import type { IncomingMessage, ServerResponse } from 'node:http';
import { getSession } from '../auth.ts';
import { applySecurityHeaders } from '../security-headers.ts';
import type { PublicPost, PublicProfile, SitemapCounts } from './data.ts';
import { seoDataSource } from './data.ts';
import {
  buildSitemapEntries,
  buildSitemapIndexUrls,
  renderHomePage,
  renderNotFoundPage,
  renderPostPage,
  renderProfilePage,
  renderRobotsTxt,
  renderServiceUnavailablePage,
  renderSitemapIndex,
  renderUrlSet,
} from './render.ts';
import {
  getHttpsRedirectUrl,
  getSiteOrigin,
  postPath,
  profilePath,
} from './site.ts';

const SINGLE_SITEMAP_LIMIT = 5_000;
const SITEMAP_CHUNK_SIZE = 20_000;
const MAX_SITEMAP_CHUNK = 100_000;
const PUBLIC_PAGE_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const SITEMAP_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

export interface SeoDataSource {
  getRecentPosts(limit: number): Promise<PublicPost[]>;
  getProfileByUsername(username: string): Promise<PublicProfile | null>;
  getProfilePosts(authorId: string, limit: number): Promise<PublicPost[]>;
  getPostById(postId: string): Promise<PublicPost | null>;
  getPostReplies(postId: string, limit: number): Promise<PublicPost[]>;
  getSitemapCounts(): Promise<SitemapCounts>;
  getSitemapProfiles(
    limit: number,
    offset: number,
  ): Promise<Array<{ username: string; suspendedAt?: number | null }>>;
  getSitemapPosts(
    limit: number,
    offset: number,
  ): Promise<Array<{ id: string; createdAt: number; authorSuspendedAt?: number | null }>>;
}

export interface SeoDependencies {
  dataSource: SeoDataSource;
  isAuthenticated: (req: IncomingMessage) => Promise<boolean>;
}

const defaultDependencies: SeoDependencies = {
  dataSource: seoDataSource,
  isAuthenticated: async (req) => {
    try {
      const session = await getSession(req);
      return Boolean(session?.userId);
    } catch {
      return false;
    }
  },
};

type SendOptions = {
  cacheControl?: string;
  robots?: string;
  headers?: Record<string, string>;
};

function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  options: SendOptions = {},
): void {
  const buffer = Buffer.from(body);
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', options.cacheControl || 'no-store');
  if (options.robots) res.setHeader('X-Robots-Tag', options.robots);
  for (const [name, value] of Object.entries(options.headers || {})) {
    res.setHeader(name, value);
  }
  if ((req.method || 'GET').toUpperCase() === 'HEAD') {
    res.end();
    return;
  }
  res.end(buffer);
}

function sendHtml(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  html: string,
  options: SendOptions = {},
): void {
  send(req, res, status, 'text/html; charset=utf-8', html, options);
}

function sendXml(req: IncomingMessage, res: ServerResponse, status: number, xml: string): void {
  send(req, res, status, 'application/xml; charset=utf-8', xml, {
    cacheControl: SITEMAP_CACHE,
  });
}

function sendText(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  text: string,
  options: SendOptions = {},
): void {
  send(req, res, status, 'text/plain; charset=utf-8', text, options);
}

function redirect(req: IncomingMessage, res: ServerResponse, location: string): void {
  res.statusCode = 301;
  res.setHeader('Location', location);
  res.setHeader('Content-Length', '0');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if ((req.method || 'GET').toUpperCase() === 'HEAD') {
    res.end();
    return;
  }
  res.end();
}

function parseRequestUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url || '/', 'http://localhost');
  } catch {
    return null;
  }
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isUsername(value: string): boolean {
  return /^[A-Za-z0-9_]{3,32}$/.test(value);
}

function isPostId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isSeoPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.startsWith('/sitemaps/') ||
    pathname.startsWith('/u/') ||
    pathname.startsWith('/post/') ||
    /^\/(?:@|%40)[^/]+\/?$/i.test(pathname)
  );
}

function sendServiceUnavailable(req: IncomingMessage, res: ServerResponse, origin: string): void {
  sendHtml(req, res, 503, renderServiceUnavailablePage(origin), {
    cacheControl: 'no-store',
    robots: 'noindex, nofollow',
    headers: { 'Retry-After': '60' },
  });
}

