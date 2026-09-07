/* GENERADO por scripts/build-moodle.mjs — copia literal, no editar a mano. Fuente: public/editor.js */
/*
 * Editor superpuesto con dos modos, conmutables sin cerrar el lienzo:
 *
 *  - «Pedir cambios a la IA»: señalar un elemento y pedirle el cambio a
 *    Claude (POST /api/jobs/:id/iterate). Comportamiento original.
 *  - «Editar textos»: señalar un nodo de texto y reescribirlo a mano, sin
 *    ninguna llamada a Claude (POST /api/jobs/:id/text-edit). Gratis e
 *    instantáneo para erratas o cambios de dato.
 *
 * El HTML de la pasada se sirve desde el mismo origen, así que se carga en un
 * <iframe sandbox="allow-same-origin"> (sin allow-scripts: el documento no
 * ejecuta JS) y esta página resalta y edita sus elementos leyendo y
 * escribiendo directamente su DOM.
 *
 * Los clics se recogen en la capa `#ed-hit` del documento padre, no dentro
 * del iframe: en WebKit un documento con `sandbox` sin `allow-scripts` no
 * despacha eventos DOM a los listeners que ponga el padre (en Chromium sí),
 * y el editor se quedaba mudo. `elementFromPoint`/`caretRangeFromPoint` sí
 * funcionan en ambos, así que el elemento o el nodo de texto se resuelve por
 * coordenadas. Por lo mismo, el modo texto tampoco escribe nada dentro del
 * iframe con el teclado: se teclea en la tarjeta del documento padre y el
 * valor se asigna al `nodeValue` del nodo desde fuera.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
  const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

  /* ───────────── estado ───────────── */
  let job = null;        // { id, width, height }
  let passN = null;      // pasada que se está mostrando
  let doc = null;        // documento del iframe
  let win = null;
  let mode = 'prompt';   // 'prompt' | 'text'
  let selected = null;   // elemento señalado (modo prompt)
  let selector = null;   // selector del elemento señalado (para reencontrarlo)
  let textNodes = [];    // nodos de texto descubiertos en la pasada actual (modo texto)
  let selectedText = null; // registro de textNodes abierto en la tarjeta
  let hoveredText = null;
  let lastTextIndex = -1; // último índice visitado, para que Tab siga por donde iba tras un «Hecho»
  let openValue = '';    // valor del texto seleccionado al abrir su tarjeta (para Esc/⌘Z)
  let undoStack = [];    // [{ record, previousValue }] — ⌘Z del modo texto
  let highlightAll = false;
  let scale = 1;
  let fitMode = true;
  let busy = false;      // hay una petición en curso (a Claude o de guardado de textos)
  let passCount = 0;     // nº de pasadas conocidas del job
  let waitingFor = null; // nº de pasadas al enviar la petición: al superarlo, listo
  let busySince = 0;
  let readyTimer = null; // sondeo del documento del iframe
  let pollTimer = null;  // sondeo del job mientras se procesa la petición

  const ui = {};
  function cacheUi() {
    Object.assign(ui, {
      root: $('editor'),
      pass: $('ed-pass'),
      error: $('ed-error'),
      canvas: $('ed-canvas'),
      sizer: $('ed-sizer'),
      stage: $('ed-stage'),
      frame: $('ed-frame'),
      hit: $('ed-hit'),
      hover: $('ed-hover'),
      sel: $('ed-sel'),
      selLabel: $('ed-sel-label'),
      zoomLabel: $('ed-zoom-label'),
      global: $('ed-global'),
      modePromptBtn: $('ed-mode-prompt'),
      modeTextBtn: $('ed-mode-text'),
      textHighlight: $('ed-text-highlight'),
      textCounter: $('ed-text-counter'),
      textDiscard: $('ed-text-discard'),
      textSave: $('ed-text-save'),
      textAll: $('ed-text-all'),
      textEdited: $('ed-text-edited'),
      textHover: $('ed-text-hover'),
      textSel: $('ed-text-sel'),
      footPrompt: $('ed-foot-prompt'),
      footText: $('ed-foot-text'),
      prompt: $('ed-prompt'),
      promptTarget: $('ed-prompt-target'),
      modePromptBody: $('ed-mode-prompt-body'),
      modeTextBody: $('ed-mode-text-body'),
      promptContext: $('ed-prompt-context'),
      promptInput: $('ed-prompt-input'),
      promptSend: $('ed-prompt-send'),
      promptParent: $('ed-prompt-parent'),
      promptStatus: $('ed-prompt-status'),
      textOriginal: $('ed-text-original'),
      textValue: $('ed-text-value'),
      textRestore: $('ed-text-restore'),
      textDone: $('ed-text-done'),
    });
  }

  /* ───────────── apertura y cierre ───────────── */
  function open(options) {
    cacheUi();
    job = { id: options.jobId, width: options.width, height: options.height };
    passN = options.pass;
    selected = null;
    selector = null;
    textNodes = [];
    selectedText = null;
    hoveredText = null;
    lastTextIndex = -1;
    undoStack = [];
    highlightAll = false;
    busy = false;
    passCount = options.passCount ?? 0;
    waitingFor = null;
    fitMode = true;

    ui.root.hidden = false;
    delete ui.root.dataset.ready;
    document.body.style.overflow = 'hidden';
    showNotice(null);
    hidePrompt();
    mode = null; // fuerza a setMode() a aplicar todo el estado visual, aunque coincida con la sesión anterior
    setMode(options.mode === 'text' ? 'text' : 'prompt');
    loadPass(passN);
  }

  function close() {
    detach();
    clearInterval(readyTimer);
    readyTimer = null;
    stopPolling();
    delete ui.root.dataset.ready;
    ui.root.classList.remove('is-loading', 'is-busy');
    ui.frame.removeEventListener('load', onFrameSettled);
    ui.frame.src = 'about:blank';
    ui.root.hidden = true;
    document.body.style.overflow = '';
    hidePrompt();
    doc = null;
    win = null;
    selected = null;
    selectedText = null;
    hoveredText = null;
    lastTextIndex = -1;
    textNodes = [];
    undoStack = [];
    job = null;
  }

  function isOpen() {
    return ui.root && !ui.root.hidden;
  }

  /**
   * Aviso en la barra superior. Vive fuera de la ventanita de prompt: cuando
   * se aplica un cambio, el lienzo se recarga y la ventanita se reinicia,
   * pero el resultado debe seguir a la vista.
   */
  function showNotice(message, kind) {
    ui.error.hidden = !message;
    ui.error.className = kind === 'ok' ? 'ed-error is-ok' : 'ed-error error';
    if (message) ui.error.textContent = message;
  }

  /* ───────────── conmutador de modo ───────────── */
  function setMode(next) {
    if (mode === next) return;
    if (mode === 'text' && selectedText) finishTextEdit();
    if (mode === 'prompt' && selected) clearSelection();
    mode = next;
    ui.modePromptBtn.classList.toggle('is-active', mode === 'prompt');
    ui.modePromptBtn.setAttribute('aria-selected', String(mode === 'prompt'));
    ui.modeTextBtn.classList.toggle('is-active', mode === 'text');
    ui.modeTextBtn.setAttribute('aria-selected', String(mode === 'text'));
    ui.global.hidden = mode !== 'prompt';
    ui.textHighlight.hidden = mode !== 'text';
    ui.footPrompt.hidden = mode !== 'prompt';
    ui.footText.hidden = mode !== 'text';
    ui.hover.hidden = true;
    hoveredText = null;
    hidePrompt();
    updateTextCounter();
    syncTextOverlays();
  }

  function loadPass(n) {
    detach();
    clearInterval(readyTimer);
    passN = n;
    doc = null;
    win = null;
    delete ui.root.dataset.ready;
    ui.root.classList.add('is-loading');
    ui.pass.textContent = `Pasada ${n} · cargando el lienzo…`;
    ui.frame.removeEventListener('load', onFrameSettled);
    ui.frame.addEventListener('load', onFrameSettled);
    const src = window.fileUrl(`/api/jobs/${job.id}/result?pass=${n}`);
    ui.frame.src = src;
    watchForDocument(new URL(src, location.href).href);
  }

  /**
   * El evento `load` del iframe espera a TODOS los recursos, incluidas las
   * Google Fonts del documento generado: con la red lenta son segundos en los
   * que el lienzo ya se ve pero no responde al clic. Se engancha en cuanto el
   * DOM existe y se reajusta después, cuando `load` confirme las métricas.
   */
  function watchForDocument(expectedUrl) {
    let tries = 0;
    readyTimer = setInterval(() => {
      tries++;
      let candidate = null;
      try {
        candidate = ui.frame.contentDocument;
      } catch {
        candidate = null;
      }
      if (candidate && candidate.body && candidate.URL === expectedUrl) {
        clearInterval(readyTimer);
        readyTimer = null;
        useDocument(candidate);
      } else if (tries >= 300) {
        clearInterval(readyTimer);
        readyTimer = null;
        ui.root.classList.remove('is-loading');
        showNotice(
          'El lienzo no acaba de cargar. Cierra el editor y vuelve a abrirlo; si se repite, recarga la página.',
          'error',
        );
      }
    }, 50);
  }

  function useDocument(candidate) {
    // Si la pasada no se pudo entregar, el iframe muestra el JSON del error.
    if ((candidate.contentType || '').includes('json')) {
      ui.root.classList.remove('is-loading');
      showNotice(
        `El servidor no pudo entregar el HTML de la pasada ${passN}: ${candidate.body.textContent.slice(0, 200)}`,
        'error',
      );
      return;
    }
    doc = candidate;
    win = ui.frame.contentWindow;
    attach();
    collectTextNodes();
    selectedText = null;
    hoveredText = null;
    lastTextIndex = -1;
    undoStack = [];
    layout();
    ui.root.classList.remove('is-loading');
    ui.root.dataset.ready = '1';
    ui.pass.textContent = `Pasada ${passN} · lienzo ${job.width}×${job.height}`;
    // Tras un cambio aplicado, se vuelve a señalar el mismo elemento si sigue ahí.
    if (mode === 'prompt' && selector) {
      const again = doc.querySelector(selector);
      if (again) select(again);
      else clearSelection();
    }
    updateTextCounter();
  }

  /** `load`: ya están todos los recursos; las fuentes pueden mover las medidas. */
  function onFrameSettled() {
    const candidate = ui.frame.contentDocument;
    if (!candidate || !candidate.body) {
      showNotice('No se pudo abrir el HTML de la pasada.', 'error');
      return;
    }
    if (candidate !== doc) useDocument(candidate);
    else {
      layout();
      refreshOverlays();
    }
  }

  function refreshOverlays() {
    syncOverlays();
    syncTextOverlays();
  }

  /* ───────────── señalar sobre el lienzo ───────────── */
  /*
   * Los clics se recogen en la capa `#ed-hit` del documento padre, no dentro
   * del iframe: en WebKit un documento con `sandbox` sin `allow-scripts` no
   * despacha eventos DOM a los listeners que ponga el padre (en Chromium sí),
   * y el editor se quedaba mudo. `elementFromPoint` sí funciona en ambos, así
   * que el elemento se resuelve por coordenadas.
   */
  function attach() {
    ui.hit.addEventListener('mousemove', onHitMove);
    ui.hit.addEventListener('mouseleave', onHitLeave);
    ui.hit.addEventListener('click', onHitClick);
  }

  function detach() {
    ui.hit.removeEventListener('mousemove', onHitMove);
    ui.hit.removeEventListener('mouseleave', onHitLeave);
    ui.hit.removeEventListener('click', onHitClick);
  }

  /** Convierte coordenadas de pantalla a coordenadas nativas del documento del iframe. */
  function toDocPoint(event) {
    const rect = ui.hit.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  }

  /** Elemento señalable bajo el puntero (nunca <html> ni <body>). */
  function elementAt(event) {
    if (!doc) return null;
    const { x, y } = toDocPoint(event);
    let el = doc.elementFromPoint(x, y);
    while (el && el.nodeType !== 1) el = el.parentNode;
    if (!el || el === doc.documentElement || el === doc.body) return null;
    return el;
  }

  // Señalar sigue funcionando mientras se procesa una petición (solo se
  // bloquea el envío): así el editor nunca parece muerto por estar esperando.
  function onHitMove(e) {
    if (mode === 'text') {
      hoveredText = textNodeAt(e);
      syncTextOverlays();
      return;
    }
    const el = elementAt(e);
    if (!el || el === selected) {
      ui.hover.hidden = true;
      return;
    }
    drawBox(el, ui.hover);
  }

  function onHitLeave() {
    ui.hover.hidden = true;
    if (mode === 'text' && hoveredText) {
      hoveredText = null;
      syncTextOverlays();
    }
  }

  function onHitClick(e) {
    e.preventDefault();
    if (mode === 'text') {
      const rec = textNodeAt(e);
      if (rec) selectText(rec);
      return;
    }
    const el = elementAt(e);
    if (!el) {
      clearSelection();
      return;
    }
    select(el);
  }

  /* ───────────── selección (modo prompt) ───────────── */
  function select(el) {
    selected = el;
    selector = cssPath(el);
    ui.hover.hidden = true;
    syncOverlays();
    showPrompt();
  }

  function clearSelection() {
    selected = null;
    selector = null;
    ui.sel.hidden = true;
    hidePrompt();
  }

  function drawBox(el, target) {
    const rect = el.getBoundingClientRect();
    target.hidden = false;
    target.style.left = `${rect.left + win.scrollX}px`;
    target.style.top = `${rect.top + win.scrollY}px`;
    target.style.width = `${rect.width}px`;
    target.style.height = `${rect.height}px`;
    target.style.borderWidth = `${Math.max(1, 1 / scale)}px`;
  }

  function syncOverlays() {
    if (!doc) return;
    ui.hover.hidden = true;
    if (mode !== 'prompt' || !selected || !selected.isConnected) {
      ui.sel.hidden = true;
      return;
    }
    drawBox(selected, ui.sel);
    ui.selLabel.textContent = labelOf(selected);
    ui.selLabel.style.fontSize = `${Math.max(9, Math.round(11 / scale))}px`;
    if (mode === 'prompt' && !ui.prompt.hidden) placePrompt();
  }

  function labelOf(el) {
    const layer = el.getAttribute('data-layer') || el.getAttribute('data-replace');
    if (layer) return `${el.localName} · ${layer}`;
    if (el.id) return `${el.localName}#${el.id}`;
    const cls = el.getAttribute('class');
    if (cls && cls.trim()) return `${el.localName}.${cls.trim().split(/\s+/)[0]}`;
    return el.localName;
  }

  /**
   * Texto del elemento tal como se lee en pantalla: `innerText` respeta los
   * saltos de línea del render (con textContent, un título partido en dos
   * líneas se leería «5STRATEGIES»). En SVG no existe, se cae a textContent.
   */
  function readableText(el) {
    const raw = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    return (raw || '').trim().replace(/\s+/g, ' ');
  }

  /** Selector CSS estable-ish hasta el elemento, para reencontrarlo tras un cambio. */
  function cssPath(el) {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== doc.body; node = node.parentElement) {
      if (node.id) {
        parts.unshift(`${node.localName}#${cssEscape(node.id)}`);
        break;
      }
      let part = node.localName;
      const layer = node.getAttribute('data-layer');
      if (layer) {
        part += `[data-layer="${layer}"]`;
      } else {
        const cls = (node.getAttribute('class') || '').trim().split(/\s+/)[0];
        if (cls) part += `.${cssEscape(cls)}`;
        const twins = node.parentElement
          ? [...node.parentElement.children].filter((c) => c.localName === node.localName)
          : [];
        if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  function cssEscape(value) {
    return value.replace(/([^\w-])/g, '\\$1');
  }

  /* ───────────── modo texto: descubrir y editar nodos de texto ───────────── */

  /** Etiquetas cuyo texto no es contenido visible de la infografía. */
  const TEXT_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TITLE', 'NOSCRIPT', 'TEMPLATE']);

  /**
   * Recorre el documento una vez por pasada y guarda cada nodo de texto no
   * vacío con su elemento contenedor, su índice entre los `childNodes` de
   * ese elemento y el valor «original» (el que trae la pasada, antes de
   * cualquier edición): es lo que viaja como `before` al guardar.
   */
  function collectTextNodes() {
    textNodes = [];
    if (!doc) return;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || TEXT_SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.trim() === '' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      textNodes.push({
        node,
        el: parent,
        nodeIndex: Array.prototype.indexOf.call(parent.childNodes, node),
        selector: cssPath(parent),
        before: node.nodeValue,
      });
      node = walker.nextNode();
    }
  }

  /** Una caja por línea: un texto partido por el reflow tiene varios rects. */
  function textRects(node) {
    if (!doc || !node.isConnected) return [];
    const range = doc.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()];
  }

  /** Nodo de texto bajo el puntero: acierto exacto por caret, o por caja si falla. */
  function textNodeAt(event) {
    if (!doc) return null;
    const { x, y } = toDocPoint(event);

    let hit = null;
    if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(x, y);
      if (range && range.startContainer.nodeType === 3) hit = range.startContainer;
    } else if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode.nodeType === 3) hit = pos.offsetNode;
    }
    if (hit) {
      const rec = textNodes.find((r) => r.node === hit);
      if (rec) return rec;
    }

    // Sin acierto exacto (el punto cayó entre líneas, o el navegador no
    // soporta ninguna de las dos APIs de caret): se prueba caja a caja.
    for (const rec of textNodes) {
      for (const box of textRects(rec.node)) {
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return rec;
      }
    }
    return null;
  }

  /** Cuántos textos hermanos (mismo elemento contenedor) hay antes de éste, para «fragmento X de Y». */
  function textFragmentLabel(rec) {
    const siblings = textNodes.filter((r) => r.el === rec.el);
    if (siblings.length <= 1) return labelOf(rec.el);
    return `${labelOf(rec.el)} · fragmento ${siblings.indexOf(rec) + 1} de ${siblings.length}`;
  }

  function countDirtyTexts() {
    let n = 0;
    for (const rec of textNodes) if (rec.node.nodeValue !== rec.before) n++;
    return n;
  }

  function collectPendingEdits() {
    return textNodes
      .filter((rec) => rec.node.nodeValue !== rec.before)
      .map((rec) => ({
        selector: rec.selector,
        nodeIndex: rec.nodeIndex,
        before: rec.before,
        after: rec.node.nodeValue,
      }));
  }

  function selectText(rec) {
    if (selectedText && selectedText !== rec) finishTextEdit();
    selectedText = rec;
    lastTextIndex = textNodes.indexOf(rec);
    openValue = rec.node.nodeValue;
    hoveredText = null;
    showTextCard(rec);
    syncTextOverlays();
  }

  /** Cierra la tarjeta conservando el cambio (si lo hay) y lo apunta en la pila de deshacer. */
  function finishTextEdit() {
    if (selectedText && selectedText.node.nodeValue !== openValue) {
      undoStack.push({ record: selectedText, previousValue: openValue });
    }
    selectedText = null;
    hidePrompt();
    syncTextOverlays();
    updateTextCounter();
  }

  /** Esc sobre una tarjeta abierta: deshace solo lo tecleado en esta sesión de edición. */
  function cancelTextEdit() {
    if (!selectedText) return;
    selectedText.node.nodeValue = openValue;
    selectedText = null;
    hidePrompt();
    syncTextOverlays();
    updateTextCounter();
  }

  function undoLastTextEdit() {
    const entry = undoStack.pop();
    if (!entry) return;
    entry.record.node.nodeValue = entry.previousValue;
    if (selectedText === entry.record) {
      openValue = entry.previousValue;
      ui.textValue.value = entry.previousValue;
    }
    syncTextOverlays();
    updateTextCounter();
  }

  function discardTextEdits() {
    if (busy) return;
    for (const rec of textNodes) rec.node.nodeValue = rec.before;
    undoStack = [];
    selectedText = null;
    hidePrompt();
    syncTextOverlays();
    updateTextCounter();
    showNotice(null);
  }

  async function saveTextEdits() {
    if (busy || !job) return;
    if (selectedText) finishTextEdit();
    const edits = collectPendingEdits();
    if (edits.length === 0) return;
    waitingFor = passCount;
    setBusy(true, `Guardando ${edits.length} texto${edits.length === 1 ? '' : 's'}…`);
    showNotice(null);
    try {
      // `html` viaja además de `edits`: el motor (con DOM vía Playwright) sigue
      // usando `edits`; el plugin de Moodle (sin DOM en PHP) no puede aplicar
      // una lista de cambios y usa el documento ya serializado tal cual.
      const html = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
      const res = await window.apiFetch(`/api/jobs/${job.id}/text-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePass: passN, edits, html }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      startPolling();
    } catch (err) {
      waitingFor = null;
      setBusy(false);
      showNotice(`No se pudieron guardar los cambios: ${err.message}`, 'error');
    }
  }

  /* ───────────── overlays del modo texto ───────────── */
  function renderBoxes(container, rects, extraClass) {
    container.innerHTML = '';
    if (!win || rects.length === 0) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    const borderWidth = Math.max(1, 1 / scale);
    for (const rect of rects) {
      const box = document.createElement('span');
      box.className = `ed-box ${extraClass}`;
      box.style.left = `${rect.left + win.scrollX}px`;
      box.style.top = `${rect.top + win.scrollY}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      box.style.borderWidth = `${borderWidth}px`;
      container.appendChild(box);
    }
  }

  function syncTextOverlays() {
    if (!doc || mode !== 'text') {
      ui.textAll.hidden = true;
      ui.textEdited.hidden = true;
      ui.textHover.hidden = true;
      ui.textSel.hidden = true;
      return;
    }
    renderBoxes(ui.textAll, highlightAll ? textNodes.flatMap((r) => textRects(r.node)) : [], 'ed-box-all');
    const edited = textNodes.filter((r) => r !== selectedText && r.node.nodeValue !== r.before);
    renderBoxes(ui.textEdited, edited.flatMap((r) => textRects(r.node)), 'ed-box-edited');
    renderBoxes(ui.textHover, hoveredText && hoveredText !== selectedText ? textRects(hoveredText.node) : [], 'ed-box-hover');
    renderBoxes(ui.textSel, selectedText ? textRects(selectedText.node) : [], 'ed-box-sel');
    if (!ui.prompt.hidden) placePrompt();
  }

  /* ───────────── ventanita de prompt / tarjeta de texto ───────────── */
  function showPrompt() {
    ui.modeTextBody.hidden = true;
    ui.modePromptBody.hidden = false;
    ui.prompt.hidden = false;
    if (!busy) ui.promptStatus.hidden = true; // no se pisa el «trabajando…»
    ui.promptTarget.textContent = selected ? labelOf(selected) : 'toda la infografía';
    ui.promptParent.hidden = !selected || !selected.parentElement || selected.parentElement === doc.body;

    const text = selected ? readableText(selected) : '';
    ui.promptContext.hidden = text === '';
    if (text) ui.promptContext.textContent = `«${clip(text, 140)}»`;

    placePrompt();
    ui.promptInput.focus();
  }

  function showTextCard(rec) {
    ui.modePromptBody.hidden = true;
    ui.modeTextBody.hidden = false;
    ui.prompt.hidden = false;
    if (!busy) ui.promptStatus.hidden = true;
    ui.promptTarget.textContent = textFragmentLabel(rec);
    ui.textOriginal.textContent = `«${clip(rec.before, 140)}»`;
    ui.textValue.value = rec.node.nodeValue;
    ui.textValue.disabled = busy;
    ui.textDone.disabled = busy;
    ui.textRestore.disabled = busy || rec.node.nodeValue === rec.before;
    placePrompt();
    ui.textValue.focus();
    ui.textValue.select();
  }

  // El texto escrito no se borra al cerrar la ventanita: solo al aplicarse el
  // cambio. Así un clic fuera no tira por tierra una petición a medio escribir.
  function hidePrompt() {
    if (!ui.prompt) return;
    ui.prompt.hidden = true;
  }

  function anchorRect() {
    if (!doc || !win) return null;
    if (mode === 'text') {
      if (!selectedText) return null;
      return textRects(selectedText.node)[0] ?? null;
    }
    if (!selected || !selected.isConnected) return null;
    return selected.getBoundingClientRect();
  }

  /**
   * Coloca la ventanita FUERA del lienzo, en el margen que quede libre y a la
   * altura del elemento (o nodo de texto) señalado. Anclarla junto al
   * elemento parecía más natural, pero tapaba a sus vecinos (un titular tapa
   * su subtítulo) y el siguiente clic se lo comía la ventanita. Solo si no
   * hay margen a los lados se coloca encima del lienzo, en el hueco más
   * despejado.
   */
  function placePrompt() {
    const card = ui.prompt.getBoundingClientRect();
    const m = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const put = (x, y) => {
      ui.prompt.style.left = `${clamp(x, m, vw - card.width - m)}px`;
      ui.prompt.style.top = `${clamp(y, m, vh - card.height - m)}px`;
    };

    const rect = anchorRect();
    if (!rect) {
      put((vw - card.width) / 2, vh * 0.25);
      return;
    }

    const frameRect = ui.frame.getBoundingClientRect();
    const x = frameRect.left + (rect.left - win.scrollX) * scale;
    const y = frameRect.top + (rect.top - win.scrollY) * scale;
    const w = rect.width * scale;
    const h = rect.height * scale;

    // A la altura del elemento, centrada sobre él pero sin salirse.
    const alineada = clamp(y + h / 2 - card.height / 2, m, vh - card.height - m);

    if (frameRect.right + 10 + card.width <= vw - m) {
      put(frameRect.right + 10, alineada);      // margen derecho del lienzo
      return;
    }
    if (frameRect.left - 10 - card.width >= m) {
      put(frameRect.left - 10 - card.width, alineada); // margen izquierdo
      return;
    }

    // Sin margen: sobre el lienzo, en el lado con más sitio libre.
    const candidates = [
      [x, y + h + 10],
      [x, y - card.height - 10],
      [x + w + 10, y],
      [x - card.width - 10, y],
    ];
    for (const [cx, cy] of candidates) {
      if (cx >= m && cy >= m && cx + card.width <= vw - m && cy + card.height <= vh - m) {
        put(cx, cy);
        return;
      }
    }
    put(vw - card.width - m, vh - card.height - m);
  }

  /** Contexto del elemento que viaja con el prompt (modo IA). */
  function targetPayload() {
    if (!selected) return null;
    const html = selected.outerHTML || '';
    return {
      label: labelOf(selected),
      selector,
      html: html.length > 4000 ? `${html.slice(0, 4000)}\n<!-- …recortado -->` : html,
      text: readableText(selected).slice(0, 400) || undefined,
    };
  }

  async function submitPrompt() {
    const prompt = ui.promptInput.value.trim();
    if (!prompt || busy || !job) return;
    waitingFor = passCount;
    setBusy(true, 'Enviando la petición a Claude…');
    showNotice(null);
    try {
      const res = await window.apiFetch(`/api/jobs/${job.id}/iterate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, target: targetPayload() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      ui.promptInput.value = '';
      startPolling();
    } catch (err) {
      setBusy(false);
      showNotice(`No se pudo pedir el cambio: ${err.message}`, 'error');
    }
  }

  function updateTextCounter() {
    const n = countDirtyTexts();
    const inText = mode === 'text';
    ui.textCounter.hidden = !inText;
    ui.textCounter.textContent = n === 0 ? 'Sin cambios' : `${n} texto${n === 1 ? '' : 's'} cambiado${n === 1 ? '' : 's'}`;
    ui.textSave.hidden = !inText;
    ui.textDiscard.hidden = !inText;
    ui.textSave.disabled = busy || n === 0;
    ui.textDiscard.disabled = busy || n === 0;
  }

  function setBusy(value, message) {
    busy = value;
    if (value && busySince === 0) busySince = Date.now();
    if (!value) {
      busySince = 0;
      stopPolling();
    }
    ui.promptInput.disabled = value;
    ui.promptSend.disabled = value;
    ui.promptSend.textContent = value ? 'Aplicando…' : 'Pedir el cambio';
    ui.textValue.disabled = value;
    ui.textDone.disabled = value;
    ui.textRestore.disabled = value || !selectedText || selectedText.node.nodeValue === selectedText.before;
    ui.textHighlight.disabled = value;
    updateTextCounter();
    ui.root.classList.toggle('is-busy', value);
    if (message) {
      ui.promptStatus.hidden = false;
      ui.promptStatus.textContent = message;
    } else if (!value) {
      ui.promptStatus.hidden = true;
    }
  }

  /**
   * Sondeo de respaldo del estado del job. El progreso llega por SSE desde
   * app.js, pero esa conexión se cae (por ejemplo si se reinicia el servidor) y
   * sin ella el editor se quedaría esperando para siempre.
   */
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (!busy || !job) {
        stopPolling();
        return;
      }
      if (Date.now() - busySince > 8 * 60 * 1000) {
        setBusy(false);
        showNotice(
          'La petición está tardando demasiado. Mira el estado del job al cerrar el editor; ' +
            'si terminó, vuelve a abrirlo para ver el resultado.',
          'error',
        );
        return;
      }
      try {
        const res = await window.apiFetch(`/api/jobs/${job.id}`);
        if (res.ok) onJobUpdate(await res.json());
      } catch {
        // El sondeo es de respaldo: un fallo puntual de red se ignora.
      }
    }, 2500);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ───────────── zoom ───────────── */
  /** Ancho de la ventanita de prompt (ver .ed-prompt) más su separación. */
  const PROMPT_GUTTER = 362;

  function layout() {
    if (!doc) return;
    // Se reserva sitio a la derecha para la ventanita: al ajustar el lienzo
    // queda un margen donde colocarla sin taparlo.
    const reserve = window.innerWidth >= 760 ? PROMPT_GUTTER : 0;
    ui.canvas.style.paddingRight = `${24 + reserve}px`;
    const availW = ui.canvas.clientWidth - 48 - reserve;
    const availH = ui.canvas.clientHeight - 48;
    if (fitMode) scale = clamp(Math.min(availW / job.width, availH / job.height), 0.1, 1);
    ui.sizer.style.width = `${job.width * scale}px`;
    ui.sizer.style.height = `${job.height * scale}px`;
    ui.stage.style.width = `${job.width}px`;
    ui.stage.style.height = `${job.height}px`;
    ui.stage.style.transform = `scale(${scale})`;
    ui.frame.style.width = `${job.width}px`;
    ui.frame.style.height = `${job.height}px`;
    ui.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    refreshOverlays();
  }

  function zoomBy(factor) {
    fitMode = false;
    scale = clamp(scale * factor, 0.1, 3);
    layout();
  }

  /* ───────────── progreso del job (lo reenvía app.js) ───────────── */
  function onProgress(data) {
    if (!busy || mode !== 'prompt') return;
    setBusy(true, `Claude está reescribiendo el HTML… ${Number(data.chars).toLocaleString('es')} caracteres`);
  }

  function onJobUpdate(record) {
    if (!isOpen() || !job || record.id !== job.id) return;
    const count = record.passes.length;
    const applied = busy && waitingFor !== null && count > waitingFor;

    if (applied) {
      const pass = record.passes[count - 1];
      waitingFor = null;
      setBusy(false);
      if (pass.kind === 'manual') {
        const n = pass.edits ? pass.edits.length : 0;
        showNotice(
          `✓ ${n} texto${n === 1 ? '' : 's'} guardado${n === 1 ? '' : 's'} en la pasada ${pass.n} · sin coste de tokens`,
          'ok',
        );
      } else {
        showNotice(
          `✓ Cambio aplicado en la pasada ${pass.n}` +
            (pass.score != null ? ` · coincidencia con el original ${Number(pass.score).toFixed(1)}%` : '') +
            ' · puedes pedir otro cambio o cerrar el editor',
          'ok',
        );
      }
      loadPass(pass.n);
    } else if (busy && record.status === 'done' && record.error) {
      waitingFor = null;
      setBusy(false);
      showNotice(record.error, 'error');
    } else if (busy && record.status !== 'done') {
      if (mode === 'text') {
        setBusy(true, 'Guardando los cambios de texto…');
      } else {
        const label = {
          iterating: 'reescribiendo el HTML',
          generating: 'generando',
          rendering: 'renderizando el resultado',
          comparing: 'comparando con el original',
        };
        setBusy(true, `Claude está trabajando: ${label[record.status] || record.status}…`);
      }
    }
    passCount = count;
  }

  /* ───────────── teclado ───────────── */
  function stepText(direction) {
    if (textNodes.length === 0) return;
    // Sigue por donde iba aunque la tarjeta se cerrara con «Hecho»: sin
    // `lastTextIndex`, cada Tab tras cerrar la tarjeta reiniciaría siempre en
    // el primer texto del documento.
    const currentIdx = selectedText ? textNodes.indexOf(selectedText) : lastTextIndex;
    if (selectedText) finishTextEdit();
    const nextIdx = (currentIdx + direction + textNodes.length) % textNodes.length;
    selectText(textNodes[nextIdx]);
  }

  function onKeyDown(e) {
    if (!isOpen()) return;

    if (mode === 'text') {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoLastTextEdit();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        stepText(e.shiftKey ? -1 : 1);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && selectedText) {
        e.preventDefault();
        finishTextEdit();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (selectedText) cancelTextEdit();
        else close();
        return;
      }
      return;
    }

    const inPrompt = e.target && e.target.closest && e.target.closest('#ed-prompt');
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submitPrompt();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (inPrompt && selected) clearSelection();
      else if (!ui.prompt.hidden) hidePrompt();
      else close();
    }
  }

  /* ───────────── cableado ───────────── */
  function wire() {
    cacheUi();

    $('ed-close').addEventListener('click', close);
    $('ed-prompt-close').addEventListener('click', () => {
      if (mode === 'text') finishTextEdit();
      else clearSelection();
    });
    $('ed-zoom-in').addEventListener('click', () => zoomBy(1.25));
    $('ed-zoom-out').addEventListener('click', () => zoomBy(0.8));
    $('ed-zoom-fit').addEventListener('click', () => { fitMode = true; layout(); });

    ui.modePromptBtn.addEventListener('click', () => setMode('prompt'));
    ui.modeTextBtn.addEventListener('click', () => setMode('text'));

    ui.textHighlight.addEventListener('click', () => {
      highlightAll = !highlightAll;
      ui.textHighlight.classList.toggle('is-active', highlightAll);
      ui.textHighlight.textContent = highlightAll ? 'Ocultar resaltado' : 'Resaltar textos';
      syncTextOverlays();
    });
    ui.textSave.addEventListener('click', () => void saveTextEdits());
    ui.textDiscard.addEventListener('click', discardTextEdits);
    ui.textRestore.addEventListener('click', () => {
      if (!selectedText) return;
      selectedText.node.nodeValue = selectedText.before;
      ui.textValue.value = selectedText.before;
      ui.textRestore.disabled = true;
      syncTextOverlays();
      updateTextCounter();
    });
    ui.textDone.addEventListener('click', finishTextEdit);
    ui.textValue.addEventListener('input', () => {
      if (!selectedText) return;
      selectedText.node.nodeValue = ui.textValue.value;
      ui.textRestore.disabled = selectedText.node.nodeValue === selectedText.before;
      syncTextOverlays();
      updateTextCounter();
    });

    ui.global.addEventListener('click', () => {
      selected = null;
      selector = null;
      ui.sel.hidden = true;
      showPrompt();
    });

    ui.promptParent.addEventListener('click', () => {
      if (selected && selected.parentElement && selected.parentElement !== doc.body) {
        select(selected.parentElement);
      }
    });

    $('ed-prompt-form').addEventListener('submit', (e) => {
      e.preventDefault();
      void submitPrompt();
    });

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', () => { if (isOpen()) layout(); });
    // La ventanita es fixed: al desplazar el lienzo hay que recolocarla.
    ui.canvas.addEventListener('scroll', () => {
      if (isOpen() && !ui.prompt.hidden) placePrompt();
    });
  }

  wire();
  window.VisualEditor = { open, close, isOpen, onJobUpdate, onProgress };
})();
