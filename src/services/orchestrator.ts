import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import { env } from '../config/env.js';
import type { JobEvent, JobOptions, JobRecord, PassRecord } from '../types.js';
import { analyzeImage } from './claude/analyze.js';
import { addUsage, emptyUsage, JobConversation, type CallUsage } from './claude/client.js';
import { compareRender } from './claude/compare.js';
import { generateHtml } from './claude/generate.js';
import {
  generateInstruction,
  iterateInstruction,
  refineInstruction,
  type IterateTarget,
} from './claude/prompts.js';
import type { Verdict } from './claude/schemas.js';
import { diffImages } from './differ.js';
import { describeError } from './errors.js';
import { renderHtml } from './renderer.js';
import {
  initJobDir,
  newJobId,
  readJob,
  readOriginal,
  readPassFile,
  saveJob,
  saveOriginal,
  savePassFile,
} from './store.js';
import { sanitizeHtml } from './validator.js';

interface ActiveJob {
  record: JobRecord;
  emitter: EventEmitter;
  /** Eventos pasados para replay al conectar el SSE (sin progresos transitorios). */
  events: JobEvent[];
  convo: JobConversation | null;
  sanitizerWarnings: string[];
}

const jobs = new Map<string, ActiveJob>();

// Fase 1: los pipelines se procesan en serie.
let queue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task, task);
}

function emit(job: ActiveJob, type: JobEvent['type'], data: Record<string, unknown>): void {
  const event: JobEvent = { type, data, at: new Date().toISOString() };
  if (type !== 'generate:progress') job.events.push(event);
  job.emitter.emit('event', event);
}

async function setStatus(job: ActiveJob, status: JobRecord['status']): Promise<void> {
  job.record.status = status;
  emit(job, 'status', { status });
  await saveJob(job.record);
}

