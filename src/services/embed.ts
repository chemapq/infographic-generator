/**
 * Sesión de embed: la app servida dentro de un iframe del plugin de Moodle.
 *
 * Dos firmas distintas, a propósito:
 *
 *   1. El **ticket** lo firma Moodle con `EMBED_SECRET`, el secreto compartido
 *      entre los dos lados. Dice quién es el usuario y caduca en 120 s: es un
 *      pase de un solo salto, para llegar de `index.php` a `GET /embed`.
 *   2. El **token de sesión** lo firma el motor con `AUTH_SECRET`, que no sale
 *      de aquí. Es el que la app arrastra en `?t=` durante toda la sesión.
 *
 * Así un Moodle comprometido no puede emitir sesiones largas, y el motor no
 * necesita compartir su propio secreto con nadie.
 *
 * El token va en la querystring y no en una cabecera `Authorization` porque
 * `public/api.js` construye con él `<img src>`, el `<iframe src>` del
 * resultado y los `<a download>` — ahí no hay forma de poner cabeceras.
 * `IG_CONFIG.extraParams` ya existía para eso (nació para el `sesskey` de
 * Moodle). El efecto secundario es bueno: sin cookies, el bloqueo de cookies
 * de terceros de Safari/Chrome no afecta a un iframe cross-site.
 *
 * Formato de los dos, idéntico: `v1.<base64url(JSON)>.<base64url(HMAC-SHA256)>`,
 * con `exp` en **segundos** Unix (no milisegundos: el otro lado es PHP y
 * `time()` da segundos).
 */
import crypto from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env.js';
import { sameSecret } from './auth.js';

export interface EmbedSession {
  /** `ownerId` de los jobs de esta sesión. Lo fija Moodle: `moodle:<hash sitio>:<userid>`. */
  owner: string;
  /** Nombre del usuario. Solo para los logs; la app no lo usa. */
  name?: string;
  /** `false` = sin capability de edición (o IA desactivada en el plugin): se rechazan `iterate` y `text-edit`. */
  edit: boolean;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function signPayload(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `v1.${body}.${sign(body, secret)}`;
}

/** El payload si la firma cuadra y no ha caducado; `null` en cualquier otro caso. */
function verifyPayload(token: string, secret: string): Record<string, unknown> | null {
  if (secret === '') return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || parts[1] === '' || parts[2] === '') return null;
  const [, body, signature] = parts;

  if (!sameSecret(signature, sign(body, secret))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

  const record = payload as Record<string, unknown>;
  const exp = Number(record.exp);
  if (!Number.isFinite(exp) || exp <= nowSeconds()) return null;

  return record;
}

/**
 * El `owner` acaba escrito en `job.json` y en los logs, así que se acota aquí:
 * ni vacío, ni kilométrico, ni con caracteres que ensucien una línea de log.
 */
function toSession(record: Record<string, unknown>): EmbedSession | null {
  const owner = typeof record.owner === 'string' ? record.owner.trim() : '';
  if (owner === '' || owner.length > 128 || !/^[\w:.@-]+$/.test(owner)) return null;

  const name = typeof record.name === 'string' ? record.name.trim().slice(0, 120) : '';
  return {
    owner,
    name: name === '' ? undefined : name,
    // Solo `true` literal habilita la edición: un payload al que le falte el
    // campo se queda sin ella, nunca al contrario.
    edit: record.edit === true,
  };
}

/** `true` si hay `EMBED_SECRET`: el motor puede aceptar tickets de Moodle. */
export function embedEnabled(): boolean {
  return env.embedSecret !== '';
}

/** Valida un ticket recién emitido por Moodle. */
export function verifyTicket(ticket: unknown): EmbedSession | null {
  if (!embedEnabled() || typeof ticket !== 'string' || ticket === '') return null;
  const record = verifyPayload(ticket, env.embedSecret);
  return record ? toSession(record) : null;
}

/** Emite el token que la app llevará en `?t=` durante `EMBED_SESSION_HOURS`. */
export function issueEmbedToken(session: EmbedSession): string {
  return signPayload(
    {
      owner: session.owner,
      name: session.name,
      edit: session.edit,
      exp: nowSeconds() + env.embedSessionHours * 3600,
    },
    env.authSecret,
  );
}

// Cacheado en la propia petición: el token lo miran el guardián, el middleware
// de dueño y la ruta, y verificar tres HMAC por petición no tiene sentido.
const CACHE = Symbol('embedSession');

/** La sesión de embed de esta petición (de `?t=`), o `null` si no es una. */
export function readEmbedSession(req: Request): EmbedSession | null {
  const holder = req as Request & { [CACHE]?: EmbedSession | null };
  if (CACHE in holder) return holder[CACHE] ?? null;

  const token = req.query?.t;
  const record = typeof token === 'string' && token !== '' ? verifyPayload(token, env.authSecret) : null;
  const session = record ? toSession(record) : null;

  holder[CACHE] = session;
  return session;
}
