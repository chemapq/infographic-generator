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
import { describeError } from './services/errors.js';
import { ownerMiddleware } from './services/owner.js';
import { closeBrowser } from './services/renderer.js';
import { startRetentionSweep } from './services/retention.js';

const app = express();

// 3 MB: cubre el HTML de hasta 2 MB que acepta POST /api/v1/edit (más el
// margen del escapado JSON) sin abrir la puerta a cuerpos arbitrariamente
// grandes en el resto de rutas, que en la práctica no se acercan a ese tamaño.
app.use(express.json({ limit: '3mb' }));

// La API v1 (bearer) se monta antes que nada: tiene su propia autenticación y
// no debe pasar por el guardián de cookie de abajo, pensado para el navegador.
app.use('/api/v1', v1Router);

if (env.uiEnabled) {
  app.use('/api/auth', authRouter);

  /**
   * Lo mínimo para poder pintar la pantalla de login, más el healthcheck: los
   * chequeos de salud de la plataforma (Render, Railway, Fly.io…) no mandan
   * cookie de sesión, así que si quedara detrás del login lo verían caído.
   */
  const PUBLIC_PATHS = new Set(['/login.html', '/styles.css', '/favicon.ico', '/api/health']);

  /**
   * Guardián: va antes que los estáticos y que la API, así que cubre también el
   * HTML generado y las capturas de cada job. Sin `AUTH_PASSWORD` no se interpone.
   */
  app.use((req, res, next) => {
    if (!authEnabled() || PUBLIC_PATHS.has(req.path) || isAuthenticated(req)) {
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
if (env.nodeEnv === 'production' && !authEnabled() && !apiEnabled()) {
  console.error(
    'No se puede arrancar en producción sin AUTH_PASSWORD ni API_KEYS: quedaría abierto a cualquiera.\n' +
      'Define AUTH_PASSWORD (interfaz web) y/o API_KEYS (clientes servidor-a-servidor) y vuelve a intentarlo.',
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
});

async function shutdown(): Promise<void> {
  await closeBrowser().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