async function downscaleForClaude(png: Buffer): Promise<string> {
  const buffer = await sharp(png)
    .resize(env.intermediateImageEdge, env.intermediateImageEdge, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  return buffer.toString('base64');
}

export async function createJob(
  image: Buffer,
  originalName: string,
  options: JobOptions,
): Promise<JobRecord> {
  // Preprocesado con sharp: orientación EXIF y <= 2576 px de lado largo.
  const normalized = await sharp(image)
    .rotate()
    .resize(env.maxImageEdge, env.maxImageEdge, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  const id = newJobId();
  await initJobDir(id);
  await saveOriginal(id, normalized.data);

  const record: JobRecord = {
    id,
    createdAt: new Date().toISOString(),
    status: 'queued',
    options,
    originalName,
    width: normalized.info.width,
    height: normalized.info.height,
    spec: null,
    passes: [],
    bestPass: null,
    totalUsage: emptyUsage(),
    stopReason: null,
    error: null,
  };

  const job: ActiveJob = {
    record,
    emitter: new EventEmitter(),
    events: [],
    convo: null,
    sanitizerWarnings: [],
  };
  jobs.set(id, job);
  await saveJob(record);

  enqueue(() => runPipeline(job));
  return record;
}

/** Job desde memoria o disco (reabrible tras reiniciar el servidor). */
export async function getJob(jobId: string): Promise<ActiveJob | null> {
  const active = jobs.get(jobId);
  if (active) return active;
  const record = await readJob(jobId);
  if (!record) return null;
  const job: ActiveJob = {
    record,
    emitter: new EventEmitter(),
    events: [],
    convo: null,
    sanitizerWarnings: [],
  };
  jobs.set(jobId, job);
  return job;
}

export async function getJobRecord(jobId: string): Promise<JobRecord | null> {
  return (await getJob(jobId))?.record ?? null;
}

export function subscribe(job: ActiveJob): { replay: JobEvent[]; emitter: EventEmitter } {
  return { replay: job.events, emitter: job.emitter };
}

/** Pasada que ve el usuario en el resultado: última iteración o la mejor del bucle. */
export function currentResultPass(record: JobRecord): PassRecord | null {
  const iterations = record.passes.filter((p) => p.kind === 'iterate');
  if (iterations.length > 0) return iterations[iterations.length - 1];
  if (record.bestPass !== null) {
    return record.passes.find((p) => p.n === record.bestPass) ?? null;
  }
  return record.passes[record.passes.length - 1] ?? null;
}

async function runPass(
  job: ActiveJob,
  passNumber: number,
  kind: PassRecord['kind'],
  instruction: string,
  originalPng: Buffer,
): Promise<{ pass: PassRecord; renderPng: Buffer; diffPng: Buffer }> {
  const { record } = job;
  emit(job, 'pass:start', { n: passNumber, kind });

  // 1. Generar / refinar HTML (streaming).
  await setStatus(job, kind === 'generate' ? 'generating' : kind === 'refine' ? 'refining' : 'iterating');
  let lastEmit = 0;
  const generation = await generateHtml(job.convo as JobConversation, instruction, (chars) => {
    const now = Date.now();
    if (now - lastEmit > 400) {
      lastEmit = now;
      emit(job, 'generate:progress', { n: passNumber, chars });
    }
  });
  const { html, warnings } = sanitizeHtml(generation.html);
  job.sanitizerWarnings = warnings;
  const htmlFile = `pass-${passNumber}.html`;
  await savePassFile(record.id, htmlFile, html);

  // 2. Renderizar con Playwright.
  await setStatus(job, 'rendering');
  const renderPng = await renderHtml(html, { width: record.width, height: record.height });
  const screenshotFile = `pass-${passNumber}.png`;
  await savePassFile(record.id, screenshotFile, renderPng);
  emit(job, 'render:done', { n: passNumber, screenshot: `passes/${screenshotFile}` });

  // 3. Métrica pixelmatch + heatmap.
  const { score, diffPng } = await diffImages(originalPng, renderPng);
  const diffFile = `pass-${passNumber}-diff.png`;
  await savePassFile(record.id, diffFile, diffPng);

  const pass: PassRecord = {
    n: passNumber,
    kind,
    score,
    verdict: null,
    usage: generation.usage,
    htmlFile,
    screenshotFile,
    diffFile,
    createdAt: new Date().toISOString(),
  };
  return { pass, renderPng, diffPng };
}

function accumulate(job: ActiveJob, usage: CallUsage): void {
  job.record.totalUsage = addUsage(job.record.totalUsage, usage);
}

function updateBestPass(record: JobRecord): void {
  let best: PassRecord | null = null;
  for (const pass of record.passes) {
    if (pass.kind === 'iterate' || pass.score === null) continue;
    if (!best || pass.score > (best.score ?? -1)) best = pass;
  }
  record.bestPass = best?.n ?? null;
}

async function runPipeline(job: ActiveJob): Promise<void> {
  const { record } = job;
  try {
    const originalPng = await readOriginal(record.id);
    const originalB64 = originalPng.toString('base64');

    // Pasada 0 — análisis (una sola vez).
    job.convo = new JobConversation();
    await setStatus(job, 'analyzing');
    const analysis = await analyzeImage(job.convo, originalB64);
    record.spec = analysis.spec;
    accumulate(job, analysis.usage);
    emit(job, 'analyze:done', {
      palette: analysis.spec.palette,
      texts: analysis.spec.texts.length,
      layers: analysis.spec.layers.length,
      photoZones: analysis.spec.photoZones.length,
      usage: analysis.usage,
    });
    await saveJob(record);

    let previousScore: number | null = null;
    let smallImprovements = 0;
    let drops = 0;
    let verdict: Verdict | null = null;

    for (let n = 1; n <= record.options.maxPasses; n++) {
      const kind = n === 1 ? 'generate' : 'refine';
      let instruction: string;
      if (n === 1) {
        instruction = generateInstruction(record.width, record.height);
        if (record.options.notes) {
          instruction += `\n\nNotas del usuario a tener en cuenta: ${record.options.notes}`;
        }
      } else {
        instruction = refineInstruction(verdict as Verdict, job.sanitizerWarnings);
      }

      const { pass, renderPng, diffPng } = await runPass(job, n, kind, instruction, originalPng);
      const score = pass.score as number;

      // 4. Juicio de Claude (doble señal): capturas a resolución reducida.
      await setStatus(job, 'comparing');
      const comparison = await compareRender(
        job.convo,
        await downscaleForClaude(renderPng),
        await downscaleForClaude(diffPng),
        n,
        score,
        previousScore,
      );
      verdict = comparison.verdict;
      pass.verdict = verdict;
      pass.usage = addUsage(pass.usage, comparison.usage);
      accumulate(job, pass.usage);
      record.passes.push(pass);
      updateBestPass(record);
      await saveJob(record);
      emit(job, 'compare:done', {
        n,
        score,
        closeEnough: verdict.closeEnough,
        summary: verdict.summary,
        discrepancies: verdict.discrepancies,
        regressions: verdict.regressions,
      });
      emit(job, 'pass:done', {
        n,
        kind,
        score,
        cacheReadTokens: pass.usage.cacheReadTokens,
      });

      // Criterio de parada.
      const improvement = previousScore === null ? null : score - previousScore;
      if (improvement !== null && improvement < 0.5) smallImprovements++;
      else smallImprovements = 0;
      if (improvement !== null && improvement < 0) drops++;
      else drops = 0;

      if (verdict.closeEnough && (improvement === null || improvement >= 0)) {
        record.stopReason = 'closeEnough: el veredicto da la reproducción por buena';
        break;
      }
      if (score >= env.targetScore) {
        record.stopReason = `score ${score.toFixed(2)}% >= objetivo ${env.targetScore}%`;
        break;
      }
      if (drops >= 2) {
        record.stopReason = `el score cayó dos pasadas seguidas: se revierte a la mejor pasada (${record.bestPass})`;
        break;
      }
      if (smallImprovements >= 2) {
        record.stopReason = 'score estancado (< +0,5 pt en dos pasadas consecutivas)';
        break;
      }
      if (n === record.options.maxPasses) {
        record.stopReason = `alcanzado MAX_PASSES (${record.options.maxPasses})`;
      }
      previousScore = score;
    }

    record.status = 'done';
    await saveJob(record);
    emit(job, 'job:done', {
      bestPass: record.bestPass,
      stopReason: record.stopReason,
      totalUsage: record.totalUsage,
    });
  } catch (error) {
    record.status = 'failed';
    record.error = describeError(error).message;
    await saveJob(record).catch(() => {});
    emit(job, 'job:failed', { error: record.error });
  }
}

/**
 * Iteración final dirigida por el usuario: una pasada más con sus
 * instrucciones como prioridad. Repetible; queda versionada en passes/.
 */
export async function requestIteration(
  jobId: string,
  prompt: string,
  target?: IterateTarget,
): Promise<JobRecord> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} no encontrado`);
  if (job.record.status !== 'done') {
    throw new Error('El job debe estar terminado antes de iterar con un prompt.');
  }
  enqueue(() => runIteration(job, prompt, target));
  return job.record;
}

async function runIteration(
  job: ActiveJob,
  prompt: string,
  target?: IterateTarget,
): Promise<void> {
  const { record } = job;
  try {
    const originalPng = await readOriginal(record.id);
    const basePass = currentResultPass(record);
    if (!basePass) throw new Error('El job no tiene ninguna pasada sobre la que iterar.');
    const currentHtml = (await readPassFile(record.id, basePass.htmlFile)).toString('utf8');

    // Si el servidor se reinició, la conversación se reconstruye con el
    // contexto mínimo: imagen original + HTML actual.
    if (!job.convo) {
      job.convo = new JobConversation();
      job.convo.pushUser([
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: originalPng.toString('base64') },
        },
        { type: 'text', text: 'Esta es la infografía original de referencia.' },
      ]);
    }

    const passNumber = (record.passes[record.passes.length - 1]?.n ?? 0) + 1;
    const instruction =
      `HTML actual sobre el que aplicar los cambios:\n\n${currentHtml}\n\n` +
      iterateInstruction(prompt, target);

    const { pass } = await runPass(job, passNumber, 'iterate', instruction, originalPng);
    pass.userPrompt = prompt;
    if (target) pass.targetLabel = target.label;
    accumulate(job, pass.usage);
    record.passes.push(pass);
    record.error = null; // el ajuste salió bien: se limpia un fallo anterior
    record.status = 'done';
    await saveJob(record);
    emit(job, 'pass:done', {
      n: pass.n,
      kind: 'iterate',
      score: pass.score,
    });
    emit(job, 'job:done', {
      bestPass: record.bestPass,
      stopReason: record.stopReason,
      totalUsage: record.totalUsage,
      iteratedPass: pass.n,
    });
  } catch (error) {
    record.status = 'done'; // la iteración falla, pero el resultado previo sigue siendo válido
    record.error = describeError(error).message;
    await saveJob(record).catch(() => {});
    emit(job, 'job:failed', { error: record.error, during: 'iterate' });
  }
}
