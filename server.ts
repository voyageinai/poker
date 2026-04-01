/**
 * Custom HTTP server: Next.js + WebSocket on the same port.
 * Pattern mirrors the chinese-chess platform's server.ts.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  const { createServer } = await import('http');
  const { parse } = await import('url');
  const next = (await import('next')).default;
  const { wsHub } = await import('./src/server/ws');
  const { getDb } = await import('./src/db/index');
  const { BASE_PATH } = await import('./src/lib/runtime-config');

  const dev = process.env.NODE_ENV !== 'production';
  const hostname = process.env.HOST ?? process.env.HOSTNAME ?? '127.0.0.1';
  const port = parseInt(process.env.PORT ?? '3001', 10);

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  // Initialize DB (creates tables on first run)
  getDb();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  wsHub.init(server);

  server.listen(port, hostname, () => {
    const publicBase = BASE_PATH || '';
    console.log(`[poker-arena] Ready on http://${hostname}:${port}${publicBase}`);
  });

  // Graceful shutdown — release port before pm2 restarts
  function shutdown(signal: string) {
    console.log(`[poker-arena] ${signal} received, shutting down...`);
    server.close(() => {
      console.log('[poker-arena] Server closed');
      process.exit(0);
    });
    // Force exit after 5s if server doesn't close gracefully
    setTimeout(() => process.exit(1), 5000);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();
