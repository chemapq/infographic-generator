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

- **Web**: abre `http://localhost:3000`, arrastra la imagen, elige nº máx. de pasadas y pulsa *Generar*. Verás el progreso en vivo (pasadas, score y discrepancias) y al terminar el comparador con slider, la **edición señalando elementos** (con Claude) o **editando textos a mano** (sin IA), la descarga del HTML y la caja de ajustes finales.
- **CLI** (pipeline sin UI): `npm run job -- ruta/a/infografia.png [maxPasses]`

**Formatos admitidos:** PNG, JPEG, WebP y GIF, hasta 25 MB. El formato se comprueba por el contenido del archivo, no por su extensión, y lo que no se puede procesar se rechaza explicando qué hacer. En particular, las fotos **HEIC/HEIF del iPhone no se pueden decodificar**: conviértelas a PNG o JPEG (en el Mac, Vista Previa → Archivo → Exportar). Los errores de las librerías (libvips, Playwright, API de Anthropic) se traducen a lenguaje llano, con el mensaje técnico plegado aparte.

Todo el estado de un trabajo vive en `output/<jobId>/` (imagen original, HTML/captura/diff de cada pasada, `job.json`, `usage.json` con el uso de tokens) y es reabrible tras reiniciar el servidor.

## Galería (historial local)

*Mis infografías* (`#/gallery`, enlace en la cabecera) lista todo lo generado en esta instalación a partir de lo que ya hay en `output/`: miniatura, título, estado, score y nº de pasadas, con buscador, filtro por estado y orden por recencia o score. Desde cada tarjeta se abre el job, se descarga el HTML, se renombra (clic en el título) o se borra (deshabilitado mientras el job sigue en curso).

Es persistencia **local**, sin base de datos: no hay migración que ejecutar, los jobs que ya existían en `output/` aparecen solos. Detalle de diseño y la costura prevista para cuando esto pase a una base de datos global en [PLAN_GALERIA.md](PLAN_GALERIA.md).

## Editar señalando elementos

En el resultado, *Editar señalando* abre la infografía a pantalla completa. Al pasar el ratón se resaltan los elementos y **al hacer clic en uno** se abre una ventanita con un prompt: escribes el cambio en lenguaje natural y **Claude lo aplica sobre ese elemento**.

- «rehaz este gráfico como barras horizontales»
- «cambia este azul por el verde de la paleta»
- «pon este título en dos líneas y más grande»

Funciona con cualquier elemento del documento, incluidas las formas y los iconos dentro de un SVG. *Señalar el contenedor* amplía la selección al elemento padre (para pedir cambios de una sección entera) y *Cambio en toda la pieza…* manda la petición sin acotarla a nada.

Cada petición es una **pasada más del job**: se envía a `POST /api/jobs/:id/iterate` con el contexto del elemento (etiqueta, selector, markup y texto), Claude reescribe el HTML completo, el servidor lo renderiza y lo compara con el original, y el lienzo se recarga con el resultado sin perder la selección. Todo queda versionado en `passes/`, así que siempre se puede volver a una pasada anterior desde el selector del resultado.

Detalle de implementación: el lienzo es un `<iframe sandbox="allow-same-origin">` servido desde el mismo origen (sin `allow-scripts`: el documento no ejecuta JS), así que la app lee su DOM para describir el elemento señalado. El HTML generado no necesita ninguna instrumentación y el navegador nunca lo modifica: los cambios los hace siempre Claude.

Los clics **no** se escuchan dentro del iframe sino en una capa transparente por encima, y el elemento se resuelve con `elementFromPoint`: WebKit (Safari) no despacha eventos DOM en un documento con `sandbox` sin `allow-scripts`, aunque el padre sí pueda leer su DOM. Y el editor se engancha en cuanto existe el DOM del iframe, sin esperar a su evento `load`, que espera también a las Google Fonts del documento generado y con la red lenta dejaba el lienzo visible pero sin responder.

## Editar textos a mano (sin IA)

El mismo editor tiene un botón *Editar textos* que abre el lienzo en un segundo modo, conmutable con *Pedir cambios a la IA* sin cerrarlo. Aquí el clic no señala un elemento sino un **nodo de texto**: en `<h1>5 <span class="hl">ESTRATEGIAS</span></h1>` son dos textos editables independientes, así que reescribir uno no toca el `<span>` de color ni el resto del markup.

