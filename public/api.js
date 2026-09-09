/*
 * Único punto por el que app.js y editor.js hablan con el backend. Sustituye
 * los `fetch('/api/…')` y `src="/api/…"` literales por dos funciones que leen
 * `window.IG_CONFIG` (config.js): así el mismo app.js/editor.js sirve tanto a
 * la app como al plugin de Moodle sin más cambio que el config.js que cada uno
 * cargue. Ver PLAN_MOODLE.md §4.1.
 */
(() => {
  'use strict';

  function config() {
    return (
      window.IG_CONFIG || { apiBase: '', filesBase: '', extraParams: {}, features: {} }
    );
  }

  /** Añade `extraParams` (p. ej. el sesskey de Moodle) a la querystring de `path`. */
  function withExtraParams(path) {
    const extra = config().extraParams || {};
    const keys = Object.keys(extra);
    if (keys.length === 0) return path;
    const [beforeHash, hash] = path.split('#');
    const separator = beforeHash.includes('?') ? '&' : '?';
    const qs = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(extra[k])}`).join('&');
    return `${beforeHash}${separator}${qs}${hash ? `#${hash}` : ''}`;
  }

  /** URL completa de una llamada de API: prefija `apiBase` y añade `extraParams`. */
  window.apiUrl = function apiUrl(path) {
    return `${config().apiBase}${withExtraParams(path)}`;
  };

  /** `fetch()` de una llamada de API: prefija `apiBase` y añade `extraParams`. */
  window.apiFetch = function apiFetch(path, options) {
    return fetch(window.apiUrl(path), options).then((response) => {
      // Sesión caducada. Se avisa desde aquí, un único sitio, porque cada
      // llamante trata su error a su manera y ninguno puede resolver esto:
      // dentro del iframe de Moodle no hay pantalla de login a la que mandar
      // a nadie. app.js escucha el evento y pinta el aviso.
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('ig:unauthorized'));
      }
      return response;
    });
  };

  /** URL de un recurso servido como fichero (imagen, HTML, descarga): prefija `filesBase`. */
  window.fileUrl = function fileUrl(path) {
    return `${config().filesBase}${withExtraParams(path)}`;
  };
})();
