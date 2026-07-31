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

- **Web**: abre `http://localhost:3000`, arrastra la imagen, elige nº máx. de pasadas y pulsa *Generar*. Verás el progreso en vivo (pasadas, score y discrepancias) y al terminar el comparador con slider, la descarga del HTML y la caja de ajustes finales.
- **CLI** (pipeline sin UI): `npm run job -- ruta/a/infografia.png [maxPasses]`

Todo el estado de un trabajo vive en `output/<jobId>/` (imagen original, HTML/captura/diff de cada pasada, `job.json`, `usage.json` con el uso de tokens) y es reabrible tras reiniciar el servidor.

## API HTTP

| Método y ruta | Descripción |
| --- | --- |
| `POST /api/jobs` | Multipart con `image` (+ `maxPasses`, `notes`). Devuelve `{ jobId }` y arranca el pipeline. |
| `GET /api/jobs/:id` | Estado del job: pasadas, scores y uso de tokens. |
| `GET /api/jobs/:id/events` | SSE con progreso en vivo (replay incluido). |
| `POST /api/jobs/:id/iterate` | `{ "prompt": "..." }` → una pasada más con las instrucciones del usuario. Repetible. |
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
public/                       # UI (subida · progreso · resultado)
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
