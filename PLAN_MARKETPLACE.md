# Plan — Marketplace de infografías

> Al terminar de generar, el autor **publica** su infografía en un catálogo compartido. Cualquier
> visitante la puede **ver, descargar y calificar con estrellas**, y el catálogo se ordena por
> **más descargadas, mejor valoradas, más recientes o en tendencia**. La publicación es un
> **snapshot inmutable**: el autor puede seguir iterando su job sin que cambie lo publicado.

Rama: `feat/marketplace` · Complementa [PLAN.md](PLAN.md), [PLAN_GALERIA.md](PLAN_GALERIA.md)
(la galería es el historial **privado**; el marketplace es el catálogo **compartido**).

---

## 1. Punto de partida (lo que ya existe y qué de ello sirve)

| Lo que hay hoy | Sirve para el marketplace |
| --- | --- |
| Cada job en `output/<jobId>/` con `passes/pass-N.{html,png}` y `job.json` ([store.ts](src/services/store.ts)) | Es la **fuente** de lo que se publica, pero no el sitio donde vive lo publicado (§7) |
| `GalleryRepository` + `FsGalleryRepository` con caché por `mtime` ([gallery.ts:134](src/services/gallery.ts#L134)) | El **patrón** (interfaz + implementación + cursor base64url) se reutiliza tal cual; el escaneo de disco, no (§2) |
| `sanitizeHtml()` aplicado a **cada** pasada antes de escribirla ([orchestrator.ts:207](src/services/orchestrator.ts#L207), [orchestrator.ts:491](src/services/orchestrator.ts#L491)) | El HTML en disco ya cumple el contrato «sin JS ni red fuera de Google Fonts». Base de la seguridad al servirlo a terceros (§8) |
| `ensureThumb()`: miniatura WebP a demanda ([thumbs.ts:36](src/services/thumbs.ts#L36)) | Misma técnica para la miniatura del item, pero **congelada** en la publicación |
| Login por **contraseña única compartida** ([auth.ts](src/services/auth.ts)) y guardián global ([index.ts:28](src/index.ts#L28)) | Es lo que hay que **abrir con cuidado**: hoy todo está detrás del login (§9) |
| Cookie `ig_owner` **sin firmar y sin valor de seguridad** ([owner.ts](src/services/owner.ts)) | No basta para votar. §5 explica por qué y qué se hace en su lugar |
| `spec` del análisis: `texts[]` con jerarquía, `palette[]`, `layers[]` ([schemas.ts](src/services/claude/schemas.ts)) | Prerrellena título y etiquetas al publicar, **sin ninguna llamada nueva a Claude** (0 tokens) |
| UI vanilla, sin build, enrutada por hash ([app.js:31](public/app.js#L31)) | El shell privado sigue igual; el marketplace estrena un shell público con URLs reales (§12) |
| Node 24 (`.nvmrc`), SQLite 3.53.4 con funciones matemáticas y UDFs vía `node:sqlite` | **Cero dependencias nuevas** para el catálogo (§2, verificado) |

---

## 2. Decisiones de diseño

| Decisión | Elección | Por qué |
| --- | --- | --- |
| Almacén del catálogo | **SQLite** (`node:sqlite`, integrado en Node) en `output/market.db` | Votos y contadores son estado **mutable, concurrente y transversal**: hacen falta `UPDATE … SET downloads = downloads + 1` atómico, unicidad `(item, votante)` y orden por una expresión calculada. Nada de eso lo da un escaneo de `job.json` con caché por `mtime`, ni un JSON en disco (dos escrituras simultáneas se pisan). Y es **sin dependencias nuevas**: verificado en Node 24.20 con SQLite 3.53.4, `pow()`, UDFs y WAL. |
| Qué se publica | Un **snapshot inmutable** en `output/market/<itemId>/` | El autor sigue iterando el job después de publicar, y el job se puede borrar. Lo publicado no puede cambiar bajo los pies de quien lo votó ni desaparecer al limpiar la galería (§7). |
| Identidad del votante | Cookie `ig_voter` firmada con un secreto **persistido en la propia BD** + tope de votos por IP | El aislamiento real necesita usuarios reales. Esto **encarece** el voto múltiple, no lo impide, y el plan lo dice en la UI (§5). |
| Orden «mejor valoradas» | **Media bayesiana**, no media aritmética | Un único 5★ no puede ganar a 4,6★ con 120 votos. Fórmula y números en §6. |
| Contadores | Desnormalizados en `items`, actualizados **en la misma transacción** que el voto o la descarga | Ordenar por `downloads` o por rango bayesiano con un `JOIN` agregado por fila no escala, y un contador en otra tabla puede derivar. Con la escritura en la misma transacción no hay ventana de inconsistencia; aun así hay script de recuento (§3). |
| Descargas y vistas | Deduplicadas por `(item, votante, día)` | Sin eso, F5 es un ranking. |
| Acceso público | `MARKET_PUBLIC` (por defecto **`false`**) con una **única** función que decide qué se sirve sin login | Hoy toda la herramienta está detrás de `AUTH_PASSWORD`. Abrirla es una decisión explícita, reversible sólo en parte (§9). |
| Shell del marketplace | `market.html` propio en `/market/:slug` (**ruta real, no hash**) | Un catálogo se comparte por enlace: hacen falta URLs limpias y `og:image` para que el enlace tenga previsualización. Y evita servir a un anónimo el HTML del shell privado. |
| HTML de terceros | `sandbox=""` + CSP restrictiva + `Content-Disposition: attachment` en la descarga | Un visitante renderiza HTML nacido de los prompts de otro. §8. |
| Moderación | Estado del item (`pending`/`published`/`hidden`/`removed`) + denuncias | Contenido público sin ningún freno es una decisión, no un descuido (§10). |
| Migración | `PRAGMA user_version` + array de migraciones en una transacción | 60 líneas, sin ORM ni herramienta externa. |

**Por qué no seguir con el sistema de ficheros.** La galería se resuelve leyendo lo que ya
existe: es un **índice de sólo lectura** sobre datos que escribe un único proceso, job a job.
El marketplace es lo contrario: muchos escritores pequeños (un voto, una descarga) sobre filas
compartidas, con unicidad que hay que garantizar (`un votante = un voto por item`) y con
órdenes que dependen de agregados. Eso es una base de datos, y `node:sqlite` la trae puesta.

**Por qué SQLite y no Postgres ya.** El despliegue de hoy es **un proceso con disco propio**
(así lo exige el pipeline: cola en memoria, Chromium, SSE — ver [DEPLOY.md](DEPLOY.md)). Con un
solo proceso, SQLite en WAL es la opción con menos partes móviles y cero infraestructura. La
interfaz `MarketRepository` (§4) es la costura para pasar a Postgres el día que haya varias
instancias, exactamente como `GalleryRepository` la dejó para la galería.

---

## 3. Modelo de datos

### 3.1 Esquema SQLite (`output/market.db`)

```sql
PRAGMA journal_mode = WAL;      -- lectores no bloquean al escritor
PRAGMA synchronous = NORMAL;    -- con WAL, durabilidad suficiente para esto
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- Secretos y metadatos propios del catálogo (§5)
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE items (
  id            TEXT PRIMARY KEY,          -- 12 hex propios del item (≠ jobId, que son 8)
  slug          TEXT NOT NULL UNIQUE,      -- "5-estrategias-de-marca-a1b2c3"
  job_id        TEXT NOT NULL,             -- procedencia; el job puede desaparecer después
  pass_n        INTEGER NOT NULL,          -- pasada congelada en el snapshot
  owner_id      TEXT,                      -- cookie ig_owner de quien publicó (etiqueta, no permiso)
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  author        TEXT NOT NULL DEFAULT 'Anónimo',
  license       TEXT NOT NULL DEFAULT 'cc-by',   -- cc0 | cc-by | cc-by-sa | reservados
  source_credit TEXT NOT NULL DEFAULT '',        -- crédito del original reproducido (§10)
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  best_score    REAL,                      -- parecido con el original, informativo
  status        TEXT NOT NULL DEFAULT 'published'
                CHECK (status IN ('pending','published','hidden','removed')),
  created_at    TEXT NOT NULL,             -- ISO-8601 UTC
  updated_at    TEXT NOT NULL,
  -- agregados: se escriben en la misma transacción que el hecho que los mueve
  downloads     INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  rating_count  INTEGER NOT NULL DEFAULT 0,
  rating_sum    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX items_pub_created   ON items(status, created_at DESC);
CREATE INDEX items_pub_downloads ON items(status, downloads DESC);
CREATE INDEX items_owner         ON items(owner_id);
CREATE INDEX items_job           ON items(job_id);
-- La misma pasada del mismo job no se publica dos veces (el botón es reintentable sin duplicar)
CREATE UNIQUE INDEX items_job_pass ON items(job_id, pass_n);

CREATE TABLE ratings (
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  voter_key  TEXT NOT NULL,                -- hash del votante (§5)
  ip_key     TEXT NOT NULL,                -- hash de la IP, para el tope por red
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (item_id, voter_key)         -- un votante, un voto: lo garantiza el índice
) WITHOUT ROWID;

CREATE INDEX ratings_ip ON ratings(item_id, ip_key);

-- Descargas y vistas ya contadas: la PK es el antídoto contra el F5
CREATE TABLE hits (
  item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('download','view')),
  voter_key TEXT NOT NULL,
  day       TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
  PRIMARY KEY (item_id, kind, voter_key, day)
) WITHOUT ROWID;

CREATE TABLE tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,                   -- kebab-case, ≤ 24 car.
  PRIMARY KEY (item_id, tag)
) WITHOUT ROWID;

CREATE INDEX tags_tag ON tags(tag);

CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL CHECK (reason IN ('derechos','ofensivo','spam','roto','otro')),
  note         TEXT NOT NULL DEFAULT '',
  reporter_key TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);

CREATE INDEX reports_open ON reports(resolved_at, created_at DESC);
```

`ratings` es la **fuente de verdad**; `rating_count`/`rating_sum` son su proyección. Nunca se
tocan por separado: todo voto pasa por una transacción que hace el `INSERT … ON CONFLICT DO
UPDATE` y ajusta los agregados con el delta. Aun así, `npm run market:recount` los recalcula
desde `ratings` y `hits` y avisa de cualquier desviación — vale como comprobación y como
reparación si algún día se toca la BD a mano.

### 3.2 Tipos que viajan a la UI ([src/types.ts](src/types.ts))

```ts
export type MarketSort = 'recent' | 'top' | 'downloads' | 'views' | 'trending';
export type MarketStatus = 'pending' | 'published' | 'hidden' | 'removed';
export type MarketLicense = 'cc0' | 'cc-by' | 'cc-by-sa' | 'reservados';

/** Fila del listado. Plana y pequeña: 24 tarjetas caben de sobra en una respuesta. */
export interface MarketSummary {
  id: string;
  slug: string;
  title: string;
  author: string;
  width: number;
  height: number;
  createdAt: string;
  tags: string[];
  downloads: number;
  views: number;
  /** Media aritmética redondeada a 1 decimal, o null sin votos. Es lo que se PINTA. */
  rating: number | null;
  ratingCount: number;
  /** Estrellas del visitante actual, si ya votó. */
  myRating: number | null;
  license: MarketLicense;
  status: MarketStatus;
}

/** Detalle: lo del listado más lo que sólo hace falta en la ficha. */
export interface MarketItemDetail extends MarketSummary {
  description: string;
  sourceCredit: string;
  bestScore: number | null;
  /** Sólo para quien publicó o para una sesión con login: habilita editar/retirar. */
  canManage: boolean;
  /** Job de origen, sólo si sigue existiendo y quien mira es su dueño. */
  jobId: string | null;
}

export interface MarketQuery {
  sort: MarketSort;
  limit: number;            // 1..60, por defecto 24
  cursor?: string;          // base64url {v, id}, igual patrón que la galería
  q?: string;               // título + descripción + autor
  tag?: string;
  /** 'mine' filtra por la cookie de dueño; 'all' es el catálogo. */
  scope?: 'all' | 'mine';
  /** Sólo con sesión: permite ver 'pending'/'hidden' en la cola de moderación. */
  status?: MarketStatus | 'all';
}

export interface MarketPage {
  items: MarketSummary[];
  nextCursor: string | null;
  total: number;
}

export interface RatingResult {
  rating: number | null;
  ratingCount: number;
  myRating: number | null;
}
```

Nota deliberada: `rating` (media aritmética) es lo que se **muestra**; el rango bayesiano es
interno y sólo **ordena**. Enseñar un «4,51» que no cuadra con las estrellas que la gente ve
confunde; ordenar con la media cruda premia al que tiene un voto.

### 3.3 Campo nuevo en la galería privada

`JobSummary` gana `publishedSlug: string | null`. **No** lo calcula `gallery.ts`: la
`FsGalleryRepository` sigue sin saber que el marketplace existe. Lo añade
[gallery.router.ts](src/api/gallery.router.ts) después de `list()`, con **una** consulta para
toda la página:

```sql
SELECT job_id, slug FROM items WHERE status <> 'removed' AND job_id IN (…24 ids…);
```

---

## 4. Arquitectura

```
                     ┌──────────────────────── público (si MARKET_PUBLIC) ───────┐
  market.html ──────▶│ GET /api/market?sort=top&tag=…                            │
  /market/:slug      │ GET /api/market/:slug            (+1 vista, deduplicada)  │
                     │ GET /api/market/:slug/preview    (CSP + iframe sandbox)   │
                     │ GET /api/market/:slug/download   (+1 descarga, dedup.)    │
                     │ PUT/DELETE /api/market/:slug/rating                       │
                     │ POST /api/market/:slug/report                             │
                     └───────────────────────────────┬───────────────────────────┘
                     ┌───────── con login ───────────┤
  index.html ───────▶│ POST /api/market  { jobId, … }│  ← publicar
  #/job/:id          │ PATCH/DELETE /api/market/:slug│  ← editar / retirar
                     │ GET /api/market/admin/reports │  ← moderación
                     └───────────────────────────────┘
                                     │
                            market.router.ts
                                     │
                     ┌───────────────┴───────────────┐
                     │ MarketRepository (interfaz)   │   ← la costura
                     └───────────────┬───────────────┘
                                     │
                   ┌─────────────────┴──────────────────┐
                   │ SqliteMarketRepository (hoy)       │
                   │  node:sqlite · WAL · sentencias    │
                   │  preparadas · transacciones        │
                   └────────────────────────────────────┘
                          (mañana: PgMarketRepository)

  publish.ts ── lee output/<jobId>/passes/pass-N.{html,png}
             ── valida (sanitizeHtml debe salir sin avisos)
             ── congela en output/market/<itemId>/{item.html,preview.png,thumb.webp}
             ── INSERT en items + tags, en una transacción
```

```ts
// src/services/market/repository.ts
export interface MarketRepository {
  list(query: MarketQuery, viewer: Viewer): Promise<MarketPage>;
  getBySlug(slug: string, viewer: Viewer): Promise<MarketItemDetail | null>;
  create(input: CreateItemInput): Promise<MarketItemDetail>;
  update(slug: string, patch: UpdateItemInput, viewer: Viewer): Promise<MarketItemDetail | null>;
  setStatus(slug: string, status: MarketStatus): Promise<void>;
  rate(slug: string, stars: number, voter: Voter): Promise<RatingResult>;
  unrate(slug: string, voter: Voter): Promise<RatingResult>;
  countHit(slug: string, kind: 'download' | 'view', voter: Voter): Promise<void>;
  report(slug: string, input: ReportInput): Promise<void>;
  slugsByJob(jobIds: string[]): Promise<Map<string, string>>;
  recount(): Promise<{ fixed: number }>;
}
```

Todos los métodos son `async` **aunque `node:sqlite` sea sincrónico**: es lo que permite que
una implementación fuera de proceso entre después sin tocar el router ni la UI. Y hay que decir
lo que eso implica hoy: **cada consulta bloquea el bucle de eventos**. Con miles de filas e
índices por el orden pedido son décimas de milisegundo, pero por eso el listado va paginado y
por eso no se hacen agregados por fila (§2).

`db.ts` abre la BD una vez al cargar el módulo, aplica los `PRAGMA`, corre las migraciones
pendientes y registra `db.close()` en el apagado, junto al `closeBrowser()` que ya hay en
[index.ts:78](src/index.ts#L78).

---

## 5. Identidad del votante (y honestidad sobre lo que impide)

Este es el punto flojo por diseño, y conviene decirlo antes de construirlo: **hoy no hay
usuarios**. El login es una contraseña compartida y `ig_owner` es una etiqueta sin firmar que
[owner.ts](src/services/owner.ts) documenta explícitamente como «no un control de acceso».

Lo que se hace:

1. **Cookie `ig_voter`**, emitida por el servidor: `<uuid>.<hmac>`, un año, `HttpOnly`,
   `SameSite=Lax`. `voter_key = sha256(secret + uuid)` truncado a 32 hex.
2. **El secreto no es `AUTH_SECRET`.** `AUTH_SECRET` se regenera en cada arranque cuando no
   está definido ([env.ts:31](src/config/env.ts#L31)): firmando con él, **cada reinicio
   invalidaría todas las cookies de votante y todo el mundo podría volver a votar**, sin que
   nada lo delatara. El secreto se genera una vez y vive en `meta.voter_secret`, dentro de la
   misma BD que los votos. (Es la misma trampa que llevó a **no** firmar `ig_owner`; aquí la
   firma sí aporta, así que se resuelve con un secreto propio.)
3. **Tope por red**: `MARKET_MAX_VOTES_PER_IP` (por defecto 3) votos distintos por item y por
   `ip_key = sha256(secret + ip)`. Tres deja pasar a la oficina o la casa compartida detrás de
   un NAT; corta el bucle de «borrar cookie y repetir».
4. **El autor no vota su item**: se rechaza con `403` si `owner_id` coincide con el `ig_owner`
   de la petición. Es un freno de cortesía, del mismo material que la cookie.
5. **Voto idempotente y reversible**: `PUT` fija o cambia las estrellas (nunca crea un segundo
   voto, lo impide la PK), `DELETE` lo retira. La UI muestra el voto propio marcado.

Y lo que **no** impide: quien quiera inflar un item puede hacerlo con varias IPs. Por eso
`MARKET_PUBLIC=false` es el valor por defecto (§9) y por eso la ficha muestra siempre
**«media (n votos)»**, nunca la media a secas: con 2 votos, el número se lee como lo que es.
La solución de verdad son cuentas reales, y la costura está puesta: el día que existan,
`voter_key` pasa a ser el id de usuario y `ratings` no cambia de forma.

---

## 6. Ordenaciones y ranking

### 6.1 «Mejor valoradas» — media bayesiana

```
R    = rating_sum / rating_count          media del item
C    = media global de todos los votos    (calculada y cacheada 60 s; 3,8 si no hay votos)
M    = MARKET_RANK_MIN_VOTES (5)          peso del prior, en "votos equivalentes"

rango = (rating_count · R + M · C) / (rating_count + M)
      = (rating_sum    + M · C) / (rating_count + M)     ← lo que se calcula en SQL
```

Con `M = 5` y `C = 3,8`:

| Item | Votos | Media | Rango |
| --- | --- | --- | --- |
| A | 1 | 5,0 | (5 + 19) / 6 = **4,00** |
| B | 40 | 4,6 | (184 + 19) / 45 = **4,51** |
| C | 3 | 4,7 | (14,1 + 19) / 8 = **4,14** |

B gana, que es lo correcto. Sin corrección, A ganaría con un solo clic.

### 6.2 «En tendencia» — decaimiento temporal

```
calor  = downloads + 3·rating_count + 0,4·views
tendencia = calor / pow(horas_desde_creacion + 2, 1.5)
```

`pow()` está disponible (SQLite 3.53.4, verificado). Ejemplo: un item de 2 h con 5 descargas
puntúa 0,63; uno de 30 días con 200 descargas, 0,010. Lo nuevo sube y decae solo, sin cron.

### 6.3 La consulta

```sql
WITH ranked AS (
  SELECT i.*,
         CASE :sort
           WHEN 'top'       THEN (i.rating_sum + :m * :c) / (i.rating_count + :m)
           WHEN 'downloads' THEN i.downloads * 1.0
           WHEN 'views'     THEN i.views * 1.0
           WHEN 'trending'  THEN (i.downloads + 3*i.rating_count + 0.4*i.views)
                                 / pow((julianday('now') - julianday(i.created_at)) * 24 + 2, 1.5)
           ELSE julianday(i.created_at)
         END AS sort_value
  FROM items i
  WHERE i.status = :status
    AND (:tag  IS NULL OR i.id IN (SELECT item_id FROM tags WHERE tag = :tag))
    AND (:q    IS NULL OR i.title LIKE :like ESCAPE '\'
                       OR i.description LIKE :like ESCAPE '\'
                       OR i.author LIKE :like ESCAPE '\')
    AND (:owner IS NULL OR i.owner_id = :owner)
)
SELECT * FROM ranked
WHERE :cv IS NULL OR sort_value < :cv OR (sort_value = :cv AND id > :cid)
ORDER BY sort_value DESC, id ASC
LIMIT :limit + 1;      -- la fila extra dice si hay página siguiente
```

- **Paginación keyset** sobre `(sort_value, id)`, con el mismo cursor `base64url({v, id})` y el
  mismo desempate por `id` que [gallery.ts:112](src/services/gallery.ts#L112). Un cursor de un
  item borrado no revienta: simplemente no encuentra fila y devuelve la página vacía.
- `LIMIT :limit + 1` en vez de contar antes: una consulta menos por página.
- `total` se saca de un `COUNT(*)` con los mismos filtros (sin cursor) sólo en la **primera**
  página; en las siguientes viaja `null` y la UI conserva el que ya tiene.
- `q` escapa `%` y `_` antes de construir el `LIKE`. FTS5 está disponible si algún día el
  catálogo lo pide, pero un `LIKE` sobre miles de filas no es el cuello de botella.
- **Sin `pending`/`hidden` para el público**: `:status` lo fija el servidor a `'published'`
  salvo que la petición traiga sesión y pida la cola de moderación.

### 6.4 Contar sin inflar

```sql
BEGIN IMMEDIATE;
  INSERT OR IGNORE INTO hits (item_id, kind, voter_key, day) VALUES (?, ?, ?, ?);
  -- changes() es 1 sólo la primera vez de ese votante, ese item y ese día
  UPDATE items SET downloads = downloads + 1 WHERE id = ? AND 1 = (SELECT changes());
COMMIT;
```

`hits` crece; `npm run market:recount` incluye una poda de las filas de más de
`MARKET_HITS_KEEP_DAYS` (90). Los contadores de `items` no se tocan al podar: la poda sólo
olvida quién ya contó, no lo contado.

**Qué cuenta como descarga**: `GET /api/market/:slug/download`. El `preview` que pinta el
iframe **no** cuenta — si contara, abrir la ficha sería descargar.

---

## 7. Publicar: el snapshot inmutable

```
output/
├── <jobId>/                    # igual que hoy
├── market.db                   # catálogo (+ market.db-wal, market.db-shm)
└── market/
    └── <itemId>/
        ├── item.html           # HTML congelado de la pasada publicada
        ├── preview.png         # captura de esa pasada
        └── thumb.webp          # miniatura 480 px, generada una vez
```

Todo bajo `output/` **a propósito**: es el punto de montaje del volumen persistente que
[DEPLOY.md](DEPLOY.md) ya documenta (`/app/output`). `MARKET_DIR` permite separarlo si algún
día conviene otro volumen. No hay colisión con la galería: su escaneo sólo acepta directorios
que casen `^[0-9a-f]{8}$` ([gallery.ts:23](src/services/gallery.ts#L23)), y `market` no casa
(los `itemId` son de 12 hex, además, para que se distingan de un `jobId` de un vistazo).

`POST /api/market` (`publish.ts`):

1. Lee el `JobRecord`; exige `status === 'done'` y la pasada pedida (por defecto
   `currentResultPass()`, [orchestrator.ts:154](src/services/orchestrator.ts#L154)).
2. Vuelve a pasar `sanitizeHtml()` sobre el HTML de esa pasada. **Debería salir sin avisos**
   porque el orquestador ya sanea cada pasada antes de escribirla; si sale con avisos, se
   responde `422` con la lista en vez de publicar en silencio algo distinto de lo que el autor
   vio. Un aviso aquí es un fallo que hay que mirar, no algo que tapar.
3. Genera `itemId` (12 hex) y `slug` = `kebab(title)` recortado a 60 caracteres + `-` + 6 hex
   del id. Estable, legible y sin colisiones.
4. Copia `item.html` y `preview.png` al directorio del item y genera `thumb.webp` con `sharp`
   (aquí sí de una vez, no a demanda: el snapshot es inmutable, no hay nada que invalidar).
5. `INSERT` en `items` + `tags` en una transacción. Si el `INSERT` falla, se borra el
   directorio recién creado: no se quedan snapshots huérfanos.
6. El índice `items_job_pass` hace que **publicar dos veces la misma pasada** devuelva `409`
   con el slug que ya existe, en lugar de duplicar la ficha. Publicar una pasada **nueva** del
   mismo job sí crea un item nuevo: son dos versiones distintas y el autor decide si retira la
   anterior.

**Consecuencias buenas de congelar**: seguir iterando el job no altera la ficha valorada;
borrar el job desde la galería no rompe el marketplace (`DELETE /api/jobs/:id` sólo **avisa**
de que hay un item publicado, no lo bloquea ni lo borra en cascada); y `preview.png` con la
captura permite `og:image` sin generar nada al vuelo.

**Prerrellenado, con 0 tokens.** El panel de publicación llega con los campos puestos a partir
de datos que ya existen — ninguna llamada nueva a Claude:

| Campo | De dónde sale |
| --- | --- |
| Título | Primer `spec.texts[]` con `hierarchy === 'h1'`; si no hay, el `title` del job |
| Etiquetas sugeridas | `spec.layers[]` (`grafico-datos` → `datos`, `icono` → `iconos`, `foto` → `fotografia`), proporción `width/height` → `vertical`/`horizontal`/`cuadrada`, y el nombre del color dominante de `spec.palette[0]` |
| Descripción | Vacía, con marcador de posición. `spec.canvas.gridDescription` describe la retícula, no de qué va la pieza: prerrellenar con eso da texto plausible y equivocado |
| Autor | `localStorage`, recordado entre publicaciones |

---

## 8. Servir HTML de terceros sin abrir un agujero

Hasta ahora el HTML generado sólo lo veía quien lo generó. En un marketplace, **A renderiza en
su navegador HTML nacido de los prompts de B**, en el mismo origen donde vive la cookie de
sesión. Las cuatro capas, de dentro afuera:

1. **El contrato ya existente**: `sanitizeHtml()` quita `<script>`, atributos `on*` y toda URL
   que no sea de Google Fonts ([validator.ts](src/services/validator.ts)). Se aplica en cada
   pasada y se **re-verifica** al publicar (§7.2).
2. **CSP en la respuesta** de `GET /api/market/:slug/preview` y del `item.html`:

   ```
   Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com;
     font-src https://fonts.gstatic.com; img-src data:; script-src 'none';
     form-action 'none'; base-uri 'none'; frame-ancestors 'self'
   X-Content-Type-Options: nosniff
   Referrer-Policy: no-referrer
   Cross-Origin-Resource-Policy: same-origin
   ```

   `'unsafe-inline'` en `style-src` es inevitable (el contrato **es** CSS inline) y es
   precisamente lo que la ausencia de `script-src` vuelve inofensivo. `frame-ancestors 'self'`
   evita que otro sitio empotre las fichas.
3. **`<iframe sandbox="" referrerpolicy="no-referrer">`** en la ficha. Sin `allow-scripts` y
   **sin `allow-same-origin`**: aunque algo se colara, no alcanza el DOM padre ni las cookies.
   Ojo con el contraste: el editor de la app privada **sí** usa `allow-same-origin` porque
   necesita leer el DOM del documento ([README](README.md#editar-señalando-elementos)); el
   marketplace **nunca** debe copiar ese atributo. Va comentado en el HTML para que no se
   arregle por error.
4. **Descarga como adjunto**: `Content-Disposition: attachment; filename="<slug>.html"`, para
   que un clic descargue en vez de navegar a HTML de otro en este origen.

Defensa en profundidad pendiente y con la costura puesta: `MARKET_ASSET_ORIGIN`, para servir
las previsualizaciones desde otro hostname el día que haya uno. Fuera de alcance ahora (§17),
pero las URLs de preview se construyen ya con una función única, no a mano, para que ese cambio
sea de una línea.

---

## 9. Público o detrás del login

Hoy el guardián de [index.ts:28](src/index.ts#L28) cubre **todo** salvo una lista blanca de
rutas exactas (`PUBLIC_PATHS`). Un marketplace donde «la gente» califica implica lectura
anónima, y eso es una decisión con consecuencias que no se deshacen del todo (lo que se indexó,
indexado queda). Por eso:

- **`MARKET_PUBLIC=false` por defecto**: el marketplace es interno, para el equipo que comparte
  `AUTH_PASSWORD`. Nada cambia respecto a hoy.
- **`MARKET_PUBLIC=true`** abre en lectura y voto, y **sólo** eso. La lista la decide una
  función, no un `Set` que crece a manotazos:

  ```ts
  // src/services/market/access.ts — la ÚNICA fuente de verdad de lo que se sirve sin login
  const PUBLIC_SHELL = new Set(['/market.html', '/market.js', '/styles.css', '/favicon.ico']);

  export function isPublicMarketRequest(req: Request): boolean {
    if (!env.marketPublic) return false;
    if (PUBLIC_SHELL.has(req.path)) return true;
    if (req.path === '/market' || req.path.startsWith('/market/')) return true;   // shell + slug
    if (!req.path.startsWith('/api/market')) return false;
    if (req.path.startsWith('/api/market/admin')) return false;                   // moderación, jamás
    if (req.method === 'GET') return true;
    if (req.method === 'POST') return /\/report$/.test(req.path);                 // denunciar, sí
    if (req.method === 'PUT' || req.method === 'DELETE') return /\/rating$/.test(req.path);
    return false;   // POST /api/market (publicar), PATCH, DELETE de items: con sesión
  }
  ```

  Se lee del revés a lo habitual: **deniega por defecto** y enumera lo que abre. Publicar,
  editar, retirar y moderar siguen exigiendo sesión aunque el catálogo esté abierto.
- El shell público es `market.html`, **no** `index.html`: así un anónimo no recibe el markup de
  la vista de subida ni de la galería privada. Y `/market/:slug` es ruta real (un `app.get`
  que sirve `market.html`), no hash, porque un catálogo se comparte por enlace.
- **`og:` para las previsualizaciones de enlace**: al servir `/market/:slug` se sustituyen
  cuatro marcadores del `market.html` (`__OG_TITLE__`, `__OG_DESC__`, `__OG_IMAGE__`,
  `__OG_URL__`) con `String.replace`. Sin motor de plantillas: son cuatro campos escapados.
- **`GET /api/auth/status`** gana `canPublish: boolean`, para que `market.js` decida si pinta
  «Publicar» y los controles de moderación sin adivinar.
- El arranque **avisa por consola** con qué modo se levanta, igual que ya avisa de la falta de
  `AUTH_PASSWORD` ([index.ts:75](src/index.ts#L75)).

---

## 10. Moderación, denuncias y derechos del original

Hay un asunto que no se puede dejar implícito: **esta herramienta reproduce infografías
ajenas**. Es su propósito — se le da la imagen de alguien y devuelve un HTML «visualmente casi
idéntico». Publicar eso en un catálogo, y más si es público, es distinto de tenerlo en
`output/`. El plan no lo resuelve (no es un problema técnico), pero sí lo hace visible:

- **`sourceCredit` obligatorio** al publicar: de dónde viene el original. Se muestra en la
  ficha.
- **Casilla explícita**: «tengo derecho a publicar esta reproducción». Sin marcarla no se
  publica. No es un blindaje legal, es un momento de fricción deliberado.
- **Licencia** del HTML resultante, elegida por el autor (`cc0`, `cc-by`, `cc-by-sa`,
  `reservados`), visible en la tarjeta y en la ficha.
- **`MARKET_PUBLIC=false` por defecto** (§9): mientras el catálogo sea interno, esto es un
  repositorio de equipo.

Moderación:

| Pieza | Cómo |
| --- | --- |
| `MARKET_MODERATION=post` (defecto) / `pre` | `pre` publica como `pending` y no aparece hasta aprobarse. Recomendado en cuanto `MARKET_PUBLIC=true` |
| Denunciar | `POST /api/market/:slug/report` — abierto a anónimos, con motivo cerrado y nota libre de 500 car. Tope de 5 denuncias por `reporter_key` y día |
| Cola | `GET /api/market/admin/reports` + `POST /api/market/admin/items/:slug/status` — **siempre** con sesión. Quien tiene `AUTH_PASSWORD` es el equipo: no hace falta un rol nuevo |
| Retirar | `hidden` (reversible, desaparece del listado) y `removed` (además borra el snapshot del disco). Nunca se borra la fila: si no queda rastro, la misma pieza se republica al día siguiente |
| Autor | Puede editar título, descripción, etiquetas y licencia de **su** item (por `owner_id`), y retirarlo a `hidden` |

---

## 11. API HTTP

| Método | Ruta | Acceso | Respuesta |
| --- | --- | --- | --- |
| `GET` | `/api/market?sort&q&tag&scope&limit&cursor` | público* | `200 MarketPage` |
| `GET` | `/api/market/:slug` | público* | `200 MarketItemDetail` · cuenta 1 vista (deduplicada) · `404` |
| `GET` | `/api/market/:slug/preview` | público* | `200 text/html` con CSP de §8. **No** cuenta descarga |
| `GET` | `/api/market/:slug/thumb` | público* | `200 image/webp`, `Cache-Control: public, max-age=31536000, immutable` (el snapshot no cambia) |
| `GET` | `/api/market/:slug/download` | público* | `200` HTML como adjunto · cuenta 1 descarga (deduplicada) |
| `PUT` | `/api/market/:slug/rating` `{ stars: 1..5 }` | público* | `200 RatingResult` · `400` fuera de 1..5 · `403` si es tu propio item · `429` si la IP superó el tope |
| `DELETE` | `/api/market/:slug/rating` | público* | `200 RatingResult` (retira el voto) |
| `POST` | `/api/market/:slug/report` `{ reason, note? }` | público* | `202` · `429` si supera el tope diario |
| `GET` | `/api/market/tags` | público* | `200 [{ tag, count }]` para las fichas de filtro |
| `POST` | `/api/market` `{ jobId, pass?, title, description, tags, author, license, sourceCredit, rightsConfirmed }` | **sesión** | `201 { slug }` · `409` si esa pasada ya está publicada · `422` si `sanitizeHtml` avisa · `400` sin `rightsConfirmed` |
| `PATCH` | `/api/market/:slug` `{ title?, description?, tags?, license?, status? }` | **sesión** (autor o equipo) | `200 MarketItemDetail` · `403` |
| `DELETE` | `/api/market/:slug` | **sesión** | `204` (pasa a `removed` y borra el snapshot) |
| `GET` | `/api/market/admin/reports?open=1` | **sesión** | `200` denuncias abiertas con su item |
| `POST` | `/api/market/admin/items/:slug/status` `{ status }` | **sesión** | `200` |

\* público **sólo** con `MARKET_PUBLIC=true`; si no, exige sesión como todo lo demás.

Validación de `:slug` contra `^[a-z0-9-]{3,80}$` antes de tocar nada, y toda ruta de fichero se
construye desde `itemId` **leído de la BD**, nunca desde el parámetro de la URL: es la misma
precaución que la galería tomó con `:id` y el motivo por el que aquí no puede haber un
`..%2f`.

Límites de cuerpo: título 120, descripción 600, autor 60, `sourceCredit` 200, 5 etiquetas de
24 caracteres. `express.json({ limit: '1mb' })` ya está puesto.

---

## 12. UI

### 12.1 Rutas

| URL | Shell | Vista |
| --- | --- | --- |
| `/market` | `market.html` | Catálogo: pestañas de orden, buscador, etiquetas, grid |
| `/market/:slug` | `market.html` | Ficha: previsualización grande, estrellas, descarga, meta, denunciar |
| `/#/` · `/#/gallery` · `/#/job/:id` | `index.html` | Lo de hoy, más el panel de publicar |

`market.js` enruta con `history.pushState` sobre `location.pathname` (no hash): la ficha tiene
URL propia, compartible y con `og:`.

### 12.2 Catálogo

- **Pestañas de orden** como botones-radio, no un `<select>`: son la interacción principal y
  conviene verlas todas — **Recientes · Mejor valoradas · Más descargadas · En tendencia · Más
  vistas**. El orden elegido va en la query string (`?sort=top`) para que se pueda compartir.
- **Tarjeta**: miniatura 16:10 (`loading="lazy"`), título, autor, **estrellas + «(n)»**,
  descargas con icono, etiquetas. Toda la tarjeta es un enlace a la ficha.
- **Estrellas en la tarjeta**: sólo lectura, 5 glifos con relleno parcial por CSS
  (`clip-path: inset(0 <resto>% 0 0)` sobre una capa de estrellas llenas). Sin votos:
  «Sin valorar», no «0★» — no es lo mismo y confundirlo castiga a lo nuevo.
- **Fichas de etiqueta** con recuento, de `GET /api/market/tags`.
- **Estados vacíos distintos** para «el catálogo está vacío» y «nada casa con este filtro»,
  como ya hace la galería ([app.js:448](public/app.js#L448)).
- **«Cargar más»** con el `nextCursor`. Sin scroll infinito, igual que la galería.

### 12.3 Ficha

- **Previsualización**: `<iframe sandbox="" src="/api/market/:slug/preview">` a ancho completo,
  con la relación de aspecto del item (`aspect-ratio: w / h`) para que no haya salto de layout,
  y un enlace «abrir a tamaño real».
- **Widget de estrellas** (el corazón del asunto):
  - `role="radiogroup"` con cinco `role="radio"`: navegable con flechas, `1`–`5` como atajos,
    `aria-label` por estrella («3 de 5 estrellas»).
  - Hover y foco previsualizan; el clic confirma y hace `PUT`.
  - **Optimista con reversión**: pinta el voto al instante y lo deshace si el `PUT` falla,
    mostrando el motivo (`403` tu propio item, `429` tope por red).
  - Debajo: «**4,3** ★ · 27 votos» y, si ya votaste, «tu voto: 4 ★ · *retirar*».
- **Descargar HTML** como acción principal, con el contador al lado.
- **Meta**: autor, fecha relativa (`Intl.RelativeTimeFormat('es')`, ya en uso en
  [app.js:398](public/app.js#L398)), dimensiones, licencia, `sourceCredit`, parecido con el
  original (`bestScore`) como dato secundario.
- **Denunciar** en un `<details>` discreto, no un botón grande.
- Si `canPublish`: **Editar** en línea y **Retirar**.

### 12.4 Publicar (app privada)

- En `#/job/:id`, al pasar el job a `done`, se **despliega solo** el panel «Publicar en el
  marketplace» con los campos ya rellenos (§7). Un clic publica. Eso es lo que pide «que se
  suban al terminar de generar», sin que la subida ocurra a espaldas del autor.
- **Por qué no automático de verdad**: se publicaría también la primera pasada fea, el job
  fallido y el de pruebas, sin título ni etiquetas, y el catálogo nacería lleno de ruido.
  Quien quiera ese comportamiento tiene `MARKET_AUTOPUBLISH=on`, que publica como `pending`
  (cola de moderación) en lugar de directamente visible. Valores: `off` (sin panel) ·
  `prompt` (defecto) · `on`.
- Publicado, el panel se convierte en «Publicada · ver en el marketplace» con el enlace.
- **Tarjeta de la galería**: chip «publicada» que enlaza al slug (de `publishedSlug`, §3.3) y
  acción «Publicar» en las que no lo estén. Y `DELETE` de un job publicado avisa de que la
  ficha del marketplace **seguirá ahí** (es un snapshot), en lugar de dejarlo a la sorpresa.

### 12.5 Estilo

Sección nueva `/* ─── Marketplace ─── */` en [styles.css](public/styles.css), con los tokens de
marca **que ya están definidos**: `--panel`/`--panel-2` de fondo, `--line` de borde,
`--cyan-400` para foco, hover y estrella activa, `--text-muted` para la meta, `--ok`/`--bad`
para los estados. Poppins y la paleta Awakelab 2026 ya están cargadas: **no entra ningún color
nuevo**. Grid `repeat(auto-fill, minmax(260px, 1fr))`. `market.html` reutiliza `styles.css`
entero y la cabecera con el logo sobre fondo oscuro.

---

## 13. Ficheros a tocar

| Fichero | Cambio |
| --- | --- |
| `src/services/market/db.ts` | **nuevo** — apertura, `PRAGMA`, migraciones por `user_version`, `meta`, cierre ordenado |
| `src/services/market/repository.ts` | **nuevo** — `MarketRepository` + `SqliteMarketRepository` (sentencias preparadas, transacciones) |
| `src/services/market/publish.ts` | **nuevo** — snapshot: valida, congela HTML, copia captura, genera thumb, inserta |
| `src/services/market/ranking.ts` | **nuevo** — media bayesiana, `C` global cacheada, expresiones de orden y cursor |
| `src/services/market/voter.ts` | **nuevo** — cookie `ig_voter` firmada con `meta.voter_secret`, `voterKey`, `ipKey`, topes |
| `src/services/market/access.ts` | **nuevo** — `isPublicMarketRequest()`: la única lista de lo que se sirve sin login |
| `src/services/market/prefill.ts` | **nuevo** — título y etiquetas desde `spec` (0 tokens) |
| `src/api/market.router.ts` | **nuevo** — todas las rutas de §11 |
| `src/index.ts` | montar el router, `/market` y `/market/:slug` → `market.html` con `og:`, guardián con `isPublicMarketRequest`, `closeDb()` en el apagado |
| `src/config/env.ts` | `marketPublic`, `marketDir`, `marketDbFile`, `marketModeration`, `marketAutopublish`, `marketRankMinVotes`, `marketMaxVotesPerIp`, `marketHitsKeepDays` |
| `src/types.ts` | `MarketSort`, `MarketStatus`, `MarketLicense`, `MarketSummary`, `MarketItemDetail`, `MarketQuery`, `MarketPage`, `RatingResult`; `publishedSlug` en `JobSummary` |
| `src/api/gallery.router.ts` | enriquecer la página con `publishedSlug` (una consulta por página) |
| `src/api/jobs.router.ts` | `DELETE` avisa si el job tiene item publicado |
| `src/api/auth.router.ts` | `canPublish` en `GET /api/auth/status` |
| `src/cli.ts` | `npm run market:recount` (recuento de agregados + poda de `hits`) |
| `public/market.html` | **nuevo** — shell público (catálogo + ficha) con marcadores `og:` |
| `public/market.js` | **nuevo** — enrutado `pushState`, listado, orden, ficha, estrellas, denuncia |
| `public/app.js` | panel «Publicar», chip «publicada» en la galería, aviso al borrar |
| `public/index.html` | panel de publicación en la vista de resultado |
| `public/styles.css` | sección Marketplace (estrellas, tarjetas, ficha) |
| `Dockerfile` | **Node ≥ 24** para `node:sqlite` sin flags (§15) |
| `.dockerignore` | excluir `output/` (que `market.db` no entre en la imagen) |
| `package.json` | script `market:recount` |
| `.env.example` · `README.md` · `DEPLOY.md` | variables nuevas, sección del marketplace, backup de `market.db` |

**Dependencias nuevas: ninguna.** `node:sqlite` viene con Node; `sharp` y `express` ya están.

---

## 14. Hitos

Cada hito deja algo comprobable por sí solo.

1. **Catálogo y esquema** — `db.ts`, migraciones, `repository.ts` con `list`/`getBySlug`,
   `ranking.ts`. Verificable con `sqlite3 output/market.db` y filas insertadas a mano, sin API
   ni UI.
2. **Publicar** — `publish.ts`, `POST /api/market`, snapshot en disco, `prefill.ts`, panel en
   la vista de resultado y chip en la galería. Aquí ya hay items reales publicados desde la app.
3. **Catálogo público** — `market.html` + `market.js`, listado con los cinco órdenes, buscador,
   etiquetas, ficha con la previsualización y la CSP de §8, `download` con su contador. Aquí la
   función ya es usable en lectura.
4. **Estrellas** — `voter.ts`, `PUT`/`DELETE .../rating`, agregados transaccionales, orden
   bayesiano y tendencia, widget accesible. Aquí está lo que pedía el encargo.
5. **Moderación y apertura** — estados, denuncias, cola con sesión, `MARKET_PUBLIC`,
   `MARKET_MODERATION`, aviso de arranque, `market:recount`.
6. **Docs y despliegue** — `README.md`, `DEPLOY.md` (volumen, backup de `market.db` con
   `VACUUM INTO`), `.env.example`, Dockerfile con Node 24 verificado.

---

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| **Node de la imagen Docker < 22.5**: `require('node:sqlite')` falla y el despliegue no arranca. La imagen es `mcr.microsoft.com/playwright:v1.61.1-noble`, cuyo Node no lo fija este repo | **Comprobar antes de escribir código**: `docker run --rm mcr.microsoft.com/playwright:v1.61.1-noble node --version`. Si es < 24, instalar Node 24 sobre esa imagen (NodeSource) o darle la vuelta (`FROM node:24-bookworm` + `npx playwright install --with-deps chromium`). En 22.5–23.3 `node:sqlite` **exige `--experimental-sqlite`**: apoyarse en ese flag es aplazar el problema, no resolverlo. Local está en Node 24.20 y verificado |
| **Votos inflados**: sin usuarios reales, cambiar de IP basta | Cookie firmada con secreto propio + tope por IP + no votar lo propio (§5) + media bayesiana, que amortigua el empujón + «(n votos)» siempre visible. Y `MARKET_PUBLIC=false` por defecto. La solución real son cuentas, y la costura está puesta |
| **`AUTH_SECRET` volátil invalidaría los votantes en cada reinicio**, en silencio | El secreto del votante vive en `meta.voter_secret`, generado una vez, independiente de `AUTH_SECRET` (§5.2) |
| **Perder `market.db`** ya no es como perder un job: se van todos los votos y contadores, que no se pueden regenerar. En Render free el disco es efímero | Volumen persistente obligatorio para el marketplace — se documenta en `DEPLOY.md` como requisito, no como recomendación. Backup con `VACUUM INTO 'market-YYYYMMDD.db'` (consistente en caliente, sin parar el servidor) |
| **HTML de terceros en el mismo origen** | Las cuatro capas de §8. Y el recordatorio en el código de que la previsualización **no** lleva `allow-same-origin`, al revés que el editor |
| **Abrir el catálogo es difícil de deshacer**: lo indexado queda indexado | `MARKET_PUBLIC=false` por defecto, `pre`-moderación recomendada al abrirlo, aviso en el arranque y en `README.md` |
| **Derechos del original reproducido** | `sourceCredit` obligatorio, casilla de confirmación, licencia explícita, denuncias con motivo `derechos` y retirada en dos pasos (§10) |
| **`node:sqlite` es sincrónico**: bloquea el bucle de eventos | Índices para cada orden, paginación keyset, sin agregados por fila, `LIMIT n+1`. La interfaz es `async` para que un almacén fuera de proceso entre sin tocar nada arriba (§4) |
| **Agregados desviados** de `ratings`/`hits` | Se escriben en la misma transacción; `market:recount` los recalcula y avisa |
| **`hits` crece sin freno** | Poda por `MARKET_HITS_KEEP_DAYS` (90) en `market:recount`. Podar olvida quién contó, no lo contado |
| **Snapshots huérfanos** si el `INSERT` falla tras copiar ficheros | El directorio se borra en el `catch`; `market:recount` lista directorios de `market/` sin fila |
| **Escribir en `market.db` desde dos procesos** (`npm run job` de CLI y el servidor) | WAL + `busy_timeout=5000`. El CLI no publica: no escribe en el catálogo |
| **La misma pieza publicada dos veces** | `UNIQUE (job_id, pass_n)` → `409` con el slug existente en lugar de un duplicado |

---

## 16. Cómo se comprueba

```bash
npm run typecheck && npm run lint
npm run dev

# 1. Publicar el último job terminado
JOB=$(curl -s 'localhost:3000/api/gallery?limit=1&status=done' | node -pe 'JSON.parse(require("fs").readFileSync(0)).items[0].id')
SLUG=$(curl -s -X POST localhost:3000/api/market -H 'Content-Type: application/json' \
  -d "{\"jobId\":\"$JOB\",\"title\":\"Prueba\",\"author\":\"Yo\",\"sourceCredit\":\"interno\",\"rightsConfirmed\":true,\"tags\":[\"datos\"]}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).slug')

# 2. Listado en cada orden
for S in recent top downloads trending views; do curl -s "localhost:3000/api/market?sort=$S&limit=3" | head -c 300; echo; done

# 3. Votar, revotar, retirar
curl -s -X PUT  "localhost:3000/api/market/$SLUG/rating" -H 'Content-Type: application/json' -d '{"stars":5}' -c c.txt -b c.txt
curl -s -X PUT  "localhost:3000/api/market/$SLUG/rating" -H 'Content-Type: application/json' -d '{"stars":3}' -b c.txt   # sigue habiendo 1 voto
curl -s -X DELETE "localhost:3000/api/market/$SLUG/rating" -b c.txt

# 4. Descargas deduplicadas: dos veces, un solo +1
curl -s -o /dev/null "localhost:3000/api/market/$SLUG/download" -b c.txt
curl -s -o /dev/null "localhost:3000/api/market/$SLUG/download" -b c.txt
curl -s "localhost:3000/api/market/$SLUG" -b c.txt | grep -o '"downloads":[0-9]*'

# 5. CSP y adjunto
curl -sI "localhost:3000/api/market/$SLUG/preview"  | grep -i 'content-security-policy'
curl -sI "localhost:3000/api/market/$SLUG/download" | grep -i 'content-disposition'

# 6. Agregados y snapshots
npm run market:recount
```

Lista manual:

- El panel de publicación **se abre solo** al terminar un job y llega con título y etiquetas.
- Publicar dos veces la misma pasada devuelve el mismo slug, no dos fichas.
- Seguir iterando el job **no** cambia la ficha publicada; borrar el job **no** la borra, y la
  galería avisa antes.
- Un 5★ solitario **no** aparece por encima de un 4,6★ con muchos votos en «Mejor valoradas».
- Votar dos veces desde el mismo navegador **cambia** el voto y deja `ratingCount` en 1.
- Borrar la cookie y votar otra vez: al cuarto intento desde la misma IP, `429`.
- Votar tu propia infografía: `403` con mensaje claro.
- Reiniciar el servidor **no** rehabilita votos ya emitidos (el secreto persiste).
- Con `MARKET_PUBLIC=false`, `/market` en una ventana privada redirige al login.
- Con `MARKET_PUBLIC=true`: `/market` se ve sin sesión; `POST /api/market` responde `401`;
  `/api/market/admin/reports` responde `401`.
- Teclado sólo: llegar al widget, votar con flechas y `Enter`, retirar el voto.
- Un `<script>` inyectado a mano en un `pass-N.html` hace que la publicación devuelva `422`,
  no que se publique saneado a medias.

---

## 17. Fuera de alcance (por ahora)

Cuentas de usuario reales con OAuth (es el paso siguiente, §5 deja la costura) · comentarios ·
«remezclar» un item publicado para partir de él (contador de forks) · seguir a un autor ·
colecciones y favoritos · notificaciones · búsqueda por el texto de la infografía (FTS5 está
disponible el día que haga falta) · almacenamiento de objetos y CDN para los snapshots ·
`MARKET_ASSET_ORIGIN` en otro hostname · exportar varios items en un zip · portadas
destacadas y curación editorial · estadísticas por autor · i18n del catálogo · nada de pagos:
«marketplace» aquí significa catálogo compartido, no tienda.
