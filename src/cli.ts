/**
 * Pipeline invocable por script (hito M1):
 *   npx tsx src/cli.ts <imagen> [maxPasses]
 * Ejecuta imagen → HTML → captura → comparación y deja todo en output/<jobId>/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createJob, getJob, subscribe } from './services/orchestrator.js';
import { closeBrowser } from './services/renderer.js';

const [, , imagePath, maxPassesArg] = process.argv;

if (!imagePath) {
  console.error('Uso: npx tsx src/cli.ts <imagen> [maxPasses]');
  process.exit(1);
}

const image = await fs.readFile(path.resolve(imagePath));
const maxPasses = maxPassesArg ? Number.parseInt(maxPassesArg, 10) : undefined;

const record = await createJob(
  image,
  path.basename(imagePath),
  { maxPasses: maxPasses && !Number.isNaN(maxPasses) ? maxPasses : 5 },
  null,
);
console.log(`Job ${record.id} creado (${record.width}x${record.height}). Ejecutando pipeline…`);

const job = await getJob(record.id);
if (!job) throw new Error('Job no registrado');

await new Promise<void>((resolve) => {
  const { emitter } = subscribe(job);
  emitter.on('event', (event: { type: string; data: Record<string, unknown> }) => {
    switch (event.type) {
      case 'status':
        console.log(`  · estado: ${String(event.data.status)}`);
        break;
      case 'analyze:done':
        console.log(`  · análisis: ${String(event.data.texts)} textos, ${String(event.data.layers)} capas`);
        break;
      case 'pass:done':
        console.log(
          `  · pasada ${String(event.data.n)} [${String(event.data.kind)}]: score ${String(event.data.score)}%`,
        );
        break;
      case 'job:done':
        console.log(
          `Terminado. Mejor pasada: ${String(event.data.bestPass)} · ${String(event.data.stopReason)}`,
        );
        resolve();
        break;
      case 'job:failed':
        console.error(`Fallo: ${String(event.data.error)}`);
        resolve();
        break;
    }
  });
});

await closeBrowser();
console.log(`Resultado en output/${record.id}/`);
