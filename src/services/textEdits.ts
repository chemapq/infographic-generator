/**
 * Aplica cambios de texto sobre un HTML ya generado, sin pasar por Claude:
 * para corregir una errata o un dato no hace falta ni tokens ni una pasada
 * de generación entera. Se apoya en el Chromium que ya mantiene vivo
 * renderer.ts para editar el DOM real (entidades, SVG y namespaces
 * correctos) en vez de parchear el HTML como texto plano.
 */
import type { TextEdit } from '../types.js';
import { getBrowser } from './renderer.js';

export interface ApplyTextEditsResult {
  /** HTML resultante si todos los cambios se aplicaron; el original si alguno falló. */
  html: string;
  /** Cambios cuyo nodo ya no coincide con `before` (HTML movido por debajo). */
  failed: TextEdit[];
}

interface BrowserApplyResult {
  ok: boolean;
  failed: TextEdit[];
  html?: string;
}

/**
 * Todo o nada: si algún `before` no coincide con lo que hay ahora en el DOM
 * (otra pestaña iteró con IA mientras tanto), no se escribe ningún cambio.
 * Media edición aplicada sería peor que ninguna.
 */
export async function applyTextEdits(
  html: string,
  edits: TextEdit[],
): Promise<ApplyTextEditsResult> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Script en string: evita depender de los tipos DOM en un proyecto Node
    // (mismo patrón que renderer.ts). `edits` viaja embebido como JSON: la
    // sustitución ocurre en Node antes de que el motor del navegador vea el
    // texto, así que cualquier comilla o backtick dentro de un texto editado
    // llega ya escapado por JSON.stringify.
    const script = `(() => {
      const edits = ${JSON.stringify(edits)};
      const failed = [];
      for (const edit of edits) {
        const el = document.querySelector(edit.selector);
        const node = el ? el.childNodes[edit.nodeIndex] : null;
        if (!el || !node || node.nodeType !== 3 || node.nodeValue !== edit.before) {
          failed.push(edit);
        }
      }
      if (failed.length > 0) return { ok: false, failed };
      for (const edit of edits) {
        const el = document.querySelector(edit.selector);
        el.childNodes[edit.nodeIndex].nodeValue = edit.after;
      }
      return { ok: true, failed: [], html: '<!DOCTYPE html>\\n' + document.documentElement.outerHTML };
    })()`;
    const result = (await page.evaluate(script)) as BrowserApplyResult;

    if (!result.ok || result.html === undefined) {
      return { html, failed: result.failed };
    }

    // Guarda de cordura: si la serialización se comió una parte grande del
    // documento (algo salió mal), es mejor fallar que guardar un HTML roto.
    if (result.html.length < html.length * 0.8) {
      throw new Error(
        'El HTML resultante de aplicar los cambios de texto perdió más de un 20% de su tamaño; se aborta por seguridad.',
      );
    }

    return { html: result.html, failed: [] };
  } finally {
    await context.close();
  }
}
