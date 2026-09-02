/**
 * Etiqueta de conveniencia para agrupar jobs en la galería, no un control de
 * acceso: no hay usuarios reales todavía (el login es una contraseña única
 * compartida, ver auth.ts), así que la cookie solo distingue "quién subió
 * esto desde este navegador". No se firma a propósito: si `AUTH_SECRET` no
 * está definido se regenera en cada arranque (env.ts), y firmar con él haría
 * que el historial pareciera "desaparecer" al reiniciar en local.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'ig_owner';
const MAX_AGE_MS = 365 * 24 * 3600_000;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

declare module 'express-serve-static-core' {
  interface Request {
    ownerId: string;
  }
}

/** Asigna (o lee) el `ownerId` de la petición antes de que llegue a las rutas. */
export function ownerMiddleware(req: Request, res: Response, next: NextFunction): void {
  let ownerId = readCookie(req, COOKIE_NAME);
  if (!ownerId) {
    ownerId = randomUUID();
    res.cookie(COOKIE_NAME, ownerId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      maxAge: MAX_AGE_MS,
      path: '/',
    });
  }
  req.ownerId = ownerId;
  next();
}
