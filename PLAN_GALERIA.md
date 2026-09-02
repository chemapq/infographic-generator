# Plan — Galería con el historial de infografías

> Vista nueva que lista las infografías que ya se han generado en esta instalación, con
> miniatura, fecha, estado y score, para poder volver a abrir cualquiera, seguir iterando,
> descargar su HTML o borrarla. **Persistencia local**: la fuente de verdad sigue siendo
> `output/<jobId>/`, igual que hoy. La base de datos global llega después, y este plan deja
> el punto exacto por donde entrará (§4).

Rama: `feat/galeria-historial` · Complementa [PLAN.md](PLAN.md) (§6 API, §7 UI).

---

## 1. Punto de partida (lo que ya existe)

- Cada job vive en `output/<jobId>/`: `job.json` (el `JobRecord` completo), `original.png`,
  `usage.json` y `passes/pass-N.{html,png}` + diffs. Reabrible tras reiniciar el servidor:
  `getJob()` ya cae a disco cuando el job no está en memoria ([orchestrator.ts:118](src/services/orchestrator.ts#L118)).
- Estado real de la carpeta hoy: **70 directorios, 67 con `job.json`, 35 MB** (≈ 0,5 MB por job).
  Los 3 restantes (`output/_informe_*`) son informes de pruebas, **no** jobs: el escaneo tiene
  que saltárselos.
- No hay usuarios: el login es una **contraseña única compartida** ([auth.ts](src/services/auth.ts)),
  así que "el usuario" es, por ahora, quien tenga acceso a la instalación.
- La UI es vanilla JS con enrutado por hash: `#/` (subida) y `#/job/:id`
  ([app.js:30](public/app.js#L30)). Añadir `#/gallery` encaja sin tocar la arquitectura.
- `output/` está en `.gitignore`: la galería no ensucia el repo.

---

## 2. Decisiones de diseño

| Decisión | Ahora (local) | Cuando haya BD global |
| --- | --- | --- |
| Fuente de verdad | Los `job.json` del disco. Sin fichero de índice que pueda quedar desincronizado. | Tabla `jobs` + assets en almacenamiento de objetos. |
| Listado | Escaneo de `output/*/job.json` con **caché en memoria invalidada por `mtime`**: `readdir` + un `stat` por job, y sólo se re-lee lo que cambió. | `SELECT … ORDER BY created_at DESC LIMIT …`. |
| Acceso a los datos | Interfaz `GalleryRepository` con implementación `FsGalleryRepository`. | Otra implementación (`PgGalleryRepository`), un solo fichero nuevo. |
| Dueño de un job | Campo `ownerId` en `job.json`, alimentado por una cookie `ig_owner` (etiqueta de conveniencia, **no** control de acceso). Por defecto la galería muestra todo (`GALLERY_SCOPE=all`). | `ownerId` = id de usuario real y filtrado obligatorio en la consulta. |
| Miniaturas | `thumb.webp` de 480 px generado con `sharp` **a demanda** y cacheado en la carpeta del job. | Mismo fichero, subido al bucket junto al resto de assets. |
| Borrado | Real: `fs.rm(output/<id>, { recursive: true })`. El disco es la BD; una papelera sería estado extra sin dueño. | `DELETE` + borrado diferido de assets. |
| Paginación | Cursor sobre `createdAt` + botón "Cargar más" (no scroll infinito). | El mismo contrato de API, resuelto con `WHERE created_at < cursor`. |

**Por qué caché por `mtime` y no un `output/_index.json`:** 67 jobs son 67 `stat` (~1-2 ms) y
sólo se leen los `job.json` que cambiaron. Un índice en fichero añadiría un segundo estado que
puede corromperse, quedar viejo o pelearse con escrituras concurrentes, y no hace falta hasta
las miles de entradas. Si algún día hace falta, entra detrás de la misma interfaz.

---

## 3. Modelo de datos

### Campos nuevos en `JobRecord` ([src/types.ts](src/types.ts))

```ts
export interface JobRecord {
  // …lo que ya hay
  /** Dueño del job. null en los jobs anteriores a la galería. */
  ownerId: string | null;
  /** Nombre editable en la galería. Si falta, se usa `originalName` sin extensión. */
  title?: string;
}
```

Los 67 jobs existentes no los traen: **la lectura es tolerante** (`ownerId ?? null`,
`title ?? basename(originalName)`), no hay migración ni script que ejecutar.

### Lo que viaja a la UI

```ts
export interface JobSummary {
  id: string;
  createdAt: string;
  updatedAt: string;          // mtime de job.json: ordena por "última actividad"
  title: string;
  originalName: string;
  status: JobStatus;
  width: number;
  height: number;
  passCount: number;
  bestScore: number | null;   // score de bestPass
  hasResult: boolean;         // hay al menos una pasada con HTML
  ownerId: string | null;
}

export interface GalleryQuery {
  limit: number;              // 1..60, por defecto 24
  cursor?: string;            // createdAt del último item de la página anterior
  q?: string;                 // busca en title + originalName + id
  status?: JobStatus | 'all';
  sort?: 'recent' | 'score';
  ownerId?: string | null;    // se ignora con GALLERY_SCOPE=all
}

export interface GalleryPage {
  items: JobSummary[];
  nextCursor: string | null;
  total: number;
}
```

El `JobSummary` es deliberadamente plano y pequeño (~300 B): 24 tarjetas caben en una
respuesta de 8 KB, sin `spec` ni `passes` ni veredictos.

---

## 4. Arquitectura

```
public/app.js  ──GET /api/gallery──▶  gallery.router.ts
   #/gallery                              │
                                          ▼
                            ┌──────────────────────────────┐
                            │ GalleryRepository (interfaz) │   ← la costura
                            └──────────────┬───────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │ FsGalleryRepository (hoy)           │
                        │  readdir output/ + stat job.json    │
                        │  caché Map<id, {summary, mtimeMs}>  │
                        └─────────────────────────────────────┘
                                  (mañana: PgGalleryRepository)
```

```ts
// src/services/gallery.ts
export interface GalleryRepository {
  list(query: GalleryQuery): Promise<GalleryPage>;
  get(id: string): Promise<JobSummary | null>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}
```

Nada fuera de `gallery.ts` sabe que los datos vienen del sistema de ficheros. El día que
llegue la BD: nueva implementación, `env.galleryDriver` elige, y el router y la UI no se tocan.

**Detalles del escaneo (`FsGalleryRepository`)**

1. `readdir(env.outputDir, { withFileTypes: true })`, se queda sólo con directorios cuyo nombre
   case con `^[0-9a-f]{8}$` — eso descarta `_informe_*` y cualquier cosa que alguien deje ahí.
2. `stat(output/<id>/job.json)`; si no existe, se salta.
3. Si el `mtimeMs` coincide con el de la caché, se reutiliza el `JobSummary`; si no, se lee y
   se re-proyecta. Un `job.json` a medio escribir hace fallar el `JSON.parse` → se ignora esa
   entrada esta vez y se reintenta en el siguiente listado (`readJob` ya devuelve `null` en catch).
4. Filtrado (`q`, `status`, `ownerId`), orden y corte por cursor en memoria.

**Escritura atómica en `saveJob`** (mejora pequeña que quita ruido): escribir a
`job.json.tmp` y `rename`. Elimina la ventana en la que la galería ve un JSON truncado
mientras el orquestador guarda.

---

## 5. Identidad del usuario (y honestidad sobre lo que aísla)

- Middleware nuevo `src/services/owner.ts`: si la petición no trae la cookie `ig_owner`, se
  emite un UUID (1 año, `sameSite=lax`, `path=/`). `createJob` lo guarda en `ownerId`.
- **La cookie no es un control de acceso.** Cualquiera que conozca `AUTH_PASSWORD` sigue
  viendo todo lo que decida ver el servidor; el aislamiento de verdad llega con usuarios
  reales en la BD. Por eso no se firma: firmarla con `AUTH_SECRET` daría falsa sensación de
  seguridad y, peor, como `AUTH_SECRET` se regenera en cada arranque cuando no está definida
  ([env.ts:31](src/config/env.ts#L31)), el historial "desaparecería" al reiniciar en local.
- `GALLERY_SCOPE` (nuevo, por defecto **`all`**):
  - `all` — la galería lista todos los jobs de la instalación. Es lo correcto para el uso
    actual (una persona, o un equipo pequeño compartiendo contraseña) y hace visibles los 67
    jobs que ya existen sin `ownerId`.
  - `owner` — filtra por cookie; los jobs con `ownerId: null` se siguen mostrando, marcados
    como *anteriores*, para no esconder el historial existente.

---

## 6. Miniaturas

Las capturas son PNG de hasta 2576 px (~150-400 KB). Una grid de 24 tarjetas con esas
imágenes serían varios MB por pantalla: hace falta miniatura.

- `src/services/thumbs.ts`: `sharp(fuente).resize({ width: 480 }).webp({ quality: 70 })`
  → `output/<id>/thumb.webp` (≈ 20-40 KB; 24 tarjetas ≈ 700 KB).
- **Fuente**: la captura de la pasada de resultado (`currentResultPass`); si el job aún no
  tiene pasadas, `original.png`, para que un job en curso también se vea en la galería.
- **Generación a demanda** en la primera petición, no al terminar el pipeline: así los 67 jobs
  antiguos entran solos y no hay paso de migración.
- **Invalidación**: si el `mtime` del `thumb.webp` es anterior al de la captura fuente, se
  regenera (cada iteración del usuario cambia el resultado y la miniatura debe seguirlo).
- **Escritura atómica** (`thumb.tmp.webp` + `rename`) para que dos peticiones simultáneas no
  sirvan un fichero a medias.
- Cabeceras: `Cache-Control: private, max-age=60` + `ETag` con el nº de pasada, así el
  navegador no re-descarga la grid al volver de un job.

---

## 7. API HTTP

| Método | Ruta | Respuesta |
| --- | --- | --- |
| `GET` | `/api/gallery?limit&cursor&q&status&sort` | `200` `GalleryPage` |
| `GET` | `/api/jobs/:id/thumb` | `200` `image/webp` · `404` si el job no existe |
| `PATCH` | `/api/jobs/:id` `{ title }` | `200 { id, title }` · `400` título vacío o > 120 car. |
| `DELETE` | `/api/jobs/:id` | `204` · `409` si el job está en curso · `404` si no existe |

- El guardián de sesión de [index.ts:26](src/index.ts#L26) va antes de los estáticos y de la
  API, así que cubre `/api/gallery` y los thumbs sin tocar nada.
- **Validación de `:id`** contra `^[0-9a-f]{8}$` en las rutas destructivas antes de construir
  cualquier ruta de fichero: sin eso, un `DELETE /api/jobs/..%2f..` sería un borrado arbitrario.
  (Las rutas de assets ya usan `path.basename`, pero aquí el que llega es el nombre del
  directorio y hay que acotarlo aparte.)
- `DELETE` rechaza con `409` si `status` no es `done` ni `failed`: borrar la carpeta bajo los
  pies de un pipeline en marcha dejaría al orquestador escribiendo en un directorio fantasma.
  Además hay que **olvidar el job en memoria** — `forgetJob(id)` nuevo en el orquestador, que
  hace `jobs.delete(id)` — o `getJob()` seguiría resucitando un job ya borrado desde el `Map`.

---

## 8. UI

### Rutas

| Hash | Vista |
| --- | --- |
| `#/` | Subida (ya existe) |
| `#/gallery` | **Galería** (nueva) |
| `#/job/:id` | Progreso + resultado (ya existe) |

`route()` en [app.js:30](public/app.js#L30) gana una rama; al salir de `#/job/:id` ya se cierra
el `EventSource`, así que no hay fugas.

### Piezas

- **Enlace en la topbar**: «Mis infografías» junto al logo, con el contador (`total`) cuando ya
  se ha cargado una página.
- **Tarjeta**: miniatura 16:10 (`object-fit: cover`, `loading="lazy"`), título, fecha relativa
  («hace 2 h», `Intl.RelativeTimeFormat('es')`), chip de estado reutilizando `STATUS_LABEL`
  ([app.js:14](public/app.js#L14)), score de la mejor pasada y nº de pasadas. Acciones:
  **Abrir** (`#/job/:id`), **Descargar HTML**, **Renombrar** (edición en línea del título),
  **Borrar** (`confirm()` nativo — el repo no tiene modal genérico y no merece uno todavía).
- **Barra superior de la vista**: buscador (`q`, con *debounce* de 250 ms), selector de estado
  y de orden.
- **Estado vacío**: mensaje + CTA a `#/`. Y estado «sin resultados» distinto cuando lo que hay
  es un filtro que no case: son dos situaciones distintas y confundirlas frustra.
- **«Cargar más»** con el `nextCursor`.
- **Tira de recientes** en la vista de subida: las 6 últimas + enlace a la galería (hito 4).
- **Estilos**: sección nueva `/* ─── Galería ─── */` en `styles.css` con los tokens de marca ya
  definidos (`--panel`, `--line`, `--cyan-400` para foco/hover, `--ok`/`--bad` para estados).
  Poppins y la paleta Awakelab 2026 ya están cargadas: no se introduce ningún color nuevo.
  Grid `repeat(auto-fill, minmax(240px, 1fr))`, que baja a una columna en móvil sin media query.

---

## 9. Ficheros a tocar

| Fichero | Cambio |
| --- | --- |
| `src/types.ts` | `ownerId`, `title` en `JobRecord`; `JobSummary`, `GalleryQuery`, `GalleryPage` |
| `src/services/gallery.ts` | **nuevo** — interfaz + `FsGalleryRepository` (escaneo, caché, filtros, cursor) |
| `src/services/thumbs.ts` | **nuevo** — miniatura a demanda con `sharp` |
| `src/services/owner.ts` | **nuevo** — cookie `ig_owner` |
| `src/services/store.ts` | `deleteJobDir`, `jobJsonPath`, `saveJob` atómico |
| `src/services/orchestrator.ts` | `createJob` recibe `ownerId`; `forgetJob(id)` |
| `src/api/gallery.router.ts` | **nuevo** — `GET /api/gallery` |
| `src/api/jobs.router.ts` | `GET /:id/thumb`, `PATCH /:id`, `DELETE /:id`; pasar `ownerId` al crear |
| `src/index.ts` | montar `gallery.router` + middleware de owner |
| `src/config/env.ts` | `galleryScope`, `galleryPageSize`, `thumbWidth` |
| `public/index.html` | `<section id="view-gallery">` + enlace en la topbar |
| `public/app.js` | ruta `#/gallery`, render de tarjetas, buscador, acciones |
| `public/styles.css` | sección Galería |
| `PLAN.md`, `README.md` | documentar la vista y las variables nuevas |

Sin dependencias nuevas: `sharp` y `express` ya están.

---

## 10. Hitos

1. **Backend de lectura** — `types`, `gallery.ts`, `GET /api/gallery`, `thumbs.ts`,
   `GET /:id/thumb`. Verificable con `curl` contra los 67 jobs que ya hay en disco, sin UI.
2. **Vista de galería** — HTML + CSS + ruta + grid + estado vacío + «Cargar más» + enlace en
   la topbar. Aquí la función ya es usable.
3. **Acciones** — `PATCH` (renombrar) y `DELETE` (borrar, con `409` y `forgetJob`), más
   buscador y filtros.
4. **Dueño y recientes** — `owner.ts`, `ownerId` al crear, `GALLERY_SCOPE`, tira de recientes
   en la vista de subida.
5. **Docs** — `PLAN.md`, `README.md`, nota en `DEPLOY.md` sobre el disco persistente.

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| **En Render (plan free) el disco es efímero**: tras un redeploy o una suspensión por inactividad la galería aparece vacía. Es el riesgo con más probabilidad de sorprender. | No es un fallo de la galería sino del alojamiento: `render.yaml` ya lo advierte. Se documenta en `DEPLOY.md` y la solución es el disco montado en `/app/output` (plan de pago) o, más adelante, la BD + almacenamiento de objetos. |
| `output/` crece ~0,5 MB por job | Borrado desde la galería (hito 3) y, si hace falta, purga por antigüedad (`GALLERY_MAX_AGE_DAYS`) más adelante. |
| Escaneo lento con muchos jobs | Caché por `mtime`; a partir de ~2 000 jobs, índice en fichero o BD detrás de la misma interfaz. |
| `job.json` a medio escribir | `saveJob` atómico + la entrada se salta y se reintenta en el listado siguiente. |
| Borrado arbitrario vía `:id` | Validación `^[0-9a-f]{8}$` antes de tocar rutas. |
| Borrar un job en marcha | `409` mientras `status` no sea `done`/`failed`, y `forgetJob` para no dejarlo vivo en el `Map` del orquestador. |
| Jobs viejos sin `ownerId`/`title` | Lectura con valores por defecto; nunca se esconden. |

---

## 12. Cómo se comprueba

```bash
npm run typecheck && npm run lint
npm run dev
curl -s 'localhost:3000/api/gallery?limit=5' | head -c 800   # sin AUTH_PASSWORD en local
curl -s -o /tmp/t.webp -w '%{http_code} %{size_download}\n' localhost:3000/api/jobs/<id>/thumb
```

Checklist manual: la galería lista los 67 jobs existentes con miniatura · abrir una tarjeta
lleva al job y el resultado sigue funcionando · renombrar persiste tras `F5` · borrar quita la
tarjeta y el directorio · reiniciar el servidor no cambia nada (persistencia) · un job en curso
aparece con su estado en vivo y no se puede borrar · con `GALLERY_SCOPE=owner` sigo viendo mis
jobs y los antiguos.

---

## 13. Fuera de alcance (por ahora)

Usuarios reales y BD global (es el paso siguiente, §4 deja la costura) · compartir por enlace
público · etiquetas y colecciones · búsqueda por contenido de la `spec` (textos de la
infografía) · exportar varias infografías en un zip · papelera con restauración ·
duplicar un job para partir de él.
