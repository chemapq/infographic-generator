import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

export interface DiffResult {
  /** % de píxeles coincidentes (0–100). */
  score: number;
  /** Heatmap PNG de diferencias. */
  diffPng: Buffer;
}

/**
 * Métrica de similitud: pixelmatch sobre original vs render, ambos
 * normalizados al mismo tamaño. La métrica es ruidosa en texto/antialiasing:
 * se usa como tendencia y desempate, no como única verdad.
 */
export async function diffImages(originalPng: Buffer, renderPng: Buffer): Promise<DiffResult> {
  // flatten() antes de ensureAlpha(): algunos originales del dataset llevan
  // transparencia real (fondo alfa=0), que sin aplanar se lee como negro puro
  // frente al blanco opaco de la captura y dispara falsos positivos masivos.
  const original = await sharp(originalPng)
    .flatten({ background: '#ffffff' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = original.info;

  const render = await sharp(renderPng)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const diff = Buffer.alloc(width * height * 4);
  const mismatched = pixelmatch(original.data, render.data, diff, width, height, {
    threshold: 0.15, // tolerancia frente al ruido de subpíxel del texto
  });

  const score = (1 - mismatched / (width * height)) * 100;
  const diffPng = await sharp(diff, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  return { score: Math.round(score * 100) / 100, diffPng };
}
