/**
 * Índice en memoria de `Idempotency-Key` → `jobId`, con reconstrucción al
 * arrancar leyendo el `job.json` de cada carpeta de `output/` (igual que hace
 * gallery.ts para su caché): así un reinicio del motor no hace que un
 * reintento de la tarea de Moodle cree un job duplicado.
 */
import fs from 'node:fs/promises';
import { env } from '../../config/env.js';
import { readJob } from '../../services/store.js';

const index = new Map<string, string>(); // `${ownerId}:${idempotencyKey}` -> jobId

function indexKey(ownerId: string, idempotencyKey: string): string {
  return `${ownerId}:${idempotencyKey}`;
}

export function rememberIdempotencyKey(ownerId: string, idempotencyKey: string, jobId: string): void {
  index.set(indexKey(ownerId, idempotencyKey), jobId);
}

export function findJobByIdempotencyKey(ownerId: string, idempotencyKey: string): string | undefined {
  return index.get(indexKey(ownerId, idempotencyKey));
}

const JOB_ID_RE = /^[0-9a-f]{8}$/;

/** Recorre `output/` una vez al arrancar y repuebla el índice desde disco. */
export async function rebuildIdempotencyIndex(): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(env.outputDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !JOB_ID_RE.test(entry.name)) continue;
    const job = await readJob(entry.name);
    if (job?.idempotencyKey && job.ownerId) {
      rememberIdempotencyKey(job.ownerId, job.idempotencyKey, job.id);
    }
  }
}
