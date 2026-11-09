import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from './server/index.ts';
import { closeDatabase } from './server/db/pool.ts';
import { closeStorage } from './server/storage/b2.ts';
import { attachRealtimeServer, closeRealtimeServer } from './server/realtime.ts';
import { initializeBackend } from './server/bootstrap.ts';
import { config } from './server/config.ts';
import { formatStartupError } from './server/errors.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, path.basename(__dirname) === 'dist' ? '.' : 'dist');
const port = Number(process.env.PORT) || config.port;
const isProduction =
  process.env.NODE_ENV === 'production' ||
  (path.basename(__filename) === 'server.js' && path.basename(__dirname) === 'dist');

async function startDevelopmentServer(): Promise<void> {
  const stopCleanup = await initializeBackend();

  const app = express();

  // CORS middleware for cross-origin requests (admin frontend)
  const corsOrigins = ['https://zunari.duckdns.org'];
  if (config.adminOrigin) corsOrigins.push(config.adminOrigin);
  app.use(cors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  }));

  app.all(
    ['/api', '/api/*', '/health', '/verify-email', '/reset-password'],
    (req, res) => {
      handleRequest(req, res).catch(() => {
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
      });
    },
  );

  // Forward API, health, and auth callback routes to the backend request router
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  const httpServer = createHttpServer(app);
  console.info('[startup] Attaching realtime WebSocket server...');
  attachRealtimeServer(httpServer);
  console.info('[startup] Realtime WebSocket server attached.');

  console.info(`[startup] Binding server to 0.0.0.0:${port}...`);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[${config.appName}] Server listening on http://0.0.0.0:${port}`);
  });

  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      stopCleanup();
      void closeRealtimeServer().then(() => {
        void Promise.all([closeDatabase(), Promise.resolve(closeStorage())])
          .then(() => process.exit(0))
          .catch(() => process.exit(1));
      });
    });
  }
}

startDevelopmentServer().catch((error) => {
  console.error(`Failed to start server: ${formatStartupError(error)}`);
  process.exit(1);
});
