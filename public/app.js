/* Infographic Generator — UI (vanilla JS, sin build) */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const viewUpload = $('view-upload');
  const viewJob = $('view-job');
  const viewGallery = $('view-gallery');

  const esc = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);

  const STATUS_LABEL = {
    queued: 'en cola',
    analyzing: 'analizando',
    generating: 'generando HTML',
    rendering: 'renderizando',
    comparing: 'comparando',
    refining: 'refinando',
    iterating: 'aplicando ajustes',
    done: 'terminado',
    failed: 'fallido',
  };

  /* ───────────── enrutado por hash ───────────── */
  let eventSource = null;
  let statusPollTimer = null;
  let currentJobId = null;

  function stopStatusPolling() {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }

  function route() {
    const jobMatch = location.hash.match(/^#\/job\/([\w-]+)/);
    if (jobMatch) {
      showJob(jobMatch[1]);
      return;
    }
    if (eventSource) { eventSource.close(); eventSource = null; }
    stopStatusPolling();
    currentJobId = null;
    viewJob.hidden = true;
    if (location.hash === '#/gallery') {
      viewUpload.hidden = true;
      viewGallery.hidden = false;
      loadGallery(true);
    } else {
      viewGallery.hidden = true;
      viewUpload.hidden = false;
      loadRecentStrip();
    }
  }
  window.addEventListener('hashchange', route);

  /* ───────────── vista 1: subida ───────────── */
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  const preview = $('drop-preview');
  const btnGenerate = $('btn-generate');
  let selectedFile = null;

  /** Muestra un error de subida con su detalle técnico plegado, si lo hay. */
  function showUploadError(message, detail) {
    const box = $('upload-error');
    box.hidden = !message;
    if (!message) return;
    box.innerHTML =
      `<span>${esc(message)}</span>` +
      (detail
        ? `<details class="detail"><summary>Detalle técnico</summary><code>${esc(detail)}</code></details>`
        : '');
  }

  function setFile(file) {
    if (!file) return;
    // Aviso en el momento, sin gastar una subida: el formato de las fotos de
    // iPhone no se puede decodificar aquí.
    if (/\.(heic|heif)$/i.test(file.name) || /^image\/(heic|heif)/i.test(file.type)) {
      showUploadError(
        `«${file.name}» está en formato HEIC/HEIF, el de las fotos del iPhone, y no se puede leer. ` +
          'Conviértela a PNG o JPEG (en el Mac: Vista Previa → Archivo → Exportar) y vuelve a arrastrarla.',
      );
      return;
    }
    if (file.type && !file.type.startsWith('image/')) {
      showUploadError(
        `«${file.name}» no parece una imagen (${file.type}). Se admiten PNG, JPEG, WebP y GIF.`,
      );
      return;
    }
    showUploadError(null);
    selectedFile = file;
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    dropzone.querySelector('.dropzone-idle').hidden = true;
    btnGenerate.disabled = false;
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => setFile(fileInput.files[0]));

  /*
   * El arrastre se escucha en TODA la ventana, no solo en el recuadro.
   *
   * El objetivo del arrastre lo elige el navegador en el `dragenter`: si nadie
   * lo cancela ahí, el objetivo pasa a ser el `<body>` y no el elemento bajo
   * el puntero. Antes solo se cancelaba `dragover` sobre el recuadro, que en
   * una página normal basta, pero dentro del iframe el recuadro es un objetivo
   * pequeño en medio de una ventana ajena: el puntero entra por el borde del
   * marco, sobre el `<body>`, y la primera decisión —«este documento no acepta
   * arrastres»— se toma ahí. Aceptando desde el primer píxel del marco no hay
   * decisión que corregir después, y de paso se puede soltar en cualquier
   * parte de la app y no solo dentro del recuadro.
   *
   * Cancelar además el `drop` en toda la ventana es la red de seguridad: sin
   * eso, una imagen soltada fuera del recuadro hace que el navegador la abra
   * y sustituya la app, que dentro del iframe se ve como si Moodle se hubiera
   * roto.
   */
  const dragHasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  // `dragenter` y `dragleave` saltan también al pasar de un elemento a otro
  // dentro de la propia página; con un contador el resaltado no parpadea.
  let dragDepth = 0;
  function paintDragging(depth) {
    dragDepth = Math.max(0, depth);
    dropzone.classList.toggle('dragover', dragDepth > 0);
  }

  window.addEventListener('dragenter', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    paintDragging(dragDepth + 1);
  });
  window.addEventListener('dragover', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    // Sin esto el navegador puede quedarse con el efecto «mover» que traiga el
    // arrastre y pintar el cursor de prohibido aunque el drop esté aceptado.
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!dragHasFiles(e)) return;
    paintDragging(dragDepth - 1);
  });
  window.addEventListener('drop', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    paintDragging(0);
    // Fuera de la vista de subida no hay nada que hacer con el fichero, pero
    // el preventDefault() de arriba ya ha evitado que el navegador lo abra.
    if (viewUpload.hidden) return;
    setFile(e.dataTransfer.files[0]);
  });

  $('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    btnGenerate.disabled = true;
    btnGenerate.textContent = 'Subiendo…';
    showUploadError(null);
    try {
      const body = new FormData();
      body.append('image', selectedFile);
      body.append('maxPasses', $('max-passes').value);
      body.append('notes', $('notes').value);
      const res = await window.apiFetch('/api/jobs', { method: 'POST', body });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showUploadError(payload.error || `El servidor respondió ${res.status}.`, payload.detail);
        return;
      }
      location.hash = `#/job/${payload.jobId}`;
    } catch {
      showUploadError(
        'No se pudo contactar con el servidor. Comprueba que sigue en marcha (npm run dev) e inténtalo otra vez.',
      );
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = 'Generar';
    }
  });

  /* ───────────── vistas 2+3: progreso y resultado ───────────── */
  let refreshTimer = null;

  function showJob(jobId) {
    viewUpload.hidden = true;
    viewGallery.hidden = true;
    viewJob.hidden = false;
    if (currentJobId === jobId) return;
    currentJobId = jobId;
    $('job-id').textContent = jobId;
    $('timeline').innerHTML = '';
    $('result').hidden = true;
    $('analysis-summary').hidden = true;
    $('job-error').hidden = true;
    refreshJob();
    openEvents(jobId);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshJob, 150);
  }

  /**
   * En Moodle no hay SSE (`features.sse = false`, PHP-FPM no sostiene una
   * conexión de minutos): en su lugar se sondea el estado cada 2 s. Se pierde
   * el contador de caracteres en vivo de `generate:progress`; se conserva
   * pasada, score y discrepancias, que llegan igual en cada sondeo.
   */
  function openEvents(jobId) {
    if (!window.IG_CONFIG.features.sse) {
      stopStatusPolling();
      statusPollTimer = setInterval(refreshJob, 2000);
      return;
    }
    if (eventSource) eventSource.close();
    eventSource = new EventSource(window.apiUrl(`/api/jobs/${jobId}/events`));
    const refreshOn = ['status', 'analyze:done', 'pass:start', 'render:done',
      'compare:done', 'pass:done', 'job:done', 'job:failed'];
    refreshOn.forEach((type) => eventSource.addEventListener(type, scheduleRefresh));
    eventSource.addEventListener('generate:progress', (e) => {
      const { data } = JSON.parse(e.data);
      const el = $('live-progress');
      el.hidden = false;
      el.textContent = `Pasada ${data.n}: generando HTML… ${Number(data.chars).toLocaleString('es')} caracteres`;
      window.VisualEditor.onProgress(data);
    });
    ['pass:done', 'job:done', 'job:failed'].forEach((type) =>
      eventSource.addEventListener(type, () => { $('live-progress').hidden = true; }),
    );
  }

  async function refreshJob() {
    if (!currentJobId) return;
    const res = await window.apiFetch(`/api/jobs/${currentJobId}`);
    if (!res.ok) return;
    renderJob(await res.json());
  }

  function renderJob(job) {
    const chip = $('job-status');
    chip.textContent = STATUS_LABEL[job.status] || job.status;
    chip.className = `chip ${job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : ''}`;

    const errEl = $('job-error');
    errEl.hidden = !job.error;
    if (job.error) errEl.textContent = job.error;

    if (job.spec) {
      const swatches = job.spec.palette
        .slice(0, 10)
        .map((c) => `<span class="swatch" style="background:${esc(c.hex)}" title="${esc(c.name)}"></span>`)
        .join('');
      $('analysis-summary').innerHTML =
        `Análisis: lienzo ${job.width}×${job.height} px · ${job.spec.texts.length} textos · ` +
        `${job.spec.layers.length} capas · ${job.spec.photoZones.length} zonas de foto · paleta` +
        `<span class="swatches">${swatches}</span>`;
      $('analysis-summary').hidden = false;
    }

    renderTimeline(job);
    if (job.status === 'done' && job.passes.length > 0) renderResult(job);
    window.VisualEditor.onJobUpdate(job);
  }

  function renderTimeline(job) {
    $('timeline').innerHTML = job.passes
      .map((pass) => {
        const verdict = pass.verdict;
        const discrepancies = (verdict?.discrepancies ?? [])
          .slice(0, 6)
          .map(
            (d) => `<li><span class="sev ${esc(d.severity)}">${esc(d.severity)}</span>` +
              `<strong>${esc(d.zone)}</strong>: ${esc(d.description)}</li>`,
          )
          .join('');
        const kindLabel = {
          generate: 'generación', refine: 'refinado', iterate: 'ajuste del usuario', manual: 'edición manual',
        }[pass.kind];
        const edits = pass.edits ?? [];
        const editList = edits
          .slice(0, 6)
          .map((e) => `<li>«${esc(e.before || '(vacío)')}» → «${esc(e.after || '(vacío)')}»</li>`)
          .join('');
        return `<li class="pass ${pass.n === job.bestPass ? 'best' : ''}">
          <img class="pass-thumb" loading="lazy"
            src="${window.fileUrl(`/api/jobs/${esc(job.id)}/assets/passes/${esc(pass.screenshotFile)}`)}" alt="Pasada ${pass.n}">
          <div>
            <div class="pass-head">
              <span class="pass-title">Pasada ${pass.n}</span>
              <span class="pass-kind">${esc(kindLabel)}</span>
              ${pass.score != null ? `<span class="score">${Number(pass.score).toFixed(2)}%</span>` : ''}
              ${pass.n === job.bestPass ? '<span class="chip">mejor</span>' : ''}
            </div>
            ${pass.userPrompt
              ? `<p class="pass-summary">${pass.targetLabel ? `<code>${esc(pass.targetLabel)}</code> ` : ''}«${esc(pass.userPrompt)}»</p>`
              : ''}
            ${pass.kind === 'manual'
              ? `<p class="pass-summary">${edits.length} texto${edits.length === 1 ? '' : 's'} editado${edits.length === 1 ? '' : 's'} a mano · sin coste de tokens</p>
                 ${editList ? `<ul class="discrepancies">${editList}</ul>` : ''}`
              : ''}
            ${verdict ? `<p class="pass-summary">${esc(verdict.summary)}</p>` : ''}
            ${discrepancies ? `<ul class="discrepancies">${discrepancies}</ul>` : ''}
          </div>
        </li>`;
      })
      .join('');
  }

  /* ───────────── resultado ───────────── */
  let resultJob = null;

  function renderResult(job) {
    resultJob = job;
    $('result').hidden = false;

    const select = $('pass-select');
    const previous = select.value;
    select.innerHTML = job.passes
      .map((p) => {
        const label = `Pasada ${p.n}` +
          (p.n === job.bestPass ? ' · mejor' : '') +
          (p.kind === 'iterate' ? ' · ajuste' : '') +
          (p.kind === 'manual' ? ' · manual' : '') +
          (p.score != null ? ` · ${Number(p.score).toFixed(1)}%` : '');
        return `<option value="${p.n}">${esc(label)}</option>`;
      })
      .join('');

    // Última iteración o edición manual: es lo que ve el usuario en el
    // resultado (mismo criterio que currentResultPass() en el servidor).
    const followUps = job.passes.filter((p) => p.kind === 'iterate' || p.kind === 'manual');
    const defaultPass = followUps.length > 0
      ? followUps[followUps.length - 1].n
      : (job.bestPass ?? job.passes[job.passes.length - 1].n);
    // Con el editor abierto se sigue siempre la pasada más reciente.
    const keepPrevious =
      !window.VisualEditor.isOpen() &&
      [...select.options].some((o) => o.value === previous) &&
      previous !== '';
    select.value = keepPrevious ? previous : String(defaultPass);
    selectPass(Number(select.value));

    if (job.spec && job.spec.photoZones.length > 0) {
      $('placeholders').innerHTML =
        '<h3>Reemplazos manuales pendientes (zonas fotográficas)</h3><ul>' +
        job.spec.photoZones
          .map((z) => `<li><strong>${esc(z.zone)}</strong>: ${esc(z.description)} ` +
            `<span class="swatch" style="background:${esc(z.averageColorHex)};display:inline-block"></span></li>`)
          .join('') +
        '</ul>';
      $('placeholders').hidden = false;
    }
  }

  function selectPass(n) {
    const job = resultJob;
    const pass = job.passes.find((p) => p.n === n);
    if (!pass) return;
    $('compare-original').src = window.fileUrl(`/api/jobs/${job.id}/assets/original.png`);
    $('compare-render').src = window.fileUrl(`/api/jobs/${job.id}/assets/passes/${pass.screenshotFile}`);
    $('btn-open').href = window.fileUrl(`/api/jobs/${job.id}/result?pass=${n}`);

    const frame = $('preview-frame');
    frame.src = window.fileUrl(`/api/jobs/${job.id}/result?pass=${n}`);
    frame.width = job.width;
    frame.height = job.height;
    const wrap = $('preview-scale');
    const scale = Math.min(1, (wrap.clientWidth || 1000) / job.width);
    frame.style.transform = `scale(${scale})`;
    wrap.style.height = `${Math.min(job.height * scale, window.innerHeight * 0.7)}px`;
  }

  $('pass-select').addEventListener('change', (e) => selectPass(Number(e.target.value)));

  $('compare-range').addEventListener('input', (e) => {
    $('compare').style.setProperty('--pos', `${e.target.value}%`);
  });

  $('btn-download').addEventListener('click', () => {
    const n = $('pass-select').value;
    const a = document.createElement('a');
    a.href = window.fileUrl(`/api/jobs/${resultJob.id}/result?pass=${n}`);
    a.download = `${resultJob.id}-pass-${n}.html`;
    a.click();
  });

  $('btn-edit').addEventListener('click', () => {
    if (!resultJob) return;
    window.VisualEditor.open({
      jobId: resultJob.id,
      pass: Number($('pass-select').value),
      width: resultJob.width,
      height: resultJob.height,
      passCount: resultJob.passes.length,
      mode: 'prompt',
    });
  });

  $('btn-edit-text').addEventListener('click', () => {
    if (!resultJob) return;
    window.VisualEditor.open({
      jobId: resultJob.id,
      pass: Number($('pass-select').value),
      width: resultJob.width,
      height: resultJob.height,
      passCount: resultJob.passes.length,
      mode: 'text',
    });
  });

  $('btn-copy').addEventListener('click', async () => {
    const n = $('pass-select').value;
    const html = await (await fetch(window.fileUrl(`/api/jobs/${resultJob.id}/result?pass=${n}`))).text();
    await navigator.clipboard.writeText(html);
    $('btn-copy').textContent = '¡Copiado!';
    setTimeout(() => { $('btn-copy').textContent = 'Copiar código'; }, 1500);
  });

  $('iterate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = $('iterate-prompt').value.trim();
    if (!prompt || !currentJobId) return;
    const btn = $('btn-iterate');
    btn.disabled = true;
    try {
      const res = await window.apiFetch(`/api/jobs/${currentJobId}/iterate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      $('iterate-prompt').value = '';
    } catch (err) {
      $('job-error').textContent = err.message;
      $('job-error').hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  /* ───────────── galería (historial local) ───────────── */
  let galleryCursor = null;
  let galleryLoading = false;
  let gallerySearchTimer = null;

  const RTF = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const RELATIVE_UNITS = [
    ['year', 31536000], ['month', 2592000], ['day', 86400],
    ['hour', 3600], ['minute', 60], ['second', 1],
  ];

  function relativeTime(iso) {
    const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    for (const [unit, secs] of RELATIVE_UNITS) {
      if (Math.abs(diffSec) >= secs || unit === 'second') return RTF.format(-Math.round(diffSec / secs), unit);
    }
    return '';
  }

  function updateGalleryCount(total) {
    const badge = $('nav-gallery-count');
    badge.textContent = String(total);
    badge.hidden = false;
  }

  function galleryCardHtml(item) {
    const statusClass = item.status === 'done' ? 'done' : item.status === 'failed' ? 'failed' : '';
    const inProgress = item.status !== 'done' && item.status !== 'failed';
    return `<article class="gallery-card" data-id="${esc(item.id)}">
      <a class="gallery-thumb" href="#/job/${esc(item.id)}">
        <img src="${window.fileUrl(`/api/jobs/${esc(item.id)}/thumb`)}" loading="lazy" alt="Miniatura de ${esc(item.title)}">
        <span class="chip gallery-chip ${statusClass}">${esc(STATUS_LABEL[item.status] || item.status)}</span>
      </a>
      <div class="gallery-body">
        <h3 class="gallery-title" tabindex="0" title="Haz clic para renombrar">${esc(item.title)}</h3>
        <div class="gallery-meta">
          <span>${esc(relativeTime(item.updatedAt))}</span>
          ${item.bestScore != null ? `<span>· <span class="score">${Number(item.bestScore).toFixed(1)}%</span></span>` : ''}
          <span>· ${item.passCount} pasada${item.passCount === 1 ? '' : 's'}</span>
        </div>
        <div class="gallery-actions">
          ${item.hasResult ? `<a class="ghost small" href="${window.fileUrl(`/api/jobs/${esc(item.id)}/result`)}" download>Descargar</a>` : '<span></span>'}
          <button type="button" class="ghost small danger" data-action="delete" data-id="${esc(item.id)}"
            ${inProgress ? 'disabled title="Espera a que termine para borrarlo"' : ''}>Borrar</button>
        </div>
      </div>
    </article>`;
  }

  function galleryQueryParams(cursor) {
    const params = new URLSearchParams();
    params.set('limit', '24');
    if (cursor) params.set('cursor', cursor);
    const q = $('gallery-search').value.trim();
    if (q) params.set('q', q);
    const status = $('gallery-status').value;
    if (status !== 'all') params.set('status', status);
    params.set('sort', $('gallery-sort').value);
    return params;
  }

  function updateGalleryEmptyStates(page) {
    const hasFilters = $('gallery-search').value.trim() !== '' || $('gallery-status').value !== 'all';
    const empty = page.items.length === 0 && !galleryCursor;
    $('gallery-empty').hidden = !(empty && !hasFilters);
    $('gallery-no-results').hidden = !(empty && hasFilters);
  }

  async function loadGallery(reset) {
    if (galleryLoading) return;
    galleryLoading = true;
    if (reset) {
      galleryCursor = null;
      $('gallery-grid').innerHTML = '';
    }
    $('gallery-error').hidden = true;
    try {
      const res = await window.apiFetch(`/api/gallery?${galleryQueryParams(galleryCursor)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = await res.json();
      galleryCursor = page.nextCursor;
      $('gallery-grid').insertAdjacentHTML('beforeend', page.items.map(galleryCardHtml).join(''));
      $('gallery-more').hidden = !page.nextCursor;
      // El contador de la topbar es el total sin filtrar: con una búsqueda o
      // un filtro de estado activos, page.total ya no lo representa.
      const hasFilters = $('gallery-search').value.trim() !== '' || $('gallery-status').value !== 'all';
      if (!hasFilters) updateGalleryCount(page.total);
      if (reset) updateGalleryEmptyStates(page);
    } catch {
      $('gallery-error').hidden = false;
      $('gallery-error').textContent =
        'No se pudo cargar la galería. Comprueba que el servidor sigue en marcha.';
    } finally {
      galleryLoading = false;
    }
  }

  function startRename(titleEl) {
    const id = titleEl.closest('.gallery-card').dataset.id;
    const original = titleEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gallery-title-input';
    input.maxLength = 120;
    input.value = original;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    async function commit() {
      if (settled) return;
      settled = true;
      const next = input.value.trim();
      if (next && next !== original) {
        try {
          const res = await window.apiFetch(`/api/jobs/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: next }),
          });
          if (!res.ok) throw new Error();
          titleEl.textContent = next;
        } catch {
          titleEl.textContent = original;
        }
      }
      input.replaceWith(titleEl);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { settled = true; input.replaceWith(titleEl); }
    });
  }

  async function deleteGalleryJob(id) {
    if (!confirm('¿Borrar esta infografía? No se puede deshacer.')) return;
    try {
      const res = await window.apiFetch(`/api/jobs/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      loadGallery(true);
    } catch (err) {
      $('gallery-error').hidden = false;
      $('gallery-error').textContent = err.message || 'No se pudo borrar la infografía.';
    }
  }

  $('gallery-grid').addEventListener('click', (e) => {
    const title = e.target.closest('.gallery-title');
    if (title) { startRename(title); return; }
    const del = e.target.closest('[data-action="delete"]');
    if (del && !del.disabled) deleteGalleryJob(del.dataset.id);
  });
  $('gallery-grid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('gallery-title')) {
      e.preventDefault();
      startRename(e.target);
    }
  });
  $('gallery-search').addEventListener('input', () => {
    clearTimeout(gallerySearchTimer);
    gallerySearchTimer = setTimeout(() => loadGallery(true), 250);
  });
  $('gallery-status').addEventListener('change', () => loadGallery(true));
  $('gallery-sort').addEventListener('change', () => loadGallery(true));
  $('gallery-more').addEventListener('click', () => loadGallery(false));

  /* ───────────── tira de recientes (vista de subida) ───────────── */
  async function loadRecentStrip() {
    try {
      const res = await window.apiFetch('/api/gallery?limit=6&sort=recent');
      if (!res.ok) return;
      const page = await res.json();
      updateGalleryCount(page.total);
      if (page.items.length === 0) {
        $('recent-strip').hidden = true;
        return;
      }
      $('recent-grid').innerHTML = page.items
        .map(
          (item) => `<a class="recent-card" href="#/job/${esc(item.id)}">
            <img src="${window.fileUrl(`/api/jobs/${esc(item.id)}/thumb`)}" loading="lazy" alt="Miniatura de ${esc(item.title)}">
            <div class="recent-card-title">${esc(item.title)}</div>
          </a>`,
        )
        .join('');
      $('recent-strip').hidden = false;
    } catch {
      // silencioso: la tira de recientes no es información crítica
    }
  }

  /* ───────────── permisos ───────────── */
  // Sin permiso de edición (lo dice Moodle en el ticket) no se ofrecen las dos
  // puertas de entrada al editor: el motor las rechazaría con un 403 y el
  // profesor no puede hacer nada al respecto.
  if (window.IG_CONFIG.features.edit === false) {
    $('btn-edit').hidden = true;
    $('btn-edit-text').hidden = true;
  }

  /* ───────────── sesión ───────────── */
  // Cualquier 401 llega aquí desde api.js. Un aviso, una sola vez, y con la
  // salida que corresponda a cada modo.
  let sessionnoticeshown = false;
  window.addEventListener('ig:unauthorized', () => {
    if (sessionnoticeshown) return;
    sessionnoticeshown = true;

    const notice = document.createElement('div');
    notice.className = 'session-expired';
    notice.setAttribute('role', 'alert');
    notice.innerHTML = window.IG_CONFIG.features.embedded
      ? '<strong>La sesión ha caducado.</strong> Recarga la página de Moodle para seguir trabajando.'
      : '<strong>La sesión ha caducado.</strong> <a href="/login.html">Vuelve a entrar</a> para seguir trabajando.';
    document.body.append(notice);
  });

  // El botón de salir solo aparece si esta instalación tiene login. En el
  // iframe de Moodle (features.auth = false) la sesión la trae Moodle: ni se
  // consulta el estado ni se muestra el botón.
  if (window.IG_CONFIG.features.auth) {
    (async () => {
      try {
        const status = await (await window.apiFetch('/api/auth/status')).json();
        if (status.enabled && status.authenticated) $('btn-logout').hidden = false;
      } catch {
        // Sin respuesta del servidor no se muestra nada: no es información crítica.
      }
    })();

    $('btn-logout').addEventListener('click', async () => {
      await window.apiFetch('/api/auth/logout', { method: 'POST' });
      location.reload();
    });
  }

  route();
})();
