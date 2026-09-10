import express from 'express';
import path from 'node:path';
import { authRouter } from './api/auth.router.js';
import { galleryRouter } from './api/gallery.router.js';
import { jobsRouter } from './api/jobs.router.js';
import { rebuildIdempotencyIndex } from './api/v1/idempotency.js';
import { apiEnabled } from './api/v1/keys.js';
import { v1Router } from './api/v1/index.js';
import { env } from './config/env.js';
import { authEnabled, isAuthenticated } from './services/auth.js';
import { embedEnabled, issueEmbedToken, readEmbedSession, verifyTicket } from './services/embed.js';
import { describeError } from './services/errors.js';
import { ownerMiddleware } from './services/owner.js';
import { closeBrowser } from './services/renderer.js';
import { startRetentionSweep } from './services/retention.js';

/**
 * Página de error de `/embed`. Se pinta **dentro** del iframe de Moodle, donde
 * un JSON o el texto plano de Express se ven como un fallo del propio Moodle:
 * merece la pena que se lea como parte del producto y diga qué hacer.
 */
function embedError(res: express.Response, status: number, message: string): void {
  res.status(status).type('html').send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Infographic Generator · Awakelab</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #011932; color: #E2E6F2;
         font-family: Poppins, system-ui, sans-serif; text-align: center; }
  .box { max-width: 34rem; padding: 2rem; }
  img { width: 11rem; margin-bottom: 2rem; }
  p { font-size: 1.05rem; line-height: 1.6; }
  strong { color: #19F7F1; font-weight: 600; }
</style></head>
<body><div class="box">
  <img src="https://media.awakelab.world/MARCA_AWK26/awakelab_logo_fondo-oscuro_transparente.png" alt="Awakelab">
  <p><strong>No se pudo abrir el generador.</strong></p>
  <p>${message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)}</p>