function sendNotFound(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  kind: 'profile' | 'post' | 'page',
): void {
  sendHtml(req, res, 404, renderNotFoundPage(kind, origin), {
    cacheControl: 'no-store',
    robots: 'noindex, nofollow',
  });
}

async function handleSitemapRoot(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  dataSource: SeoDataSource,
): Promise<void> {
  try {
    const counts = await dataSource.getSitemapCounts();
    const total = 1 + counts.profiles + counts.posts;
    if (total <= SINGLE_SITEMAP_LIMIT) {
      const [profiles, posts] = await Promise.all([
        counts.profiles > 0
          ? dataSource.getSitemapProfiles(counts.profiles, 0)
          : Promise.resolve([]),
        counts.posts > 0
          ? dataSource.getSitemapPosts(counts.posts, 0)
          : Promise.resolve([]),
      ]);
      const entries = buildSitemapEntries(origin, profiles, posts, counts.latestPostAt);
      sendXml(req, res, 200, renderUrlSet(entries));
      return;
    }
    sendXml(
      req,
      res,
      200,
      renderSitemapIndex(buildSitemapIndexUrls(origin, counts, SITEMAP_CHUNK_SIZE)),
    );
  } catch {
    sendText(req, res, 503, 'Sitemap temporarily unavailable. Please try again shortly.\n', {
      cacheControl: 'no-store',
      robots: 'noindex, nofollow',
      headers: { 'Retry-After': '60' },
    });
  }
}

async function handleSitemapChunk(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  dataSource: SeoDataSource,
  kind: string,
  chunk: number,
): Promise<void> {
  if (!Number.isSafeInteger(chunk) || chunk < 1 || chunk > MAX_SITEMAP_CHUNK) {
    sendText(req, res, 404, 'Sitemap not found.\n', { robots: 'noindex, nofollow' });
    return;
  }
  if (kind === 'static') {
    if (chunk !== 1) {
      sendText(req, res, 404, 'Sitemap not found.\n', { robots: 'noindex, nofollow' });
      return;
    }
    let latestPostAt: number | null = null;
    try {
      latestPostAt = (await dataSource.getSitemapCounts()).latestPostAt;
    } catch {
      latestPostAt = null;
    }
    const entries = buildSitemapEntries(origin, [], [], latestPostAt);
    sendXml(req, res, 200, renderUrlSet(entries));
    return;
  }

  const offset = (chunk - 1) * SITEMAP_CHUNK_SIZE;
  try {
    if (kind === 'profiles') {
      const profiles = await dataSource.getSitemapProfiles(SITEMAP_CHUNK_SIZE, offset);
      if (profiles.length === 0) {
        sendText(req, res, 404, 'Sitemap not found.\n', { robots: 'noindex, nofollow' });
        return;
      }
      sendXml(req, res, 200, renderUrlSet(buildSitemapEntries(origin, profiles, [], null, false)));
      return;
    }
    if (kind === 'posts') {
      const posts = await dataSource.getSitemapPosts(SITEMAP_CHUNK_SIZE, offset);
      if (posts.length === 0) {
        sendText(req, res, 404, 'Sitemap not found.\n', { robots: 'noindex, nofollow' });
        return;
      }
      sendXml(req, res, 200, renderUrlSet(buildSitemapEntries(origin, [], posts, null, false)));
      return;
    }
    sendText(req, res, 404, 'Sitemap not found.\n', { robots: 'noindex, nofollow' });
  } catch {
    sendText(req, res, 503, 'Sitemap temporarily unavailable. Please try again shortly.\n', {
      cacheControl: 'no-store',
      robots: 'noindex, nofollow',
      headers: { 'Retry-After': '60' },
    });
  }
}

