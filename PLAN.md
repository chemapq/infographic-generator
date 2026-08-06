# Plan — Infographic Generator (imagen → HTML/SVG editable)

> Herramienta local que toma una imagen de una infografía y produce un HTML autocontenido,
> visualmente casi idéntico, donde **todo es editable**: textos reales, formas en SVG,
> colores en variables CSS. Claude genera el HTML, lo renderiza con un navegador headless,
> **se compara visualmente con el original** y refina en varias pasadas. Al final, el usuario
> escribe un prompt con los últimos ajustes para la iteración final.

---

## 1. Decisiones de diseño (cerradas)

| Decisión | Elección |
| --- | --- |
| Motor IA | **API directa de Anthropic** (Messages API con visión). La app controla el bucle: pasadas y consumo predecibles. |
| Editabilidad | **Por fases.** Fase 1: HTML/SVG limpio y semántico + edición vía prompt. Fase 2: señalar un elemento en la web y pedirle el cambio a Claude. |
| Alcance de imágenes | **Vectorizable puro**: texto, formas, iconos, diagramas, gráficos de datos. Fotos/ilustraciones complejas → placeholders marcados para reemplazo manual. |
| Despliegue | **Local, un usuario** (`npm run dev`), proyectos persistidos en disco (`output/`). Para desplegarla, `AUTH_PASSWORD` activa una pantalla de login que cubre toda la app; en producción es obligatoria (el servidor no arranca sin ella). Al ser un proceso con estado en memoria + disco propio, se despliega con Docker en un host de proceso persistente (Render/Railway/Fly.io/VPS) — ver [DEPLOY.md](DEPLOY.md) —, no en plataformas serverless. |
| Modelo | `claude-opus-4-8` (visión de alta resolución hasta 2576 px de lado largo, coordenadas 1:1 con píxeles). Configurable por env. |

---

## 2. Arquitectura general

```
┌─────────────┐   multipart    ┌──────────────────────────────────────────┐
│  UI web      │ ─────────────▶ │  API Express (src/api)                   │
│  (public/)   │ ◀───────────── │  POST /api/jobs · SSE progreso · result  │
└─────────────┘    SSE/JSON    └──────────────┬───────────────────────────┘
                                              │
                               ┌──────────────▼───────────────┐
                               │  Orquestador (src/services)  │
                               │  bucle: generar → renderizar │
                               │  → comparar → refinar        │
                               └──┬─────────┬─────────┬───────┘
                                  │         │         │
                        ┌─────────▼──┐ ┌────▼─────┐ ┌─▼──────────────┐
                        │ Anthropic  │ │ Renderer │ │ Comparador     │
                        │ Messages   │ │ Playwright│ │ pixelmatch +   │
                        │ API (visión)│ │ headless │ │ juicio Claude  │
                        └────────────┘ └──────────┘ └────────────────┘
```

- **Stack**: el andamiaje existente — Node ≥ 20, TypeScript ESM, Express 5, `sharp`.
- **Dependencias nuevas**: `@anthropic-ai/sdk`, `playwright` (Chromium), `pixelmatch` + `pngjs`, `multer` (subida), `zod` (schemas de salida estructurada).
- Todo el estado de un trabajo vive en `output/<jobId>/` (imagen original, HTML y captura de cada pasada, diffs, métricas, log de uso de tokens). Reabrible tras reiniciar el servidor.

---

## 3. El pipeline de pasadas

### Pasada 0 — Análisis (una sola vez)
Claude recibe la imagen original y devuelve una **especificación estructurada** (salida
estructurada con `output_config.format` + schema Zod):

- dimensiones del lienzo y retícula aproximada
- paleta de colores (hex) → se convertirán en variables CSS
- inventario completo de textos (OCR semántico: jerarquía, no solo strings)
- árbol de capas: secciones, formas, iconos, gráficos de datos
- zonas fotográficas detectadas → marcadas como `placeholder`

Esta spec sirve para dos cosas: da editabilidad (nombres de capas, textos reales) y ancla
las pasadas siguientes.

### Pasada 1 — Generación
Claude genera un **HTML autocontenido** a partir de imagen + spec, siguiendo las
convenciones de editabilidad (§4). Petición en streaming (`client.messages.stream` +
`finalMessage()`, `max_tokens` ≈ 64000) porque el HTML puede ser largo.

