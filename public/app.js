/* Infographic Generator — UI (vanilla JS, sin build) */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const viewUpload = $('view-upload');
  const viewJob = $('view-job');

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
  let currentJobId = null;

  function route() {
    const match = location.hash.match(/^#\/job\/([\w-]+)/);
    if (match) {
      showJob(match[1]);
    } else {
      if (eventSource) { eventSource.close(); eventSource = null; }
      currentJobId = null;
      viewJob.hidden = true;
      viewUpload.hidden = false;
    }
  }
  window.addEventListener('hashchange', route);

  /* ───────────── vista 1: subida ───────────── */
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  const preview = $('drop-preview');
  const btnGenerate = $('btn-generate');
  let selectedFile = null;

  function setFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
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
  ['dragover', 'dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.toggle('dragover', type === 'dragover');
      if (type === 'drop') setFile(e.dataTransfer.files[0]);
    });
  });

  $('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    btnGenerate.disabled = true;
    btnGenerate.textContent = 'Subiendo…';
    $('upload-error').hidden = true;
    try {
      const body = new FormData();
      body.append('image', selectedFile);
      body.append('maxPasses', $('max-passes').value);
      body.append('notes', $('notes').value);
      const res = await fetch('/api/jobs', { method: 'POST', body });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const { jobId } = await res.json();
      location.hash = `#/job/${jobId}`;
    } catch (err) {
      $('upload-error').textContent = err.message;
      $('upload-error').hidden = false;
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = 'Generar';
    }
  });

  /* ───────────── vistas 2+3: progreso y resultado ───────────── */
  let refreshTimer = null;

  function showJob(jobId) {
    viewUpload.hidden = true;
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

  function openEvents(jobId) {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/jobs/${jobId}/events`);
    const refreshOn = ['status', 'analyze:done', 'pass:start', 'render:done',
      'compare:done', 'pass:done', 'job:done', 'job:failed'];
    refreshOn.forEach((type) => eventSource.addEventListener(type, scheduleRefresh));
    eventSource.addEventListener('generate:progress', (e) => {
      const { data } = JSON.parse(e.data);
      const el = $('live-progress');
      el.hidden = false;
      el.textContent = `Pasada ${data.n}: generando HTML… ${Number(data.chars).toLocaleString('es')} caracteres`;
    });
    ['pass:done', 'job:done', 'job:failed'].forEach((type) =>
      eventSource.addEventListener(type, () => { $('live-progress').hidden = true; }),
    );
  }

  async function refreshJob() {
    if (!currentJobId) return;
    const res = await fetch(`/api/jobs/${currentJobId}`);
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
        const kindLabel = { generate: 'generación', refine: 'refinado', iterate: 'ajuste del usuario' }[pass.kind];
        return `<li class="pass ${pass.n === job.bestPass ? 'best' : ''}">
          <img class="pass-thumb" loading="lazy"
            src="/api/jobs/${esc(job.id)}/assets/passes/${esc(pass.screenshotFile)}" alt="Pasada ${pass.n}">
          <div>
            <div class="pass-head">
              <span class="pass-title">Pasada ${pass.n}</span>
              <span class="pass-kind">${esc(kindLabel)}</span>
              ${pass.score != null ? `<span class="score">${Number(pass.score).toFixed(2)}%</span>` : ''}
              ${pass.n === job.bestPass ? '<span class="chip">mejor</span>' : ''}
            </div>
            ${pass.userPrompt ? `<p class="pass-summary">«${esc(pass.userPrompt)}»</p>` : ''}
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
          (p.score != null ? ` · ${Number(p.score).toFixed(1)}%` : '');
        return `<option value="${p.n}">${esc(label)}</option>`;
      })
      .join('');

    const iterations = job.passes.filter((p) => p.kind === 'iterate');
    const defaultPass = iterations.length > 0
      ? iterations[iterations.length - 1].n
      : (job.bestPass ?? job.passes[job.passes.length - 1].n);
    select.value = [...select.options].some((o) => o.value === previous) && previous !== ''
      ? previous
      : String(defaultPass);
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
    $('compare-original').src = `/api/jobs/${job.id}/assets/original.png`;
    $('compare-render').src = `/api/jobs/${job.id}/assets/passes/${pass.screenshotFile}`;
    $('btn-open').href = `/api/jobs/${job.id}/result?pass=${n}`;

    const frame = $('preview-frame');
    frame.src = `/api/jobs/${job.id}/result?pass=${n}`;
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
    a.href = `/api/jobs/${resultJob.id}/result?pass=${n}`;
    a.download = `${resultJob.id}-pass-${n}.html`;
    a.click();
  });

  $('btn-copy').addEventListener('click', async () => {
    const n = $('pass-select').value;
    const html = await (await fetch(`/api/jobs/${resultJob.id}/result?pass=${n}`)).text();
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
      const res = await fetch(`/api/jobs/${currentJobId}/iterate`, {
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

  route();
})();
