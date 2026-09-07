#!/usr/bin/env node
/**
 * Genera los assets del plugin de Moodle desde `public/`: una sola fuente de
 * verdad para la interfaz de la app y la del plugin. Ver PLAN_MOODLE.md §6.5.
 *
 *   npm run build:moodle                          # escribe en moodle-plugin/local/awakeinfographic
 *   npm run build:moodle -- --out ../moodle/local/awakeinfographic
 *
 * Qué genera:
 *   - templates/app.mustache  ← public/index.html: extrae el <body>, lo
 *     envuelve en .ig-app, quita los <script>/<link> propios (index.php los
 *     sustituye por $PAGE->requires / IG_CONFIG en línea).
 *   - styles/app.css          ← public/styles.css, cada selector calificado
 *     bajo .ig-app (implementación propia, sin postcss: el CSS de origen es
 *     plano — un :root y un solo @media — y no lo justifica).
 *   - js/api.js, js/app.js, js/editor.js ← copia literal. Ya leen IG_CONFIG,
 *     no hace falta transformarlos (§4.1).
 *
 * Cada fichero generado lleva una cabecera "GENERADO — no editar": si
 * alguien lo toca a mano, el próximo `build:moodle` lo pisa sin avisar.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const publicDir = path.join(repoRoot, 'public');

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : null;
  return {
    outDir: out ? path.resolve(process.cwd(), out) : path.join(repoRoot, 'moodle-plugin/local/awakeinfographic'),
  };
}

function generatedHeaderHtml(source) {
  return `{{!\n    GENERADO por scripts/build-moodle.mjs — no editar a mano.\n    Fuente: ${source}\n}}\n`;
}

function generatedHeaderCss(source) {
  return `/* GENERADO por scripts/build-moodle.mjs — no editar a mano. Fuente: ${source} */\n`;
}

function generatedHeaderJs(source) {
  return `/* GENERADO por scripts/build-moodle.mjs — copia literal, no editar a mano. Fuente: ${source} */\n`;
}

/**
 * `public/index.html` -> `templates/app.mustache`: el `<body>`, calificado
 * bajo `.ig-app`, sin los `<link>`/`<script>` que index.php ya cubre por su
 * cuenta ($PAGE->requires->css, IG_CONFIG en línea + los 3 `<script src>`
 * con las URLs de Moodle).
 */
function buildMustache(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) throw new Error('public/index.html: no se encontró <body>');
  let body = bodyMatch[1];

  // Los 4 <script src="…"> propios del documento original se sustituyen por
  // su equivalente en Moodle: IG_CONFIG en línea (lo emite index.php, lleva
  // el sesskey) + las URLs de js/ que sí puede resolver build:moodle.
  const mustacheScripts = [
    '<script>window.IG_CONFIG = {{{igconfigjson}}};</script>',
    '<script src="{{apijsurl}}"></script>',
    '<script src="{{editorjsurl}}"></script>',
    '<script src="{{appjsurl}}"></script>',
  ].join('\n  ');
  const scriptBlock = /(\s*<script src="config\.js"><\/script>\s*<script src="api\.js"><\/script>\s*<script src="editor\.js"><\/script>\s*<script src="app\.js"><\/script>)/;
  if (!scriptBlock.test(body)) {
    throw new Error('public/index.html: no se encontró el bloque de <script> esperado (config/api/editor/app.js)');
  }
  body = body.replace(scriptBlock, `\n  ${mustacheScripts}`);

  const inner = body.trim();
  return `${generatedHeaderHtml('public/index.html')}<div class="ig-app">\n${inner}\n</div>\n`;
}

/**
 * Recorre `css` character a character llevando la profundidad de llaves:
 * en cada regla de nivel superior, si el preludio empieza por `@` (media,
 * supports…) se recorre su cuerpo recursivamente; si no, es un selector y
 * se califica. `:root` pasa a ser `.ig-app` (las variables CSS deben colgar
 * de la raíz de la app, no de la del documento, para no pelear con las
 * variables de Boost). Sin librerías: el CSS de origen es plano a propósito
 * (ver cabecera del fichero).
 */
function qualifyCss(css, scope) {
  let out = '';
  let i = 0;
  const n = css.length;

  while (i < n) {
    // Comentarios: se copian tal cual, sin interpretarlos como código.
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (/\s/.test(css[i])) {
      out += css[i];
      i++;
      continue;
    }
    if (css[i] === '}') {
      // Llave de cierre suelta a nivel superior: no debería pasar en CSS válido.
      i++;
      continue;
    }

    // Preludio hasta el '{' que abre la regla.
    let j = i;
    while (j < n && css[j] !== '{') j++;
    const prelude = css.slice(i, j).trim();

    // Cuerpo, con conteo de profundidad para encontrar su '}' de cierre.
    let depth = 1;
    let k = j + 1;
    while (k < n && depth > 0) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') depth--;
      k++;
    }
    const body = css.slice(j + 1, k - 1);

    if (prelude.startsWith('@')) {
      out += `${prelude} {${qualifyCss(body, scope)}}`;
    } else {
      const selectors = prelude
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s === ':root' ? scope : `${scope} ${s}`))
        .join(', ');
      out += `${selectors} {${body}}`;
    }
    i = k;
  }

  return out;
}

/**
 * Reset de lo que Boost toca en formularios y tipografía dentro de `.ig-app`.
 * Es la parte que se ajusta a ojo (PLAN_MOODLE.md §6.5): punto de partida
 * razonable, no el final.
 */
const BOOST_RESET = `
.ig-app, .ig-app * { box-sizing: border-box; }
.ig-app { line-height: normal; }
.ig-app h1, .ig-app h2, .ig-app h3, .ig-app p, .ig-app ul, .ig-app ol, .ig-app dl {
  margin: 0; padding: 0; list-style: none;
}
.ig-app a { text-decoration: none; }
.ig-app button, .ig-app input, .ig-app select, .ig-app textarea {
  font-family: inherit; font-size: inherit; line-height: inherit; color: inherit;
  background: none; border: 0; border-radius: 0; box-shadow: none; appearance: none;
}
.ig-app button { cursor: pointer; }
.ig-app img { max-width: none; }
.ig-app table { border-collapse: collapse; }
`;

function buildCss(css) {
  return `${generatedHeaderCss('public/styles.css')}${qualifyCss(css, '.ig-app')}\n${BOOST_RESET}`;
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));

  const [indexHtml, stylesCss, apiJs, appJs, editorJs] = await Promise.all([
    readFile(path.join(publicDir, 'index.html'), 'utf8'),
    readFile(path.join(publicDir, 'styles.css'), 'utf8'),
    readFile(path.join(publicDir, 'api.js'), 'utf8'),
    readFile(path.join(publicDir, 'app.js'), 'utf8'),
    readFile(path.join(publicDir, 'editor.js'), 'utf8'),
  ]);

  await mkdir(path.join(outDir, 'templates'), { recursive: true });
  await mkdir(path.join(outDir, 'styles'), { recursive: true });
  await mkdir(path.join(outDir, 'js'), { recursive: true });

  await writeFile(path.join(outDir, 'templates/app.mustache'), buildMustache(indexHtml));
  await writeFile(path.join(outDir, 'styles/app.css'), buildCss(stylesCss));
  await writeFile(path.join(outDir, 'js/api.js'), generatedHeaderJs('public/api.js') + apiJs);
  await writeFile(path.join(outDir, 'js/app.js'), generatedHeaderJs('public/app.js') + appJs);
  await writeFile(path.join(outDir, 'js/editor.js'), generatedHeaderJs('public/editor.js') + editorJs);

  console.log(`build:moodle → ${path.relative(repoRoot, outDir) || '.'}`);
}

main().catch((error) => {
  console.error('build:moodle falló:', error);
  process.exitCode = 1;
});