- Se teclea el cambio en una tarjeta y el lienzo reflowa **en vivo**, sin esperar a nada.
- *Resaltar textos* marca de un vistazo todos los nodos editables; `Tab` / `Mayús+Tab` los recorre en orden sin tocar el ratón; `⌘Z` deshace el último cambio confirmado; *↺ Restaurar* devuelve un texto concreto a como estaba.
- Nada se guarda hasta pulsar *Guardar cambios* — hasta entonces, *Descartar* deja la infografía como estaba y cerrar el editor no toca nada en el servidor.

Al guardar, `POST /api/jobs/:id/text-edit` aplica los cambios sobre el **DOM real** con el Chromium de Playwright (nunca como texto plano: así sobreviven entidades, atributos y SVG) y crea una pasada más, con `kind: "manual"`. Es todo o nada — si algún texto ya no coincide con lo que hay en el servidor (otra pestaña iteró con IA mientras tanto), no se aplica ninguno y se avisa cuáles. Y **no hay ninguna llamada a Claude**: la pasada resultante cuesta 0 tokens, aparece marcada como "edición manual" en el timeline y nunca compite por el chip de "mejor pasada" (ese lo decide el parecido con el original, no un cambio de texto hecho a propósito).

## Login (para desplegar)

En local no hace falta nada: sin `AUTH_PASSWORD` la app se abre directamente. **Al desplegar, define `AUTH_PASSWORD` y toda la herramienta queda detrás de una pantalla de login** — la interfaz, la API, el HTML generado y las capturas de cada job.

```bash
AUTH_PASSWORD=una-contraseña-larga
AUTH_SECRET=cadena-aleatoria-y-fija   # sin ella, cada reinicio cierra las sesiones
AUTH_SESSION_HOURS=12
```

- **En producción es obligatoria**: con `NODE_ENV=production` y sin `AUTH_PASSWORD`, el servidor no arranca y explica por qué. Así un despliegue no queda abierto por un descuido.
- La sesión es una cookie `HttpOnly` + `SameSite=Lax` firmada con HMAC; *Cerrar sesión* invalida todos los tokens emitidos, no solo la cookie del navegador.
- Cinco fallos seguidos bloquean los intentos 30 s, y el doble en cada fallo siguiente hasta 5 minutos.
- **Sirve por HTTPS.** Por HTTP la contraseña viaja en claro; ponlo detrás de un proxy con certificado o de un túnel con TLS. La cookie se marca `Secure` automáticamente cuando la petición llega por HTTPS.
- Ojo con dejarlo sin `AUTH_PASSWORD` fuera de tu equipo: el puerto queda accesible para cualquiera que lo alcance, y el arranque lo avisa por consola.

## Despliegue

Servidor de larga duración (cola en memoria, disco local, Chromium vía Playwright, SSE):
necesita un host con proceso persistente y disco propio, no funciones serverless. Hay un
`Dockerfile` listo para Render, Railway, Fly.io o un VPS — variables de entorno, volumen
persistente y pasos por host en [DEPLOY.md](DEPLOY.md).

## API HTTP

| Método y ruta | Descripción |
| --- | --- |
| `POST /api/auth/login` | `{ "password": "..." }` → cookie de sesión. `GET /api/auth/status` y `POST /api/auth/logout` completan el trío. |
| `POST /api/jobs` | Multipart con `image` (+ `maxPasses`, `notes`). Devuelve `{ jobId }` y arranca el pipeline. |
| `GET /api/jobs/:id` | Estado del job: pasadas, scores y uso de tokens. |
| `GET /api/jobs/:id/events` | SSE con progreso en vivo (replay incluido). |
| `POST /api/jobs/:id/iterate` | `{ "prompt": "...", "target"?: { label, selector, html, text } }` → una pasada más con las instrucciones del usuario, acotada al elemento señalado si se envía `target`. Repetible. |
| `POST /api/jobs/:id/text-edit` | `{ "basePass": n, "edits": [{ selector, nodeIndex, before, after }] }` → cambios de texto a mano, **sin IA** (0 tokens). `409` si `basePass` ya no es la pasada actual. |
| `GET /api/jobs/:id/result` | HTML final (`?pass=n` para versiones anteriores). |
| `GET /api/jobs/:id/assets/...` | Original, capturas y diffs. |
| `GET /api/gallery` | Historial de jobs (`?limit&cursor&q&status&sort`). |
| `GET /api/jobs/:id/thumb` | Miniatura WebP para la galería, generada a demanda. |
| `PATCH /api/jobs/:id` | `{ "title": "..." }` → renombra el job. |
| `DELETE /api/jobs/:id` | Borra el job (`409` si sigue en curso). |

