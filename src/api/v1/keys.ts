/**
 * Autenticación de la API v1: claves declaradas en `API_KEYS` (entorno, sin
 * base de datos). El nombre de cada clave es el `ownerId` que se escribe en
 * `JobRecord.ownerId` y en los logs; la clave en sí nunca se registra.
 */
import { env } from '../../config/env.js';
import { sameSecret } from '../../services/auth.js';

interface ApiKey {
  ownerId: string;
  secret: string;
}

function parseApiKeys(raw: string): ApiKey[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0) {
        throw new Error(
          `API_KEYS mal formado: se esperaba "nombre:clave" separado por comas, se recibió "${entry}"`,
        );
      }
      return { ownerId: entry.slice(0, separator).trim(), secret: entry.slice(separator + 1).trim() };
    });
}

// Se parsea una sola vez, en el primer acceso (falla rápido si está mal formado).
let keys: ApiKey[] | null = null;
function loadedKeys(): ApiKey[] {
  if (keys === null) keys = parseApiKeys(env.apiKeys);
  return keys;
}

/** `true` si hay al menos una clave declarada: la API v1 puede autenticar peticiones. */
export function apiEnabled(): boolean {
  return loadedKeys().length > 0;
}

/** `ownerId` de la clave que coincide con el bearer recibido, o `null` si no hay ninguna. */
export function resolveApiKey(bearer: string | undefined): string | null {
  if (!bearer) return null;
  for (const key of loadedKeys()) {
    if (sameSecret(bearer, key.secret)) return key.ownerId;
  }
  return null;
}

/* ───────────── cupo diario por clave ───────────── */

interface DailyCount {
  day: string;
  count: number;
}

// En memoria, sin persistencia: un reinicio del motor regala un día de cupo.
// Igual que `sessionEpoch` en auth.ts, es una simplificación deliberada — no
// hay base de datos en este plan, y el caso de abuso real es un bucle que
// reintenta sin parar, no alguien reiniciando el proceso a propósito.
const dailyCounts = new Map<string, DailyCount>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `true` si `ownerId` ya alcanzó `API_DAILY_JOB_LIMIT` hoy. No consume cupo. */
export function quotaExceeded(ownerId: string): boolean {
  const entry = dailyCounts.get(ownerId);
  if (!entry || entry.day !== today()) return false;
  return entry.count >= env.apiDailyJobLimit;
}

/** Consume una unidad de cupo diario. Llamar solo al crear un job de verdad, nunca en una réplica idempotente. */
export function consumeQuota(ownerId: string): void {
  const day = today();
  const entry = dailyCounts.get(ownerId);
  if (!entry || entry.day !== day) {
    dailyCounts.set(ownerId, { day, count: 1 });
  } else {
    entry.count++;
  }
}
