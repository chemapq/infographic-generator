/*
 * Configuración de red de la app, con un único punto de override.
 *
 * Dos modos, y los distingue la propia URL:
 *
 *   - **Directo** (`https://motor/`): mismo origen, sesión por cookie, login
 *     con `AUTH_PASSWORD` si el despliegue lo tiene puesto.
 *   - **Incrustado** en el iframe del plugin de Moodle: el motor redirige a
 *     `/?t=<token>` desde `GET /embed`, y ese token es la sesión. Se copia a
 *     `extraParams` para que `api.js` lo añada a TODA llamada y a toda URL de
 *     fichero — incluidas las que acaban en `<img src>`, en el iframe del
 *     resultado y en los enlaces de descarga, donde no se pueden poner
 *     cabeceras. Ver src/services/embed.ts.
 *
 * `noai=1` lo añade `/embed` cuando el ticket de Moodle dice que el usuario no
 * tiene la capability de edición (o el admin desactivó la edición con IA).
 */
(() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  const embedded = token !== null && token !== '';

  window.IG_CONFIG = {
    apiBase: '', // prefijo para las llamadas de apiFetch(); '' = mismo origen
    filesBase: '', // prefijo para las URLs de fileUrl() (imágenes, HTML, descargas)
    extraParams: embedded ? { t: token } : {}, // pares añadidos como querystring a toda llamada
    features: {
      // El iframe habla directamente con el motor, no con PHP-FPM: SSE
      // funciona igual que en el modo directo.
      sse: true,
      // En modo incrustado la sesión la trae Moodle: ni se consulta
      // /api/auth/status ni tiene sentido ofrecer «Cerrar sesión».
      auth: !embedded,
      // false → se esconden «Pedir cambios a la IA» y la edición de textos.
      edit: !(embedded && params.get('noai') === '1'),
      // false → el comparador se apaga en pasadas nacidas de una edición sin score.
      score: true,
      // Cambia los mensajes de sesión caducada: dentro de un iframe no se
      // puede mandar a nadie a /login.html.
      embedded,
    },
  };
})();
