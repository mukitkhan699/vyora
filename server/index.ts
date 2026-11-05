import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { closeDatabase } from './db/pool.ts';
import { closeStorage } from './storage/b2.ts';
import { initializeBackend } from './bootstrap.ts';
import { attachRealtimeServer, closeRealtimeServer } from './realtime.ts';
import { handleApiRequest } from './routes/api.ts';
import {
  renderEmailVerificationPage,
  renderPasswordResetPage,
  setAuthError,
} from './auth.ts';
import { formatStartupError } from './errors.ts';

const parentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.basename(parentDir) === 'dist' ? parentDir : path.join(parentDir, 'dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function applySecurityHeaders(req: IncomingMessage, res: ServerResponse, nonce: string): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: http: ws: wss:; media-src 'self' blob: https:; frame-ancestors *;",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const isEncrypted = Boolean((req.socket as { encrypted?: boolean }).encrypted);
  if (isEncrypted) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  const body = Buffer.from(html);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  const body = Buffer.from(text);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function withNonce(html: string, nonce: string): string {
  return html.replace(/<script>/g, `<script nonce="${nonce}">`);
}

function resolveStaticPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = path.resolve(distDir, relative);
  if (!candidate.startsWith(distDir + path.sep) && candidate !== path.join(distDir, 'index.html')) {
    return null;
  }
  return candidate;
}

function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string): boolean {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Cache-Control', isAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const nonce = randomBytes(16).toString('base64url');
  applySecurityHeaders(req, res, nonce);

  let url: URL;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendText(res, 400, 'Invalid request URL.');
    return;
  }

  const method = (req.method || 'GET').toUpperCase();
  const pathname = url.pathname;

  try {
    if (pathname === '/verify-email' && method === 'GET') {
      const page = renderEmailVerificationPage(url.searchParams.get('token') || '');
      sendHtml(res, page.status, withNonce(page.html, nonce));
      return;
    }

    if (pathname === '/reset-password' && method === 'GET') {
      const page = renderPasswordResetPage(url.searchParams.get('token') || '');
      sendHtml(res, page.status, withNonce(page.html, nonce));
      return;
    }

    if (pathname === '/health' && method === 'GET') {
      sendText(res, 200, 'ok');
      return;
    }

    if (pathname.startsWith('/api/')) {
      const handled = await handleApiRequest(req, res, url);
      if (!handled) {
        sendText(res, 404, 'Not found.');
      }
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendText(res, 405, 'Method not allowed.');
      return;
    }

    const staticPath = resolveStaticPath(pathname);
    if (staticPath && serveFile(req, res, staticPath)) return;

    if (pathname.startsWith('/assets/') || path.extname(pathname)) {
      sendText(res, 404, 'Not found.');
      return;
    }

    const indexPath = path.join(distDir, 'index.html');
    if (serveFile(req, res, indexPath)) return;

    sendText(
      res,
      503,
      'Zunari is running, but no frontend build was found. Run `npm run build` first.',
    );
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    setAuthError(res, error);
  }
}

export function createServer() {
  const server = createHttpServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (!res.headersSent) setAuthError(res, error);
      else res.destroy();
    });
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  server.timeout = 30_000;
  attachRealtimeServer(server);
  return server;
}

export async function startServer(): Promise<void> {
  const stopCleanup = await initializeBackend();
  const port = Number(process.env.PORT) || config.port || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();

  server.listen(port, host, () => {
    console.log(`${config.appName} server listening on http://${host}:${port}`);
    console.log(`Serving frontend from ${distDir}`);
  });

  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      stopCleanup();
      try {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      } catch {
        // Ignore.
      }
      void (async () => {
        await closeRealtimeServer();
        await Promise.all([closeDatabase(), Promise.resolve(closeStorage())]);
        process.exit(0);
      })();
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startServer().catch((error) => {
    console.error(`Failed to start server: ${formatStartupError(error)}`);
    process.exit(1);
  });
}
