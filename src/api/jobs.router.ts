import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { env } from '../config/env.js';
import {
  createJob,
  currentResultPass,
  getJob,
  getJobRecord,
  requestIteration,
  subscribe,
} from '../services/orchestrator.js';
import { jobDir, passesDir, readPassFile } from '../services/store.js';
import { openSse } from './sse.js';

export const jobsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype));
  },
});

/** POST /api/jobs — multipart con la imagen (+ maxPasses, notes). Arranca el pipeline. */
jobsRouter.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Falta la imagen (campo "image": png, jpeg, webp o gif).' });
    return;
  }
  const requested = Number.parseInt(String(req.body.maxPasses ?? ''), 10);
  const maxPasses = Number.isNaN(requested) ? env.maxPasses : Math.min(Math.max(requested, 1), 8);
  const notes = typeof req.body.notes === 'string' && req.body.notes.trim() !== ''
    ? req.body.notes.trim()
    : undefined;

  const record = await createJob(req.file.buffer, req.file.originalname, { maxPasses, notes });
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

/** POST /api/jobs/:id/iterate — iteración final dirigida por el usuario. */
jobsRouter.post('/:id/iterate', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'Falta el campo "prompt".' });
    return;
  }
  try {
    const record = await requestIteration(req.params.id, prompt);
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
