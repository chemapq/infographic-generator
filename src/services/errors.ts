/**
 * Traducción de fallos a mensajes que el usuario pueda accionar.
 *
 * Las librerías de más abajo (libvips/libheif, Playwright, el SDK de Anthropic)
 * hablan en su propio idioma y a veces con mucho ruido: un HEIC ilegible
 * produce media docena de líneas `source: bad seek to 52275` antes de la causa
 * real. Aquí se limpia ese ruido, se reconoce el fallo y se devuelve qué ha
 * pasado y qué se puede hacer, guardando el mensaje técnico aparte.
 */
import Anthropic from '@anthropic-ai/sdk';
import { MulterError } from 'multer';
import { env } from '../config/env.js';
import { describeApiError } from './claude/client.js';
import { IMAGE_KIND_LABEL, type ImageKind } from './image.js';

export interface FriendlyError {
  /** Código HTTP adecuado si el fallo se responde a una petición. */
  status: number;
  /** Qué ha pasado y qué hacer, en lenguaje llano. */
  message: string;
  /** Mensaje original ya limpio, para el detalle técnico y los logs. */
  detail?: string;
}

const CONVIERTE = 'Conviértela a PNG o JPEG y vuelve a subirla.';

/** Quita las líneas de ruido de libvips y deja la causa. */
export function cleanMessage(raw: string): string {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^source: bad seek to \d+$/i.test(line));
  return (lines.length > 0 ? lines : [raw.trim()]).join(' · ');
}

/** Mensaje para un archivo cuyo formato real no se puede procesar. */
export function describeUnsupportedImage(kind: ImageKind, declaredType?: string): FriendlyError {
  const detail = `formato detectado por los bytes: ${kind}${declaredType ? ` · tipo declarado: ${declaredType}` : ''}`;
  const admitidos = 'Se admiten PNG, JPEG, WebP y GIF.';

  if (kind === 'heic') {
    return {
      status: 415,
      message:
        'La imagen está en formato HEIC/HEIF, el de las fotos del iPhone, y este equipo no puede decodificarlo. ' +
        `${CONVIERTE} En el Mac: ábrela en Vista Previa y usa Archivo → Exportar. ` +
        'En el iPhone: Ajustes → Cámara → Formatos → «Más compatible».',
      detail,
    };
  }
  if (kind === 'avif' || kind === 'tiff' || kind === 'bmp') {
    return {
      status: 415,
      message: `La imagen está en formato ${IMAGE_KIND_LABEL[kind]}, que no se admite. ${CONVIERTE}`,
      detail,
    };
  }
  if (kind === 'pdf' || kind === 'svg') {
    return {
      status: 415,
      message:
        `El archivo es un ${IMAGE_KIND_LABEL[kind]}, no una imagen de mapa de bits. ` +
        `Expórtalo como PNG (a la resolución a la que quieras reproducirlo) y vuelve a subirlo.`,
      detail,
    };
  }
  return {
    status: 415,
    message:
      `No se reconoce el contenido del archivo como una imagen${declaredType ? ` (llega declarado como ${declaredType})` : ''}. ` +
      admitidos,
    detail,
  };
}

interface Rule {
  match: RegExp;
  status: number;
  message: string;
}

/**
 * Fallos reconocibles por el texto del error. El orden importa: las reglas
 * específicas van antes que las genéricas (un HEIC también dice "invalid input").
 */
const RULES: Rule[] = [
  {
    match: /heif|heic|bitstream not supported|compression format has not been built/i,
    status: 415,
    message:
      'La imagen está en formato HEIC/HEIF (fotos de iPhone) o usa una compresión que este equipo no puede decodificar. ' +
      CONVIERTE,
  },
  {
    match: /input buffer is empty|input file is missing|empty file/i,
    status: 400,
    message: 'El archivo llegó vacío. Vuelve a elegir la imagen y súbela de nuevo.',
  },
  {
    match: /unsupported image format/i,
    status: 415,
    message:
      'El contenido del archivo no es una imagen que se pueda leer. Se admiten PNG, JPEG, WebP y GIF.',
  },
  {
    match: /read error|premature end|truncated|corrupt|not enough data|bad seek|invalid input/i,
    status: 415,
    message:
      'La imagen está incompleta o dañada: el decodificador se quedó a medias. ' +
      'Vuelve a exportarla o prueba con otra copia del archivo.',
  },
  {
    match: /exceeds pixel limit|image (is )?too large|maximum image size/i,
    status: 413,
    message:
      'La imagen tiene demasiados píxeles para procesarla. Redúcela de tamaño y vuelve a subirla.',
  },
  {
    match: /executable doesn'?t exist|playwright install|browserType\.launch/i,
    status: 500,
    message:
      'Falta el navegador que renderiza el HTML. Ejecuta `npx playwright install chromium` y reintenta.',
  },
  {
    match: /timeout .*exceeded|navigation timeout|timeouterror/i,
    status: 504,
    message:
      'El renderizado del HTML tardó demasiado y se canceló. Reintenta; si se repite, prueba con menos pasadas.',
  },
  {
    match: /enospc|no space left/i,
    status: 507,
    message: 'No queda espacio en disco para guardar el resultado del trabajo.',
  },
  {
    match: /could not resolve authentication|anthropic_api_key/i,
    status: 500,
    message:
      'No hay credenciales de Anthropic. Copia .env.example a .env y define ANTHROPIC_API_KEY (o inicia sesión con `ant auth login`).',
  },
];

export function describeError(error: unknown): FriendlyError {
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return {
        status: 413,
        message: `La imagen pesa más de ${env.maxUploadMb} MB. Expórtala a menor resolución o comprímela y vuelve a subirla.`,
        detail: error.message,
      };
    }
    return {
      status: 400,
      message: 'La subida no llegó completa al servidor. Vuelve a elegir la imagen e inténtalo otra vez.',
      detail: `${error.code}: ${error.message}`,
    };
  }

  if (error instanceof Anthropic.APIError) {
    return {
      status: error.status && error.status >= 400 && error.status < 500 ? 502 : 503,
      message: describeApiError(error),
      detail: cleanMessage(error.message),
    };
  }

  const raw = error instanceof Error ? error.message : String(error);
  const detail = cleanMessage(raw);
  const rule = RULES.find((candidate) => candidate.match.test(detail));
  if (rule) return { status: rule.status, message: rule.message, detail };

  return { status: 500, message: `Error inesperado: ${detail}`, detail: undefined };
}
