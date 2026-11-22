import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSeoHandler, type SeoDataSource } from './seo/handler.ts';

function makeDataSource(): SeoDataSource {
  return {
    getRecentPosts: async () => [],
    getProfileByUsername: async () => null,
    getProfilePosts: async () => [],
    getPostById: async () => null,
    getPostReplies: async () => [],
    getSitemapCounts: async () => ({ profiles: 0, posts: 0, latestPostAt: null }),
    getSitemapProfiles: async () => [],
    getSitemapPosts: async () => [],
  };
}

function seoRequest(path: string): IncomingMessage {
  return {
    method: 'GET',
    url: path,
    headers: { host: 'localhost' },
    socket: {},
  } as unknown as IncomingMessage;
}

function createApp() {
  const app = express();

  // Non-indexable shell and private routes (mirrors server.ts middleware).
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

  app.use((req, res, next) => {
    void createSeoHandler({ dataSource: makeDataSource() })(req, res).then((handled) => {
      if (!handled) next();
    }).catch(() => next());
  });

  // Public SPA shell fallback (mirrors server.ts production fallback).
  app.get('*', (req, res, next) => {
    if (req.path === '/admin' || req.path.startsWith('/admin/')) {
      next();
      return;
    }
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.status(200).send('SPA shell');
  });

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found.');
  });

  return app;
}

async function requestHtml(app: express.Express, path: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      void fetch(`http://127.0.0.1:${port}${path}`)
        .then(async (res) => {
          const headers: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            headers[key] = value;
          });
          resolve({ status: res.status, headers, body: await res.text() });
        })
        .catch(reject)
        .finally(() => void server.close());
    });
  });
}

test('SEO middleware stack: sitemaps are not noindexed while shell, login, admin, and 404 retain directives', async () => {
  const app = createApp();

  const sitemap = await requestHtml(app, '/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.equal(sitemap.headers['content-type'], 'application/xml; charset=utf-8');
  assert.equal(sitemap.headers['x-robots-tag'], undefined);

  const chunk = await requestHtml(app, '/sitemaps/static-1.xml');
  assert.equal(chunk.status, 200);
  assert.equal(chunk.headers['x-robots-tag'], undefined);
  assert.match(chunk.body, /<urlset/);

  const login = await requestHtml(app, '/login');
  assert.equal(login.status, 200);
  assert.equal(login.headers['x-robots-tag'], 'noindex, nofollow');

  const admin = await requestHtml(app, '/admin');
  assert.equal(admin.headers['x-robots-tag'], 'noindex, nofollow');

  const adminNested = await requestHtml(app, '/admin/settings');
  assert.equal(adminNested.headers['x-robots-tag'], 'noindex, nofollow');

  const shell = await requestHtml(app, '/settings');
  assert.equal(shell.status, 200);
  assert.equal(shell.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(shell.body, 'SPA shell');

  const seoNotFound = await requestHtml(app, '/u/no-such-user');
  assert.equal(seoNotFound.status, 404);
  assert.equal(seoNotFound.headers['x-robots-tag'], 'noindex, nofollow');

  const missing = await requestHtml(app, '/no-such-page');
  assert.equal(missing.status, 200);
  assert.equal(missing.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(missing.body, 'SPA shell');
});
