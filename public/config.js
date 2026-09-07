/*
 * Configuración de red de la app, con un único punto de override.
 *
 * El motor sirve este fichero tal cual (valores por defecto: mismo origen,
 * SSE y auth activos). El plugin de Moodle genera su propia versión en tiempo
 * de petición (js/config.js), con `apiBase`/`filesBase` apuntando a sus
 * endpoints y `extraParams.sesskey` para el CSRF de Moodle. Ver PLAN_MOODLE.md §4.1.
 */
window.IG_CONFIG = {
  apiBase: '', // prefijo para las llamadas de apiFetch(); '' = mismo origen
  filesBase: '', // prefijo para las URLs de fileUrl() (imágenes, HTML, descargas)
  extraParams: {}, // pares añadidos como querystring a toda llamada, p. ej. { sesskey: '…' }
  features: {
    sse: true, // false → sondeo cada 2 s en vez de EventSource (PHP-FPM no sostiene SSE)
    auth: true, // false → no se llama a /api/auth/status ni se muestra «Cerrar sesión»
    score: true, // false → el comparador se apaga en pasadas nacidas de una edición sin score
  },
};
