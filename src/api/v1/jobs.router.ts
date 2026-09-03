/**
 * Endpoints de `/api/v1/jobs`: pensados para un cliente servidor-a-servidor
 * (el plugin de Moodle) que sondea en vez de sostener una conexión SSE, y que
 * necesita respuestas pequeñas y códigos de error estables. Ver PLAN_MOODLE.md §3.
 */
import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { galleryRepository } from '../../services/gallery.js';
import { describeUnsupportedImage } from '../../services/errors.js';
import { isSupportedImageKind, sniffImageKind } from '../../services/image.js';
import {
  createJob,
  currentResultPass,
  estimateWaitSeconds,
  forgetJob,
  getJobRecord,
  queueDepth,
} from '../../services/orchestrator.js';
import { jobJsonPath, readOriginal, readPassFile } from '../../services/store.js';
import { ensureThumb } from '../../services/thumbs.js';
import type { JobRecord } from '../../types.js';
import { consumeQuota, quotaExceeded } from './keys.js';
import { findJobByIdempotencyKey, rememberIdempotencyKey } from './idempotency.js';
import fs from 'node:fs/promises';

export const v1JobsRouter = Router();

const JOB_ID_RE = /^[0-9a-f]{8}$/;
const MAX_TEXT_FIELD = 2000;
const MAX_IDEMPOTENCY_KEY = 200;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
});

function sendError(
  res: Response,
  status: number,
  code: string,
  error: string,
  extra?: Record<string, unknown>,
): void {
  res.status(status).json({ code, error, ...extra });
}

/** Recorta un campo de texto del cuerpo; `undefined` si viene vacío o no es texto. */
function field(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, maxLength);
}

/** Job por id, ya comprobado que pertenece al `ownerId` de la clave que llama; `null` en caso contrario. */
async function ownedJob(id: string, apiOwnerId: string): Promise<JobRecord | null> {
  if (!JOB_ID_RE.test(id)) return null;
  const record = await getJobRecord(id);
  if (!record || record.ownerId !== apiOwnerId) return null;
  return record;
}

/** Estado ligero para el sondeo: sin `spec` ni `passes[]` salvo que se pida `?include=passes`. */
async function lightStatus(record: JobRecord, includePasses: boolean): Promise<Record<string, unknown>> {
  const bestScore =
    record.bestPass !== null ? (record.passes.find((p) => p.n === record.bestPass)?.score ?? null) : null;
  const lastPass = record.passes[record.passes.length - 1] ?? null;

  let finishedAt: string | null = null;
  if (record.status === 'done' || record.status === 'failed') {
    try {
      finishedAt = (await fs.stat(jobJsonPath(record.id))).mtime.toISOString();
    } catch {
      finishedAt = null;
    }
  }

  const base: Record<string, unknown> = {
    jobId: record.id,
    status: record.status,
    progress: { pass: record.passes.length, maxPasses: record.options.maxPasses },
    currentScore: lastPass?.score ?? null,
    bestPass: record.bestPass,
    bestScore,
    passCount: record.passes.length,
    stopReason: record.stopReason,
    error: record.error,
    usage: record.totalUsage,
    createdAt: record.createdAt,
    finishedAt,
    hasResult: record.passes.length > 0,
    externalRef: record.externalRef ?? null,
  };
  if (includePasses) {
    base.spec = record.spec;
    base.passes = record.passes;
  }
  return base;
}

/** POST /api/v1/jobs — crea un job. Requiere `Idempotency-Key`. */
v1JobsRouter.post('/', upload.single('image'), async (req, res) => {
  const apiOwnerId = req.apiOwnerId;
  const idempotencyKey = field(req.headers['idempotency-key'], MAX_IDEMPOTENCY_KEY);
  if (!idempotencyKey) {
    sendError(res, 400, 'missing_idempotency_key', 'Falta la cabecera "Idempotency-Key".');
    return;
  }

  const existingJobId = findJobByIdempotencyKey(apiOwnerId, idempotencyKey);
  if (existingJobId) {
    const existing = await getJobRecord(existingJobId);
    if (existing) {
      res.status(200).json({ jobId: existing.id, status: existing.status, idempotent: true });
      return;
    }
    // El job ya no existe (borrado o purgado por retención): se trata como una petición nueva.
  }

  if (!req.file || req.file.size === 0) {
    sendError(res, 400, 'missing_image', 'No llegó ninguna imagen en el campo "image".');
    return;
  }
  const kind = sniffImageKind(req.file.buffer);
  if (!isSupportedImageKind(kind)) {
    const { message, detail } = describeUnsupportedImage(kind, req.file.mimetype);
    sendError(res, 400, 'unsupported_image', message, { detail });
    return;
  }

  if (quotaExceeded(apiOwnerId)) {
    sendError(res, 429, 'quota_exceeded', `Se alcanzó el tope de ${env.apiDailyJobLimit} jobs por día para esta clave.`);
    return;
  }
  const depth = queueDepth();
  if (depth >= env.apiMaxQueueDepth) {
    const retryAfterSeconds = estimateWaitSeconds(depth);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendError(res, 429, 'queue_full', 'La cola del motor está llena ahora mismo. Reintenta más tarde.', {
      retryAfterSeconds,
    });
    return;
  }

  const requested = Number.parseInt(String(req.body.maxPasses ?? ''), 10);
  const maxPasses = Number.isNaN(requested) ? env.maxPasses : Math.min(Math.max(requested, 1), 8);
  const notes = field(req.body.notes, MAX_TEXT_FIELD);
  const externalRef = field(req.body.externalRef, 500);

  const record = await createJob(
    req.file.buffer,
    req.file.originalname,
    { maxPasses, notes },
    apiOwnerId,
    { idempotencyKey, externalRef },
  );
  rememberIdempotencyKey(apiOwnerId, idempotencyKey, record.id);
  consumeQuota(apiOwnerId);

  res.status(202).json({ jobId: record.id, status: record.status, statusUrl: `/api/v1/jobs/${record.id}` });
});

