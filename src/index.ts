import express from 'express';
import path from 'node:path';
import { jobsRouter } from './api/jobs.router.js';
import { env } from './config/env.js';
import { describeError } from './services/errors.js';
import { closeBrowser } from './services/renderer.js';

const app = express();

app.use(express.json({ limit: '1mb' }));
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

const server = app.listen(env.port, () => {
  console.log(`Infographic Generator escuchando en http://localhost:${env.port}`);
  console.log(`Modelo: ${env.anthropicModel} · MAX_PASSES=${env.maxPasses} · TARGET_SCORE=${env.targetScore}`);
});

async function shutdown(): Promise<void> {
  await closeBrowser().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
