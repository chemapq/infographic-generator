import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { env } from '../config/env.js';
import { galleryRepository } from '../services/gallery.js';
import type { IterateTarget } from '../services/claude/prompts.js';
import { describeUnsupportedImage } from '../services/errors.js';
import { isSupportedImageKind, sniffImageKind } from '../services/image.js';
import {
  createJob,
  currentResultPass,
  forgetJob,
  getJob,
  getJobRecord,
  requestIteration,
  subscribe,
} from '../services/orchestrator.js';
import { jobDir, passesDir, readPassFile } from '../services/store.js';
import { ensureThumb } from '../services/thumbs.js';
import { openSse } from './sse.js';

export const jobsRouter = Router();

/** Nombre de carpeta de job: los 8 hex de `newJobId()`. */
const JOB_ID_RE = /^[0-9a-f]{8}$/;

// Sin filtro por tipo MIME: el navegador lo deduce de la extensión y miente a
// menudo (un HEIC renombrado llega como image/jpeg). El formato real se
// comprueba luego mirando los bytes, que es lo que de verdad importa.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
});

/** POST /api/jobs — multipart con la imagen (+ maxPasses, notes). Arranca el pipeline. */
jobsRouter.post('/', upload.single('image'), async (req, res) => {
  if (!req.file || req.file.size === 0) {
    res.status(400).json({
      error: 'No llegó ninguna imagen. Elige un archivo PNG, JPEG, WebP o GIF y vuelve a intentarlo.',
    });
    return;
  }

  const kind = sniffImageKind(req.file.buffer);
  if (!isSupportedImageKind(kind)) {
    const { status, message, detail } = describeUnsupportedImage(kind, req.file.mimetype);
    res.status(status).json({ error: message, detail });
    return;
  }

  const requested = Number.parseInt(String(req.body.maxPasses ?? ''), 10);
  const maxPasses = Number.isNaN(requested) ? env.maxPasses : Math.min(Math.max(requested, 1), 8);
  const notes = typeof req.body.notes === 'string' && req.body.notes.trim() !== ''
    ? req.body.notes.trim()
    : undefined;

  const record = await createJob(
    req.file.buffer,
    req.file.originalname,
    { maxPasses, notes },
    req.ownerId ?? null,
  );
  res.status(201).json({ jobId: record.id });
});

/** GET /api/jobs/:id — estado del job. */
jobsRouter.get('/:id', async (req, res) => {
  const record = await getJobRecord(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  res.json(record);
});

/** GET /api/jobs/:id/events — SSE: replay + progreso en vivo. */
jobsRouter.get('/:id/events', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const sse = openSse(res);
  const { replay, emitter } = subscribe(job);
  for (const event of replay) sse.send(event);

  const listener = sse.send;
  emitter.on('event', listener);
  req.on('close', () => {
    emitter.off('event', listener);
    sse.close();
  });
});

/** Recorta un campo de texto del cuerpo; devuelve undefined si viene vacío. */
function field(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, maxLength);
}

/**
 * POST /api/jobs/:id/iterate — ajuste dirigido por el usuario. Con `target`
 * (elemento señalado en el editor visual) la petición se acota a ese elemento.
 */
jobsRouter.post('/:id/iterate', async (req, res) => {
  const prompt = field(req.body?.prompt, 2000);
  if (!prompt) {
    res.status(400).json({ error: 'Falta el campo "prompt".' });
    return;
  }
  const raw = req.body?.target;
  const label = raw && typeof raw === 'object' ? field(raw.label, 200) : undefined;
  const target: IterateTarget | undefined = label
    ? {
        label,
        selector: field(raw.selector, 500),
        html: field(raw.html, 4000),
        text: field(raw.text, 400),
      }
    : undefined;

  try {
    const record = await requestIteration(req.params.id, prompt, target);
    res.status(202).json({ jobId: record.id, queued: true });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** GET /api/jobs/:id/result — HTML final (o ?pass=n para versiones anteriores). */
jobsRouter.get('/:id/result', async (req, res) => {
  const record = await getJobRecord(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const requested = Number.parseInt(String(req.query.pass ?? ''), 10);
  const pass = Number.isNaN(requested)
    ? currentResultPass(record)
    : (record.passes.find((p) => p.n === requested) ?? null);
  if (!pass) {
    res.status(404).json({ error: 'El job no tiene todavía ninguna pasada con HTML.' });
    return;
  }
  const html = await readPassFile(record.id, pass.htmlFile);
  res
    .status(200)
    .type('html')
    .setHeader('Content-Disposition', `inline; filename="${record.id}-pass-${pass.n}.html"`)
    .send(html);
});

/** GET /api/jobs/:id/assets/... — original, capturas y diffs para el side-by-side. */
jobsRouter.get('/:id/assets/passes/:file', async (req, res) => {
  const record = await getJobRecord(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  res.sendFile(path.join(passesDir(record.id), path.basename(req.params.file)));
});

jobsRouter.get('/:id/assets/:file', async (req, res) => {
  const record = await getJobRecord(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  res.sendFile(path.join(jobDir(record.id), path.basename(req.params.file)));
});

/** GET /api/jobs/:id/thumb — miniatura para la galería, generada a demanda. */
jobsRouter.get('/:id/thumb', async (req, res) => {
  const thumb = await ensureThumb(req.params.id);
  if (!thumb) {
    res.status(404).json({ error: 'Job no encontrado, o todavía sin ninguna imagen que mostrar.' });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('ETag', `"${thumb.mtimeMs}"`);
  res.type('webp').sendFile(thumb.file);
});

/** PATCH /api/jobs/:id — { title } renombra el job en la galería. */
jobsRouter.patch('/:id', async (req, res) => {
  if (!JOB_ID_RE.test(req.params.id)) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
  if (!title) {
    res.status(400).json({ error: 'El título no puede estar vacío.' });
    return;
  }
  const summary = await galleryRepository.rename(req.params.id, title);
  if (!summary) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  res.json({ id: summary.id, title: summary.title });
});

/** DELETE /api/jobs/:id — borra el job. 409 si sigue en curso. */
jobsRouter.delete('/:id', async (req, res) => {
  if (!JOB_ID_RE.test(req.params.id)) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const record = await getJobRecord(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  if (record.status !== 'done' && record.status !== 'failed') {
    res.status(409).json({ error: 'El job todavía está en curso: espera a que termine para borrarlo.' });
    return;
  }
  await galleryRepository.remove(req.params.id);
  forgetJob(req.params.id);
  res.status(204).end();
});
