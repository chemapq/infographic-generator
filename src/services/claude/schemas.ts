import { z } from 'zod';

/**
 * Especificación estructurada de la infografía (pasada 0 — análisis).
 * Ancla las pasadas siguientes y da editabilidad: nombres de capas,
 * textos reales, paleta que se convertirá en variables CSS.
 */
export const SpecSchema = z.object({
  canvas: z.object({
    width: z.number().describe('Ancho del lienzo en píxeles (igual a la imagen original)'),
    height: z.number().describe('Alto del lienzo en píxeles (igual a la imagen original)'),
    gridDescription: z
      .string()
      .describe('Descripción de la retícula/estructura: columnas, secciones, flujo de lectura'),
  }),
  palette: z
    .array(
      z.object({
        hex: z.string().describe('Color en formato #RRGGBB'),
        name: z.string().describe('Nombre descriptivo en kebab-case, p. ej. "azul-fondo"'),
        usage: z.string().describe('Dónde se usa: fondos, titulares, iconos…'),
      }),
    )
    .describe('Paleta completa de colores detectados, de más a menos dominante'),
  typography: z
    .array(
      z.object({
        role: z.string().describe('Rol: titular, subtitulo, cuerpo, dato, pie…'),
        googleFont: z.string().describe('Google Font más parecida a la fuente original'),
        weight: z.string().describe('Peso aproximado: 400, 600, 700…'),
        notes: z.string().describe('Rasgos distintivos: serif/sans, condensada, redondeada…'),
      }),
    )
    .describe('Familias tipográficas detectadas y su Google Font equivalente'),
  texts: z
    .array(
      z.object({
        content: z.string().describe('Texto literal tal como aparece en la imagen'),
        hierarchy: z
          .string()
          .describe('Jerarquía semántica: h1, h2, h3, p, caption, label, dato'),
        zone: z.string().describe('Zona de la imagen: cabecera, columna-izquierda, pie…'),
      }),
    )
    .describe('Inventario completo de textos (OCR semántico)'),
  layers: z
    .array(
      z.object({
        id: z.string().describe('Identificador kebab-case, p. ej. "icono-cohete"'),
        kind: z
          .enum(['seccion', 'forma', 'icono', 'grafico-datos', 'linea', 'foto'])
          .describe('Tipo de capa'),
        description: z.string().describe('Qué es y qué aspecto tiene'),
        zone: z.string().describe('Posición aproximada en el lienzo'),
      }),
    )
    .describe('Árbol de capas: secciones, formas, iconos, gráficos de datos'),
  photoZones: z
    .array(
      z.object({
        description: z.string().describe('Qué muestra la foto/ilustración compleja'),
        averageColorHex: z.string().describe('Color medio de la zona, #RRGGBB'),
        zone: z.string().describe('Posición aproximada en el lienzo'),
      }),
    )
    .describe('Zonas fotográficas no vectorizables → placeholders marcados'),
});

export type Spec = z.infer<typeof SpecSchema>;

/**
 * Veredicto estructurado de comparación (pasadas 2..N).
 */
export const VerdictSchema = z.object({
  closeEnough: z
    .boolean()
    .describe('true si la reproducción es visualmente casi idéntica y no merece otra pasada'),
  summary: z.string().describe('Valoración global en una o dos frases'),
  discrepancies: z
    .array(
      z.object({
        zone: z.string().describe('Zona afectada: cabecera, columna-derecha, gráfico-barras…'),
        description: z.string().describe('Qué difiere y cómo corregirlo'),
        severity: z.enum(['alta', 'media', 'baja']).describe('Impacto visual de la discrepancia'),
      }),
    )
    .describe('Discrepancias concretas entre original y render, de mayor a menor severidad'),
  regressions: z
    .array(z.string())
    .describe('Zonas que estaban bien en la pasada anterior y han empeorado (vacío si ninguna)'),
  typographyNotes: z
    .string()
    .describe(
      'Diferencias puramente tipográficas (fuente no disponible en Google Fonts). Se puntúan aparte para no quemar pasadas persiguiendo lo imposible.',
    ),
});

export type Verdict = z.infer<typeof VerdictSchema>;
