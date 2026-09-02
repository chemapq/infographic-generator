/**
 * Miniatura de un job para la galería, generada a demanda (no al terminar el
 * pipeline): así los jobs que ya existían antes de la galería aparecen solos,
 * sin ningún paso de migración.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { currentResultPass, getJobRecord } from './orchestrator.js';
import { jobDir } from './store.js';

function thumbPath(jobId: string): string {
  return path.join(jobDir(jobId), 'thumb.webp');
}

/** Misma pasada que ve el usuario en el resultado; sin pasadas aún, la imagen original. */
function thumbSourcePath(jobId: string, record: Awaited<ReturnType<typeof getJobRecord>>): string {
  const pass = record ? currentResultPass(record) : null;
  return pass
    ? path.join(jobDir(jobId), 'passes', pass.screenshotFile)
    : path.join(jobDir(jobId), 'original.png');
}

export interface ThumbResult {
  file: string;
  mtimeMs: number;
}

/**
 * Devuelve la ruta de la miniatura, regenerándola si no existe o si la
 * captura fuente es más nueva (una iteración cambia el resultado). `null` si
 * el job no existe o todavía no tiene ni pasadas ni imagen original.
 */
export async function ensureThumb(jobId: string): Promise<ThumbResult | null> {
  const record = await getJobRecord(jobId);
  if (!record) return null;

  const src = thumbSourcePath(jobId, record);
  let srcStat;
  try {
    srcStat = await fs.stat(src);
  } catch {
    return null;
  }

  const dest = thumbPath(jobId);
  try {
    const destStat = await fs.stat(dest);
    if (destStat.mtimeMs >= srcStat.mtimeMs) return { file: dest, mtimeMs: destStat.mtimeMs };
  } catch {
    // sin miniatura todavía: se genera abajo
  }

  const buffer = await sharp(src)
    .resize({ width: env.thumbWidth, withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();
  const tmp = `${dest}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, dest);

  const written = await fs.stat(dest);
  return { file: dest, mtimeMs: written.mtimeMs };
}
