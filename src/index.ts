import express from 'express';
import path from 'node:path';
import { authRouter } from './api/auth.router.js';
import { jobsRouter } from './api/jobs.router.js';
import { env } from './config/env.js';
import { authEnabled, isAuthenticated } from './services/auth.js';
import { describeError } from './services/errors.js';
import { closeBrowser } from './services/renderer.js';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', authRouter);

/** Lo mínimo para poder pintar la pantalla de login. */
const PUBLIC_PATHS = new Set(['/login.html', '/styles.css', '/favicon.ico']);

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
app.use('/api/jobs', jobsRouter);

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

// Un despliegue sin contraseña dejaría la herramienta abierta a cualquiera:
// mejor no arrancar que arrancar desprotegido.
if (env.nodeEnv === 'production' && !authEnabled()) {
  console.error(
    'No se puede arrancar en producción sin AUTH_PASSWORD: la herramienta quedaría abierta a cualquiera.\n' +
      'Define AUTH_PASSWORD (y AUTH_SECRET para que las sesiones sobrevivan a los reinicios) y vuelve a intentarlo.',
  );
  process.exit(1);
}

const server = app.listen(env.port, () => {
  console.log(`Infographic Generator escuchando en http://localhost:${env.port}`);
  console.log(`Modelo: ${env.anthropicModel} · MAX_PASSES=${env.maxPasses} · TARGET_SCORE=${env.targetScore}`);
  console.log(`Login: ${authEnabled() ? 'activado (AUTH_PASSWORD configurada)' : 'desactivado — sin AUTH_PASSWORD, cualquiera que alcance este puerto entra'}`);
});

async function shutdown(): Promise<void> {
  await closeBrowser().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
