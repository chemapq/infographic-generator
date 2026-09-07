/**
 * Router de la API v1 (`/api/v1`): pensada para un cliente servidor-a-servidor
 * (bearer token, sondeo, idempotencia), no para el navegador con sesión que
 * consume `/api/jobs`. Se monta antes del guardián de cookie de index.ts, así
 * que su autenticación es la única que le aplica. Ver PLAN_MOODLE.md §3.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { MulterError } from 'multer';
import { env } from '../../config/env.js';
import { describeError } from '../../services/errors.js';
import { resolveApiKey } from './keys.js';
import { v1EditRouter } from './edit.router.js';
import { v1JobsRouter } from './jobs.router.js';

export const v1Router = Router();

declare module 'express-serve-static-core' {
  interface Request {
    /** `ownerId` de la clave bearer que autenticó la petición. Solo en rutas de `/api/v1`. */
    apiOwnerId: string;
  }
}

/** Público y sin clave: el botón «probar conexión» del plugin y los healthchecks del host. */
v1Router.get('/health', (_req, res) => {
  res.json({ ok: true, model: env.anthropicModel, maxPasses: env.maxPasses, version: env.version });
});

v1Router.use((req, res, next) => {
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
  const ownerId = resolveApiKey(bearer);
  if (!ownerId) {
    res.status(401).json({ code: 'unauthorized', error: 'Falta un token bearer válido en la cabecera Authorization.' });
    return;
  }
  req.apiOwnerId = ownerId;
  next();
});

v1Router.use('/jobs', v1JobsRouter);
v1Router.use('/edit', v1EditRouter);

// Manejador de errores propio: todo fallo de /api/v1 lleva un `code` estable,
// a diferencia del manejador global de index.ts (pensado para el navegador).
v1Router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        code: 'image_too_large',
        error: `La imagen pesa más de ${env.maxUploadMb} MB.`,
      });
      return;
    }
    res.status(400).json({
      code: 'bad_request',
      error: 'La subida no llegó completa al servidor.',
      detail: `${error.code}: ${error.message}`,
    });
    return;
  }
  const friendly = describeError(error);
  console.error('[api/v1]', friendly.message, friendly.detail ? `— ${friendly.detail}` : '');
  res.status(friendly.status).json({ code: 'internal_error', error: friendly.message, detail: friendly.detail });
});
