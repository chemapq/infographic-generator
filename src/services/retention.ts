/**
 * Barrido de `output/`: sin él, cada job de la API (30-50 MB con cinco
 * pasadas) se queda para siempre. `RETENTION_DAYS=0` (por defecto) desactiva
 * el barrido y no cambia el comportamiento actual. Seguro de usar junto al
 * plugin de Moodle: el HTML ya está copiado en la File API antes de que el
 * motor lo borre (PLAN_MOODLE.md §3.7).
 */
import fs from 'node:fs/promises';
import { env } from '../config/env.js';
import { deleteJobDir, jobJsonPath } from './store.js';

const JOB_ID_RE = /^[0-9a-f]{8}$/;
const SWEEP_INTERVAL_MS = 6 * 3600_000;

async function sweepOnce(): Promise<void> {
  const cutoff = Date.now() - env.retentionDays * 24 * 3600_000;
  let entries;
  try {
    entries = await fs.readdir(env.outputDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !JOB_ID_RE.test(entry.name)) continue;
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(jobJsonPath(entry.name))).mtimeMs;
    } catch {
      continue; // job.json a medio escribir o ya borrado: se deja para el siguiente barrido
    }
    if (mtimeMs < cutoff) {
      await deleteJobDir(entry.name).catch((error) => {
        console.error('[retention]', `no se pudo borrar ${entry.name}:`, error);
      });
    }
  }
}

/** Arranca el barrido periódico si `RETENTION_DAYS > 0`. No hace nada en caso contrario. */
export function startRetentionSweep(): void {
  if (env.retentionDays <= 0) return;
  void sweepOnce();
  setInterval(() => void sweepOnce(), SWEEP_INTERVAL_MS).unref();
}
