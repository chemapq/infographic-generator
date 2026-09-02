import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { JobRecord } from '../types.js';

/**
 * Persistencia en disco: todo el estado de un trabajo vive en
 * output/<jobId>/ (imagen original, HTML y captura de cada pasada, diffs,
 * métricas, log de uso de tokens). Reabrible tras reiniciar el servidor.
 */

export function newJobId(): string {
  return randomUUID().slice(0, 8);
}

export function jobDir(jobId: string): string {
  return path.join(env.outputDir, jobId);
}

export function passesDir(jobId: string): string {
  return path.join(jobDir(jobId), 'passes');
}

export async function initJobDir(jobId: string): Promise<void> {
  await fs.mkdir(passesDir(jobId), { recursive: true });
}

export async function saveOriginal(jobId: string, png: Buffer): Promise<string> {
  const file = path.join(jobDir(jobId), 'original.png');
  await fs.writeFile(file, png);
  return file;
}

export async function readOriginal(jobId: string): Promise<Buffer> {
  return fs.readFile(path.join(jobDir(jobId), 'original.png'));
}

export async function savePassFile(
  jobId: string,
  name: string,
  content: Buffer | string,
): Promise<string> {
  const file = path.join(passesDir(jobId), name);
  await fs.writeFile(file, content);
  return file;
}

export async function readPassFile(jobId: string, name: string): Promise<Buffer> {
  // Solo nombres planos: evita path traversal.
  return fs.readFile(path.join(passesDir(jobId), path.basename(name)));
}

export function jobJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), 'job.json');
}

/** Escritura atómica (tmp + rename): la galería nunca ve un job.json a medias. */
async function writeFileAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

export async function saveJob(job: JobRecord): Promise<void> {
  await writeFileAtomic(jobJsonPath(job.id), JSON.stringify(job, null, 2));
  // Log de uso de tokens separado, tal y como pide el plan (§5).
  const usageFile = path.join(jobDir(job.id), 'usage.json');
  await fs.writeFile(
    usageFile,
    JSON.stringify(
      {
        total: job.totalUsage,
        perPass: job.passes.map((p) => ({ n: p.n, kind: p.kind, usage: p.usage })),
      },
      null,
      2,
    ),
  );
}

export async function readJob(jobId: string): Promise<JobRecord | null> {
  try {
    const raw = await fs.readFile(jobJsonPath(jobId), 'utf8');
    return JSON.parse(raw) as JobRecord;
  } catch {
    return null;
  }
}

/** Borra la carpeta completa de un job. Irreversible: solo se llama tras validar su estado. */
export async function deleteJobDir(jobId: string): Promise<void> {
  await fs.rm(jobDir(jobId), { recursive: true, force: true });
}