### Pasadas 2..N — Renderizar → Comparar → Refinar
1. **Renderizar**: Playwright abre el HTML con viewport fijo a las dimensiones del original,
   `deviceScaleFactor` fijo, animaciones desactivadas y espera a `document.fonts.ready`.
   Captura PNG.
2. **Comparar (doble señal)**:
   - *Métrica*: `pixelmatch` sobre original vs render (ambos normalizados con `sharp` al
     mismo tamaño) → `score` (% píxeles coincidentes) + **imagen diff (heatmap)**.
     La métrica es ruidosa en texto/antialiasing: se usa como tendencia y desempate, no
     como única verdad.
   - *Juicio de Claude*: se le envían original + render + diff y devuelve un **veredicto
     estructurado**: lista de discrepancias concretas (con zona y severidad) y un booleano
     `closeEnough`.
3. **Refinar**: Claude reescribe el HTML corrigiendo las discrepancias. Al inicio,
   re-emisión completa del fichero (simple y robusto); como optimización futura,
   edición por bloques search/replace para ahorrar tokens de salida.

### Criterio de parada
Se detiene el bucle cuando ocurre lo primero de:
- `closeEnough === true` en el veredicto de Claude **y** el score no empeora,
- el score se estanca (< +0,5 pt en dos pasadas consecutivas), o
- se alcanza `MAX_PASSES` (por defecto **5**, configurable) — techo duro de consumo.

### Iteración final dirigida por el usuario
La UI muestra original vs resultado lado a lado. El usuario escribe un prompt libre
("cambia el título a X", "el azul más oscuro", "quita el pie de página") y se ejecuta
**una pasada más** con esas instrucciones como prioridad. Puede repetirse las veces que
quiera; cada iteración queda versionada en `output/<jobId>/passes/`.