export function createSeoHandler(
  overrides: Partial<SeoDependencies> = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const dependencies: SeoDependencies = { ...defaultDependencies, ...overrides };
  const origin = getSiteOrigin();

  return async function handleSeoRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = parseRequestUrl(req);
    if (!url) return false;
    const pathname = url.pathname;
    if (!isSeoPath(pathname)) return false;

    applySecurityHeaders(req, res);

    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendText(req, res, 405, 'Method not allowed.\n', {
        cacheControl: 'no-store',
        robots: 'noindex, nofollow',
      });
      return true;
    }

    const httpsRedirect = getHttpsRedirectUrl(req, url);
    if (httpsRedirect) {
      redirect(req, res, httpsRedirect);
      return true;
    }

    if (pathname === '/robots.txt') {
      sendText(req, res, 200, renderRobotsTxt(origin), {
        cacheControl: 'public, max-age=3600',
      });
      return true;
    }

    if (pathname === '/sitemap.xml') {
      await handleSitemapRoot(req, res, origin, dependencies.dataSource);
      return true;
    }

    const chunkMatch = /^\/sitemaps\/(static|profiles|posts)-(\d+)\.xml$/.exec(pathname);
    if (chunkMatch) {
      await handleSitemapChunk(
        req,
        res,
        origin,
        dependencies.dataSource,
        chunkMatch[1],
        Number(chunkMatch[2]),
      );
      return true;
    }

    if (pathname === '/') {
      let authenticated = false;
      try {
        authenticated = await dependencies.isAuthenticated(req);
      } catch {
        authenticated = false;
      }
      if (authenticated) return false;
      try {
        const posts = await dependencies.dataSource.getRecentPosts(20);
        sendHtml(req, res, 200, renderHomePage(posts, origin), {
          cacheControl: PUBLIC_PAGE_CACHE,
          robots: 'index, follow',
        });
      } catch {
        sendServiceUnavailable(req, res, origin);
      }
      return true;
    }

    const aliasMatch = /^\/(?:@|%40)([^/]+)\/?$/i.exec(pathname);
    if (aliasMatch) {
      const decoded = safeDecode(aliasMatch[1]);
      if (!decoded || !isUsername(decoded)) {
        sendNotFound(req, res, origin, 'profile');
        return true;
      }
      redirect(req, res, profilePath(decoded));
      return true;
    }

    const profileTrailingMatch = /^\/u\/([^/]+)\/$/.exec(pathname);
    if (profileTrailingMatch) {
      const decoded = safeDecode(profileTrailingMatch[1]);
      if (!decoded || !isUsername(decoded)) {
        sendNotFound(req, res, origin, 'profile');
        return true;
      }
      redirect(req, res, profilePath(decoded));
      return true;
    }

    const postTrailingMatch = /^\/post\/([^/]+)\/$/.exec(pathname);
    if (postTrailingMatch) {
      const decoded = safeDecode(postTrailingMatch[1]);
      if (!decoded || !isPostId(decoded)) {
        sendNotFound(req, res, origin, 'post');
        return true;
      }
      redirect(req, res, postPath(decoded));
      return true;
    }

    const profileMatch = /^\/u\/([^/]+)$/.exec(pathname);
    if (profileMatch) {
      const decoded = safeDecode(profileMatch[1]);
      if (!decoded || !isUsername(decoded)) {
        sendNotFound(req, res, origin, 'profile');
        return true;
      }
      try {
        const profile = await dependencies.dataSource.getProfileByUsername(decoded);
        if (!profile) {
          sendNotFound(req, res, origin, 'profile');
          return true;
        }
        const canonicalUsername = profile.username.toLowerCase();
        if (decoded.toLowerCase() !== canonicalUsername || decoded !== canonicalUsername) {
          redirect(req, res, profilePath(canonicalUsername));
          return true;
        }
        const posts = await dependencies.dataSource.getProfilePosts(profile.id, 20);
        sendHtml(req, res, 200, renderProfilePage(profile, posts, origin), {
          cacheControl: PUBLIC_PAGE_CACHE,
          robots: 'index, follow',
        });
      } catch {
        sendServiceUnavailable(req, res, origin);
      }
      return true;
    }

    const postMatch = /^\/post\/([^/]+)$/.exec(pathname);
    if (postMatch) {
      const decoded = safeDecode(postMatch[1]);
      if (!decoded || !isPostId(decoded)) {
        sendNotFound(req, res, origin, 'post');
        return true;
      }
      try {
        const post = await dependencies.dataSource.getPostById(decoded);
        if (!post) {
          sendNotFound(req, res, origin, 'post');
          return true;
        }
        const replies = await dependencies.dataSource.getPostReplies(post.id, 20);
        sendHtml(req, res, 200, renderPostPage(post, replies, origin), {
          cacheControl: PUBLIC_PAGE_CACHE,
          robots: 'index, follow',
        });
      } catch {
        sendServiceUnavailable(req, res, origin);
      }
      return true;
    }

    sendNotFound(req, res, origin, 'page');
    return true;
  };
}

export const handleSeoRequest = createSeoHandler();
