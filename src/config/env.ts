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
