import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Carga .env si existe (Node >= 20.12). No falla si no está.
try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'));
} catch {
  // sin .env: se usan las variables del entorno tal cual
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`La variable de entorno ${name} no es un entero: "${raw}"`);
  }
  return value;
}

/** Versión del `package.json`, para `GET /api/v1/health`. */
function readVersion(): string {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const env = {
  port: int('PORT', 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /**
   * Contraseña de acceso. Definirla activa la pantalla de login; vacía (lo
   * normal en local) la app se abre directamente. En producción es obligatoria:
   * el servidor no arranca sin ella.
   */
  authPassword: process.env.AUTH_PASSWORD?.trim() ?? '',
  /** Firma las sesiones. Si no se define, se genera y las sesiones caen al reiniciar. */
  authSecret: process.env.AUTH_SECRET?.trim() || crypto.randomBytes(32).toString('hex'),
  authSessionHours: int('AUTH_SESSION_HOURS', 12),
  outputDir: path.resolve(process.cwd(), process.env.OUTPUT_DIR ?? 'output'),
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
  maxPasses: int('MAX_PASSES', 5),
  targetScore: int('TARGET_SCORE', 97),
  /** Tamaño máximo (MB) del archivo que se puede subir. */
  maxUploadMb: 25,
  /** Lado largo máximo (px) de la imagen original enviada a Claude. */
  maxImageEdge: 2576,
  /** Lado largo máximo (px) de las capturas intermedias enviadas a Claude. */
  intermediateImageEdge: 1600,
  /**
   * Alcance de la galería: `all` lista todos los jobs de la instalación (lo
   * correcto sin usuarios reales, y lo que hace visible el historial previo
   * a la cookie de dueño); `owner` filtra por la cookie `ig_owner`.
   */
  galleryScope: (process.env.GALLERY_SCOPE ?? 'all') as 'all' | 'owner',
  galleryPageSize: int('GALLERY_PAGE_SIZE', 24),
  /** Ancho (px) de las miniaturas generadas para la galería. */
  thumbWidth: int('THUMB_WIDTH', 480),

  /**
   * Claves de la API v1 (bearer, para clientes servidor-a-servidor como el
   * plugin de Moodle). Formato `nombre:clave,nombre2:clave2`. El nombre es el
   * `ownerId` del job y lo único que se escribe en los logs.
   */
  apiKeys: process.env.API_KEYS?.trim() ?? '',
  /** Jobs en cola (encolados + en curso) antes de que `POST /api/v1/jobs` devuelva 429. */
  apiMaxQueueDepth: int('API_MAX_QUEUE_DEPTH', 5),
  /** Tope de jobs por clave y día natural (UTC) antes de `429 quota_exceeded`. */
  apiDailyJobLimit: int('API_DAILY_JOB_LIMIT', 50),
  /** Tope de ediciones (`POST /api/v1/edit`) por clave y día natural. Un orden de magnitud más barato que un job. */
  apiDailyEditLimit: int('API_DAILY_EDIT_LIMIT', 500),
  /** Ediciones en curso a la vez, para no reventar el límite de la API de Anthropic. No pasan por la cola en serie. */
  apiMaxConcurrentEdits: int('API_MAX_CONCURRENT_EDITS', 4),
  /** Antigüedad (días) a partir de la que se borra `output/<jobId>`. 0 = sin límite. */
  retentionDays: int('RETENTION_DAYS', 0),
  /** `false` sirve solo la API (sin estáticos, sin login, sin galería web). */
  uiEnabled: (process.env.UI_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
  /** Versión del motor, expuesta en `GET /api/v1/health`. */
  version: readVersion(),
} as const;
