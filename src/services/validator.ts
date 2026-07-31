/**
 * Validador post-generación del contrato de salida: solo se permite red
 * hacia Google Fonts; cualquier <script> o URL externa se elimina y se
 * registra para pedirle corrección a Claude en la siguiente pasada.
 */

const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export interface SanitizeResult {
  html: string;
  warnings: string[];
}

export function sanitizeHtml(rawHtml: string): SanitizeResult {
  const warnings: string[] = [];
  let html = rawHtml;

  // 1. Sin JavaScript: fuera <script> y atributos on*.
  html = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, () => {
    warnings.push('se eliminó un bloque <script> (el contrato prohíbe JS)');
    return '';
  });
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, () => {
    warnings.push('se eliminó un atributo de evento on* (el contrato prohíbe JS)');
    return '';
  });

  // 2. URLs externas fuera de la lista blanca de Google Fonts.
  html = html.replace(/https?:\/\/([^\s"'<>)]+)/gi, (match, rest: string) => {
    const host = rest.split('/')[0].toLowerCase();
    if (ALLOWED_HOSTS.has(host)) return match;
    warnings.push(`se eliminó una URL externa no permitida (${host})`);
    return 'about:blank';
  });

  return { html, warnings: [...new Set(warnings)] };
}
