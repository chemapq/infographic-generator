# Plan — API del motor + plugin de Moodle

> El motor se queda en TypeScript. Se le añade una **API para máquinas** (bearer token, sondeo,
> idempotencia) y se escribe un **plugin `local_` de Moodle** que la consume: el profesor sube una
> imagen desde Moodle, el HTML generado acaba como fichero del plugin, descargable e insertable
> en cualquier curso.

Rama: `feat/api-moodle` · Complementa [PLAN.md](PLAN.md). No depende de
[PLAN_MARKETPLACE.md](PLAN_MARKETPLACE.md) — de hecho lo aplaza (§13).

**Decisiones cerradas antes de empezar:**

| Decisión | Elección |
| --- | --- |
| Alcance de la v1 | **Solo generar**: imagen → HTML en Moodle. El editor (señalar elementos, editar textos) se queda en la app; no se embebe ni se reimplementa |
| Tipo de plugin | **`local_awakeinfographic`**, con el resultado en la File API. El banco de contenido (`contenttype_`) es fase 2 |
| Quién genera | **Solo profesores y gestores** (por capability). Sin alumnos, sin cuotas por usuario, sin moderación |
| Entorno de pruebas | **moodle-docker** en el portátil, con el motor corriendo en el host |
| Transporte | Sondeo desde una tarea ad hoc de Moodle. **Sin webhooks**: no exige que el motor alcance al Moodle |

---

## 1. Por qué la API actual no sirve tal cual

No es un problema de rutas, es de modelo. Lo que hay hoy está diseñado para un navegador con
sesión, y el plugin es un cliente servidor-a-servidor.

