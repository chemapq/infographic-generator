/**
 * System prompt + contrato de salida (§4 del plan).
 * Es el prefijo estable de la conversación de cada job: se cachea con
 * cache_control y no debe variar entre pasadas.
 */
export const SYSTEM_PROMPT = `Eres un experto en reproducir infografías como HTML autocontenido y editable. Trabajas dentro de un bucle automatizado: analizas una imagen, generas HTML, recibes una captura de tu propio resultado comparada con el original y lo refinas hasta que sean casi idénticos.

# Contrato de salida del HTML (obligatorio en cada emisión)

1. **Un solo fichero HTML autocontenido**: todo el CSS inline en un único <style>. Sin JavaScript. Sin recursos externos de ningún tipo salvo Google Fonts (fonts.googleapis.com / fonts.gstatic.com), que es la única lista blanca de red.
2. **Lienzo de tamaño fijo**: un <div class="canvas"> con el ancho y alto exactos del original en píxeles (margin: 0 en body). Dentro, posicionamiento absoluto o grid/flex, lo que mejor sirva a la fidelidad.
3. **Textos como DOM real** (h1, h2, p, span, li…), NUNCA texto convertido a trazados SVG ni texto dentro de <text> si puede ser HTML. Respeta el texto literal del original.
4. **Paleta en variables CSS** declaradas en :root (--color-1, --color-2… con comentario del nombre descriptivo). Todos los colores del documento deben referirse a esas variables: cambiar una variable recolorea toda la pieza.
5. **Formas, iconos, líneas y gráficos en SVG inline**, con id y data-layer descriptivos en kebab-case (p. ej. data-layer="icono-cohete", id="barra-ventas-q3"). Nada de imágenes rasterizadas.
6. **Gráficos de datos con los datos a la vista**: los valores numéricos como atributos data-value o en un comentario HTML junto al SVG, para poder reeditarlos.
7. **Placeholders de fotos**: para zonas fotográficas no vectorizables usa <div class="photo-placeholder" data-replace="descripción de la foto"> con el color medio de la zona como background y dimensiones correctas.
8. **Tipografías**: elige la Google Font más parecida a la del original, impórtala con <link> de Google Fonts y declara pila de fallbacks.

# Reglas de emisión

- Cuando se te pida HTML, responde ÚNICAMENTE con el fichero HTML completo, desde <!DOCTYPE html> hasta </html>. Sin explicaciones, sin markdown, sin vallas de código.
- En cada refinado re-emite el fichero COMPLETO corrigiendo las discrepancias indicadas sin romper lo que ya estaba bien.
- La fidelidad visual manda: posición, tamaño, color, espaciado y jerarquía deben coincidir con el original píxel a píxel en lo posible.`;

export const ANALYZE_INSTRUCTION = `Analiza a fondo esta infografía original. Devuelve la especificación estructurada completa: dimensiones del lienzo, retícula, paleta de colores, tipografías con su Google Font equivalente, inventario completo de textos con jerarquía, árbol de capas (secciones, formas, iconos, gráficos de datos) y zonas fotográficas que deban marcarse como placeholder. Sé exhaustivo: esta especificación ancla todas las pasadas siguientes.`;

export function generateInstruction(canvasWidth: number, canvasHeight: number): string {
  return `Genera ahora el HTML autocontenido que reproduce la infografía original siguiendo el contrato de salida. El lienzo debe medir exactamente ${canvasWidth}x${canvasHeight} px. Usa la especificación que acabas de producir como guía. Responde solo con el HTML completo.`;
}

export function compareInstruction(pass: number, score: number, previousScore: number | null): string {
  const trend =
    previousScore === null
      ? ''
      : ` En la pasada anterior la métrica era ${previousScore.toFixed(2)}%.`;
  return `Te envío dos imágenes: (1) la captura del render de tu HTML de la pasada ${pass} y (2) el mapa de diferencias (heatmap: las zonas coloreadas difieren del original que viste al principio). La métrica de coincidencia de píxeles es ${score.toFixed(2)}%.${trend} La métrica es ruidosa en texto y antialiasing: úsala como tendencia, tu juicio visual es la señal primaria. Compara el render con la infografía original y devuelve el veredicto estructurado: discrepancias concretas (zona, corrección, severidad), regresiones respecto a la pasada anterior si las hay, diferencias puramente tipográficas aparte, y closeEnough.`;
}

export function refineInstruction(verdict: {
  discrepancies: Array<{ zone: string; description: string; severity: string }>;
  regressions: string[];
}, sanitizerWarnings: string[]): string {
  const lines: string[] = [
    'Reescribe el HTML completo corrigiendo estas discrepancias (en orden de severidad):',
    ...verdict.discrepancies.map(
      (d, i) => `${i + 1}. [${d.severity}] ${d.zone}: ${d.description}`,
    ),
  ];
  if (verdict.regressions.length > 0) {
    lines.push(
      '',
      'ATENCIÓN — regresiones detectadas (zonas que empeoraron): ' + verdict.regressions.join('; ') + '. Recupéralas sin deshacer las correcciones buenas.',
    );
  }
  if (sanitizerWarnings.length > 0) {
    lines.push(
      '',
      'El validador eliminó contenido no permitido de tu última emisión. Corrige estas violaciones del contrato: ' +
        sanitizerWarnings.join('; '),
    );
  }
  lines.push('', 'Responde solo con el fichero HTML completo.');
  return lines.join('\n');
}

/** Elemento señalado en el editor visual al que va dirigida la petición. */
export interface IterateTarget {
  /** Etiqueta legible, p. ej. `h1#titulo` o `path · icono-cohete`. */
  label: string;
  /** Selector CSS hasta el elemento dentro del documento. */
  selector?: string;
  /** Markup actual del elemento (recortado). */
  html?: string;
  /** Texto que contiene, si tiene. */
  text?: string;
}

export function iterateInstruction(userPrompt: string, target?: IterateTarget): string {
  if (!target) {
    return `El usuario ha revisado el resultado y pide estos ajustes finales, que tienen PRIORIDAD sobre la fidelidad al original:

"""
${userPrompt}
"""

Aplica exactamente lo pedido sin romper el resto de la pieza y re-emite el fichero HTML completo. Responde solo con el HTML.`;
  }

  const lines = [
    'El usuario ha señalado UN elemento concreto del HTML en el editor visual y pide un cambio SOBRE ÉL. Su petición tiene PRIORIDAD sobre la fidelidad al original.',
    '',
    `Elemento señalado: ${target.label}`,
  ];
  if (target.selector) lines.push(`Selector: ${target.selector}`);
  if (target.text) lines.push(`Texto que contiene: "${target.text}"`);
  if (target.html) lines.push('', 'Markup actual del elemento:', '```html', target.html, '```');
  lines.push(
    '',
    'Petición del usuario:',
    '"""',
    userPrompt,
    '"""',
    '',
    'Aplica el cambio en ese elemento (y solo en lo imprescindible a su alrededor: si hace falta tocar sus variables CSS, su contenedor o el SVG que lo contiene, hazlo). El resto de la pieza debe quedar exactamente igual. Re-emite el fichero HTML completo y responde solo con el HTML.',
  );
  return lines.join('\n');
}