**Señalando el elemento** (implementado): en la vista de resultado el usuario abre la
infografía a pantalla completa, hace clic en cualquier elemento del HTML —incluidas las
formas dentro de un SVG— y escribe el cambio en una ventanita anclada a él ("rehaz este
gráfico como barras horizontales", "cambia este azul por el verde de la paleta"). El
contexto del elemento (etiqueta, selector, markup y texto) viaja con el prompt en
`POST /iterate`, de modo que Claude acota el cambio a ese elemento y re-emite el HTML
completo. El navegador no edita nada: el HTML lo escribe siempre Claude, y cada petición
es una pasada más del job.

---

## 4. Convenciones del HTML editable (el contrato de salida)

El prompt de sistema exige a Claude:

1. **Un solo fichero HTML autocontenido**: CSS inline en `<style>`, sin JS, sin recursos
   externos salvo Google Fonts (única lista blanca de red).
2. **Lienzo de tamaño fijo** (`<div class="canvas">` con las dimensiones del original);
   dentro, posicionamiento absoluto o grid según convenga a la fidelidad.
3. **Textos como DOM real** (`h1`, `p`, `span`…), nunca texto convertido a trazados SVG.
4. **Paleta en variables CSS** en `:root` (`--color-1`, `--color-2`…): cambiar un color
   en un sitio recolorea toda la pieza.
5. **Formas, iconos, líneas y gráficos en SVG inline**, con `id`/`data-layer` descriptivos
   (`data-layer="icono-cohete"`, `id="barra-ventas-q3"`).
6. **Gráficos de datos con los datos a la vista**: los valores como atributos o comentario
   junto al SVG para poder reeditarlos.
7. **Placeholders de fotos**: `<div class="photo-placeholder" data-replace="descripción">`
   con el color medio de la zona como fondo, listados al final del job para reemplazo manual.
8. **Tipografías**: elegir la Google Font más parecida a la del original y declarar la pila
   de fallbacks.

Este contrato es lo que hace que "editable" sea real y no solo un screenshot en HTML.

---

## 5. Uso de la API de Anthropic (detalles que importan)

- **Modelo**: `claude-opus-4-8`. Sin `temperature`/`top_p` (eliminados en Opus 4.8);
  pensamiento adaptativo `thinking: { type: "adaptive" }` y `output_config.effort`
  (`high` para generar, `medium` para comparar).
- **Visión**: imágenes en base64. Preprocesar con `sharp` a ≤ 2576 px de lado largo.
  Consumo ~hasta 4784 tokens por imagen a máxima resolución; para las capturas intermedias
  puede bastar ~1600 px si el consumo aprieta.
- **Conversación por job + caché de prompt**: cada job es **una conversación multi-turno**
  (system + imagen original al principio con `cache_control: { type: "ephemeral" }`, y un
  breakpoint al final del último turno). Así, cada pasada solo paga en frío la captura
  nueva y el veredicto; el prefijo (system, contrato de salida, imagen original, historial)
  se lee de caché (cache read). Verificar con `usage.cache_read_input_tokens`.
- **Salidas estructuradas**: spec (pasada 0) y veredictos de comparación con
  `client.messages.parse()` + `zodOutputFormat(schema)` — sin parsing frágil.
- **Streaming**: siempre en la generación/refinado de HTML; los eventos de texto alimentan
  el progreso de la UI vía SSE.
- **Errores**: cadena tipada del SDK (`RateLimitError` → backoff, `APIStatusError`,
  `APIConnectionError`); el job pasa a estado `failed` con causa legible, nunca se cuelga.
- **Uso estimado por infografía** (5 pasadas, con caché): entrada ~60–100K tokens
  (mayoría cacheada), salida ~50–100K tokens. Se registra el uso real por pasada en
  `output/<jobId>/usage.json`.

---

## 6. API HTTP

| Método y ruta | Descripción |
| --- | --- |
| `POST /api/auth/login` · `/logout` · `GET /status` | Pantalla de login del despliegue (sesión en cookie firmada). |
| `POST /api/jobs` | Multipart con la imagen (+ opciones: `maxPasses`, notas del usuario). Devuelve `{ jobId }` y arranca el pipeline. |
| `GET /api/jobs/:id` | Estado del job: pasada actual, scores y uso de tokens. |
| `GET /api/jobs/:id/events` | **SSE**: progreso en vivo (inicio/fin de pasada, score, discrepancias, texto en streaming). |
| `POST /api/jobs/:id/iterate` | Body `{ prompt, target? }` → iteración dirigida por el usuario; con `target` (elemento señalado) el cambio se acota a él. Repetible. |
| `GET /api/jobs/:id/result` | HTML final (y `?pass=n` para versiones anteriores). |
| `GET /api/jobs/:id/assets/*` | Original, capturas y diffs de cada pasada (para el side-by-side de la UI). |

---

## 7. UI web (fase 1) — `public/`

Estática (HTML + CSS + JS vanilla, sin build), servida por Express. Tres vistas:

1. **Subida**: drag & drop de la imagen, opciones (nº máx. de pasadas), botón "Generar".
2. **Progreso**: timeline de pasadas en vivo (SSE): miniatura del render, score, lista de
   discrepancias detectadas.
3. **Resultado**: original vs resultado lado a lado con **slider de superposición**,
   selector de pasada, caja de prompt para la iteración final, botones *Descargar HTML* y
   *Copiar código*.
4. **Editor por prompt** (superpuesto): la infografía a tamaño completo en un
   `<iframe sandbox="allow-same-origin">` del mismo origen; la app lee su DOM para resaltar
   el elemento bajo el puntero y, al hacer clic, abre la ventanita de prompt anclada a él.

**Identidad visual de la herramienta** (marca Awakelab 2026 — aplica a la UI de la app,
*no* a las infografías generadas, que respetan la paleta de su imagen original):

- Tipografía **Poppins** (Google Fonts) en toda la UI.
- Fondos en azules profundos (`#011932`, `#012142`, `#01264C`); superficies suaves en
  claros (`#F0F3FC`, `#E2E6F2`); acentos, CTAs y datos en cianes vivos (`#19F7F1`,
  `#11EAEA`, `#0ABCC9`) sobre fondo oscuro, siempre con contraste accesible.
- Logo completo de Awakelab en cabecera usando la variante acorde al fondo
  (oscuro: `https://media.awakelab.world/MARCA_AWK26/awakelab_logo_fondo-oscuro_transparente.png`);
  isotipo como favicon
  (`https://media.awakelab.world/MARCA_AWK26/awakelab_isotipo_fondo-blanco_transparente.png`).
  Sin recolorear ni deformar; margen de protección igual a la altura del isotipo.

---

## 8. Estructura de código prevista

```
src/
├── index.ts                  # arranque Express + estáticos + rutas
├── config/
│   └── env.ts                # PORT, ANTHROPIC_API_KEY, MODEL, MAX_PASSES, TARGET_SCORE…
├── api/
│   ├── jobs.router.ts        # endpoints de §6
│   └── sse.ts                # helper de Server-Sent Events
└── services/
    ├── orchestrator.ts       # máquina de estados del job (bucle de pasadas)
    ├── claude/
    │   ├── client.ts         # cliente Anthropic, retries, contadores de uso
    │   ├── prompts.ts        # system prompt + contrato de salida (§4)
    │   ├── analyze.ts        # pasada 0 → spec (structured output)
    │   ├── generate.ts       # generación/refinado de HTML (streaming)
    │   └── compare.ts        # veredicto estructurado de comparación
    ├── renderer.ts           # Playwright: HTML → PNG determinista
    ├── differ.ts             # sharp + pixelmatch: score + heatmap
    └── store.ts              # persistencia en output/<jobId>/
```

`.env` nuevo sobre el `.env.example` actual:

```
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-4-8
MAX_PASSES=5
TARGET_SCORE=97        # % de similitud pixelmatch para considerar "suficiente"
```

---

## 9. Hitos

| Hito | Entregable | Verificación |
| --- | --- | --- |
| **M1 — Pipeline mínimo** | `analyze` + `generate` + `renderer`: imagen → HTML → captura, invocable por script. | Con 2–3 infografías de prueba se obtiene un HTML que "se parece". |
| **M2 — Bucle iterativo** | `differ` + `compare` + `orchestrator` con criterio de parada, persistencia por pasada y log de uso de tokens. | El score mejora entre pasadas y el bucle se detiene solo. |
| **M3 — API + UI** | Endpoints de §6 y las tres vistas de §7 con SSE y branding. | Flujo completo desde el navegador: subir → ver pasadas → resultado. |
| **M4 — Iteración final + pulido** | `POST /iterate`, versionado de iteraciones, slider de comparación, descarga, caché de prompt verificada. | Un prompt del usuario produce el cambio pedido sin romper el resto. |
| **Fase 2 — Edición señalando elementos** | Lienzo a pantalla completa: resaltado al pasar el ratón, selección por clic de cualquier elemento (también dentro de SVG) y ventanita de prompt que manda el cambio a Claude con el contexto del elemento. | Clic en un elemento + frase en lenguaje natural → Claude cambia solo eso y el resto queda igual. |

---

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| **Tipografías**: la fuente exacta del original no existe en Google Fonts. | Claude elige la más parecida; la discrepancia tipográfica se puntúa aparte en el veredicto para no quemar pasadas persiguiendo lo imposible. El usuario puede fijar la fuente en la iteración final. |
| **Métrica de píxeles ruidosa** (antialiasing, subpixel del texto). | Umbral de tolerancia en pixelmatch + comparar también a media resolución; el juicio visual de Claude es la señal primaria. |
| **Bucle que no converge** (correcciones que rompen otra zona). | Veredicto incluye regresiones detectadas vs pasada anterior; si el score cae 2 veces, se revierte a la mejor pasada y se para. Techo duro `MAX_PASSES`. |
| **Consumo por job se dispara.** | Caché de prompt (conversación única por job), capturas intermedias a resolución reducida, uso de tokens registrado en `output/<jobId>/usage.json`, techo de pasadas. |
| **HTML generado con recursos externos o JS.** | Validador post-generación: solo se permite `fonts.googleapis.com`/`gstatic`; cualquier `<script>` o URL externa se elimina y se le pide corrección a Claude. |
| **Imagen que no se puede procesar** (HEIC/HEIF de iPhone, PDF, SVG, archivo dañado) y **errores ilegibles** de las librerías (libvips/libheif, Playwright, SDK). | El formato real se detecta por los bytes de cabecera antes de procesar, no por el tipo MIME (que se deduce de la extensión y miente): `src/services/image.ts`. Los fallos se traducen a un mensaje con la acción a tomar y el técnico queda aparte en `detail`: `src/services/errors.ts`. Los HEIC se avisan ya en el navegador, sin gastar la subida. |
| **Render no determinista.** | Viewport y `deviceScaleFactor` fijos, `prefers-reduced-motion`, espera a fuentes cargadas, misma versión de Chromium anclada por lockfile. |
| **Fotos dentro de la infografía.** | Fuera de alcance por decisión: placeholder marcado con descripción y color medio; listado de reemplazos pendientes en el resultado. |

---

## 11. Fuera de alcance (por ahora)

- Multiusuario, auth, despliegue en servidor (la arquitectura no lo impide: el estado ya
  vive en disco por job).
- Vectorización de fotografías/ilustraciones complejas.
- Export a Figma/PowerPoint (posible futuro: el SVG inline ya facilita un export `.svg`).
- Batch de múltiples imágenes en paralelo (el orquestador procesará jobs en serie en fase 1).