| Lo que hay hoy | Por qué no vale para Moodle | Qué se hace |
| --- | --- | --- |
| Auth por **cookie de sesión con contraseña compartida** ([auth.ts:13](src/services/auth.ts#L13)) | PHP no va a mantener una cookie de sesión, y la contraseña es la misma para todo el mundo: no hay a quién atribuir un job | Bearer token por cliente (§3.1) |
| El guardián global intercepta **todo** ([index.ts:28](src/index.ts#L28)) | Devuelve `401 JSON` a cualquier petición sin cookie, incluido un bearer válido | El guardián deja pasar `/api/v1/*` a su propia autenticación (§3.1) |
| Progreso por **SSE** ([sse.ts](src/api/sse.ts)) | Una tarea de cron de Moodle no puede sostener una conexión abierta durante minutos | Sondeo con un endpoint de estado ligero (§3.3) |
| `GET /api/jobs/:id` devuelve el **`JobRecord` completo** ([jobs.router.ts:69](src/api/jobs.router.ts#L69)) | Incluye `spec` (paleta, textos, capas) y `passes[]` con veredictos: decenas de KB por sondeo | Estado ligero por defecto, `?include=passes` para el resto |
| `ownerId` viene de la cookie `ig_owner` **sin firmar** ([owner.ts](src/services/owner.ts)) | Un cliente de API no tiene cookie, y esa cookie no vale como identidad | El `ownerId` se deriva del nombre de la clave de API |
| **Sin idempotencia** en `POST /api/jobs` | Si la tarea de Moodle reintenta tras un timeout de red, se crea un job duplicado y se pagan los tokens dos veces | Cabecera `Idempotency-Key` obligatoria (§3.2) |
| **Sin límite de cola ni de cuota** | La cola es en serie ([orchestrator.ts:44](src/services/orchestrator.ts#L44)). Diez profesores a la vez son diez turnos de varios minutos, sin aviso | `429` + `Retry-After` al llenarse la cola, y tope diario por clave (§3.6) |
| **`output/` crece sin freno** ([store.ts](src/services/store.ts)) | Cada job son decenas de MB. Con la API es más fácil generar volumen | Retención por antigüedad (§3.7) |
| En producción **exige `AUTH_PASSWORD`** o no arranca ([index.ts:64](src/index.ts#L64)) | Quien despliegue el motor solo como backend de Moodle no quiere la UI web ni su contraseña | El arranque acepta `AUTH_PASSWORD` **o** `API_KEYS`; `UI_ENABLED=false` sirve solo la API |

Nada de esto rompe la UI existente: la API nueva vive en `/api/v1` y la vieja se queda donde está.

---

## 2. Arquitectura

```
   Moodle (PHP)                                  Motor (Node, sin cambios en el pipeline)
 ┌──────────────────────────┐                  ┌────────────────────────────────────────┐
 │ create.php               │                  │                                        │
 │  moodleform + filepicker │                  │  /api/v1  (bearer)                     │
 │        │                 │                  │   POST   /jobs          ─┐             │
 │        ▼                 │                  │   GET    /jobs/:id       │             │
 │  fila en BD (pending)    │                  │   GET    /jobs/:id/html  ├─ router v1   │
 │  + queue_adhoc_task      │                  │   GET    /jobs/:id/preview.png         │
 │        │                 │                  │   DELETE /jobs/:id      ─┘             │
 │        ▼                 │   1. POST multipart                                       │
 │ task\sync_job  ──────────┼─────────────────▶│  createJob() ─▶ cola en serie ─▶ …      │
 │  (cron)                  │                  │                    │                   │
 │        │                 │   2. GET estado  │                    ▼                   │
 │        │◀────────────────┼──────────────────│  output/<jobId>/passes/…                │
 │        │  ¿running?      │                  │                                        │
 │        │  → se reencola  │   3. GET html + preview.png                                │
 │        ▼                 │◀─────────────────│                                        │
 │  File API                │                  └────────────────────────────────────────┘
 │   component: local_awakeinfographic
 │   filearea: result | preview
 │   itemid:   id de la fila
 │        │
 │        ▼
 │  view.php ── iframe sandbox="" vía pluginfile.php
 │           ── botón «Descargar HTML»
 │           ── el profesor lo inserta donde quiera con el selector de ficheros
 └──────────────────────────┘
```

Dos propiedades de este diseño que conviene no perder de vista:

- **El sondeo lo inicia siempre Moodle.** El motor no necesita alcanzar al Moodle, no hay
  webhook que firmar ni puerto entrante que abrir en el lado del centro. Es lo que hace que
  esto funcione detrás del cortafuegos de una institución sin negociar nada.
- **El HTML se copia a Moodle, no se enlaza.** Una vez descargado a la File API, el activo
  vive en el Moodle: entra en su backup, sobrevive a que el motor se caiga, y borrar el job en
  el motor no rompe la clase de nadie. A cambio, iterar sobre él ya no es posible desde Moodle
  (y por eso la v1 no edita).

---

## 3. La API del motor

Todo nuevo va en `src/api/v1/`. Versionada desde el primer día porque a partir de que un plugin
instalado en un centro la consuma, cambiarla es un problema de otros.

### 3.1 Autenticación

`Authorization: Bearer <clave>`. Las claves se declaran en el entorno, sin base de datos:

```
API_KEYS=moodle-pruebas:8f3c…,moodle-centro-a:b21e…
```

- Formato `nombre:clave`, separadas por comas. El **nombre** es el `ownerId` del job y lo único
  que se escribe en los logs; la clave nunca.
- Comparación en tiempo constante, reutilizando `sameSecret()` de [auth.ts:26](src/services/auth.ts#L26).
- El guardián de [index.ts:28](src/index.ts#L28) añade `/api/v1` a la lista de rutas que no
  pasan por la cookie. La autenticación bearer se aplica como middleware del router v1, salvo
  en `/api/v1/health`.

`GET /api/v1/health` queda **público y sin clave**: es lo que usa el botón «probar conexión»
del plugin y lo que ya usan los healthchecks de los hosts ([index.ts:45](src/index.ts#L45)).
Devuelve solo `{ ok, model, maxPasses, version }` — nada que revelar.

### 3.2 `POST /api/v1/jobs`

`multipart/form-data`, mismo `multer` en memoria y misma comprobación de formato por bytes que
la ruta actual ([jobs.router.ts:46](src/api/jobs.router.ts#L46)).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `image` | fichero | PNG/JPEG/WebP/GIF, ≤ 25 MB. Formato validado por cabecera, no por extensión |
| `maxPasses` | entero | 1–8, por defecto `MAX_PASSES` |
| `notes` | texto | Notas del profesor, se inyectan en la instrucción de la pasada 1 |
| `externalRef` | texto | Opaco para el motor. El plugin manda `moodle:<wwwroothash>:<rowid>` para poder correlacionar en soporte |

**Cabecera `Idempotency-Key` obligatoria.** Se guarda junto al job; una segunda petición con la
misma clave devuelve `200` con el `jobId` existente en lugar de crear otro. Esto es lo que hace
seguro que la tarea de Moodle reintente, y lo que evita que un doble clic cueste el doble.
Implementación: un `Map` en memoria más el campo persistido en `job.json`, con reconstrucción
del índice al arrancar leyendo `output/*/job.json` (ya se hace algo equivalente en
[gallery.ts](src/services/gallery.ts)).

Respuestas:

```
202 { "jobId": "a1b2c3d4", "status": "queued", "statusUrl": "/api/v1/jobs/a1b2c3d4" }
200 { "jobId": "a1b2c3d4", "status": "done", "idempotent": true }
400 { "code": "unsupported_image", "error": "…", "detail": "…" }
429 { "code": "queue_full", "error": "…", "retryAfterSeconds": 120 }
```

Todo error lleva un **`code` estable** además del `error` en lenguaje llano que ya produce
[errors.ts](src/services/errors.ts). El plugin decide por el `code`, no por el texto.

### 3.3 `GET /api/v1/jobs/:id` — estado ligero

Esto es lo que se sondea, así que tiene que ser pequeño y barato:

```json
{
  "jobId": "a1b2c3d4",
  "status": "refining",
  "progress": { "pass": 3, "maxPasses": 5 },
  "currentScore": 94.12,
  "bestPass": 2,
  "bestScore": 94.8,
  "passCount": 3,
  "stopReason": null,
  "error": null,
  "usage": { "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0 },
  "createdAt": "2026-09-03T10:00:00.000Z",
  "finishedAt": null,
  "hasResult": true
}
```

Sin `spec` y sin `passes[]`. `?include=passes` añade el detalle para quien lo quiera. `hasResult`
dice si ya hay HTML descargable aunque el job siga corriendo — útil para mostrar algo antes del
final, aunque la v1 del plugin espera a `done`.

### 3.4 Resultado

| Ruta | Devuelve |
| --- | --- |
| `GET /api/v1/jobs/:id/html` | `text/html`, `Content-Disposition: attachment`, `ETag`. `?pass=n` para versiones anteriores |
| `GET /api/v1/jobs/:id/preview.png` | Captura de la pasada actual, a tamaño completo |
| `GET /api/v1/jobs/:id/thumb.webp` | Miniatura, reutiliza `ensureThumb()` ([thumbs.ts:36](src/services/thumbs.ts#L36)) |
| `GET /api/v1/jobs/:id/original.png` | El original normalizado, por si el plugin quiere el antes/después |
| `DELETE /api/v1/jobs/:id` | Borra el job. Lo llama el plugin cuando el profesor borra su activo |

`attachment` y no `inline`, al contrario que la ruta de la UI
([jobs.router.ts:208](src/api/jobs.router.ts#L208)): quien consume esto es una máquina que va a
guardar el fichero, y así ningún navegador lo ejecuta por accidente en el origen del motor.

### 3.5 Lo que deliberadamente **no** entra en la v1

- `POST /api/v1/jobs/:id/iterate` y `/text-edit`. El espacio de URLs los reserva, pero mientras
  la v1 del plugin no edite, exponerlos es superficie de ataque sin usuario.
- Listado (`GET /api/v1/jobs`). Moodle mantiene su propia lista en su propia BD; no necesita la
  galería del motor y no debería depender de ella.
- Webhooks. Se añaden cuando haya un caso que el sondeo no cubra, no antes.

### 3.6 Cola y cuotas

La cola es en serie y eso no cambia en este plan, pero deja de ser invisible:

- `API_MAX_QUEUE_DEPTH` (por defecto 5). Al llenarse, `POST /jobs` devuelve `429` con
  `Retry-After` estimado a partir de la duración media de los últimos jobs. El plugin reencola su
  tarea y lo vuelve a intentar; el profesor ve «en espera», no un error.
- `API_DAILY_JOB_LIMIT` por clave (por defecto 50). `429` con `code: "quota_exceeded"`.
- Hace falta exponer la profundidad de la cola: añadir `queueDepth()` a
  [orchestrator.ts](src/services/orchestrator.ts) junto al `enqueue()` existente.

### 3.7 Retención de `output/`

No es un extra, es el tapón de la única fuga real que tiene el motor hoy. Cada job son
`original.png` + N×(`pass.html` + `pass.png` + `pass-diff.png`); a 2576 px y cinco pasadas, del
orden de 30–50 MB, y el heatmap del diff comprime mal porque es ruido.

- `RETENTION_DAYS` (por defecto 0 = sin límite, para no cambiar el comportamiento actual).
- Barrido al arrancar y luego cada 6 h: borra jobs cuyo `job.json` sea más antiguo, reutilizando
  `deleteJobDir()` ([store.ts:92](src/services/store.ts#L92)).
- Con el plugin, borrar en el motor es seguro: el HTML ya está copiado en el Moodle.

### 3.8 Ficheros a tocar

| Fichero | Cambio |
| --- | --- |
| `src/api/v1/index.ts` | **nuevo** — router, middleware bearer, manejador de errores con `code` |
| `src/api/v1/jobs.router.ts` | **nuevo** — los endpoints de §3.2–3.4 |
| `src/api/v1/keys.ts` | **nuevo** — parseo de `API_KEYS`, comparación en tiempo constante, `ownerId` |
| `src/api/v1/idempotency.ts` | **nuevo** — índice en memoria + reconstrucción desde disco |
| `src/services/retention.ts` | **nuevo** — barrido de `output/` |
| `src/config/env.ts` | `API_KEYS`, `API_MAX_QUEUE_DEPTH`, `API_DAILY_JOB_LIMIT`, `RETENTION_DAYS`, `UI_ENABLED` |
| `src/index.ts` | montar `/api/v1` antes del guardián; relajar el arranque de la línea 64 a «`AUTH_PASSWORD` o `API_KEYS`»; `UI_ENABLED=false` no sirve `public/` |
| `src/services/orchestrator.ts` | `queueDepth()`; `idempotencyKey` y `externalRef` en `JobRecord` |
| `src/types.ts` | los dos campos nuevos en `JobRecord` |
| `docs/openapi.yaml` | **nuevo** — el contrato, para que el plugin no se escriba leyendo código TS |
| `.env.example`, `README.md`, `DEPLOY.md` | documentar las variables nuevas y el modo solo-API |

---

## 4. El plugin: `local_awakeinfographic`

Nombre en frankenstyle `local_awakeinfographic` — con el prefijo de marca para que no colisione
en el directorio de plugins el día que se publique.

```
local/awakeinfographic/
├── version.php
├── settings.php                     # URL de la API, clave, timeout, enlace a la prueba de conexión
├── lib.php                          # local_awakeinfographic_pluginfile() + hook de navegación
├── index.php                        # «Mis infografías»: listado con estado
├── create.php                       # formulario de subida
├── view.php                         # ficha: previsualización, descarga, cómo insertarla
├── delete.php                       # borrado con confirmación
├── testconnection.php               # ping a /api/v1/health desde el propio Moodle
├── classes/
│   ├── api_client.php               # \curl contra la API; traduce códigos a excepciones
│   ├── job.php                      # entidad + CRUD sobre la tabla + File API
│   ├── form/create_form.php         # moodleform: filepicker + maxpasses + notes
│   ├── task/sync_job.php            # adhoc_task: enviar → sondear → descargar
│   ├── task/cleanup.php             # scheduled_task: purga de jobs fallidos antiguos
│   └── privacy/provider.php
├── db/
│   ├── install.xml                  # tabla local_awakeinfographic_job
│   ├── access.php                   # capabilities
│   ├── tasks.php                    # registro de cleanup
│   └── upgrade.php
├── lang/en/local_awakeinfographic.php
├── lang/es/local_awakeinfographic.php
├── templates/list.mustache
├── templates/detail.mustache
└── tests/                           # api_client_test.php, sync_job_test.php
```

### 4.1 Tabla (XMLDB)

`local_awakeinfographic_job`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | int(10) PK autoinc | |
| `userid` | int(10) | FK a `user`. Dueño del activo |
| `courseid` | int(10) null | Curso desde el que se creó, informativo; el activo no vive en el curso |
| `remotejobid` | char(64) null | Los 8 hex del motor. `null` mientras no se ha enviado |
| `idempotencykey` | char(64) | Generado con `random_string(32)` al crear la fila, **antes** del primer envío |
| `title` | char(255) | Editable |
| `status` | char(20) | `pending` \| `submitted` \| `running` \| `done` \| `failed` |
| `remotestatus` | char(20) null | El `status` crudo del motor, para diagnóstico |
| `score` | number(6,2) null | |
| `passcount` | int(4) null | |
| `attempts` | int(4) | Sondeos realizados; corta a `MAXATTEMPTS` |
| `errorcode` | char(64) null | El `code` de la API |
| `errormessage` | text null | |
| `timecreated`, `timemodified` | int(10) | |

Índices: `userid`, `remotejobid` (único donde no sea null), `status`.

Ficheros en la File API, no en la tabla:

- contexto **de usuario** (`context_user::instance($job->userid)`) — los permisos siguen al
  dueño y el activo sobrevive a que se borre el curso donde se creó
- `component` = `local_awakeinfographic`
- `filearea` = `result` (`infographic.html`) · `preview` (`preview.png`) · `source` (el original,
  para poder regenerar sin volver a subirlo)
- `itemid` = `id` de la fila

### 4.2 Capabilities (`db/access.php`)

| Capability | Por defecto | Para qué |
| --- | --- | --- |
| `local/awakeinfographic:generate` | `editingteacher`, `manager` | Crear infografías. **No** `student` en la v1 |
| `local/awakeinfographic:viewall` | `manager` | Ver y borrar las de cualquiera |

Ambas con `riskbitmask` = `RISK_SPAM` en la de generar (consume una API de pago) y
`RISK_PERSONAL` en la de ver todo.

### 4.3 El flujo, paso a paso

1. **`create.php`** — `moodleform` con `filepicker` (`accepted_types => ['web_image']`,
   `maxbytes` = 25 MB), un `select` de `maxpasses` y un `textarea` de notas. `require_capability`
   sobre el contexto de sistema.
2. **Al enviar** — se inserta la fila con `status = 'pending'` y su `idempotencykey`, se copia el
   fichero del área de borrador al `filearea` `source`, y se encola
   `\local_awakeinfographic\task\sync_job` con `custom_data = ['jobid' => $id]`. Redirección a
   `view.php` con un aviso de que va a tardar unos minutos.
3. **`sync_job::execute()`** — una única tarea que resuelve los dos estados:
   - Sin `remotejobid` → `POST /api/v1/jobs` con el fichero de `source`, la `Idempotency-Key` de
     la fila y `externalRef`. Guarda el `jobId`, `status = 'submitted'`, y **se reencola** con
     30 s de espera.
   - Con `remotejobid` → `GET /api/v1/jobs/:id`. Si `done`, descarga `html` y `preview.png` a la
     File API, `status = 'done'`, fin. Si `failed`, guarda `errorcode`/`errormessage` y para. Si
     sigue en curso, actualiza `progress` y **se reencola** con espera creciente (30 s, 60 s,
     120 s, tope 120 s).
   - Un `429` con `queue_full` **no es un fallo**: se reencola con el `Retry-After` que dio la API.
   - `attempts >= MAXATTEMPTS` (40) → `failed` con `errorcode = 'timeout'`.

   > **Detalle que importa:** «sigue en curso» se resuelve encolando una tarea nueva y
   > **retornando con normalidad**, nunca lanzando una excepción. Si la tarea lanza, Moodle activa
   > su maquinaria de reintentos con backoff y la marca como fallida en los informes: acabas con
   > un panel de administración lleno de rojo por un job que iba perfectamente. Reencolar con
   > `$task->set_next_run_time(time() + $delay)` y `queue_adhoc_task($task, false)`.

4. **`index.php`** — listado del usuario (o de todos con `viewall`): miniatura, título, estado,
   score, fecha. Con algún job en curso, un `<meta http-equiv="refresh" content="15">` y se
   acabó: son cinco líneas, no miente, y no obliga a montar un web service ni un módulo AMD para
   la v1.
5. **`view.php`** — la ficha:
   - previsualización en `<iframe sandbox="" src="pluginfile.php/…/result/…/infographic.html">`
   - botón **Descargar HTML** (`send_stored_file` con `$forcedownload = true`)
   - la URL de `pluginfile` visible y copiable, más una nota de dos líneas explicando que para
     usarla en un curso se inserta con el selector de ficheros o se enlaza
   - si `status = 'failed'`, el `errormessage` de la API tal cual: ya viene traducido a lenguaje
     llano por [errors.ts](src/services/errors.ts)
6. **`delete.php`** — borra los ficheros, la fila y llama a `DELETE /api/v1/jobs/:id`. Que el
   borrado remoto falle no impide el local: se registra y se sigue.

### 4.4 Servir HTML de terceros dentro de Moodle

Es el punto delicado del plugin, y merece hacerlo con cuidado porque `pluginfile.php` sirve
desde el **origen del propio Moodle**.

1. **El motor ya sanea.** `sanitizeHtml()` corre en cada pasada antes de escribirla
   ([orchestrator.ts:207](src/services/orchestrator.ts#L207) y
   [orchestrator.ts:491](src/services/orchestrator.ts#L491)): fuera `<script>`, fuera atributos
   `on*`, fuera cualquier URL que no sea Google Fonts.
2. **El plugin no se lo cree.** Antes de guardar en la File API, una comprobación en PHP: si
   aparece `<script`, `on\w+\s*=` o una URL externa fuera de la lista blanca, se rechaza el
   resultado y el job pasa a `failed` con `errorcode = 'unsafe_html'`. Defensa en profundidad:
   el día que alguien apunte el plugin a un motor mal configurado, esto es lo único que hay.
3. **`sandbox=""` sin `allow-same-origin`.** Justo lo contrario que el editor de la app, que
   necesita `allow-same-origin` para leer el DOM del iframe ([README](README.md#editar-señalando-elementos)).
   Aquí solo se muestra, así que se le quita todo. Las Google Fonts siguen cargando: `sandbox`
   no bloquea la descarga de CSS ni de tipografías.
4. **`local_awakeinfographic_pluginfile()`** exige `require_login()`, comprueba que el contexto
   sea de usuario y que sea el dueño o alguien con `viewall`, y sirve con
   `send_stored_file($file, 0, 0, $forcedownload)` — `filelifetime` 0 para no cachear un activo
   privado en proxies intermedios.

### 4.5 `api_client.php`

- `new \curl(['ignoresecurity' => true])`.

  > La URL de la API la configura un administrador, no un usuario, así que saltarse el
  > comprobador de seguridad de cURL es correcto aquí. Y es **necesario**: sin eso, apuntar el
  > plugin a `host.docker.internal`, a una IP privada o a `localhost` puede acabar bloqueado por
  > `$CFG->curlsecurityblockedhosts` con un error de conexión que no dice por qué. Si en las
  > pruebas ves «no se pudo conectar» contra una dirección que sí responde con `curl` desde el
  > contenedor, este es el sitio donde mirar.
- Multipart: `copy_content_to()` del `stored_file` a `make_request_directory()`, luego
  `new \CURLFile($tmp, $mime, $name)`.
- Timeouts explícitos: 30 s de conexión, 120 s de respuesta para el `POST` (el motor responde
  `202` rápido, pero la subida de 25 MB no es instantánea), 30 s para el sondeo, 300 s para la
  descarga del resultado.
- Traduce el `code` de la API a excepciones tipadas del plugin, y **nunca** registra la clave.

### 4.6 Ajustes (`settings.php`)

| Ajuste | Tipo | Notas |
| --- | --- | --- |
| `apibaseurl` | `admin_setting_configtext` | p. ej. `http://host.docker.internal:3000`. Sin barra final |
| `apikey` | `admin_setting_configpasswordunmask` | La clave declarada en `API_KEYS` del motor |
| `maxpassesdefault` | `admin_setting_configselect` | 1–8, por defecto 3 |
| `polltimeoutminutes` | `admin_setting_configtext` | Tope antes de marcar `timeout`, por defecto 20 |
| — | `admin_setting_description` | Enlace a `testconnection.php` |

`testconnection.php` pega un `GET /api/v1/health` y muestra la respuesta cruda o el error. Es la
primera cosa que se usa al instalar y ahorra media hora de adivinar.

### 4.7 Privacidad (`classes/privacy/provider.php`)

Obligatorio, y aquí no es papeleo: hay una transferencia a un tercero.

- `\core_privacy\local\metadata\provider` declarando la tabla, los tres `filearea` y un
  **`external_location_link`** para el motor, con los campos que salen del Moodle (la imagen, las
  notas del profesor) y la mención de que el motor a su vez llama a la API de Anthropic.
- `\core_privacy\local\request\plugin\provider`: `get_contexts_for_userid`,
  `export_user_data`, `delete_data_for_user`, `delete_data_for_all_users_in_context`. El borrado
  local también intenta el `DELETE` remoto.

### 4.8 Versión objetivo

```php
$plugin->component = 'local_awakeinfographic';
$plugin->version   = 2026090300;
$plugin->requires  = 2024100700;      // Moodle 4.5 LTS — confirmar el stamp exacto del
                                      // moodle-docker que levantes: lo dice su version.php
$plugin->supported = [405, 500];      // 4.5 y 5.0
$plugin->maturity  = MATURITY_ALPHA;
```

Sin dependencias de Composer y sin librerías vendorizadas: todo con `\curl`, `moodleform`,
XMLDB y la File API del core. Es lo que hace que este plugin sea presentable en el directorio.

---

## 5. Hitos

Cada uno deja algo comprobable por sí solo.

1. **API del motor** — router v1, bearer, `POST`/`GET`/`html`/`preview`, idempotencia, `429`,
   retención, `openapi.yaml`. Verificable con los `curl` de §7.1, **sin Moodle de por medio**.
2. **Esqueleto del plugin** — `version.php`, `settings.php`, `install.xml`, capabilities, lang en,
   `testconnection.php`. Verificable: el plugin se instala y el botón de probar conexión responde
   en verde.
3. **Ida y vuelta** — `create.php`, `sync_job`, descarga a la File API, `index.php` con estado.
   Aquí ya hay una infografía generada desde Moodle.
4. **Ficha y entrega** — `view.php` con la previsualización sandbox, descarga, borrado,
   comprobación `unsafe_html`, lang es. Aquí es usable de verdad.
5. **Peaje** — `privacy/provider.php`, `cleanup` programado, PHPUnit de `api_client` y
   `sync_job` con la API simulada, `README` del plugin.

Estimación gruesa: **hito 1** una semana · **2** dos o tres días · **3** una semana · **4** tres
o cuatro días · **5** tres días. Del orden de **tres semanas** de trabajo enfocado. La mitad del
hito 5 es peaje de plataforma, no producto.

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| **El cron de Moodle no corre** y nada se mueve nunca. Es el fallo número uno de quien empieza con tareas ad hoc | Documentado en §7.4 como el primer sitio donde mirar. `index.php` avisa si un job lleva más de 5 minutos en `pending` y el cron no se ha ejecutado (`\core\task\manager::get_last_cron_start()`) |
| **La tarea lanza excepción por «sigue en curso»** y Moodle la marca como fallida con backoff | §4.3: reencolar y retornar. Nunca lanzar salvo fallo real |
| **Doble clic en «Generar»** = dos jobs y dos facturas | `idempotencykey` generada al crear la fila, antes del primer envío. El motor devuelve el mismo `jobId` |
| **`curlsecurityblockedhosts` bloquea la URL del motor** en silencio | `ignoresecurity => true` y el aviso explícito en §4.5 |
| **Un job tarda 8 minutos** y el profesor cree que se ha roto | Estado visible con nº de pasada, aviso de duración esperada al enviar, y `polltimeoutminutes` configurable. Y la razón de fondo: medir si el bucle se puede acortar |
| **La cola en serie** convierte cinco profesores simultáneos en 40 minutos de espera para el último | `429` + `Retry-After` (§3.6): el plugin muestra «en espera», que es la verdad, en vez de un error. La solución real es concurrencia en el motor, fuera del alcance de este plan |
| **`output/` se llena** | `RETENTION_DAYS` (§3.7). Y con el plugin, borrar en el motor es seguro |
| **La clave de API acaba en un log o en un backup de Moodle** | `configpasswordunmask`, nunca en logs, y declarada en la privacy metadata. Rotable: cambiar `API_KEYS` en el motor y el ajuste en Moodle |
| **HTML malicioso servido desde el origen de Moodle** | Las cuatro capas de §4.4 |
| **El motor cae y Moodle acumula tareas** | `MAXATTEMPTS` corta a los 20 minutos con `errorcode = 'timeout'`; `cleanup` purga los fallidos antiguos. Los activos ya descargados no se ven afectados |
| **Derechos del original reproducido** | Casilla obligatoria en `create.php` confirmando que se tienen derechos sobre la imagen, y el texto guardado en la fila. No resuelve nada legalmente por sí solo, pero deja constancia y obliga a leerlo |
| **Cambia la API y los plugins instalados se rompen** | `/api/v1` congelada. Cualquier cosa incompatible es `/api/v2` |

---

## 7. Cómo probarlo en Moodle, de cero

Escrito para no dar por sabido nada de Moodle. Los comandos asumen Docker Desktop en Windows o
macOS; en Linux hay una nota al final de cada bloque donde cambia algo.

### 7.1 Primero, el motor y su API — sin Moodle

```bash
# En el repo del motor
cd infographic-generator

# Añade la clave de API al .env
echo 'API_KEYS=moodle-pruebas:clave-de-prueba-larga-y-aleatoria' >> .env

npm install
npx playwright install chromium
npm run dev
```

Comprueba la API con `curl` antes de tocar Moodle. Si esto no funciona, el plugin tampoco:

```bash
# 1. Salud (sin clave)
curl -s localhost:3000/api/v1/health

# 2. Crear un job
curl -s -X POST localhost:3000/api/v1/jobs \
  -H 'Authorization: Bearer clave-de-prueba-larga-y-aleatoria' \
  -H 'Idempotency-Key: prueba-001' \
  -F 'image=@ruta/a/una-infografia.png' \
  -F 'maxPasses=2'
# → {"jobId":"a1b2c3d4","status":"queued",…}

# 3. La misma clave otra vez: mismo jobId, sin cobrar de nuevo
curl -s -X POST localhost:3000/api/v1/jobs \
  -H 'Authorization: Bearer clave-de-prueba-larga-y-aleatoria' \
  -H 'Idempotency-Key: prueba-001' \
  -F 'image=@ruta/a/una-infografia.png'
# → {"jobId":"a1b2c3d4","status":"…","idempotent":true}

# 4. Sondear
curl -s localhost:3000/api/v1/jobs/a1b2c3d4 \
  -H 'Authorization: Bearer clave-de-prueba-larga-y-aleatoria'

# 5. Sin clave → 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/jobs/a1b2c3d4

# 6. El resultado
curl -s localhost:3000/api/v1/jobs/a1b2c3d4/html \
  -H 'Authorization: Bearer clave-de-prueba-larga-y-aleatoria' -o resultado.html
```

### 7.2 Levantar un Moodle de desarrollo

`moodle-docker` es la herramienta oficial de Moodle HQ para esto. Necesita el código fuente de
Moodle a mano, y a cambio te deja el directorio del plugin editable en caliente: cambias un
`.php` y recargas el navegador.

```bash
# Fuera del repo del motor
git clone --branch MOODLE_405_STABLE --depth 1 \
  https://github.com/moodle/moodle.git moodle
git clone --depth 1 https://github.com/moodlehq/moodle-docker.git

cd moodle-docker
export MOODLE_DOCKER_WWWROOT=../moodle       # en PowerShell: $env:MOODLE_DOCKER_WWWROOT="..\moodle"
export MOODLE_DOCKER_DB=pgsql

cp config.docker-template.php $MOODLE_DOCKER_WWWROOT/config.php
bin/moodle-docker-compose up -d
bin/moodle-docker-compose exec webserver php admin/cli/install_database.php \
  --agree-license --fullname="Moodle pruebas" --shortname="pruebas" \
  --summary="Entorno de pruebas" --adminpass="Admin.123" --adminemail="admin@example.com"
```

Ya tienes Moodle en **http://localhost:8000**, usuario `admin`, contraseña `Admin.123`.

En Linux, para que el contenedor alcance el motor que corre en el host, añade al
`docker-compose` del webserver `extra_hosts: ["host.docker.internal:host-gateway"]`. En Windows
y macOS `host.docker.internal` ya funciona.

### 7.3 Instalar el plugin y usarlo

1. **Copia el plugin** a `moodle/local/awakeinfographic/`. Como el directorio `moodle` está
   montado en el contenedor, aparece al instante. (Para desarrollar, un enlace simbólico desde
   el repo del plugin es más cómodo que copiar.)
2. **Visita http://localhost:8000** y entra como `admin`. Moodle detecta el plugin nuevo y pide
   confirmar la actualización de la base de datos → *Actualizar la base de datos ahora*.
3. **Configúralo**: *Administración del sitio → Extensiones → Extensiones locales → Awakelab
   Infographic*.
   - `apibaseurl`: `http://host.docker.internal:3000`
   - `apikey`: `clave-de-prueba-larga-y-aleatoria`
   - Guarda y pulsa **probar conexión**. Tiene que responder con el `{ok: true, model: …}` del
     motor. Si no, ve a §7.4 antes de seguir.
4. **Activa el modo desarrollador** mientras pruebas: *Administración del sitio → Desarrollo →
   Depuración* → `DEVELOPER` y marca *Mostrar mensajes de depuración*. Sin esto, un error de PHP
   es una página en blanco.
5. **Genera una infografía**: *Administración del sitio → Extensiones → Awakelab Infographic →
   Nueva infografía* (o directamente `http://localhost:8000/local/awakeinfographic/create.php`).
   Sube una imagen, deja 2 pasadas para que tarde menos, envía.
6. **Ejecuta el cron a mano.** Este es el paso que se olvida y el que hace que parezca que nada
   funciona: en un Moodle de desarrollo no hay cron automático.

   ```bash
   bin/moodle-docker-compose exec webserver php admin/cli/cron.php
   ```

   **Ejecútalo varias veces**, con un minuto entre medias. La primera pasada envía la imagen al
   motor; las siguientes sondean; cuando el motor termina, una descarga el resultado. Ve mirando
   `http://localhost:8000/local/awakeinfographic/index.php`: el estado va cambiando.

   Para ver solo las tareas ad hoc, sin el resto del cron:

   ```bash
   bin/moodle-docker-compose exec webserver php admin/cli/adhoc_task.php --execute
   ```

7. **Abre la ficha**: previsualización dentro del iframe, **Descargar HTML**, y la URL de
   `pluginfile` para insertarla.
8. **Úsala en un curso**, que es la prueba de verdad: crea un curso, añade un recurso de tipo
   *Página*, y en el editor inserta la infografía. Comprueba si se ve como esperabas — aquí es
   donde se manifiesta si el saneado de Moodle estorba, y es la razón por la que la v1 sirve el
   HTML como fichero y no como contenido pegado en un campo de texto.

### 7.4 Cuando algo no funciona

| Síntoma | Causa casi siempre | Qué hacer |
| --- | --- | --- |
| El job se queda en `pending` para siempre | El cron no se ha ejecutado | `bin/moodle-docker-compose exec webserver php admin/cli/cron.php`, varias veces |
| Probar conexión: «no se pudo conectar» | El contenedor no alcanza el motor | Desde dentro: `bin/moodle-docker-compose exec webserver curl -s http://host.docker.internal:3000/api/v1/health`. Si desde ahí sí va, es `curlsecurityblockedhosts` (§4.5) |
| Probar conexión: `401` | Clave distinta a la del motor, o `API_KEYS` sin recargar | Reinicia `npm run dev` tras editar `.env` |
| `429` con `queue_full` | Hay jobs por delante | Es correcto. El plugin reintenta solo |
| Página en blanco en Moodle | Error de PHP con depuración apagada | Modo `DEVELOPER` (§7.3, paso 4) y `bin/moodle-docker-compose logs webserver` |
| El iframe se ve vacío | `sandbox` o el `pluginfile` | Abre la URL de `pluginfile` directamente en una pestaña; mira la consola del navegador |
| La infografía se ve sin estilos al insertarla en una Página | El saneado de Moodle se comió el `<style>` | Esperado. Se inserta como fichero o enlace, no pegando el HTML en el editor |
| «Acceso denegado» al generar | Falta la capability | Entra como `admin`, o asigna `local/awakeinfographic:generate` al rol |

### 7.5 Limpiar

```bash
bin/moodle-docker-compose down -v    # borra también la BD y los ficheros
```

---

## 8. Fuera de alcance (por ahora)

Aquí para que no se cuelen a mitad de camino:

- **Editar desde Moodle** (señalar elementos, editar textos). Decisión tomada: la v1 solo genera.
- **`contenttype_` / banco de contenido.** Fase 2, y solo después de haber usado Moodle como
  profesor unos días para confirmar que es ahí donde se quiere el activo.
- **Alumnos generando**, con las cuotas, la concurrencia y la moderación que eso arrastra.
- **Actividad de curso con nota** (`mod_`), backup y restore de la actividad.
- **Botón en el editor TinyMCE** (`tiny_`), que es el que más choca con el saneado.
- **Soporte en la app móvil de Moodle.**
- **El marketplace** de [PLAN_MARKETPLACE.md](PLAN_MARKETPLACE.md). Si el destino es Moodle,
  Moodle regala lo que ese plan resuelve a mano — usuarios reales, un voto por usuario, roles de
  moderación, y la base de datos del centro con backup incluido. Construir ahora el catálogo con
  SQLite, cookie `ig_voter` y tope por IP es trabajo que habría que tirar.
- **Publicar en el directorio de plugins de Moodle.** Después de que un centro real lo use.
- **Concurrencia en el motor.** La cola sigue siendo en serie; este plan solo la hace visible.
