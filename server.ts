import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from './server/index.ts';
import { initAuth } from './server/auth.ts';
import { config } from './server/config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = 3000;
const isProduction = process.env.NODE_ENV === 'production';

async function startDevelopmentServer(): Promise<void> {
  // Initialize SQLite database and seed initial demo users
  await initAuth();

  const app = express();

  // Forward API, health, and auth callback routes to the backend request router
  app.all(
    ['/api', '/api/*', '/health', '/verify-email', '/reset-password'],
    (req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error('API Error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      });
    },
  );

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[VYORA] Server listening on http://0.0.0.0:${port}`);
  });
}

startDevelopmentServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
