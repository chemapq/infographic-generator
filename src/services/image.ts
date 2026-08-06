/**
 * Reconocimiento del formato real por los bytes de cabecera.
 *
 * El tipo MIME que manda el navegador se deduce de la extensión y miente a
 * menudo: una foto de iPhone guardada como `.jpg` llega como `image/jpeg` pero
 * por dentro sigue siendo HEIC, y el decodificador falla con un error
 * incomprensible ("heif: … Bitstream not supported by this decoder"). Mirando
 * los bytes se puede decir exactamente qué es y qué hacer con ello.
 */

export const SUPPORTED_IMAGE_KINDS = ['png', 'jpeg', 'webp', 'gif'] as const;

export type SupportedImageKind = (typeof SUPPORTED_IMAGE_KINDS)[number];

export type ImageKind =
  | SupportedImageKind
  | 'heic'
  | 'avif'
  | 'tiff'
  | 'bmp'
  | 'svg'
  | 'pdf'
  | 'desconocido';

/** Nombre presentable de cada formato, para los mensajes de error. */
export const IMAGE_KIND_LABEL: Record<ImageKind, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  gif: 'GIF',
  heic: 'HEIC/HEIF',
  avif: 'AVIF',
  tiff: 'TIFF',
  bmp: 'BMP',
  svg: 'SVG',
  pdf: 'PDF',
  desconocido: 'desconocido',
};

export function isSupportedImageKind(kind: ImageKind): kind is SupportedImageKind {
  return (SUPPORTED_IMAGE_KINDS as readonly string[]).includes(kind);
}

export function sniffImageKind(buffer: Buffer): ImageKind {
  if (buffer.length < 12) return 'desconocido';
  const at = (start: number, end: number) => buffer.subarray(start, end).toString('latin1');

  if (at(0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (at(0, 4) === 'RIFF' && at(8, 12) === 'WEBP') return 'webp';
  if (at(0, 3) === 'GIF') return 'gif';
  if (at(0, 2) === 'BM') return 'bmp';
  if (at(0, 5) === '%PDF-') return 'pdf';
  if (at(0, 4) === 'II\x2a\x00' || at(0, 4) === 'MM\x00\x2a') return 'tiff';

  // Contenedores ISO-BMFF: la marca (brand) distingue AVIF de la familia HEIF.
  if (at(4, 8) === 'ftyp') {
    const brand = at(8, 12).toLowerCase();
    if (brand.startsWith('avi')) return 'avif';
    return 'heic';
  }

  if (/^\s*(<\?xml|<!doctype svg|<svg)/i.test(at(0, 200))) return 'svg';
  return 'desconocido';
}