/** GET /api/v1/jobs/:id — estado ligero. `?include=passes` añade `spec` y `passes[]`. */
v1JobsRouter.get('/:id', async (req, res) => {
  const record = await ownedJob(req.params.id, req.apiOwnerId);
  if (!record) {
    sendError(res, 404, 'job_not_found', 'Job no encontrado.');
    return;
  }
  const includePasses = req.query.include === 'passes';
  res.json(await lightStatus(record, includePasses));
});

/** GET /api/v1/jobs/:id/html — HTML final como adjunto. `?pass=n` para versiones anteriores. */
v1JobsRouter.get('/:id/html', async (req, res) => {
  const record = await ownedJob(req.params.id, req.apiOwnerId);
  if (!record) {
    sendError(res, 404, 'job_not_found', 'Job no encontrado.');
    return;
  }
  const requested = Number.parseInt(String(req.query.pass ?? ''), 10);
  const pass = Number.isNaN(requested)
    ? currentResultPass(record)
    : (record.passes.find((p) => p.n === requested) ?? null);
  if (!pass) {
    sendError(res, 404, 'no_result', 'El job no tiene todavía ninguna pasada con HTML.');
    return;
  }
  const html = await readPassFile(record.id, pass.htmlFile);
  const etag = `"${crypto.createHash('sha1').update(html).digest('hex')}"`;
  res
    .status(200)
    .type('html')
    .setHeader('Content-Disposition', `attachment; filename="${record.id}-pass-${pass.n}.html"`)
    .setHeader('ETag', etag)
    .send(html);
});

/** GET /api/v1/jobs/:id/preview.png — captura de la pasada que se muestra como resultado. */
v1JobsRouter.get('/:id/preview.png', async (req, res) => {
  const record = await ownedJob(req.params.id, req.apiOwnerId);
  if (!record) {
    sendError(res, 404, 'job_not_found', 'Job no encontrado.');
    return;
  }
  const pass = currentResultPass(record);
  if (!pass) {
    sendError(res, 404, 'no_result', 'El job no tiene todavía ninguna captura.');
    return;
  }
  const png = await readPassFile(record.id, pass.screenshotFile);
  res.type('png').send(png);
});

/** GET /api/v1/jobs/:id/thumb.webp — miniatura, reutiliza ensureThumb(). */
v1JobsRouter.get('/:id/thumb.webp', async (req, res) => {
  const record = await ownedJob(req.params.id, req.apiOwnerId);
  if (!record) {
    sendError(res, 404, 'job_not_found', 'Job no encontrado.');
    return;
  }
  const thumb = await ensureThumb(record.id);
  if (!thumb) {
    sendError(res, 404, 'no_result', 'Todavía no hay ninguna imagen que miniaturizar.');
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('ETag', `"${thumb.mtimeMs}"`);
  res.type('webp').sendFile(thumb.file);
});

/** GET /api/v1/jobs/:id/original.png — el original normalizado, para un antes/después. */
v1JobsRouter.get('/:id/original.png', async (req, res) => {
  const record = await ownedJob(req.params.id, req.apiOwnerId);
  if (!record) {
    sendError(res, 404, 'job_not_found', 'Job no encontrado.');
    return;
  }
  const png = await readOriginal(record.id);
  res.type('png').send(png);
});

/** DELETE /api/v1/jobs/:id — borra el job. 409 si sigue en curso. */
v1JobsRouter.delete('/:id', async (req, res) => {
  const record = await ownedJob(req.params.id, req.apiOwnerId);
  if (!record) {
    sendError(res, 404, 'job_not_found', 'Job no encontrado.');
    return;
  }
  if (record.status !== 'done' && record.status !== 'failed') {
    sendError(res, 409, 'job_not_finished', 'El job todavía está en curso: espera a que termine para borrarlo.');
    return;
  }
  await galleryRepository.remove(record.id);
  forgetJob(record.id);
  res.status(204).end();
});