## API v1 (integraciones — Moodle y similares)

Además de la API de arriba (para el navegador, con cookie de sesión), hay una segunda API en
`/api/v1` pensada para un **cliente servidor-a-servidor**: bearer token, sondeo en vez de SSE,
respuestas ligeras e idempotencia. Es la que consume el plugin `local_awakeinfographic` de
Moodle — ver [PLAN_MOODLE.md](PLAN_MOODLE.md) para el porqué y [docs/openapi.yaml](docs/openapi.yaml)
para el contrato completo.

```bash
API_KEYS=moodle-pruebas:clave-larga-y-aleatoria   # en .env

curl -s localhost:3000/api/v1/health                              # público, sin clave
curl -s -X POST localhost:3000/api/v1/jobs \
  -H 'Authorization: Bearer clave-larga-y-aleatoria' \
  -H 'Idempotency-Key: prueba-001' \
  -F 'image=@infografia.png'
curl -s localhost:3000/api/v1/jobs/<jobId> -H 'Authorization: Bearer clave-larga-y-aleatoria'
```

Diferencias clave frente a `/api/jobs`: cada clave de `API_KEYS` es un cliente distinto y solo ve
sus propios jobs (404 en cualquier otro caso, incluidos los de otra clave); `POST` exige
`Idempotency-Key` (un reintento con la misma clave devuelve el mismo `jobId`, sin cobrar tokens
dos veces); `GET /jobs/:id` no lleva `spec` ni `passes[]` salvo `?include=passes`; y `/html` se
sirve como adjunto, no `inline`. `UI_ENABLED=false` arranca el motor sirviendo solo esta API (sin
estáticos, login ni galería web) — pensado para un despliegue que solo alimenta a Moodle.

El plugin `local_awakeinfographic` que consume esta API vive en [moodle-plugin/](moodle-plugin/)
(PHP, no forma parte de este build de Node). Cómo instalarlo y probarlo de punta a punta con
`moodle-docker`: [PLAN_MOODLE.md §7](PLAN_MOODLE.md#7-cómo-probarlo-en-moodle-de-cero).

## Estructura

```
src/
├── index.ts                  # Express + estáticos + rutas
├── cli.ts                    # pipeline invocable por script
├── config/env.ts             # PORT, ANTHROPIC_MODEL, MAX_PASSES, AUTH_*, API_*…
├── api/                      # jobs.router.ts · gallery.router.ts · auth.router.ts · sse.ts
│   └── v1/                   # API para integraciones: bearer, idempotencia, sondeo (ver arriba)
└── services/
    ├── orchestrator.ts       # bucle generar → renderizar → comparar → refinar
    ├── retention.ts          # barrido de output/ por antigüedad (RETENTION_DAYS)
    ├── claude/               # client (caché + uso) · prompts · schemas · analyze · generate · compare
    ├── renderer.ts           # Playwright: HTML → PNG determinista
    ├── textEdits.ts          # edición manual de texto sobre el DOM, sin IA
    ├── differ.ts             # sharp + pixelmatch: score + heatmap
    ├── gallery.ts            # historial local: listar, buscar, paginar (ver PLAN_GALERIA.md)
    ├── thumbs.ts             # miniatura WebP a demanda
    ├── owner.ts              # cookie ig_owner: agrupa jobs, no controla acceso
    ├── auth.ts               # local sin fricción, remoto con contraseña
    ├── errors.ts             # traduce los fallos a lenguaje llano
    ├── image.ts              # formato real por los bytes de cabecera
    ├── validator.ts          # contrato: sin JS ni red fuera de Google Fonts
    └── store.ts              # persistencia en output/<jobId>/
public/
├── index.html · styles.css   # UI: subida · progreso · resultado · editor
├── login.html                # pantalla de acceso (solo desde fuera del equipo)
├── app.js                    # subida, SSE, timeline, comparador
└── editor.js                 # señalar elementos (Claude) o editar textos a mano (sin IA)
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
