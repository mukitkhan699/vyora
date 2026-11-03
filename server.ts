import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from './server/index.ts';
import { initAuth } from './server/auth.ts';
import { config } from './server/config.ts';

async function startDevelopmentServer(): Promise<void> {
  await initAuth();
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const pathname = (req.url || '/').split('?')[0];
    const backendOwned =
      pathname.startsWith('/api/') ||
      pathname === '/health' ||
      pathname === '/verify-email' ||
      pathname === '/reset-password';

    if (backendOwned) {
      handleRequest(req, res).catch((error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Internal server error');
        } else {
          res.destroy();
        }
        console.error(error);
      });
      return;
    }

    vite.middlewares(req, res, (error?: unknown) => {
      if (error) {
        console.error(error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal server error');
        }
      }
    });
  });

  const port = Number(process.env.PORT) || config.port || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`${config.appName} dev server listening on http://0.0.0.0:${port}`);
  });
}

startDevelopmentServer().catch((error) => {
  console.error('Failed to start development server:', error);
  process.exit(1);
});
