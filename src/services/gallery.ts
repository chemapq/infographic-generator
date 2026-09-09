/**
 * Galería: proyección ligera de los jobs para listarlos, buscarlos y
 * paginarlos sin cargar `spec` ni `passes` completos.
 *
 * La interfaz `GalleryRepository` es la costura para el día en que esto pase
 * a una base de datos global: otra implementación (p. ej. `PgGalleryRepository`)
 * entra detrás del mismo contrato y ni el router ni la UI se enteran.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { GalleryPage, GalleryQuery, JobRecord, JobStatus, JobSummary } from '../types.js';
import { deleteJobDir, jobJsonPath, readJob, saveJob } from './store.js';

export interface GalleryRepository {
  list(query: GalleryQuery): Promise<GalleryPage>;
  get(id: string): Promise<JobSummary | null>;
  rename(id: string, title: string): Promise<JobSummary | null>;
  remove(id: string): Promise<void>;
}

/** Nombre de carpeta de job: 8 hex de `newJobId()`. Descarta `_informe_*` y demás. */
const JOB_ID_RE = /^[0-9a-f]{8}$/;

function titleOf(job: JobRecord): string {
  if (job.title && job.title.trim() !== '') return job.title.trim();
  return path.parse(job.originalName).name || job.originalName;
}

function toSummary(job: JobRecord, updatedAt: string): JobSummary {
  const bestScore = job.bestPass !== null
    ? (job.passes.find((p) => p.n === job.bestPass)?.score ?? null)
    : null;
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt,
    title: titleOf(job),
    originalName: job.originalName,
    status: job.status,
    width: job.width,
    height: job.height,
    passCount: job.passes.length,
    bestScore,
    hasResult: job.passes.length > 0,
    ownerId: job.ownerId ?? null,
  };
}

interface CacheEntry {
  mtimeMs: number;
  summary: JobSummary;
}

// Caché a nivel de módulo: se invalida por job cuando cambia el mtime de su
// job.json (una escritura del orquestador, un rename, una iteración…), no
// por tiempo. Con las decenas de jobs de hoy, un `stat` por job es barato;
// llegado a miles, esta es la costura para pasar a un índice o a la BD.
const cache = new Map<string, CacheEntry>();

async function loadSummary(id: string): Promise<JobSummary | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(jobJsonPath(id))).mtimeMs;
  } catch {
    return null;
  }
  const cached = cache.get(id);
  if (cached && cached.mtimeMs === mtimeMs) return cached.summary;

  const job = await readJob(id);
  if (!job) return null; // job.json a medio escribir: se reintenta en el siguiente listado
  const summary = toSummary(job, new Date(mtimeMs).toISOString());
  cache.set(id, { mtimeMs, summary });
  return summary;
}

async function listJobIds(): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(env.outputDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && JOB_ID_RE.test(entry.name))
    .map((entry) => entry.name);
}

async function loadAllSummaries(): Promise<JobSummary[]> {
  const ids = await listJobIds();
  const summaries = await Promise.all(ids.map(loadSummary));
  return summaries.filter((s): s is JobSummary => s !== null);
}

function sortValue(item: JobSummary, sort: 'recent' | 'score'): number {
  return sort === 'score' ? (item.bestScore ?? -1) : Date.parse(item.updatedAt);
}

/** Orden estable: por `sort` descendente, con el id como desempate. */
function compareItems(a: JobSummary, b: JobSummary, sort: 'recent' | 'score'): number {
  const diff = sortValue(b, sort) - sortValue(a, sort);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface Cursor {
  v: number;
  id: string;
}

function encodeCursor(item: JobSummary, sort: 'recent' | 'score'): string {
  const cursor: Cursor = { v: sortValue(item, sort), id: item.id };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.v === 'number' && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

/** true si `item` va después del cursor en el mismo orden que `compareItems`. */
function isAfterCursor(item: JobSummary, cursor: Cursor, sort: 'recent' | 'score'): boolean {
  const v = sortValue(item, sort);
  if (v !== cursor.v) return v < cursor.v;
  return item.id > cursor.id;
}

export class FsGalleryRepository implements GalleryRepository {
  async list(query: GalleryQuery): Promise<GalleryPage> {
    const sort = query.sort ?? 'recent';
    const limit = Math.min(Math.max(query.limit || env.galleryPageSize, 1), 60);

    let items = await loadAllSummaries();

    if ((query.strictOwner || env.galleryScope === 'owner') && query.ownerId) {
      const owner = query.ownerId;
      // Los jobs sin dueño (anteriores a la cookie `ig_owner`) se cuelan en el
      // modo laxo para que el historial previo no pareciera desaparecer. En el
      // estricto no: ahí el dueño es una persona y "de nadie" no es "de todos".
      items = query.strictOwner
        ? items.filter((item) => item.ownerId === owner)
        : items.filter((item) => item.ownerId === owner || item.ownerId === null);
    }

    if (query.status && query.status !== 'all') {
      const status: JobStatus = query.status;
      items = items.filter((item) => item.status === status);
    }

    if (query.q && query.q.trim() !== '') {
      const needle = query.q.trim().toLowerCase();
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(needle) ||
          item.originalName.toLowerCase().includes(needle) ||
          item.id.includes(needle),
      );
    }

    items.sort((a, b) => compareItems(a, b, sort));
    const total = items.length;

    let start = 0;
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      start = cursor ? items.findIndex((item) => isAfterCursor(item, cursor, sort)) : -1;
      if (start === -1) start = items.length; // cursor caducado (p. ej. el job se borró): sin más páginas
    }

    const page = items.slice(start, start + limit);
    const nextCursor =
      start + limit < items.length ? encodeCursor(page[page.length - 1], sort) : null;

    return { items: page, nextCursor, total };
  }

  async get(id: string): Promise<JobSummary | null> {
    if (!JOB_ID_RE.test(id)) return null;
    return loadSummary(id);
  }

  async rename(id: string, title: string): Promise<JobSummary | null> {
    if (!JOB_ID_RE.test(id)) return null;
    const job = await readJob(id);
    if (!job) return null;
    job.title = title;
    await saveJob(job);
    cache.delete(id); // la escritura atómica cambia el mtime: se releerá en el próximo listado
    return loadSummary(id);
  }

  async remove(id: string): Promise<void> {
    if (!JOB_ID_RE.test(id)) return;
    await deleteJobDir(id);
    cache.delete(id);
  }
}

export const galleryRepository: GalleryRepository = new FsGalleryRepository();
