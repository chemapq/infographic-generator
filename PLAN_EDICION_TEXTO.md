# Plan — Edición manual de textos (sin IA)

> Botón nuevo en el resultado: **«Editar textos»**. Abre el lienzo, se hace clic en cualquier
> texto de la infografía y se reescribe a mano. El cambio se ve al momento sobre el HTML real y
> al guardar queda como una pasada más del job. **Cero llamadas a Claude, cero tokens**: para
> corregir una errata o cambiar un dato no hace falta pagar (ni esperar) una generación entera.

Rama: `feat/edicion-texto-manual` (sobre `feat/galeria-historial`) ·
Complementa [PLAN.md](PLAN.md) y [PLAN_GALERIA.md](PLAN_GALERIA.md).

---

## 1. Punto de partida (lo que ya existe)

- El resultado terminado tiene su barra de acciones en `#result`: pasada, **Editar señalando**,
  Descargar, Copiar, Abrir ([index.html:121](public/index.html#L121)). Ahí entra el botón nuevo.
- Ya hay un editor superpuesto a pantalla completa ([editor.js](public/editor.js), 633 líneas)
  con casi toda la maquinaria que hace falta: carga del HTML de una pasada en un
  `<iframe sandbox="allow-same-origin">`, sondeo hasta que el documento existe, zoom/ajuste,
  mapeo de coordenadas, resaltado de elementos y `cssPath()` para reencontrarlos. Hoy todo eso
  termina en una llamada a Claude; **la parte de lienzo es reutilizable tal cual**.
- Los clics no se recogen dentro del iframe sino en la capa `#ed-hit` del documento padre,
  porque WebKit no despacha eventos DOM a un documento con `sandbox` sin `allow-scripts`
  ([editor.js:201](public/editor.js#L201)). El modo texto hereda esa decisión: **nada se
  escribe dentro del iframe con el teclado**.
- Cada pasada se persiste en `output/<jobId>/passes/pass-N.{html,png}` y el `JobRecord` lleva
  la lista completa ([store.ts](src/services/store.ts)). Añadir una pasada más es el mecanismo
  natural para versionar una edición manual: gratis en histórico, deshacer y descarga.
- `runPass()` ([orchestrator.ts:162](src/services/orchestrator.ts#L162)) hace tres cosas en
  fila: generar HTML con Claude → renderizar con Playwright → medir con pixelmatch. Una pasada
  manual necesita **solo las dos últimas**.
- `currentResultPass()` es lo que ven el resultado, la descarga y la miniatura de la galería:
  hoy devuelve la última pasada `iterate`, o la mejor del bucle ([orchestrator.ts:153](src/services/orchestrator.ts#L153)).
- Playwright ya es dependencia y mantiene un Chromium vivo entre peticiones
  ([renderer.ts](src/services/renderer.ts)): hay un DOM disponible en el servidor sin añadir
  nada al `package.json`.

---

## 2. Qué es exactamente «editar el texto»

Editar **nodos de texto**, no elementos. Es la diferencia entre conservar la infografía y
romperla:

```html
<h1 class="titulo">5 <span class="hl">ESTRATEGIAS</span><br>de venta</h1>
```

- `h1.textContent = "…"` destruiría el `<span>` y el `<br>`: adiós al color de acento y al
  salto de línea.
- Con nodos de texto son **tres textos editables independientes** (`"5 "`, `"ESTRATEGIAS"`,
  `"de venta"`), cada uno con su caja, y el markup queda intacto.

Lo mismo aplica a los SVG que genera Claude: cada `<tspan>` es un texto propio. La tarjeta de
edición lo dice en claro («fragmento 2 de 3 de este titular») para que no parezca un fallo.

**Lo que este modo NO hace** (sigue siendo trabajo del editor por prompt): mover, redimensionar,
cambiar colores, tipografías, atributos o estructura. Solo texto.

---

## 3. Decisiones de diseño

| Decisión | Elección | Por qué |
| --- | --- | --- |
| Dónde vive la UI | **Un modo más del editor existente** (`VisualEditor.open({ mode: 'text' })`), con conmutador en la barra para saltar entre «Editar textos» y «Pedir cambios a la IA» sin cerrar. | Carga del iframe, zoom, ajuste, mapeo de coordenadas y overlays ya están escritos y depurados en los dos navegadores. Duplicarlos en un fichero nuevo sería copiar ~300 líneas frágiles. |
| Dónde se escribe | **Tarjeta flotante** reutilizando `placePrompt()`, con el texto original arriba y un `<textarea>` debajo. El lienzo se actualiza **en vivo** mientras se teclea. | Editar in situ (tipografía copiada sobre el propio texto) es más bonito pero exige clonar `font`, `letter-spacing`, `text-anchor` de SVG, transformaciones y escala; y `contenteditable` dentro del iframe reabre el problema de eventos de WebKit. La vista previa en vivo da el 90 % de la sensación con el 20 % del riesgo. Queda como mejora (§10). |
| Qué se manda al servidor | **La lista de cambios** (`selector`, `nodeIndex`, `before`, `after`), no el HTML completo. | Payload de bytes en vez de 200 KB, se puede verificar que el texto sigue siendo el que se editó, y el servidor no tiene que confiar en HTML llegado del navegador. |
| Cómo se aplica en el servidor | **Sobre el DOM, con el Chromium de Playwright** que ya está en marcha. | Un solo camino de código y siempre correcto (entidades, espacios, SVG, namespaces). El parcheo textual byte a byte es más fiel pero necesita casos especiales; entra después (§10) sin cambiar la API. |
| Cómo se persiste | **Una pasada nueva** con `kind: 'manual'` y `usage` a cero. | El histórico, la descarga, la miniatura, el selector de pasadas y el «volver atrás» ya funcionan por pasada. No hay estado nuevo que inventar. |
| Efecto en el score | Se calcula y se muestra, pero **una pasada manual nunca puede ser `bestPass`**. | El score mide parecido con la imagen original. Cambiar un texto a propósito lo baja, y es correcto que lo baje: lo que sería un error es que el chip «mejor» saltara de sitio por eso. |
| Concurrencia | Se encola con `enqueue()` como la iteración, y responde `202` + SSE. | Comparte el Chromium con el pipeline; y la UI de progreso (`onJobUpdate`, timeline) ya sabe reaccionar a una pasada nueva. |

---

## 4. Modelo de datos

### `TextEdit` — el contrato entre navegador y servidor ([src/types.ts](src/types.ts))

```ts
export interface TextEdit {
  /** cssPath del elemento que contiene el nodo de texto (lo produce cssPath() del editor). */
  selector: string;
  /** Índice del nodo de texto entre los childNodes de ese elemento. */
  nodeIndex: number;
  /** Texto tal como estaba al abrir el editor: verificación optimista. */
  before: string;
  /** Texto nuevo. Puede ser vacío (borrar el texto), nunca se borra el nodo. */
  after: string;
}
```

`nodeIndex` es estable dentro de un mismo documento, y `before` es el cinturón de seguridad: si
otro cambio (una iteración con IA desde otra pestaña) movió el HTML por debajo, la aplicación
falla en vez de escribir en el sitio equivocado.

### Cambios en `PassKind` y `PassRecord`

```ts
export type PassKind = 'generate' | 'refine' | 'iterate' | 'manual';

export interface PassRecord {
  // …lo que ya hay
  /** Cambios de texto aplicados a mano cuando kind === 'manual'. */
  edits?: TextEdit[];
}
```

Nada que migrar: los jobs existentes no traen `edits` y `kind` nunca vale `'manual'` en ellos.

### Puntos del código que **tienen** que enterarse del nuevo `kind`

| Sitio | Cambio | Si se olvida… |
| --- | --- | --- |
| `currentResultPass()` [orchestrator.ts:153](src/services/orchestrator.ts#L153) | la última pasada `iterate` **o `manual`** | la edición se guarda pero el resultado, la descarga y la miniatura siguen mostrando la anterior |
| `updateBestPass()` [orchestrator.ts:217](src/services/orchestrator.ts#L217) | ignora `manual` igual que ignora `iterate` | el chip «mejor» salta a una pasada peor puntuada |
| `renderResult()` / `renderTimeline()` [app.js](public/app.js) | etiqueta `manual: 'edición manual'` y resumen «3 textos editados a mano» | la pasada aparece sin nombre en el desplegable y sin explicación en el timeline |

---

## 5. Frontend — modo texto en el editor

### 5.1 Encontrar los textos editables

Al quedar listo el documento (`useDocument()`), se recorre una vez con un `TreeWalker`:

```js
const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
  acceptNode: (node) =>
    node.nodeValue.trim() !== '' && !SKIP.has(node.parentElement?.localName)
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT,
});
// SKIP = script, style, title, noscript, template
```

De cada nodo se guarda `{ node, parent, nodeIndex, before, rect }`. La caja de un nodo de texto
no sale de `getBoundingClientRect()` (los nodos de texto no lo tienen): se obtiene con un
`Range` sobre su contenido (`range.selectNodeContents(node)`), que además devuelve una caja por
línea cuando el texto va partido.

### 5.2 Señalar

- Un botón **«Resaltar textos»** dibuja la caja de todos los nodos a la vez: de un vistazo se ve
  qué es editable y qué no (una forma SVG no lo es).
- Al pasar el ratón se resalta solo el que está debajo.
- Al hacer clic se resuelve el nodo exacto — no basta con el elemento, porque un `<h1>` puede
  tener tres:
  1. `doc.caretRangeFromPoint(x, y)` (Chromium/WebKit) → `range.startContainer` si es texto.
  2. `doc.caretPositionFromPoint(x, y)` (Firefox y el estándar).
  3. Si ninguna existe: el nodo del elemento cuya caja contiene el punto, y si no, el primero.

  Las coordenadas se convierten igual que hoy en `elementAt()`: restando el rect de `#ed-hit`
  y dividiendo por `scale`.
- **Tab / Shift+Tab** salta al texto siguiente/anterior en orden de documento: para repasar
  todos los textos de una infografía es más rápido que apuntar con el ratón.

### 5.3 Editar

La tarjeta (reutiliza `#ed-prompt` → `#ed-card`, misma colocación por `placePrompt()`) muestra:

```
┌─ h1.titulo · fragmento 2 de 3 ─────────── ✕ ┐
│ Original:  «ESTRATEGIAS»                    │
│ ┌─────────────────────────────────────────┐ │
│ │ ESTRATEGIAS                             │ │  ← textarea
│ └─────────────────────────────────────────┘ │
│  ↺ Restaurar          [ Hecho ]             │
└─────────────────────────────────────────────┘
```

- Cada pulsación escribe `node.nodeValue = value` en el iframe: **el lienzo reflowa en vivo**,
  así se ve al momento si el texto nuevo se sale de su caja o parte mal.
- `Enter` (o clic fuera) cierra la tarjeta; `Esc` deshace ese texto; `⌘Z` deshace el último
  cambio de toda la sesión (pila de ediciones).
- Un texto cambiado queda con la caja en cian de marca; el contador de la barra pasa a
  «3 textos cambiados · Guardar · Descartar».
- Nada se ha persistido todavía: **Descartar** recarga la pasada y no queda rastro.

### 5.4 Guardar

`POST /api/jobs/:id/text-edit` con los cambios pendientes → `202` → se espera igual que en el
modo prompt (SSE de `app.js` + el sondeo de respaldo de `startPolling()`), y al aparecer la
pasada nueva se carga en el lienzo con el aviso `✓ 3 textos guardados en la pasada 7 · sin
coste de tokens`.

---

## 6. Backend

### 6.1 `POST /api/jobs/:id/text-edit`

```jsonc
// petición
{
  "basePass": 6,                       // la pasada que se estaba editando
  "edits": [
    { "selector": "section.hero > h1", "nodeIndex": 2, "before": "de venta", "after": "de captación" }
  ]
}
// respuesta
202 { "jobId": "a1b2c3d4", "queued": true }
```

| Código | Cuándo |
| --- | --- |
| `400` | `edits` vacío, mal formado, más de 200 entradas o un `after` de más de 2 000 caracteres |
| `404` | job inexistente |
| `409` | el job no está `done` (hay una pasada en curso) |
| `409` | `basePass` ya no es la pasada actual, o algún `before` no coincide → devuelve **qué** cambios fallaron para poder avisar en la UI |

El límite de `express.json` ya es 1 MB ([index.ts:14](src/index.ts#L14)): de sobra para 200
cambios de texto.

### 6.2 `applyTextEdits()` — servicio nuevo

`src/services/textEdits.ts`, con el Chromium que ya está en marcha:

```ts
export async function applyTextEdits(
  html: string,
  edits: TextEdit[],
): Promise<{ html: string; failed: TextEdit[] }>;
```

1. `page.setContent(html)` en el navegador compartido.
2. Por cada cambio: `document.querySelector(selector)`, comprobar que
   `el.childNodes[nodeIndex]` es un nodo de texto y que su valor es `before`; si sí,
   asignar `after`; si no, a `failed`.
3. Si hay alguno en `failed`, **no se aplica nada**: se responde `409` con la lista. Media
   edición aplicada sería peor que ninguna.
4. Serializar con `documentElement.outerHTML` y reponer el `<!DOCTYPE html>`.
5. Guarda de cordura: si el HTML resultante pierde más del 20 % del tamaño, se aborta con
   error — señal de que la serialización se comió algo.

**Seguridad**: `after` viaja como texto y se asigna a `nodeValue`, así que un `<script>`
tecleado por el usuario se serializa escapado (`&lt;script&gt;`); no hay inyección posible. Aun
así el resultado pasa por `sanitizeHtml()` como cualquier otra pasada, para que el contrato de
salida (sin JS, sin red fuera de Google Fonts) se cumpla en un único sitio.

### 6.3 Pasada manual en el orquestador

`runPass()` hace hoy generar → renderizar → medir. Se extrae la cola:

```ts
// nuevo, sacado tal cual de los pasos 2 y 3 de runPass()
async function renderAndScore(job, passNumber, html, originalPng): Promise<{ pass; renderPng; diffPng }>
```

Con eso:

- `runPass()` = llamada a Claude + `renderAndScore()` (sin cambio de comportamiento).
- `runManualPass()` = `applyTextEdits()` + `sanitizeHtml()` + `renderAndScore()`, y la pasada
  resultante lleva `kind: 'manual'`, `verdict: null`, `usage: emptyUsage()` y `edits`.

`requestTextEdit(jobId, basePass, edits)` valida y hace `enqueue(() => runManualPass(...))`,
igual que `requestIteration()`. Los eventos `pass:done` / `job:done` que ya emite el
orquestador bastan para que la UI se entere sin tocar el SSE.

**La miniatura de la galería se actualiza sola**: `ensureThumb()` compara mtimes contra
`currentResultPass()` ([thumbs.ts:51](src/services/thumbs.ts#L51)) y regenera al vuelo.

---

## 7. Ficheros a tocar

| Fichero | Cambio |
| --- | --- |
| `src/types.ts` | `TextEdit`; `'manual'` en `PassKind`; `edits?` en `PassRecord` |
| `src/services/textEdits.ts` | **nuevo** — `applyTextEdits()` sobre el DOM de Playwright |
| `src/services/renderer.ts` | exponer una página del navegador compartido para aplicar los cambios (o `applyTextEdits` lo pide por su cuenta) |
| `src/services/orchestrator.ts` | extraer `renderAndScore()`; `runManualPass()`; `requestTextEdit()`; `currentResultPass()` y `updateBestPass()` al tanto de `'manual'` |
| `src/api/jobs.router.ts` | `POST /:id/text-edit` con validación y códigos `400/404/409` |
| `public/index.html` | botón `#btn-edit-text` en la barra del resultado; conmutador de modo y contador en `.ed-bar`; tarjeta de edición; pie de ayuda por modo |
| `public/editor.js` | modo `text`: recorrido de nodos, resolución por `caretRangeFromPoint`, cajas de texto, tarjeta, edición en vivo, pila de deshacer, guardar/descartar |
| `public/app.js` | abrir el editor en modo texto; `manual` en las etiquetas del timeline y del selector de pasadas |
| `public/styles.css` | sección `Edición manual de textos` (cajas, tarjeta, contador) con la paleta de marca |
| `PLAN.md`, `README.md` | documentar el modo y el endpoint |

Sin dependencias nuevas y sin variables de entorno nuevas: los límites (200 cambios, 2 000
caracteres) son constantes en el código.

---

## 8. Hitos

1. **Backend completo** — tipos, `textEdits.ts`, `renderAndScore()`, `runManualPass()`,
   endpoint. Verificable con `curl` sobre un job que ya exista, sin tocar la UI.
2. **Modo texto navegable** — botón, apertura del editor en modo texto, descubrimiento y
   resaltado de nodos, clic → tarjeta, edición en vivo, contador, descartar. Aún no guarda.
3. **Guardar** — envío, estados de espera, recarga de la pasada nueva, timeline y selector al
   día. Aquí la función ya es usable de punta a punta.
4. **Pulido** — `⌘Z`, `Tab` entre textos, conmutador de modo, avisos de fallo (`409` con los
   textos que ya no coinciden), CSS de marca.
5. **Docs** — `PLAN.md`, `README.md`.

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| `caretRangeFromPoint` no es estándar y Firefox usa `caretPositionFromPoint` | las dos, más un tercer camino por cajas de `Range`; el clic nunca se queda sin respuesta |
| WebKit no despacha eventos dentro del iframe con `sandbox` | ya resuelto por la capa `#ed-hit`; el texto se teclea en la tarjeta del documento padre, nunca dentro del iframe |
| El HTML cambió por debajo (iteración con IA en otra pestaña) | `basePass` + verificación de `before`; `409` con la lista de textos que ya no coinciden y recarga del lienzo |
| Aplicación a medias | todo o nada: si falla un cambio, no se escribe ninguno |
| La serialización de Chromium reformatea el HTML (SVG autocerrado, indentación) | la pasada anterior queda intacta en disco y se puede volver a ella; guarda de tamaño ±20 %; fidelidad byte a byte como mejora (§10) |
| El score baja al cambiar un texto a propósito | `updateBestPass()` ignora las pasadas manuales; la UI explica que el score mide parecido con el original |
| Un texto vacío descuadra la maquetación | se permite (a veces es lo que se quiere), con vista previa en vivo, `↺ Restaurar` y `⌘Z` |
| Textos partidos en `<span>`/`<br>`/`<tspan>` se editan por trozos | es lo que preserva el diseño; la tarjeta lo dice («fragmento 2 de 3») |
| Playwright ocupado con otro job | se encola como la iteración; la UI muestra la espera |
| Un texto dentro de `<style>` o de un comentario | el `TreeWalker` los excluye |

---

## 10. Fuera de alcance (por ahora)

- **Edición in situ** con la tipografía real sobre el propio texto (v2 del modo).
- **Fidelidad byte a byte**: parche textual por enésima ocurrencia con caída al DOM cuando el
  texto no aparezca literal en el fuente (entidades, espacios no separables).
- Editar a mano colores, tipografías, posiciones, tamaños o atributos — eso sigue siendo el
  editor por prompt.
- Editar los `data-value` de los gráficos SVG para que el dibujo se recalcule (interesante, pero
  necesita recalcular geometría, no solo texto).
- Reemplazar los `.photo-placeholder` por fotos reales.
- Deshacer entre sesiones (al cerrar el editor, la pila se pierde; lo persistido son las pasadas).
- Edición simultánea por varias personas.

---

## 11. Cómo se comprueba

```bash
npm run typecheck && npm run lint
npm run dev

# el selector y el nodeIndex salen del editor; para probar a mano, del HTML de la pasada
curl -s -X POST localhost:3000/api/jobs/<id>/text-edit \
  -H 'Content-Type: application/json' \
  -d '{"basePass":3,"edits":[{"selector":"section.hero > h1","nodeIndex":0,"before":"HOLA","after":"ADIÓS"}]}'

curl -s localhost:3000/api/jobs/<id> | python3 -c 'import json,sys; j=json.load(sys.stdin); print(j["passes"][-1]["kind"], j["bestPass"], j["totalUsage"])'
```

Checklist manual: el botón solo aparece con el job terminado · clic en un titular abre la
tarjeta con ese fragmento, no con el titular entero · teclear se ve en el lienzo al momento ·
`Descartar` deja la infografía como estaba · `Guardar` crea una pasada `manual` y la descarga
trae el texto nuevo · `totalUsage` **no** se mueve · el chip «mejor» sigue en la misma pasada ·
la miniatura de la galería se actualiza sola · un `<span>` de color dentro de un titular sigue
en su sitio después de editar el texto que lo rodea · un `before` manipulado a mano devuelve
`409` sin tocar el HTML · funciona en Chrome, Safari y Firefox.
