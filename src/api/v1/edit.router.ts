/**
 * `POST /api/v1/edit`: edición sin estado. No entra en la cola en serie del
 * motor —no es una pasada del pipeline, es una llamada a la API— así que dos
 * profesores editando a la vez no se estorban entre sí. Tiene su propio
 * semáforo de concurrencia (`API_MAX_CONCURRENT_EDITS`) para no reventar el
 * límite de la API de Anthropic. Ver PLAN_MOODLE.md §5.3.
 */
import { Router, type Response } from 'express';
import { env } from '../../config/env.js';
import { describeApiError } from '../../services/claude/client.js';
import type { IterateTarget } from '../../services/claude/prompts.js';
import { editHtml } from '../../services/editHtml.js';
import { getJobRecord } from '../../services/orchestrator.js';
import { readOriginal } from '../../services/store.js';
import { consumeEditQuota, editQuotaExceeded } from './keys.js';

export const v1EditRouter = Router();

const JOB_ID_RE = /^[0-9a-f]{8}$/;
const MAX_HTML_LENGTH = 2 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 2000;
const MAX_LABEL_LENGTH = 200;
const MAX_SELECTOR_LENGTH = 500;
const MAX_TARGET_HTML_LENGTH = 4000;
const MAX_TARGET_TEXT_LENGTH = 400;

let activeEdits = 0;

function sendError(
  res: Response,
  status: number,
  code: string,
  error: string,
  extra?: Record<string, unknown>,
): void {
  res.status(status).json({ code, error, ...extra });
}

function stringField(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, maxLength);
}

/** Valida el elemento señalado que llega en el cuerpo; `undefined` si no viene o es inválido. */
function parseTarget(raw: unknown): IterateTarget | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const label = stringField(record.label, MAX_LABEL_LENGTH);
  if (!label) return undefined;
  return {
    label,
    selector: stringField(record.selector, MAX_SELECTOR_LENGTH),
    html: stringField(record.html, MAX_TARGET_HTML_LENGTH),
    text: stringField(record.text, MAX_TARGET_TEXT_LENGTH),
  };
}

/** Original del job indicado, si existe, es del mismo dueño y sigue en disco. `null` en cualquier otro caso. */
async function ownedOriginal(jobId: unknown, apiOwnerId: string): Promise<Buffer | null> {
  if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId)) return null;
  const record = await getJobRecord(jobId);
  if (!record || record.ownerId !== apiOwnerId) return null;
  try {
    return await readOriginal(jobId);
  } catch {
    return null; // la retención ya lo purgó: se degrada sin error (ver §5.3)
  }
}

v1EditRouter.post('/', async (req, res) => {
  const apiOwnerId = req.apiOwnerId;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const html = stringField(body.html, MAX_HTML_LENGTH);
  if (typeof body.html !== 'string' || body.html.trim() === '') {
    sendError(res, 400, 'missing_html', 'Falta el campo "html".');
    return;
  }
  if (body.html.length > MAX_HTML_LENGTH) {
    sendError(res, 400, 'html_too_large', `El HTML no puede superar los ${MAX_HTML_LENGTH} bytes.`);
    return;
  }
  const prompt = stringField(body.prompt, MAX_PROMPT_LENGTH);
  if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
    sendError(res, 400, 'missing_prompt', 'Falta el campo "prompt".');
    return;
  }
  if (body.prompt.length > MAX_PROMPT_LENGTH) {
    sendError(res, 400, 'prompt_too_large', `El prompt no puede superar los ${MAX_PROMPT_LENGTH} caracteres.`);
    return;
  }

  if (editQuotaExceeded(apiOwnerId)) {
    sendError(
      res,
      429,
      'quota_exceeded',
      `Se alcanzó el tope de ${env.apiDailyEditLimit} ediciones por día para esta clave.`,
    );
    return;
  }
  if (activeEdits >= env.apiMaxConcurrentEdits) {
    const retryAfterSeconds = 5;
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendError(
      res,
      429,
      'edit_queue_full',
      'Hay demasiadas ediciones en curso ahora mismo. Reintenta en unos segundos.',
      { retryAfterSeconds },
    );
    return;
  }

  const original = await ownedOriginal(body.originalJobId, apiOwnerId);

  activeEdits++;
  try {
    const result = await editHtml({
      html: html as string,
      prompt: prompt as string,
      target: parseTarget(body.target),
      originalImageBase64: original?.toString('base64'),
    });
    consumeEditQuota(apiOwnerId);
    res.json({
      html: result.html,
      usage: result.usage,
      warnings: result.warnings,
      originalAvailable: typeof body.originalJobId === 'string' ? original !== null : undefined,
    });
  } catch (error) {
    sendError(res, 502, 'edit_failed', describeApiError(error));
  } finally {
    activeEdits--;
  }
});
