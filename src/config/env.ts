import crypto from 'node:crypto';
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
} as const;
