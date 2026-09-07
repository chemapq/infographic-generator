# Plan — API del motor + plugin visual de Moodle

> El plugin de Moodle **es la misma interfaz** que la app: la pantalla de subida, el resultado con
> el comparador y **el editor visual completo** — señalar elementos y pedirle el cambio a Claude,
> o editar los textos a mano. No es un formulario de Moodle con un botón de descarga.
>
> El motor se queda en TypeScript. El plugin PHP hace tres cosas: autenticar con Moodle, servir
> el front-end existente, y hacer de **proxy** hacia la API del motor para que la clave nunca baje
> al navegador.

Rama: `feat/api-moodle` · Complementa [PLAN.md](PLAN.md) · Aplaza
[PLAN_MARKETPLACE.md](PLAN_MARKETPLACE.md) (§10)

**Decisiones cerradas:**

| Decisión | Elección |
| --- | --- |
| Alcance de la v1 | **Generar + editar**. El editor entra en la v1: es re-alojarlo, no reimplementarlo (§2) |
| Tipo de plugin | `local_awakeinfographic`, resultado en la File API. El banco de contenido (`contenttype_`) es fase 2 |
| Quién genera | Solo profesores y gestores, por capability |
| Front-end | **El mismo `styles.css` / `app.js` / `editor.js`**, transformados desde el repo del motor por un `npm run build:moodle` (§6.5). Una sola fuente de verdad |
| Auth | Moodle. El navegador nunca ve la clave de la API; todas las llamadas van a Moodle y Moodle reenvía (§6.4) |
| Entorno de pruebas | moodle-docker en el portátil, motor en el host |

---

## 1. Punto de partida: qué de lo que hay sirve

