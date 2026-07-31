import type { Response } from 'express';
import type { JobEvent } from '../types.js';

/**
 * Helper de Server-Sent Events: cabeceras, envío de eventos con nombre
 * y heartbeat para mantener viva la conexión detrás de proxies.
 */
export function openSse(res: Response): {
  send: (event: JobEvent) => void;
  close: () => void;
} {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25_000);

  return {
    send(event: JobEvent): void {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close(): void {
      clearInterval(heartbeat);
      res.end();
    },
  };
}
