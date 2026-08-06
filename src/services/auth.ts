/**
 * Pantalla de login para los despliegues.
 *
 * El login se activa definiendo `AUTH_PASSWORD`: en local se deja vacía y la
 * app se abre directamente; al desplegar se define y toda la herramienta queda
 * detrás de la pantalla de acceso. En producción (`NODE_ENV=production`) es
 * obligatoria y el servidor se niega a arrancar sin ella.
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';

const COOKIE_NAME = 'ig_session';

export function authEnabled(): boolean {
  return env.authPassword !== '';
}

/* ───────────── sesión firmada en cookie ───────────── */

function sign(payload: string): string {
  return crypto.createHmac('sha256', env.authSecret).update(payload).digest('base64url');
}

/** Comparación en tiempo constante, sin filtrar la longitud. */
function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function passwordMatches(candidate: string): boolean {
  if (env.authPassword === '') return false;
  return sameSecret(candidate, env.authPassword);
}

/**
 * Marca de las sesiones válidas. Al cerrar sesión avanza, y con ella caducan
 * todos los tokens emitidos antes: sin esto, "cerrar sesión" solo borraría la
 * cookie del navegador y el token seguiría sirviendo hasta su expiración.
 * También se renueva al reiniciar el servidor.
 */
let sessionEpoch = Date.now();

function issueToken(): string {
  const payload = `${Date.now() + env.authSessionHours * 3600_000}:${sessionEpoch}`;
  return `${payload}.${sign(payload)}`;
}

function tokenIsValid(token: string | undefined): boolean {
  if (!token) return false;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;
  const payload = token.slice(0, separator);
  if (!sameSecret(token.slice(separator + 1), sign(payload))) return false;
  const [expiresAt, epoch] = payload.split(':').map(Number);
  return (
    Number.isFinite(expiresAt) && expiresAt > Date.now() && epoch === sessionEpoch
  );
}

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

export function isAuthenticated(req: Request): boolean {
  return tokenIsValid(readCookie(req, COOKIE_NAME));
}

export function startSession(req: Request, res: Response): void {
  res.cookie(COOKIE_NAME, issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: env.authSessionHours * 3600_000,
    path: '/',
  });
}

export function endSession(res: Response): void {
  sessionEpoch = Date.now();
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/* ───────────── freno a la fuerza bruta ───────────── */

interface Attempts {
  fails: number;
  blockedUntil: number;
}

const attempts = new Map<string, Attempts>();

function clientKey(req: Request): string {
  return req.socket.remoteAddress ?? 'desconocido';
}

/** Milisegundos que quedan de bloqueo; 0 si puede intentarlo. */
export function loginBlockedMs(req: Request): number {
  const entry = attempts.get(clientKey(req));
  if (!entry) return 0;
  return Math.max(0, entry.blockedUntil - Date.now());
}

export function registerFailure(req: Request): void {
  const key = clientKey(req);
  const entry = attempts.get(key) ?? { fails: 0, blockedUntil: 0 };
  entry.fails++;
  if (entry.fails >= 5) {
    // 30 s el quinto fallo y el doble en cada uno siguiente, hasta 5 minutos.
    const seconds = Math.min(30 * 2 ** (entry.fails - 5), 300);
    entry.blockedUntil = Date.now() + seconds * 1000;
  }
  attempts.set(key, entry);
  pruneAttempts();
}

export function clearFailures(req: Request): void {
  attempts.delete(clientKey(req));
}

function pruneAttempts(): void {
  if (attempts.size < 500) return;
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.blockedUntil < now) attempts.delete(key);
  }
}