| Lo que hay hoy | Sirve |
| --- | --- |
| `editor.js` (38 KB): IIFE que expone **un solo global**, `window.VisualEditor = {open, close, isOpen, onJobUpdate, onProgress}` ([editor.js:1071](public/editor.js#L1071)) | **Íntegro.** Sin imports, sin framework, sin build. Se carga con un `<script>` y funciona |
| El editor lee el DOM del iframe con `elementFromPoint` sobre `contentDocument` ([editor.js:314](public/editor.js#L314)) | **Íntegro**, y es la clave de todo: solo exige que el iframe sea del mismo origen que la página. En Moodle lo es (§6.6) |
| `editor.js` hace **3 llamadas de red**: `/api/jobs/:id`, `/api/jobs/:id/iterate`, `/api/jobs/:id/text-edit` | Se reescriben las 3 URLs. Nada más |
| `app.js` (23 KB): IIFE, enrutado por hash, ~14 llamadas a `/api/…` | Se reescriben las URLs; se quita el bloque de `/api/auth/*` y el `EventSource` (§6.6) |
| `index.html`: cabecera + 3 vistas (`#view-upload`, `#view-gallery`, `#view-job`) + overlay `#editor` | Pasa a plantilla Mustache casi literal |
| `styles.css` (20 KB), CSS plano, **ya con Poppins de Google Fonts** ([index.html:11](public/index.html#L11)) | Se reutiliza, calificado bajo `.ig-app` para que no pelee con Boost (§6.5) |
| `iterateInstruction(userPrompt, target?)` ([prompts.ts:78](src/services/claude/prompts.ts#L78)) | **Ya es pura**: prompt + elemento señalado → instrucción. Es lo que hace trivial el endpoint sin estado (§5.3) |
| `sanitizeHtml()` en cada pasada ([validator.ts:14](src/services/validator.ts#L14)) | Base de la seguridad al servir el HTML desde el origen de Moodle (§6.10) |
| `#ed-frame` con `sandbox="allow-same-origin"` vs `#preview-frame` con `sandbox=""` ([index.html:146](public/index.html#L146), [index.html:198](public/index.html#L198)) | La distinción se mantiene tal cual: el editor necesita leer el DOM, la previsualización no |
| Auth por cookie con contraseña compartida ([auth.ts](src/services/auth.ts)) | **No sirve.** Se sustituye por bearer server-a-servidor (§5.2) |
| Progreso por SSE ([sse.ts](src/api/sse.ts)) | **No sirve** en Moodle: PHP-FPM no puede sostener una conexión de minutos. Pasa a sondeo (§6.6) |

**El acoplamiento total del front-end son 17 URLs literales.** Eso es lo que hace que esto sea
un re-alojamiento y no un port.

---

## 2. Las tres operaciones, y por qué solo una es pesada

El hallazgo que reordena el plan: **generar es caro; editar no lo es en absoluto.**

| Operación | Cómo se resuelve | Necesita | Latencia | Coste |
| --- | --- | --- | --- | --- |
| **Generar** (imagen → HTML) | Asíncrona: tarea ad hoc de Moodle + sondeo | Cola en serie, Chromium, pixelmatch, N llamadas a Claude | Minutos | Alto |
| **Editar textos a mano** | **100% en el navegador** | Nada | Instantánea | **0 tokens, 0 llamadas** |
| **Editar señalando** (IA) | Síncrona, con spinner | **Una** llamada a Claude | 20–60 s | Una llamada |

Los dos razonamientos que lo sostienen:

**La edición manual no necesita servidor.** `textEdits.ts` usa Playwright porque *el servidor no
tiene DOM* — de ahí su comentario de que parchear el HTML como texto plano rompería entidades,
atributos y SVG ([textEdits.ts:1](src/services/textEdits.ts#L1)). El navegador del profesor **sí
tiene DOM**: los cambios se aplican al `nodeValue` del nodo real en el iframe (que es exactamente
lo que ya hace `editor.js`), se serializa `'<!DOCTYPE html>\n' + documentElement.outerHTML`, y se
manda a Moodle a guardar. Fidelidad idéntica, cero tokens, cero cron, cero espera.

**La edición con IA no necesita el bucle.** Hoy `/iterate` genera, renderiza con Chromium,
compara con pixelmatch y crea una pasada versionada en `output/`. De todo eso, para un cambio
dirigido lo único imprescindible es la llamada a Claude: la previsualización ya la tiene el
profesor en vivo en el iframe, y un score de parecido al original no significa gran cosa cuando
el usuario acaba de pedir a propósito que algo cambie. Un endpoint **sin estado** —
HTML entra, HTML sale — se salta la cola, Chromium, el disco y la llamada de comparación.

Consecuencia práctica: **editar no pasa por el cron de Moodle.** Solo generar. Eso elimina de la
experiencia de edición toda la fricción que hace raro un plugin de Moodle.

---

## 3. Arquitectura

```
  Navegador del profesor (origen: el Moodle)
 ┌────────────────────────────────────────────────────────────────────┐
 │  Página del plugin — pagelayout 'embedded' (sin barra ni bloques)  │
 │  .ig-app  ←  styles.css calificado + app.js + editor.js            │
 │                                                                    │
 │  #view-upload   #view-gallery   #view-job ──▶ #editor (overlay)     │
 │                                                  │                 │
 │                                     #ed-frame (sandbox=            │
 │                                      "allow-same-origin")          │
 │                                      src = pluginfile.php/…        │
 │                                            ▲  MISMO ORIGEN         │
 │                                            │  → contentDocument    │
 │                                            │    legible            │
 │  fetch(…) + sesskey ──┐                    │                       │
 └───────────────────────┼────────────────────┼───────────────────────┘
                         │                    │
 ┌───────────────────────▼────────────────────┴───────────────────────┐
 │  Moodle (PHP) — local_awakeinfographic                             │
 │                                                                    │
 │  ajax/create.php    ─▶ fila + queue_adhoc_task ──┐    (asíncrono)  │
 │  ajax/status.php    ─▶ shape JobRecord desde la BD de Moodle       │
 │  ajax/edit.php      ─▶ POST /api/v1/edit ────────┼─▶ (síncrono)    │
 │  ajax/savehtml.php  ─▶ valida y guarda versión   │  (sin motor)    │
 │  ajax/gallery.php   ─▶ desde la BD de Moodle     │                 │
 │  pluginfile.php     ─▶ File API: version/N/infographic.html        │
 │                                    preview/N/preview.png           │
 │                                    source/original.png             │
 │                                                  │                 │
 │  classes/task/sync_job.php  (cron) ──────────────┤                 │
 │  classes/api_client.php  ── Bearer <clave> ──────┤                 │
 └──────────────────────────────────────────────────┼─────────────────┘
                                                    │
 ┌──────────────────────────────────────────────────▼─────────────────┐
 │  Motor (Node) — /api/v1                                            │
 │   POST   /jobs              cola en serie ─▶ Chromium ─▶ pixelmatch │
 │   GET    /jobs/:id          estado ligero                          │
 │   GET    /jobs/:id/html · /preview.png · /original.png             │
 │   DELETE /jobs/:id                                                 │
 │   POST   /edit              SIN ESTADO: html+prompt → html          │
 │   GET    /health            público                                │
 └────────────────────────────────────────────────────────────────────┘
```

Tres propiedades que no hay que perder:

1. **La clave de la API vive solo en el servidor de Moodle.** El navegador habla con Moodle; Moodle
   habla con el motor. Nunca hay un bearer en las devtools.
2. **El iframe se sirve desde Moodle**, no desde el motor. Por eso el editor funciona sin tocar su
   lógica, y por eso el activo sobrevive a que el motor se caiga o purgue el job.
3. **El navegador nunca ve el `jobId` del motor**, solo el id de la fila de Moodle. Que la
   retención del motor borre el job no rompe nada.

---

## 4. Fase 0 — antes de escribir el plugin

Dos cosas que se hacen en el repo del motor, son útiles por sí solas y desbloquean todo lo demás.

### 4.1 `apiFetch()` con base configurable

Hoy hay 17 URLs literales `/api/…` repartidas entre `app.js` y `editor.js`. Se sustituyen por un
único punto de configuración:

```js
// public/config.js — el motor lo sirve con los valores por defecto;
// el plugin lo genera con los suyos.
window.IG_CONFIG = {
  apiBase: '',              // '' en la app; '/local/awakeinfographic/ajax' en Moodle
  filesBase: '',            // '' en la app; la URL de pluginfile.php en Moodle
  extraParams: {},          // {} en la app; { sesskey: '…' } en Moodle
  features: { sse: true, auth: true, score: true },
};
```

```js
// helper compartido
async function apiFetch(path, options = {}) { … }   // prefija apiBase y añade extraParams
function fileUrl(path) { … }                        // prefija filesBase
```

`features` es lo que apaga limpiamente lo que en Moodle no existe: `sse: false` conmuta a sondeo,
`auth: false` esconde `#btn-logout` y no llama a `/api/auth/status`, `score: false` esconde el
comparador en las versiones nacidas de una edición.

**Esto es refactor puro, sin cambio de comportamiento en la app.** Verificable con la app tal cual.

### 4.2 Medir el bucle (sigue pendiente)

Independiente de este plan pero decide su ergonomía: con 45 casos (8–10 por familia del dataset),
`maxPasses=1` contra `maxPasses=N`, comparando la distribución del delta de score, el coste, y
sobre todo **cuántas de las correcciones de las pasadas 2+ las habría hecho un humano en 30
segundos con el editor**. Si la respuesta es «casi todas», generar baja de minutos a un minuto y
el plugin deja de necesitar cron para casi nada.

---

## 5. El motor: la API

Todo nuevo en `src/api/v1/`. Versionada desde el día uno: a partir de que un plugin instalado en
un centro la consuma, cambiarla es problema de otros.

### 5.1 Autenticación

`Authorization: Bearer <clave>`. Claves declaradas en el entorno, sin base de datos:

```
API_KEYS=moodle-pruebas:8f3c…,moodle-centro-a:b21e…
```

- Formato `nombre:clave`. El **nombre** es el `ownerId` del job y lo único que aparece en logs.
- Comparación en tiempo constante, reutilizando `sameSecret()` ([auth.ts:26](src/services/auth.ts#L26)).
- El guardián global de [index.ts:28](src/index.ts#L28) añade `/api/v1` a las rutas que no pasan
  por la cookie; el bearer se aplica como middleware del router v1.
- `GET /api/v1/health` queda **público**: lo usa el botón «probar conexión» del plugin. Devuelve
  solo `{ ok, model, maxPasses, version }`.
- El arranque de [index.ts:64](src/index.ts#L64) pasa a exigir `AUTH_PASSWORD` **o** `API_KEYS`.
  Con `UI_ENABLED=false` no se sirve `public/`: el motor como puro backend de Moodle.

### 5.2 Generar — asíncrono

**`POST /api/v1/jobs`** · `multipart/form-data`, mismo `multer` en memoria y misma comprobación de
formato por bytes que la ruta actual ([jobs.router.ts:46](src/api/jobs.router.ts#L46)).

| Campo | Notas |
| --- | --- |
| `image` | PNG/JPEG/WebP/GIF, ≤ 25 MB. Formato por cabecera, no por extensión |
| `maxPasses` | 1–8, por defecto `MAX_PASSES` |
| `notes` | Notas del profesor; se inyectan en la instrucción de la pasada 1 |
| `externalRef` | Opaco: `moodle:<hash del wwwroot>:<id de fila>`, para correlacionar en soporte |

**Cabecera `Idempotency-Key` obligatoria.** Una segunda petición con la misma clave devuelve `200`
con el `jobId` existente. Es lo que hace seguro que la tarea de Moodle reintente tras un timeout
de red, y lo que evita que un doble clic cueste el doble. Índice en memoria + campo persistido en
`job.json`, reconstruido al arrancar leyendo `output/*/job.json`.

```
202 { "jobId": "a1b2c3d4", "status": "queued", "statusUrl": "/api/v1/jobs/a1b2c3d4" }
200 { "jobId": "a1b2c3d4", "status": "done", "idempotent": true }
400 { "code": "unsupported_image", "error": "…", "detail": "…" }
429 { "code": "queue_full", "error": "…", "retryAfterSeconds": 120 }
```

Todo error lleva un **`code` estable** además del `error` en lenguaje llano que ya produce
[errors.ts](src/services/errors.ts). El plugin decide por el `code`, nunca por el texto.

**`GET /api/v1/jobs/:id`** — estado ligero, que es lo que se sondea:

```json
{ "jobId": "a1b2c3d4", "status": "refining",
  "progress": { "pass": 3, "maxPasses": 5 },
  "currentScore": 94.12, "bestPass": 2, "bestScore": 94.8, "passCount": 3,
  "stopReason": null, "error": null, "hasResult": true,
  "usage": { "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0 },
  "createdAt": "2026-09-07T10:00:00.000Z", "finishedAt": null }
```

Sin `spec` y sin `passes[]` (que son decenas de KB por sondeo). `?include=passes` añade el detalle.

| Ruta | Devuelve |
| --- | --- |
| `GET /api/v1/jobs/:id/html` | `text/html`, `Content-Disposition: attachment`, `ETag`. `?pass=n` |
| `GET /api/v1/jobs/:id/preview.png` | Captura de la pasada indicada |
| `GET /api/v1/jobs/:id/original.png` | El original normalizado (para el comparador) |
| `DELETE /api/v1/jobs/:id` | Borra el job. Lo llama el plugin al borrar el activo |

`attachment` y no `inline` como la ruta de la UI
([jobs.router.ts:208](src/api/jobs.router.ts#L208)): quien consume esto es una máquina, y así
ningún navegador lo ejecuta por accidente en el origen del motor.

### 5.3 Editar — `POST /api/v1/edit`, sin estado

El endpoint nuevo, y el que hace posible el editor en Moodle.

```
POST /api/v1/edit
Authorization: Bearer …
Content-Type: application/json

{
  "html": "<!DOCTYPE html>…",            // el HTML actual, completo
  "prompt": "pon este título en dos líneas y más grande",
  "target": {                             // opcional: el elemento señalado
    "label": "h1.title", "selector": "…", "html": "…", "text": "…"
  },
  "originalJobId": "a1b2c3d4"             // opcional: reusar el original del motor
}
→ 200 { "html": "…", "usage": { … } }
```

- **Sin job, sin `output/`, sin Chromium, sin pixelmatch, sin cola.** Una llamada a Claude.
- El prompt se construye con `iterateInstruction(prompt, target)`, que **ya es una función pura**
  ([prompts.ts:78](src/services/claude/prompts.ts#L78)): no hay que tocarla.
- El `html` que entra y el que sale pasan por `sanitizeHtml()`; los avisos vuelven en la respuesta.
- `originalJobId` es la única concesión a la calidad: sin la imagen original, el modelo edita a
  ciegas respecto al referente visual. Para un cambio dirigido («más grande», «este azul por el
  verde de la paleta») da igual; para «arregla esto, que no se parece al original» no. Si el job
  sigue en disco, se adjunta su `original.png` con `cache_control: ephemeral`, así ediciones
  sucesivas sobre el mismo activo en pocos minutos leen la imagen de caché. Si la retención ya lo
  borró, se degrada sin error y se avisa en la respuesta con `"originalAvailable": false`.
- Límites: `html` ≤ 2 MB, `prompt` ≤ 2000, `target.html` ≤ 4000 (los mismos que ya valida
  [jobs.router.ts:109](src/api/jobs.router.ts#L109)).
- **No entra en la cola en serie.** Es una llamada a la API, no una pasada del pipeline: dos
  profesores editando a la vez no se estorban. Sí tiene su propio semáforo
  (`API_MAX_CONCURRENT_EDITS`, por defecto 4) para no reventar el límite de la API de Anthropic.

Ojo con la asimetría, que hay que documentar: una versión nacida de `/edit` **no tiene score ni
captura**. La UI lo refleja apagando el comparador en esas versiones (`features.score`), igual que
la app ya excluye las pasadas manuales del chip de «mejor pasada»
([orchestrator.ts:241](src/services/orchestrator.ts#L241)).

### 5.4 Cola, cuotas y retención

- `API_MAX_QUEUE_DEPTH` (5): al llenarse, `POST /jobs` → `429` con `Retry-After` estimado con la
  duración media de los últimos jobs. Hace falta exponer `queueDepth()` junto al `enqueue()` de
  [orchestrator.ts:44](src/services/orchestrator.ts#L44).
- `API_DAILY_JOB_LIMIT` por clave (50) → `429 quota_exceeded`. Las ediciones no cuentan aquí; van
  a `API_DAILY_EDIT_LIMIT` (500), que es un orden de magnitud más barato.
- `RETENTION_DAYS` (0 = sin límite, para no cambiar el comportamiento actual): barrido al arrancar
  y cada 6 h, reutilizando `deleteJobDir()` ([store.ts:92](src/services/store.ts#L92)). Con el
  plugin es seguro: el HTML y las versiones ya viven en Moodle.

### 5.5 Ficheros a tocar en el motor

| Fichero | Cambio |
| --- | --- |
| `public/config.js` | **nuevo** — `window.IG_CONFIG` (§4.1) |
| `public/api.js` | **nuevo** — `apiFetch()` / `fileUrl()` |
| `public/app.js` | Las ~14 URLs por `apiFetch`; `EventSource` y `/api/auth/*` tras `features` |
| `public/editor.js` | Las 3 URLs por `apiFetch`; `#ed-frame` por `fileUrl()`; modo texto → cliente (§6.7) |
| `public/index.html` | Envolver en `.ig-app`; cargar `config.js` y `api.js` antes de los demás |
| `src/api/v1/index.ts` | **nuevo** — router, middleware bearer, errores con `code` |
| `src/api/v1/jobs.router.ts` | **nuevo** — §5.2 |
| `src/api/v1/edit.router.ts` | **nuevo** — §5.3 |
| `src/api/v1/keys.ts` | **nuevo** — parseo de `API_KEYS`, comparación segura, `ownerId` |
| `src/api/v1/idempotency.ts` | **nuevo** — índice en memoria + reconstrucción desde disco |
| `src/services/editHtml.ts` | **nuevo** — la llamada sin estado (system + html + instrucción) |
| `src/services/retention.ts` | **nuevo** — barrido de `output/` |
| `src/config/env.ts` | `API_KEYS`, `API_MAX_QUEUE_DEPTH`, `API_DAILY_JOB_LIMIT`, `API_DAILY_EDIT_LIMIT`, `API_MAX_CONCURRENT_EDITS`, `RETENTION_DAYS`, `UI_ENABLED` |
| `src/index.ts` | Montar `/api/v1`; relajar la línea 64; `UI_ENABLED=false` |
| `src/services/orchestrator.ts` | `queueDepth()`; `idempotencyKey` y `externalRef` en `JobRecord` |
| `src/types.ts` | Los dos campos nuevos |
| `scripts/build-moodle.mjs` | **nuevo** — genera los assets del plugin (§6.5) |
| `docs/openapi.yaml` | **nuevo** — el contrato |
| `.env.example`, `README.md`, `DEPLOY.md` | Variables nuevas y modo solo-API |

---

## 6. El plugin: `local_awakeinfographic`

Con prefijo de marca para no colisionar en el directorio de plugins el día que se publique.

### 6.1 Árbol

```
local/awakeinfographic/
├── version.php
├── settings.php                  # URL de la API, clave, defaults, enlace a probar conexión
├── lib.php                       # local_awakeinfographic_pluginfile() + hook de navegación
├── index.php                     # LA página: sirve el front-end completo
├── testconnection.php            # ping a /api/v1/health
├── ajax/
│   ├── create.php                # multipart → fila + adhoc task
│   ├── status.php                # estado con forma de JobRecord
│   ├── edit.php                  # síncrono → POST /api/v1/edit → versión nueva
│   ├── savehtml.php              # guarda el HTML que el navegador ya editó
│   ├── gallery.php               # listado desde la BD de Moodle
│   ├── rename.php · delete.php
│   └── lib.php                   # require_login + require_sesskey + capability, común
├── classes/
│   ├── api_client.php            # \curl al motor; traduce `code` a excepciones
│   ├── job.php                   # entidad, versiones, File API
│   ├── job_shape.php             # emite el JSON que app.js espera
│   ├── html_guard.php            # revalidación del HTML antes de guardar (§6.10)
│   ├── task/sync_job.php         # adhoc: enviar → sondear → descargar
│   ├── task/cleanup.php          # scheduled: purga de fallidos antiguos
│   └── privacy/provider.php
├── db/
│   ├── install.xml · access.php · tasks.php · upgrade.php
├── lang/en/local_awakeinfographic.php
├── lang/es/local_awakeinfographic.php
├── templates/app.mustache        # generado desde index.html
├── styles/app.css                # generado desde styles.css, calificado
├── js/config.js                  # generado por PHP en tiempo de petición
├── js/api.js · js/app.js · js/editor.js   # copiados del motor
├── thirdpartylibs.xml            # declara js/ y styles/ como assets vendorizados
└── tests/
```

### 6.2 Tablas (XMLDB)

**`local_awakeinfographic_job`** — el activo

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | int(10) PK autoinc | El id que ve el navegador |
| `userid` | int(10) | Dueño |
| `courseid` | int(10) null | Contexto de creación, informativo |
| `remotejobid` | char(64) null | Los 8 hex del motor. `null` hasta el envío. **Nunca sale al navegador** |
| `idempotencykey` | char(64) | `random_string(32)` al crear la fila, antes del primer envío |
| `title` | char(255) | Editable |
| `status` | char(20) | `pending` \| `submitted` \| `running` \| `done` \| `failed` |
| `remotestatus` | char(20) null | El `status` crudo del motor, para diagnóstico |
| `width`, `height` | int(6) | Necesarios por el editor y el comparador |
| `currentversion` | int(4) null | Versión que se muestra |
| `bestversion` | int(4) null | La de mejor score entre las generadas |
| `attempts` | int(4) | Sondeos hechos |
| `errorcode` | char(64) null · `errormessage` | text null |
| `timecreated` · `timemodified` | int(10) | |

**`local_awakeinfographic_version`** — el historial, que en Moodle es donde debe vivir

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | int(10) PK | |
| `jobid` | int(10) | FK |
| `versionno` | int(4) | 1-based. Corresponde al `pass` que ve `app.js` |
| `origin` | char(10) | `generate` \| `refine` \| `ai` \| `manual` |
| `score` | number(6,2) null | `null` en `ai` y `manual` |
| `prompt` | text null | El prompt del profesor en `ai` |
| `targetlabel` | char(255) null | Elemento señalado |
| `haspreview` | int(1) | 0 en `ai` y `manual`: no hay captura |
| `timecreated` | int(10) | |

Índice único `(jobid, versionno)`.

Ficheros en la File API, **contexto de usuario** (`context_user::instance($job->userid)`) — los
permisos siguen al dueño y el activo sobrevive a que se borre el curso donde se creó:

| `filearea` | `itemid` | Contenido |
| --- | --- | --- |
| `version` | id de la fila de versión | `infographic.html` |
| `preview` | id de la fila de versión | `preview.png` (solo si `haspreview`) |
| `source` | id del job | `original.png`, para el comparador y para `originalJobId` |

### 6.3 Capabilities (`db/access.php`)

| Capability | Por defecto | Riesgo |
| --- | --- | --- |
| `local/awakeinfographic:generate` | `editingteacher`, `manager` | `RISK_SPAM` — consume una API de pago |
| `local/awakeinfographic:edit` | `editingteacher`, `manager` | `RISK_SPAM` — las de IA cuestan |
| `local/awakeinfographic:viewall` | `manager` | `RISK_PERSONAL` |

Sin `student` en la v1. `edit` separada de `generate` a propósito: hay centros que querrán que un
perfil pueda retocar pero no generar de cero.

### 6.4 El proxy: por qué, y endpoint por endpoint

**Por qué.** Si el navegador llamara al motor directamente necesitaría un bearer, y un bearer en
el navegador es un bearer en las devtools. Que Moodle haga de proxy cuesta código PHP y lo compra
todo: la clave se queda en el servidor, la autorización es la de Moodle (`require_login` +
capability + `sesskey`), y no hay CORS ni cookies de terceros en ninguna parte.

| Llamada de `app.js`/`editor.js` | Va a | Qué hace |
| --- | --- | --- |
| `POST /api/jobs` | `ajax/create.php` | Inserta fila, guarda el original en `source`, encola `sync_job`. Devuelve `{jobId}` = id de fila |
| `EventSource /api/jobs/:id/events` | **eliminado** | `features.sse = false` → sondeo de `status.php` cada 2 s |
| `GET /api/jobs/:id` | `ajax/status.php` | `job_shape.php` emite la forma de `JobRecord` desde las dos tablas |
| `GET /api/jobs/:id/result?pass=n` | `pluginfile.php/…/version/<vid>/infographic.html` | **Mismo origen.** Es lo que hace funcionar el editor |
| `POST /api/jobs/:id/iterate` | `ajax/edit.php` | **Síncrono**: `POST /api/v1/edit` → valida → versión nueva. Responde con el `versionno` |
| `POST /api/jobs/:id/text-edit` | `ajax/savehtml.php` | El navegador **ya aplicó** los cambios. Valida y guarda versión `manual`. **Sin motor** |
| `GET /api/gallery` | `ajax/gallery.php` | Desde la BD de Moodle, con la forma de `GalleryPage` |
| `GET /api/jobs/:id/thumb` | `pluginfile.php/…/preview/…` | |
| `PATCH` / `DELETE /api/jobs/:id` | `ajax/rename.php` · `ajax/delete.php` | El borrado también llama a `DELETE /api/v1/jobs/:id`; que falle no impide el local |
| `/api/auth/*` | **eliminado** | `features.auth = false` |

`ajax/lib.php` centraliza el preámbulo de todos: `require_login()`, `require_sesskey()`,
`require_capability()`, cabeceras JSON, y un `try/catch` que convierte las excepciones del
`api_client` en `{ code, error }` con el mismo formato que da el motor — así el manejo de errores
de `app.js` no cambia.

> **Nota de revisión:** lo idiomático en Moodle serían web services (`db/services.php` +
> `external_api`). No se usan en la v1 porque su envoltorio no encaja con multipart de 25 MB ni con
> respuestas de HTML crudo o PNG, y forzarlo añade complejidad sin beneficio. Endpoints planos con
> `require_login` + `require_sesskey` + `require_capability` son aceptables y comunes. Cuando haya
> que soportar la app móvil, entonces sí harán falta web services — y esa es otra conversación.

### 6.5 Que se vea como la app, no como Moodle

**Página.** `index.php` con `$PAGE->set_pagelayout('embedded')`: Moodle sirve la página sin barra
de navegación, sin bloques y sin pie. Un lienzo. Encima:

```php
$PAGE->requires->css(new moodle_url('/local/awakeinfographic/styles/app.css'));
$PAGE->requires->js(new moodle_url('/local/awakeinfographic/js/config.js'), true);
$PAGE->requires->js(new moodle_url('/local/awakeinfographic/js/api.js'), true);
$PAGE->requires->js(new moodle_url('/local/awakeinfographic/js/app.js'), true);
$PAGE->requires->js(new moodle_url('/local/awakeinfographic/js/editor.js'), true);
echo $OUTPUT->render_from_template('local_awakeinfographic/app', $context);
```

`->js()` en vez de AMD **a propósito**: `app.js` y `editor.js` son IIFE con un global, no módulos;
envolverlos en `define()` obligaría a un `grunt` en el entorno de desarrollo sin ganar nada. Se
declaran en `thirdpartylibs.xml` como assets vendorizados, que es el mecanismo previsto para
código que no sigue las convenciones de Moodle, y así el comprobador de estilo no marca los
ficheros enteros.

**Una sola fuente de verdad: `npm run build:moodle`.** El script vive en el repo del motor y
escribe dentro del plugin. Nadie edita a mano lo generado:

| Genera | Desde | Transformación |
| --- | --- | --- |
| `templates/app.mustache` | `public/index.html` | Extrae el `<body>`, envuelve en `.ig-app`, quita `<script>` y `<link>` (los pone `$PAGE->requires`), sustituye los textos por `{{#str}}` de las cadenas de idioma |
| `styles/app.css` | `public/styles.css` | PostCSS con `postcss-prefix-selector`: cada selector calificado bajo `.ig-app` |
| `js/api.js` · `js/app.js` · `js/editor.js` | los mismos | Copia literal. Sin transformar: ya leen `IG_CONFIG` |

`js/config.js` **no** se genera aquí: lo emite `index.php` en cada petición, porque lleva el
`sesskey` y las URLs del Moodle concreto.

**El CSS de Boost.** Calificar bajo `.ig-app` evita que el tuyo se escape, pero no que el de Boost
entre — `body`, `button`, `input`, `a`, los `:root` de las variables. Mitigación: en `.ig-app`, un
bloque de reset de las propiedades que Boost toca en elementos de formulario y tipografía. El
overlay `#editor` sufre menos porque ya es `position: fixed` con su propio contexto de apilamiento.
**Esto es lo único de todo el plan que se ajusta a ojo**, y calculo un par de días de ir mirando
pantallas y corrigiendo. Es también la razón de que el hito 3 esté separado del 4.

**Marca.** El front-end ya usa **Poppins** desde Google Fonts
([index.html:11](public/index.html#L11)), así que la tipografía de la identidad Awakelab 2026 viene
puesta. Al tocar el CSS conviene revisar de paso que la paleta de `styles.css` sea la de
`brand-guideline-AWK-2026` (azules profundos de fondo, cianes vivos de acento) y no la anterior, y
usar la variante de logotipo acorde al fondo. Este plugin va a ser la cara del producto dentro del
Moodle de un cliente.

### 6.6 El editor: qué cambia y qué no

**No cambia** — y esto es el hallazgo del plan:

- El mecanismo entero. `elementFromPoint` sobre `contentDocument`, la capa `#ed-hit` en el padre
  por el asunto de WebKit, el `cssPath`, el descubrimiento de nodos de texto, el zoom, el reflow en
  vivo, `Tab`/`⌘Z`/`Esc`, «señalar el contenedor». Ni una línea.
- `sandbox="allow-same-origin"` en `#ed-frame` y `sandbox=""` en `#preview-frame`. La distinción
  sigue siendo exactamente la correcta.
- La interfaz `VisualEditor.open({jobId, pass, width, height, passCount, mode})`.

**Cambia:**

| Qué | Cómo |
| --- | --- |
| Las 3 URLs | Por `apiFetch()` / `fileUrl()` |
| Guardar textos | Aplicar en el DOM (ya lo hace) + serializar + `POST savehtml.php`. **Sin `/text-edit`** (§6.7) |
| Pedir cambio a la IA | `POST edit.php`, **síncrono**: llega el `versionno` en la respuesta, no hay que sondear el job esperando a que aparezca una pasada (`waitingFor` y `pollTimer` se simplifican) |
| El progreso de generación | `onProgress` deja de recibir `generate:progress` (caracteres en vivo). Recibe el sondeo: pasada, score, discrepancias |

### 6.7 Edición manual: 100 % en el navegador

El flujo, que ya está medio escrito en `editor.js`:

1. El profesor teclea; `editor.js` asigna el `nodeValue` del nodo real en el iframe. **Ya pasa hoy**
   — es lo que da el reflow en vivo.
2. Al pulsar *Guardar cambios*, en vez de mandar la lista de `TextEdit` al servidor:
   ```js
   const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
   await apiFetch(`/savehtml.php?id=${job.id}`, { method: 'POST', body: … });
   ```
3. `savehtml.php` pasa el HTML por `html_guard.php` (§6.10) y crea una versión `manual`.

Lo que se gana: **0 tokens, 0 llamadas al motor, sin cron, instantáneo**, y desaparecen los 409 por
`basePass` desactualizado ([orchestrator.ts:459](src/services/orchestrator.ts#L459)) porque ya no
hay una carrera entre la pasada que el navegador cree que edita y la que hay en el servidor: el
navegador manda el documento entero que él mismo tiene delante.

Lo que se pierde, y hay que decirlo: la garantía de «todo o nada» de
[textEdits.ts:29](src/services/textEdits.ts#L29) deja de tener sentido (ya no hay `before` que
verificar), y **dos pestañas editando el mismo activo se pisan** — la última que guarda gana.
Mitigación: `savehtml.php` recibe el `versionno` sobre el que se editaba y devuelve `409` si ya no
es el actual, con el mismo mensaje que hoy. La versión anterior no se pierde nunca: está en su
propia fila y su propio fichero.

### 6.8 Edición con IA: síncrona

```
navegador ── POST ajax/edit.php { versionno, prompt, target } ──▶ Moodle
                                                                    │
                              lee el HTML de la versión actual de la File API
                                                                    │
                          POST /api/v1/edit { html, prompt, target, originalJobId }
                                                                    │
                                                     ◀── { html, usage }
                                                                    │
                                  html_guard → versión nueva → { versionno }
navegador ◀─── { versionno: 4 } ─── recarga el iframe con fileUrl(), sin perder la selección
```

- 20–60 s con el spinner que `editor.js` ya tiene (`busy`, `busySince`).
- `max_execution_time` de PHP: el `api_client` pone 180 s de timeout de respuesta y `index.php`
  no necesita tocar nada, pero conviene documentar que un `max_execution_time` de 30 s en el
  Moodle del centro cortaría la petición. Se comprueba en `testconnection.php` y se avisa.
- Si el motor devuelve `429` (semáforo de ediciones lleno), se propaga el `Retry-After` y el
  editor lo reintenta solo una vez, mostrando «esperando turno».

### 6.9 Versionado: en Moodle, no en el motor

Las pasadas de generación bajan a Moodle como versiones `generate`/`refine` con su score y su
captura. Las ediciones crean versiones `ai`/`manual` **sin score ni captura**. El selector de
pasadas de `app.js` (`#pass-select`) pasa a ser el selector de versiones, sin cambios: solo lee lo
que le da `job_shape.php`.

Esto es mejor que dejarlo en el motor por tres razones: las versiones entran en el backup del
Moodle, sobreviven a la retención de `output/`, y el activo es reutilizable sin depender de que el
motor esté vivo.

### 6.10 Servir HTML de terceros dentro de Moodle

Es el punto delicado, porque `pluginfile.php` sirve desde el **origen del propio Moodle** y aquí
hay HTML que ha escrito un modelo y ha pasado por un navegador.

1. **El motor sanea.** `sanitizeHtml()` en cada pasada y en las dos direcciones de `/edit`: fuera
   `<script>`, fuera atributos `on*`, fuera toda URL que no sea Google Fonts
   ([validator.ts:14](src/services/validator.ts#L14)).
2. **`html_guard.php` no se lo cree.** Antes de guardar **cualquier** versión —venga del motor o
   del navegador— PHP revalida: rechaza si aparece `<script`, `on\w+\s*=`, `javascript:`,
   `srcdoc`, o una URL externa fuera de la lista blanca. Es la capa que importa de verdad, porque
   en el flujo manual **el HTML llega del cliente** y un cliente es siempre hostil.
3. **`sandbox=""` para mostrar, `allow-same-origin` solo en el editor.** Las Google Fonts siguen
   cargando: `sandbox` no bloquea la descarga de CSS ni de tipografías. Y `allow-scripts` no
   aparece en ninguno de los dos.
4. **`local_awakeinfographic_pluginfile()`**: `require_login()`, contexto de usuario, dueño o
   `viewall`, y `send_stored_file($file, 0, 0, $forcedownload)` con `filelifetime` 0 para no
   cachear un activo privado en proxies intermedios.

### 6.11 `api_client.php`

- `new \curl(['ignoresecurity' => true])`.

  > La URL la configura un administrador, no un usuario, así que saltarse el comprobador de
  > seguridad de cURL es correcto. Y es **necesario**: sin eso, apuntar a `host.docker.internal`, a
  > una IP privada o a `localhost` puede quedar bloqueado por `$CFG->curlsecurityblockedhosts` con
  > un error de conexión que no dice por qué. Si en las pruebas ves «no se pudo conectar» contra
  > una dirección que sí responde con `curl` desde dentro del contenedor, es esto.
- Multipart: `copy_content_to()` del `stored_file` a `make_request_directory()` y
  `new \CURLFile($tmp, $mime, $name)`.
- Timeouts: conexión 30 s · `POST /jobs` 120 s (subir 25 MB no es instantáneo) · sondeo 30 s ·
  `POST /edit` **180 s** · descarga 300 s.
- Traduce el `code` a excepciones tipadas. **Nunca** registra la clave.

### 6.12 La tarea `sync_job`

Igual que en la versión anterior del plan, porque generar sigue siendo asíncrono:

- Sin `remotejobid` → `POST /api/v1/jobs` con la `Idempotency-Key` de la fila. Guarda el id,
  `status = 'submitted'`, **se reencola** a 30 s.
- Con `remotejobid` → `GET /api/v1/jobs/:id`. `done` → descarga el HTML y la captura de cada
  pasada a la File API creando sus versiones, `status = 'done'`. `failed` → guarda el error y para.
  En curso → actualiza el progreso y **se reencola** con espera creciente (30, 60, 120 s, tope 120).
- Un `429 queue_full` **no es fallo**: se reencola con el `Retry-After` que dio la API.
- `attempts >= 40` → `failed` con `errorcode = 'timeout'`.

> **El detalle que ahorra una tarde:** «sigue en curso» se resuelve **encolando una tarea nueva y
> retornando con normalidad**, nunca lanzando una excepción. Si la tarea lanza, Moodle activa su
> maquinaria de reintentos con backoff y la marca como fallida en los informes de administración:
> acabas con un panel rojo por jobs que iban perfectamente. `$task->set_next_run_time(time() +
> $delay)` y `\core\task\manager::queue_adhoc_task($task, false)`.

### 6.13 Ajustes, privacidad, versión

**`settings.php`**

| Ajuste | Tipo |
| --- | --- |
| `apibaseurl` | `admin_setting_configtext` — p. ej. `http://host.docker.internal:3000`, sin barra final |
| `apikey` | `admin_setting_configpasswordunmask` |
| `maxpassesdefault` | `admin_setting_configselect` 1–8, por defecto 3 |
| `polltimeoutminutes` | `admin_setting_configtext`, por defecto 20 |
| `allowaiedit` | `admin_setting_configcheckbox` — permite apagar solo la edición con IA, dejando la manual (que es gratis) |
| — | `admin_setting_description` con enlace a `testconnection.php` |

`testconnection.php` hace `GET /api/v1/health`, muestra la respuesta cruda o el error, y comprueba
además el `max_execution_time` del PHP local avisando si es menor de 180 s (§6.8).

**`classes/privacy/provider.php`** — obligatorio, y aquí no es papeleo: hay transferencia a un
tercero.

- `metadata\provider`: las dos tablas, los tres `filearea`, y un **`external_location_link`** al
  motor declarando qué sale (la imagen, las notas, los prompts de edición, el HTML) y que el motor
  a su vez llama a la API de Anthropic.
- `request\plugin\provider`: `get_contexts_for_userid`, `export_user_data`, `delete_data_for_user`,
  `delete_data_for_all_users_in_context`. El borrado local intenta también el `DELETE` remoto.

**`version.php`**

```php
$plugin->component = 'local_awakeinfographic';
$plugin->version   = 2026090700;
$plugin->requires  = 2024100700;   // Moodle 4.5 LTS — confirmar el stamp exacto en el
                                   // version.php del moodle-docker que levantes
$plugin->supported = [405, 500];   // 4.5 y 5.0
$plugin->maturity  = MATURITY_ALPHA;
```

Sin Composer y sin librerías de terceros: `\curl`, XMLDB, File API, `moodleform` y Mustache del
core. Es lo que hace este plugin presentable en el directorio.

---

## 7. Hitos

| # | Hito | Deja comprobable | Estimación |
| --- | --- | --- | --- |
| 0 | **`apiFetch` + `IG_CONFIG`** (§4.1) | La app funciona exactamente igual, con 0 URLs literales | 1–2 días |
| 1 | **API v1 del motor**: bearer, `/jobs`, idempotencia, `429`, retención, `openapi.yaml` | Los `curl` de §8.1, **sin Moodle** | 4–5 días |
| 2 | **`POST /api/v1/edit`** sin estado | `curl` con un HTML y un prompt → HTML nuevo, en 30 s, sin tocar `output/` | 2 días |
| 3 | **Esqueleto del plugin**: `version.php`, `settings.php`, XMLDB, capabilities, `api_client`, `testconnection.php`, lang en | Se instala y el botón de probar conexión responde en verde | 3–4 días |
| 4 | **Generar de punta a punta**: `ajax/create.php`, `sync_job`, versiones en la File API, `status.php`, `job_shape.php` | Una infografía generada desde Moodle, aunque la vea en una página fea | 4–5 días |
| 5 | **La página visual**: `build:moodle`, Mustache, CSS calificado, `config.js`, `pagelayout embedded` | La app se ve dentro de Moodle igual que fuera | 4–5 días |
| 6 | **El editor**: manual 100 % cliente, IA síncrona, `html_guard`, versionado, `pluginfile` | Señalar un elemento y pedirle un cambio, dentro de Moodle | 4–5 días |
| 7 | **Peaje**: privacy provider, lang es, `cleanup`, PHPUnit de `api_client`/`sync_job`/`html_guard`, `thirdpartylibs.xml`, README | Listo para instalarlo en un piloto | 4 días |

**Total: 4–4,5 semanas** de trabajo enfocado. Una semana más que el plan anterior, y a cambio el
plugin deja de ser «sube un fichero, descarga otro».

Orden recomendado: 0 → 1 → 3 → 4 (**ya hay ida y vuelta funcionando, aunque fea**) → 2 → 5 → 6 → 7.
Meter el hito 4 antes que la parte visual es deliberado: el riesgo de integración con Moodle
(cron, File API, capabilities) se descubre antes que el riesgo estético, que es el que menos
sorpresas da.

---

## 8. Cómo probarlo, de cero

Escrito sin dar por sabido nada de Moodle. Comandos para Docker Desktop en Windows o macOS; las
diferencias en Linux van anotadas.

### 8.1 Primero el motor, sin Moodle

```bash
cd infographic-generator
echo 'API_KEYS=moodle-pruebas:clave-de-prueba-larga-y-aleatoria' >> .env
npm install
npx playwright install chromium
npm run dev
```

```bash
K='Authorization: Bearer clave-de-prueba-larga-y-aleatoria'

# 1. Salud (sin clave)
curl -s localhost:3000/api/v1/health

# 2. Generar
curl -s -X POST localhost:3000/api/v1/jobs -H "$K" \
  -H 'Idempotency-Key: prueba-001' \
  -F 'image=@ruta/a/una-infografia.png' -F 'maxPasses=2'
# → {"jobId":"a1b2c3d4","status":"queued",…}

# 3. La misma clave otra vez: mismo jobId, sin cobrar de nuevo
curl -s -X POST localhost:3000/api/v1/jobs -H "$K" \
  -H 'Idempotency-Key: prueba-001' -F 'image=@ruta/a/una-infografia.png'
# → {"jobId":"a1b2c3d4",…,"idempotent":true}

# 4. Sondear hasta done
curl -s localhost:3000/api/v1/jobs/a1b2c3d4 -H "$K"

# 5. Bajar el resultado
curl -s localhost:3000/api/v1/jobs/a1b2c3d4/html -H "$K" -o v1.html

# 6. EDITAR sin estado — la prueba del hito 2
jq -Rn --rawfile h v1.html '{html:$h, prompt:"haz el titular un 30% más grande"}' \
  > /tmp/edit.json
time curl -s -X POST localhost:3000/api/v1/edit -H "$K" \
  -H 'Content-Type: application/json' --data @/tmp/edit.json | jq -r .html > v2.html
# Debe tardar decenas de segundos, NO minutos, y no crear nada en output/
diff <(wc -c < v1.html) <(wc -c < v2.html)

# 7. Sin clave → 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/jobs/a1b2c3d4
```

Si el paso 6 tarda minutos o toca `output/`, el endpoint no está bien: está pasando por el
pipeline en vez de ser sin estado.

### 8.2 Levantar Moodle

`moodle-docker` es la herramienta oficial de Moodle HQ. Necesita el código de Moodle a mano y a
cambio deja el directorio del plugin editable en caliente.

```bash
git clone --branch MOODLE_405_STABLE --depth 1 \
  https://github.com/moodle/moodle.git moodle
git clone --depth 1 https://github.com/moodlehq/moodle-docker.git

cd moodle-docker
export MOODLE_DOCKER_WWWROOT=../moodle     # PowerShell: $env:MOODLE_DOCKER_WWWROOT="..\moodle"
export MOODLE_DOCKER_DB=pgsql

cp config.docker-template.php $MOODLE_DOCKER_WWWROOT/config.php
bin/moodle-docker-compose up -d
bin/moodle-docker-compose exec webserver php admin/cli/install_database.php \
  --agree-license --fullname="Moodle pruebas" --shortname="pruebas" \
  --summary="Entorno de pruebas" --adminpass="Admin.123" --adminemail="admin@example.com"
```

Moodle queda en **http://localhost:8000**, `admin` / `Admin.123`.

En **Linux**, para que el contenedor alcance el motor del host, añade al servicio `webserver`:
`extra_hosts: ["host.docker.internal:host-gateway"]`. En Windows y macOS ya funciona.

### 8.3 Instalar el plugin

```bash
# En el repo del motor: genera los assets dentro del plugin
npm run build:moodle -- --out ../moodle/local/awakeinfographic
```

1. **http://localhost:8000** como `admin`. Moodle detecta el plugin y pide confirmar la
   actualización de la base de datos → *Actualizar la base de datos ahora*.
2. **Configura**: *Administración del sitio → Extensiones → Extensiones locales → Awakelab
   Infographic*.
   - `apibaseurl`: `http://host.docker.internal:3000`
   - `apikey`: `clave-de-prueba-larga-y-aleatoria`
   - Guarda y pulsa **probar conexión**. Debe devolver el `{ok: true, model: …}` del motor y no
     avisar de `max_execution_time`. Si falla, §8.6 antes de seguir.
3. **Modo desarrollador** mientras pruebas: *Administración del sitio → Desarrollo → Depuración* →
   `DEVELOPER` + *Mostrar mensajes de depuración*. Sin esto, un error de PHP es una página blanca.

### 8.4 Generar

1. Ve a `http://localhost:8000/local/awakeinfographic/index.php`. **Debe verse tu app**: la
   pantalla de subida con Poppins y tu paleta, sin barra de Moodle alrededor.
2. Arrastra una imagen, pon 2 pasadas para que tarde menos, *Generar*.
3. **Ejecuta el cron a mano.** Este es el paso que se olvida y el que hace parecer que nada
   funciona: en un Moodle de desarrollo no hay cron automático.

   ```bash
   bin/moodle-docker-compose exec webserver php admin/cli/cron.php
   ```

   **Varias veces**, con un minuto entre medias: la primera envía la imagen, las siguientes
   sondean, y una descarga el resultado. La página va actualizando el estado sola.

   Para ver solo las tareas ad hoc:
   ```bash
   bin/moodle-docker-compose exec webserver php admin/cli/adhoc_task.php --execute
   ```

### 8.5 Editar — la prueba de verdad

Aquí **no hace falta cron para nada**. Si te ves ejecutando `cron.php` en este apartado, algo está
mal conectado.

1. En el resultado, *Editar textos*. Haz clic en un texto, cámbialo, mira que el lienzo **reflowa
   en vivo**. Prueba `Tab` para saltar al siguiente, `⌘Z`/`Ctrl+Z` para deshacer, *Resaltar textos*.
2. *Guardar cambios* → **instantáneo**, sin cron, sin gastar tokens. Debe aparecer una versión
   nueva en el selector, marcada como edición manual y **sin score**.
3. *Pedir cambios a la IA*: haz clic en un elemento y escribe «pon este título en dos líneas y más
   grande». Debe tardar decenas de segundos con el spinner, y al terminar el lienzo se recarga con
   el cambio **sin perder la selección**.
4. Prueba *Señalar el contenedor* y *Cambio en toda la pieza…*.
5. Vuelve al selector de versiones y salta a una anterior: tiene que estar todo ahí.

Si el paso 2 llama al motor, o el 3 tarda minutos, revisa que `editor.js` esté yendo a
`savehtml.php` y `edit.php` y no a las rutas viejas.

### 8.6 Cuando algo no funciona

| Síntoma | Causa casi siempre | Qué hacer |
| --- | --- | --- |
| Todo se queda en `pending` | El cron no se ha ejecutado | `bin/moodle-docker-compose exec webserver php admin/cli/cron.php`, varias veces |
| Probar conexión: «no se pudo conectar» | El contenedor no alcanza el motor | Desde dentro: `bin/moodle-docker-compose exec webserver curl -s http://host.docker.internal:3000/api/v1/health`. Si desde ahí sí va, es `curlsecurityblockedhosts` (§6.11) |
| Probar conexión: `401` | Clave distinta, o `.env` sin recargar | Reinicia `npm run dev` tras editar `.env` |
| La página se ve como un Moodle normal, con barra | Falta `set_pagelayout('embedded')` | §6.5 |
| Se ve tu app pero rota: botones y tipos raros | El CSS de Boost entrando en `.ig-app` | El bloque de reset de §6.5. Inspecciona el elemento y mira qué regla gana |
| **El editor abre pero no resalta nada al pasar el ratón** | El iframe **no es del mismo origen** | Es el fallo crítico. Comprueba que `#ed-frame` apunta a `pluginfile.php` del mismo Moodle y no a la URL del motor. En consola: `document.getElementById('ed-frame').contentDocument` debe devolver un documento, no `null` |
| El editor abre pero el lienzo está en blanco | El HTML no llegó, o `pluginfile` deniega | Abre la URL del iframe en una pestaña aparte |
| Guardar textos → `409` | Otra pestaña creó una versión mientras tanto | Esperado. Recarga (§6.7) |
| Editar con IA → 504 o se corta a los 30 s | `max_execution_time` del PHP de Moodle | Súbelo a 180 s. `testconnection.php` lo avisa |
| `429 queue_full` al generar | Hay jobs por delante | Correcto: se reintenta solo |
| Página en blanco | Error de PHP con depuración apagada | Modo `DEVELOPER` y `bin/moodle-docker-compose logs webserver` |
| «Acceso denegado» | Falta la capability | Entra como `admin` o asigna `local/awakeinfographic:generate` |

### 8.7 Limpiar

```bash
bin/moodle-docker-compose down -v    # borra también la BD y los ficheros
```

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| **El iframe deja de ser del mismo origen** y el editor muere en silencio | Es el supuesto del que cuelga todo. Se sirve siempre por `pluginfile.php`, hay una prueba explícita en §8.5 y una fila en la tabla de fallos. Un test de Behat que compruebe que `#ed-frame` tiene un `contentDocument` legible |
| **El CSS de Boost desfigura la app** | Calificado bajo `.ig-app` + reset. Es lo único que se ajusta a ojo, y por eso es su propio hito |
| **`build:moodle` se salta y alguien edita el asset generado a mano** | Cabecera `/* GENERADO — no editar. Fuente: public/app.js */` en cada fichero generado, y una comprobación en CI que falle si lo generado no coincide con la fuente |
| **El cron no corre** y nada se genera | Documentado como primer sospechoso. La página avisa si un job lleva >5 min en `pending` y el cron no se ha ejecutado (`\core\task\manager::get_last_cron_start()`) |
| **La tarea lanza excepción por «sigue en curso»** | §6.12: reencolar y retornar, nunca lanzar |
| **El HTML del flujo manual llega del cliente** y un cliente es hostil | `html_guard.php` revalida **toda** versión antes de guardar, venga de donde venga (§6.10) |
| **Editar con IA se corta por `max_execution_time`** | 180 s en `api_client`, comprobación en `testconnection.php`, y el `allowaiedit` para apagarlo si un centro no puede subirlo |
| **Dos pestañas editando el mismo activo** | `versionno` optimista → `409`. Ninguna versión se pierde: cada una es su fila y su fichero |
| **Doble clic en Generar** = dos jobs, dos facturas | `idempotencykey` creada con la fila, antes del primer envío |
| **`curlsecurityblockedhosts` bloquea la URL del motor** en silencio | `ignoresecurity => true` + el aviso de §6.11 |
| **La cola en serie** convierte cinco profesores en 40 min de espera para el último | `429` + `Retry-After`: la UI dice «en espera», que es la verdad. Las **ediciones no pasan por la cola**, así que lo que más se usa no se atasca. La solución de fondo es concurrencia en el motor, fuera de este plan |
| **Se pierde el progreso en vivo de generación** | Aceptado: sondeo cada 2 s. Se mantiene pasada, score y discrepancias; se pierde el contador de caracteres |
| **Una versión editada no tiene score** y la UI miente | `features.score` apaga el comparador en esas versiones; la etiqueta dice el origen (`ai`/`manual`) |
| **`output/` se llena** | `RETENTION_DAYS`. Con el plugin es seguro purgar: las versiones viven en Moodle |
| **La clave de API acaba en un log o en el navegador** | `configpasswordunmask`, proxy obligatorio (§6.4), nunca en logs, declarada en la privacy metadata, rotable cambiando `API_KEYS` y el ajuste |
| **El motor cae** y Moodle acumula tareas | `attempts >= 40` corta a los 20 min; `cleanup` purga los fallidos. Los activos ya descargados no se ven afectados: viven en la File API |
| **Endpoints planos en vez de web services** en la revisión del directorio | `require_login` + `require_sesskey` + `require_capability` en todos, centralizado en `ajax/lib.php`. Se migra a web services cuando haya que soportar la app móvil |
| **Derechos del original reproducido** | Casilla obligatoria al subir, confirmando que se tienen derechos, y el texto guardado en la fila. No resuelve nada legalmente por sí solo, pero obliga a leerlo |
| **Cambia la API y los plugins instalados se rompen** | `/api/v1` congelada. Lo incompatible es `/api/v2` |

---

## 10. Fuera de alcance (por ahora)

- **`contenttype_` / banco de contenido.** Fase 2, y solo después de haber usado Moodle como
  profesor unos días para confirmar que es ahí donde se quiere el activo. La costura está puesta:
  las versiones ya son ficheros de la File API con su fila; un `contenttype_` los referencia.
- **Alumnos generando**, con sus cuotas por usuario, concurrencia y moderación.
- **Actividad de curso con nota** (`mod_`), con backup y restore de la actividad.
- **Botón en el editor TinyMCE** (`tiny_`), que es el que más choca con el saneado de Moodle.
- **App móvil de Moodle.** Exigiría web services de verdad, y un editor que introspecciona el DOM
  de un iframe no va a funcionar ahí.
- **El progreso en vivo carácter a carácter** durante la generación.
- **Score y captura en las versiones editadas** (exigiría Chromium en el camino de edición, que es
  justo lo que este plan quita).
- **El marketplace** de [PLAN_MARKETPLACE.md](PLAN_MARKETPLACE.md). Si el destino es Moodle,
  Moodle regala lo que ese plan resuelve a mano: usuarios reales, un voto por usuario, roles de
  moderación y la base de datos del centro con backup incluido. Construir ahora el catálogo con
  SQLite, cookie `ig_voter` y tope por IP es trabajo que habría que tirar.
- **Publicar en el directorio de plugins de Moodle.** Después de que un centro real lo use.
- **Concurrencia en el motor.** La cola sigue siendo en serie; este plan la hace visible y saca de
  ella el camino de edición, que es el que más se usa.