</div></body></html>`);
}

const app = express();

// 3 MB: cubre el HTML de hasta 2 MB que acepta POST /api/v1/edit (más el
// margen del escapado JSON) sin abrir la puerta a cuerpos arbitrariamente
// grandes en el resto de rutas, que en la práctica no se acercan a ese tamaño.
app.use(express.json({ limit: '3mb' }));

// Quién puede meter la app en un iframe. Solo se manda si está configurado:
// el motor no emite `X-Frame-Options`, así que sin esto el iframe funciona
// igual — esta cabecera está para acotar, no para permitir.
if (env.embedAllowedOrigins !== '') {
  const origins = env.embedAllowedOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  const policy = `frame-ancestors 'self' ${origins.join(' ')}`;
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', policy);
    next();
  });
}

// La API v1 (bearer) se monta antes que nada: tiene su propia autenticación y
// no debe pasar por el guardián de cookie de abajo, pensado para el navegador.
app.use('/api/v1', v1Router);

if (env.uiEnabled) {
  app.use('/api/auth', authRouter);

  /**
   * GET /embed?t=<ticket firmado por Moodle> — la puerta del iframe.
   *
   * Cambia el ticket de un salto por un token de sesión y redirige a la app
   * con él en la querystring. A partir de ahí `public/config.js` lo recoge y
   * `api.js` lo añade a cada llamada (services/embed.ts explica por qué en la
   * URL y no en una cabecera).
   */
  app.get('/embed', (req, res) => {
    if (!embedEnabled()) {
      embedError(res, 404, 'Este motor no acepta sesiones incrustadas: le falta configurar EMBED_SECRET.');
      return;
    }

    const session = verifyTicket(req.query.t);
    if (!session) {
      // Un mismo mensaje para firma inválida, ticket caducado y ticket
      // ausente: son indistinguibles para quien lo ve y distinguirlos solo
      // ayudaría a quien esté probando firmas. La causa habitual, de largo,
      // es un secreto que no coincide entre Moodle y el motor.
      embedError(
        res,
        403,
        'El pase de acceso no es válido o ha caducado. Vuelve a abrir la página desde Moodle.',
      );
      return;
    }

    const params = new URLSearchParams({ t: issueEmbedToken(session) });
    if (!session.edit) params.set('noai', '1');
    res.redirect(302, `/?${params.toString()}`);
  });

  /**
   * Lo mínimo para poder pintar la pantalla de login, más el healthcheck: los
   * chequeos de salud de la plataforma (Render, Railway, Fly.io…) no mandan
   * cookie de sesión, así que si quedara detrás del login lo verían caído.
   * `/embed` se sirve arriba, antes del guardián, pero se declara igual para
   * que un método distinto de GET no acabe redirigido al login.
   */
  const PUBLIC_PATHS = new Set(['/login.html', '/styles.css', '/favicon.ico', '/api/health', '/embed']);

  /**
   * Los ficheros sueltos de la interfaz: config.js, api.js, editor.js, app.js
   * y cualquier .css que se añada al lado de styles.css.
   *
   * Son públicos por la misma razón que styles.css —son el código del cliente,
   * no los datos de nadie— pero dentro del iframe la razón es de peso: la
   * sesión de embed viaja en el `?t=` de la URL, y un `<script src="app.js">`
   * NO arrastra la querystring de la página que lo carga. Esas peticiones
   * llegaban sin token, el guardián las cortaba con un 401 y quedaba una app
   * pintada del todo y muerta del todo: el index.html sí había pasado (ese sí
   * lleva el `?t=`) y styles.css también, así que se veía perfecta, pero sin
   * una sola línea de JavaScript ejecutada no respondía a nada.
   *
   * Lo que hay que proteger son los datos, y esos están detrás de `/api/**`,
   * que sigue cubierto: la propia app no puede leer un job sin token.
   */
  const isUiAsset = (path: string): boolean => /^\/[\w-]+\.(?:js|css)$/.test(path);

  /**
   * Guardián: va antes que los estáticos y que la API, así que cubre también el
   * HTML generado y las capturas de cada job. Sin `AUTH_PASSWORD` no se interpone.
   * Un token de embed válido vale como sesión: es lo que trae al profesor desde
   * Moodle, y no puede pasar por la pantalla de contraseña.
   */
  app.use((req, res, next) => {
    if (
      !authEnabled() ||
      PUBLIC_PATHS.has(req.path) ||
      isUiAsset(req.path) ||
      isAuthenticated(req) ||
      readEmbedSession(req)
    ) {
      next();
      return;
    }
    if ((req.headers.accept ?? '').includes('text/html')) {
      res.redirect(302, `/login.html?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    res.status(401).json({ error: 'Sesión caducada o no iniciada. Vuelve a entrar.' });
  });

  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use('/api', ownerMiddleware);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/gallery', galleryRouter);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: env.anthropicModel, maxPasses: env.maxPasses });
});

// Manejador de errores final: nunca dejar la petición colgada. El mensaje que
// se devuelve va traducido a lenguaje llano; el técnico queda en el log y en
// `detail` para quien quiera mirarlo.
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const friendly = describeError(error);
    console.error('[api]', friendly.message, friendly.detail ? `— ${friendly.detail}` : '');
    if (!res.headersSent) {
      res.status(friendly.status).json({ error: friendly.message, detail: friendly.detail });
    }
  },
);

// Un despliegue sin ninguna autenticación dejaría la herramienta (o la API)
// abierta a cualquiera: mejor no arrancar que arrancar desprotegido.
if (env.nodeEnv === 'production' && !authEnabled() && !apiEnabled() && !embedEnabled()) {
  console.error(
    'No se puede arrancar en producción sin AUTH_PASSWORD, API_KEYS ni EMBED_SECRET: quedaría abierto a cualquiera.\n' +
      'Define AUTH_PASSWORD (interfaz web), API_KEYS (clientes servidor-a-servidor)\n' +
      'y/o EMBED_SECRET (el iframe del plugin de Moodle) y vuelve a intentarlo.',
  );
  process.exit(1);
}

await rebuildIdempotencyIndex();
startRetentionSweep();

const server = app.listen(env.port, () => {
  console.log(`Infographic Generator escuchando en http://localhost:${env.port}`);
  console.log(`Modelo: ${env.anthropicModel} · MAX_PASSES=${env.maxPasses} · TARGET_SCORE=${env.targetScore}`);
  console.log(`UI web: ${env.uiEnabled ? 'activada' : 'desactivada (UI_ENABLED=false, solo API)'}`);
  if (env.uiEnabled) {
    console.log(`Login: ${authEnabled() ? 'activado (AUTH_PASSWORD configurada)' : 'desactivado — sin AUTH_PASSWORD, cualquiera que alcance este puerto entra'}`);
  }
  console.log(`API v1: ${apiEnabled() ? 'activada (API_KEYS configurada)' : 'desactivada — sin API_KEYS, /api/v1 rechaza todo salvo /health'}`);
  console.log(
    `Iframe de Moodle: ${
      embedEnabled()
        ? `activado (EMBED_SECRET configurada) · orígenes permitidos: ${env.embedAllowedOrigins || "cualquiera (EMBED_ALLOWED_ORIGINS sin definir)"}`
        : 'desactivado — sin EMBED_SECRET, /embed responde 404'
    }`,
  );
});

async function shutdown(): Promise<void> {
  await closeBrowser().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
