# Infographic Generator

Herramienta local que toma una **imagen de una infografía** y produce un **HTML autocontenido, visualmente casi idéntico, donde todo es editable**: textos reales en el DOM, formas e iconos en SVG inline, colores en variables CSS.

Claude genera el HTML, la app lo renderiza con Chromium headless, **compara el resultado con el original** (pixelmatch + juicio visual de Claude) y refina en varias pasadas. Al final, el usuario puede pedir los últimos ajustes con un prompt libre.

> Diseño completo en [PLAN.md](PLAN.md).

## Stack

- **Runtime:** Node.js ≥ 20 (ver `.nvmrc`) · TypeScript ESM
- **IA:** API de Anthropic (`claude-opus-4-8`, visión + salidas estructuradas + streaming + caché de prompt)
- **Render:** Playwright (Chromium headless, determinista)
- **Comparación:** `sharp` + `pixelmatch` (score + heatmap de diferencias)
- **API/UI:** Express 5 + UI estática vanilla (sin build) en `public/`

## Puesta en marcha

```bash
nvm use
npm install
npx playwright install chromium   # navegador para el renderizado

cp .env.example .env              # y define ANTHROPIC_API_KEY
npm run dev                       # → http://localhost:3000
```

Sin `ANTHROPIC_API_KEY`, el SDK también acepta `ANTHROPIC_AUTH_TOKEN` o un perfil de `ant auth login`.

## Uso

- **Web**: abre `http://localhost:3000`, arrastra la imagen, elige nº máx. de pasadas y pulsa *Generar*. Verás el progreso en vivo (pasadas, score y discrepancias) y al terminar el comparador con slider, la **edición señalando elementos**, la descarga del HTML y la caja de ajustes finales.
- **CLI** (pipeline sin UI): `npm run job -- ruta/a/infografia.png [maxPasses]`

**Formatos admitidos:** PNG, JPEG, WebP y GIF, hasta 25 MB. El formato se comprueba por el contenido del archivo, no por su extensión, y lo que no se puede procesar se rechaza explicando qué hacer. En particular, las fotos **HEIC/HEIF del iPhone no se pueden decodificar**: conviértelas a PNG o JPEG (en el Mac, Vista Previa → Archivo → Exportar). Los errores de las librerías (libvips, Playwright, API de Anthropic) se traducen a lenguaje llano, con el mensaje técnico plegado aparte.

Todo el estado de un trabajo vive en `output/<jobId>/` (imagen original, HTML/captura/diff de cada pasada, `job.json`, `usage.json` con el uso de tokens) y es reabrible tras reiniciar el servidor.

## Editar señalando elementos

En el resultado, *Editar señalando* abre la infografía a pantalla completa. Al pasar el ratón se resaltan los elementos y **al hacer clic en uno** se abre una ventanita con un prompt: escribes el cambio en lenguaje natural y **Claude lo aplica sobre ese elemento**.

- «rehaz este gráfico como barras horizontales»
- «cambia este azul por el verde de la paleta»
- «pon este título en dos líneas y más grande»

Funciona con cualquier elemento del documento, incluidas las formas y los iconos dentro de un SVG. *Señalar el contenedor* amplía la selección al elemento padre (para pedir cambios de una sección entera) y *Cambio en toda la pieza…* manda la petición sin acotarla a nada.

Cada petición es una **pasada más del job**: se envía a `POST /api/jobs/:id/iterate` con el contexto del elemento (etiqueta, selector, markup y texto), Claude reescribe el HTML completo, el servidor lo renderiza y lo compara con el original, y el lienzo se recarga con el resultado sin perder la selección. Todo queda versionado en `passes/`, así que siempre se puede volver a una pasada anterior desde el selector del resultado.

Detalle de implementación: el lienzo es un `<iframe sandbox="allow-same-origin">` servido desde el mismo origen (sin `allow-scripts`: el documento no ejecuta JS), así que la app lee su DOM para describir el elemento señalado. El HTML generado no necesita ninguna instrumentación y el navegador nunca lo modifica: los cambios los hace siempre Claude.

Los clics **no** se escuchan dentro del iframe sino en una capa transparente por encima, y el elemento se resuelve con `elementFromPoint`: WebKit (Safari) no despacha eventos DOM en un documento con `sandbox` sin `allow-scripts`, aunque el padre sí pueda leer su DOM. Y el editor se engancha en cuanto existe el DOM del iframe, sin esperar a su evento `load`, que espera también a las Google Fonts del documento generado y con la red lenta dejaba el lienzo visible pero sin responder.

## API HTTP

| Método y ruta | Descripción |
| --- | --- |
| `POST /api/jobs` | Multipart con `image` (+ `maxPasses`, `notes`). Devuelve `{ jobId }` y arranca el pipeline. |
| `GET /api/jobs/:id` | Estado del job: pasadas, scores y uso de tokens. |
| `GET /api/jobs/:id/events` | SSE con progreso en vivo (replay incluido). |
| `POST /api/jobs/:id/iterate` | `{ "prompt": "...", "target"?: { label, selector, html, text } }` → una pasada más con las instrucciones del usuario, acotada al elemento señalado si se envía `target`. Repetible. |
| `GET /api/jobs/:id/result` | HTML final (`?pass=n` para versiones anteriores). |
| `GET /api/jobs/:id/assets/...` | Original, capturas y diffs. |

## Estructura

```
src/
├── index.ts                  # Express + estáticos + rutas
├── cli.ts                    # pipeline invocable por script
├── config/env.ts             # PORT, ANTHROPIC_MODEL, MAX_PASSES, TARGET_SCORE…
├── api/                      # jobs.router.ts · sse.ts
└── services/
    ├── orchestrator.ts       # bucle generar → renderizar → comparar → refinar
    ├── claude/               # client (caché + uso) · prompts · schemas · analyze · generate · compare
    ├── renderer.ts           # Playwright: HTML → PNG determinista
    ├── differ.ts             # sharp + pixelmatch: score + heatmap
    ├── validator.ts          # contrato: sin JS ni red fuera de Google Fonts
    └── store.ts              # persistencia en output/<jobId>/
public/
├── index.html · styles.css   # UI: subida · progreso · resultado · editor
├── app.js                    # subida, SSE, timeline, comparador
└── editor.js                 # señalar elementos y pedir el cambio a Claude
```

## Uso de tokens

Cada job es **una conversación multi-turno con caché de prompt**: cada pasada solo procesa en frío la captura nueva y el veredicto, mientras que el prefijo (system, contrato de salida, imagen original e historial) se lee de caché. El uso real por pasada se registra en `output/<jobId>/usage.json`.

## Scripts

| Script              | Descripción                                    |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Servidor en desarrollo con recarga (`tsx`)     |
| `npm run job -- <img>` | Ejecuta el pipeline desde la terminal       |
| `npm run build`     | Compila TypeScript a `dist/`                   |
| `npm start`         | Ejecuta la build compilada                     |
| `npm run typecheck` | Verifica tipos sin emitir archivos             |
| `npm run lint`      | ESLint                                         |
| `npm run format`    | Prettier                                       |

## Licencia

MIT
