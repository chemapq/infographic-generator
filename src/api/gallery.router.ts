import { Router } from 'express';
import type { GalleryQuery, JobStatus } from '../types.js';
import { readEmbedSession } from '../services/embed.js';
import { galleryRepository } from '../services/gallery.js';

export const galleryRouter = Router();

const VALID_STATUSES: readonly JobStatus[] = [
  'queued', 'analyzing', 'generating', 'rendering', 'comparing', 'refining', 'iterating', 'done', 'failed',
];

/** GET /api/gallery?limit&cursor&q&status&sort — historial de infografías generadas. */
galleryRouter.get('/', async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? ''), 10);
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
  const status: JobStatus | 'all' | undefined =
    statusRaw === 'all' || (statusRaw && (VALID_STATUSES as string[]).includes(statusRaw))
      ? (statusRaw as JobStatus | 'all')
      : undefined;
  const sort = req.query.sort === 'score' ? 'score' : 'recent';

  const query: GalleryQuery = {
    limit: Number.isNaN(limit) ? 24 : limit,
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    status,
    sort,
    ownerId: req.ownerId ?? null,
    // Desde el iframe de Moodle cada profesor ve solo lo suyo, sin depender
    // de cómo esté puesto GALLERY_SCOPE en el despliegue.
    strictOwner: readEmbedSession(req) !== null,
  };

  res.json(await galleryRepository.list(query));
});
