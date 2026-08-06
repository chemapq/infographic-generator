/*
 * Editor por prompt: señalar un elemento y pedirle el cambio a Claude.
 *
 * El HTML de la pasada se sirve desde el mismo origen, así que se carga en un
 * <iframe sandbox="allow-same-origin"> (sin allow-scripts: el documento no
 * ejecuta JS) y esta página resalta y selecciona sus elementos leyendo su DOM.
 * Del elemento señalado se extrae su contexto (etiqueta, selector, markup y
 * texto) y se envía junto al prompt a POST /api/jobs/:id/iterate, que produce
 * una pasada más del job. Nada se edita en el navegador: los cambios los hace
 * Claude sobre el HTML.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  /* ───────────── estado ───────────── */
  let job = null;        // { id, width, height }
  let passN = null;      // pasada que se está mostrando
  let doc = null;        // documento del iframe
  let win = null;
  let selected = null;
  let selector = null;   // selector del elemento señalado (para reencontrarlo)
  let scale = 1;
  let fitMode = true;
  let busy = false;      // hay una petición en curso con Claude
  let passCount = 0;     // nº de pasadas conocidas del job
  let waitingFor = null; // nº de pasadas al enviar la petición: al superarlo, listo
  let busySince = 0;
  let readyTimer = null; // sondeo del documento del iframe
  let pollTimer = null;  // sondeo del job mientras Claude trabaja

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
      prompt: $('ed-prompt'),
      promptTarget: $('ed-prompt-target'),
      promptContext: $('ed-prompt-context'),
      promptInput: $('ed-prompt-input'),
      promptSend: $('ed-prompt-send'),
      promptParent: $('ed-prompt-parent'),
      promptStatus: $('ed-prompt-status'),
    });
  }

  /* ───────────── apertura y cierre ───────────── */
  function open(options) {
    cacheUi();
    job = { id: options.jobId, width: options.width, height: options.height };
    passN = options.pass;
    selected = null;
    selector = null;
    busy = false;
    passCount = options.passCount ?? 0;
    waitingFor = null;
    fitMode = true;

    ui.root.hidden = false;
    delete ui.root.dataset.ready;
    document.body.style.overflow = 'hidden';
    showNotice(null);
    hidePrompt();
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
    job = null;
  }

  function isOpen() {
    return ui.root && !ui.root.hidden;
  }

  /**
   * Aviso en la barra superior. Vive fuera de la ventanita de prompt: cuando
   * Claude aplica un cambio, el lienzo se recarga y la ventanita se reinicia,
   * pero el resultado debe seguir a la vista.
   */
  function showNotice(message, kind) {
    ui.error.hidden = !message;
    ui.error.className = kind === 'ok' ? 'ed-error is-ok' : 'ed-error error';
    if (message) ui.error.textContent = message;
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
    const src = `/api/jobs/${job.id}/result?pass=${n}`;
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
    layout();
    ui.root.classList.remove('is-loading');
    ui.root.dataset.ready = '1';
    ui.pass.textContent = `Pasada ${passN} · lienzo ${job.width}×${job.height}`;
    // Tras un cambio aplicado, se vuelve a señalar el mismo elemento si sigue ahí.
    if (selector) {
      const again = doc.querySelector(selector);
      if (again) select(again);
      else clearSelection();
    }
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
      syncOverlays();
    }
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

  /** Elemento señalable bajo el puntero (nunca <html> ni <body>). */
  function elementAt(event) {
    if (!doc) return null;
    const rect = ui.hit.getBoundingClientRect();
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    let el = doc.elementFromPoint(x, y);
    while (el && el.nodeType !== 1) el = el.parentNode;
    if (!el || el === doc.documentElement || el === doc.body) return null;
    return el;
  }

  // Señalar sigue funcionando mientras Claude trabaja (solo se bloquea el envío):
  // así el editor nunca parece muerto por estar esperando.
  function onHitMove(e) {
    const el = elementAt(e);
    if (!el || el === selected) {
      ui.hover.hidden = true;
      return;
    }
    drawBox(el, ui.hover);
  }

  function onHitLeave() {
    ui.hover.hidden = true;
  }

  function onHitClick(e) {
    e.preventDefault();
    const el = elementAt(e);
    if (!el) {
      clearSelection();
      return;
    }
    select(el);
  }

  /* ───────────── selección ───────────── */
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
    if (!selected || !selected.isConnected) {
      ui.sel.hidden = true;
      return;
    }
    drawBox(selected, ui.sel);
    ui.selLabel.textContent = labelOf(selected);
    ui.selLabel.style.fontSize = `${Math.max(9, Math.round(11 / scale))}px`;
    if (!ui.prompt.hidden) placePrompt();
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

  /* ───────────── ventanita de prompt ───────────── */
  function showPrompt() {
    ui.prompt.hidden = false;
    if (!busy) ui.promptStatus.hidden = true; // no se pisa el «Claude está trabajando…»
    ui.promptTarget.textContent = selected ? labelOf(selected) : 'toda la infografía';
    ui.promptParent.hidden = !selected || !selected.parentElement || selected.parentElement === doc.body;

    const text = selected ? readableText(selected) : '';
    ui.promptContext.hidden = text === '';
    if (text) ui.promptContext.textContent = `«${text.slice(0, 140)}${text.length > 140 ? '…' : ''}»`;

    placePrompt();
    ui.promptInput.focus();
  }

  // El texto escrito no se borra al cerrar la ventanita: solo al aplicarse el
  // cambio. Así un clic fuera no tira por tierra una petición a medio escribir.
  function hidePrompt() {
    if (!ui.prompt) return;
    ui.prompt.hidden = true;
  }

  /**
   * Coloca la ventanita FUERA del lienzo, en el margen que quede libre y a la
   * altura del elemento señalado. Anclarla junto al elemento parecía más
   * natural, pero tapaba a sus vecinos (un titular tapa su subtítulo) y el
   * siguiente clic se lo comía la ventanita. Solo si no hay margen a los lados
   * se coloca encima del lienzo, en el hueco más despejado.
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

    if (!selected || !selected.isConnected || !doc) {
      put((vw - card.width) / 2, vh * 0.25);
      return;
    }

    const frameRect = ui.frame.getBoundingClientRect();
    const rect = selected.getBoundingClientRect();
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

  /** Contexto del elemento que viaja con el prompt. */
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
      const res = await fetch(`/api/jobs/${job.id}/iterate`, {
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
        const res = await fetch(`/api/jobs/${job.id}`);
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
    syncOverlays();
  }

  function zoomBy(factor) {
    fitMode = false;
    scale = clamp(scale * factor, 0.1, 3);
    layout();
  }

  /* ───────────── progreso del job (lo reenvía app.js) ───────────── */
  function onProgress(data) {
    if (!busy) return;
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
      showNotice(
        `✓ Cambio aplicado en la pasada ${pass.n}` +
          (pass.score != null ? ` · coincidencia con el original ${Number(pass.score).toFixed(1)}%` : '') +
          ' · puedes pedir otro cambio o cerrar el editor',
        'ok',
      );
      loadPass(pass.n);
    } else if (busy && record.status === 'done' && record.error) {
      waitingFor = null;
      setBusy(false);
      showNotice(record.error, 'error');
    } else if (busy && record.status !== 'done') {
      const label = {
        iterating: 'reescribiendo el HTML',
        generating: 'generando',
        rendering: 'renderizando el resultado',
        comparing: 'comparando con el original',
      };
      setBusy(true, `Claude está trabajando: ${label[record.status] || record.status}…`);
    }
    passCount = count;
  }

  /* ───────────── teclado ───────────── */
  function onKeyDown(e) {
    if (!isOpen()) return;
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
    $('ed-prompt-close').addEventListener('click', clearSelection);
    $('ed-zoom-in').addEventListener('click', () => zoomBy(1.25));
    $('ed-zoom-out').addEventListener('click', () => zoomBy(0.8));
    $('ed-zoom-fit').addEventListener('click', () => { fitMode = true; layout(); });

    $('ed-global').addEventListener('click', () => {
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
