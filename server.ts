import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from './server/index.ts';
import { applySecurityHeaders } from './server/security-headers.ts';
import { closeDatabase } from './server/db/pool.ts';
import { closeStorage } from './server/storage/b2.ts';
import { attachRealtimeServer, closeRealtimeServer } from './server/realtime.ts';
import { initializeBackend } from './server/bootstrap.ts';
import { startRealtimeOutboxDispatcher } from './server/realtime-outbox.ts';
import { config } from './server/config.ts';
import { formatStartupError } from './server/errors.ts';
import { handleSeoRequest } from './server/seo/handler.ts';
import { getHttpsRedirectUrl } from './server/seo/site.ts';

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

  app.use((req, res, next) => {
    const method = (req.method || 'GET').toUpperCase();
    if (req.path !== '/health' && (method === 'GET' || method === 'HEAD')) {
      const httpsRedirect = getHttpsRedirectUrl(req);
      if (httpsRedirect) {
        res.redirect(301, httpsRedirect);
        return;
      }
    }
    next();
  });

  app.use((req, res, next) => {
    if (
      req.path === '/login' ||
      req.path === '/index.html' ||
      req.path === '/admin' ||
      req.path.startsWith('/admin/')
    ) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });

  // CORS middleware for cross-origin requests (admin frontend)
  const corsOrigins = ['https://zunari.duckdns.org'];
  if (config.adminOrigin) corsOrigins.push(config.adminOrigin);
  app.use(cors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Admin-Confirm-Password'],
  }));

  app.all(
    ['/api', '/api/*', '/health', '/verify-email', '/reset-password'],
    (req, res) => {
      handleRequest(req, res).catch(() => {
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
      });
    },
  );

  app.use((req, res, next) => {
    void handleSeoRequest(req, res)
      .then((handled) => {
        if (!handled) next();
      })
      .catch(() => {
        if (!res.headersSent) {
          res.status(503).type('text/plain').send('Service temporarily unavailable.');
        } else {
          res.destroy();
        }
      });
  });

  // Forward API, health, and auth callback routes to the backend request router
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const adminDistPath = path.resolve(distPath, 'admin');
    const adminIndexPath = path.resolve(adminDistPath, 'index.html');

    app.use('/admin', (req, res, next) => {
      applySecurityHeaders(req, res);
      next();
    });
    app.get('/admin', (_req, res) => {
      res.sendFile(adminIndexPath);
    });
    app.use('/admin', express.static(adminDistPath, { redirect: false }));
    app.use(express.static(distPath));

    // Client-side routes under /admin/ must serve the admin shell.
    app.get('/admin/*', (req, res, next) => {
      if (path.extname(req.path)) {
        next();
        return;
      }
      res.sendFile(adminIndexPath);
    });

    // Public SPA fallback must never handle admin paths.
    app.get('*', (req, res, next) => {
      if (req.path === '/admin' || req.path.startsWith('/admin/')) {
        next();
        return;
      }
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });

    app.use((_req, res) => {
      res.status(404).type('text/plain').send('Not found.');
    });
  }

  const httpServer = createHttpServer(app);
  await attachRealtimeServer(httpServer);
  const stopOutboxDispatcher = startRealtimeOutboxDispatcher();
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[${config.appName}] Server listening on http://0.0.0.0:${port}`);
  });

  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void (async () => {
        await stopOutboxDispatcher();
        await stopCleanup();
        await closeRealtimeServer();
        void Promise.all([closeDatabase(), Promise.resolve(closeStorage())])
          .then(() => process.exit(0))
          .catch(() => process.exit(1));
      })().catch(() => process.exit(1));
    });
  }
}

startDevelopmentServer().catch((error) => {
  console.error(`Failed to start server: ${formatStartupError(error)}`);
  process.exit(1);
});
