import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  PUBLIC_AUTHOR_POSTS_SQL,
  PUBLIC_POST_BY_ID_SQL,
  PUBLIC_POST_REPLIES_SQL,
  PUBLIC_PROFILE_SQL,
  PUBLIC_RECENT_POSTS_SQL,
  SITEMAP_POSTS_SQL,
  SITEMAP_PROFILES_SQL,
  type PublicPost,
  type PublicProfile,
} from './seo/data.ts';
import { createSeoHandler, type SeoDataSource } from './seo/handler.ts';
import {
  buildSitemapEntries,
  buildSitemapIndexUrls,
  renderHomePage,
  renderNotFoundPage,
  renderPostPage,
  renderProfilePage,
  renderRobotsTxt,
  renderSitemapIndex,
  renderUrlSet,
} from './seo/render.ts';
import {
  escapeHtml,
  escapeXml,
  getHttpsRedirectUrl,
  getSiteOrigin,
  normalizeSiteOrigin,
  safeHttpUrl,
  truncate,
} from './seo/site.ts';

const ORIGIN = 'https://zunari.duckdns.org';

class TestResponse extends EventEmitter {
  statusCode = 0;
  headersSent = false;
  writableEnded = false;
  headers = new Map<string, string | number>();
  chunks: Buffer[] = [];

  setHeader(name: string, value: string | number): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  getHeader(name: string): string | number | undefined {
    return this.headers.get(name.toLowerCase());
  }

  end(chunk?: Uint8Array): this {
    if (chunk) this.chunks.push(Buffer.from(chunk));
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }

  body(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function request(path: string, method = 'GET', headers: Record<string, string> = {}): IncomingMessage {
  return {
    method,
    url: path,
    headers: { host: 'localhost', ...headers },
    socket: {},
  } as unknown as IncomingMessage;
}

function response(): TestResponse {
  return new TestResponse();
}

function profile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id: 'user_alice',
    username: 'alice',
    name: 'Alice Example',
    avatarUrl: 'https://images.example.com/alice.jpg',
    bannerUrl: null,
    bio: 'Builder of useful things & public posts.',
    location: 'Lisbon',
    website: 'https://alice.example.com',
    verified: true,
    isGold: false,
    followersCount: 12,
    followingCount: 7,
    joinedDate: 'Joined March 2021',
    createdAt: Date.parse('2021-03-01T00:00:00.000Z'),
    suspendedAt: null,
    ...overrides,
  };
}

function post(overrides: Partial<PublicPost> = {}): PublicPost {
  return {
    id: 'post_1',
    content: 'Hello <Zunari> & welcome to my public post.',
    mediaUrls: [],
    replyToId: null,
    replyToAuthor: null,
    createdAt: Date.parse('2024-05-01T12:00:00.000Z'),
    likesCount: 4,
    repostsCount: 2,
    repliesCount: 1,
    viewsCount: 100,
    author: profile(),
    ...overrides,
  };
}

function dataSource(overrides: Partial<SeoDataSource> = {}): SeoDataSource {
  return {
    getRecentPosts: async () => [],
    getProfileByUsername: async () => null,
    getProfilePosts: async () => [],
    getPostById: async () => null,
    getPostReplies: async () => [],
    getSitemapCounts: async () => ({ profiles: 0, posts: 0, latestPostAt: null }),
    getSitemapProfiles: async () => [],
    getSitemapPosts: async () => [],
    ...overrides,
  };
}

test('site origin normalization never publishes localhost and upgrades to HTTPS', () => {
  assert.equal(normalizeSiteOrigin('http://localhost:3000'), null);
  assert.equal(normalizeSiteOrigin('http://127.0.0.1:3000'), null);
  assert.equal(normalizeSiteOrigin('http://zunari.duckdns.org/path?q=1'), 'https://zunari.duckdns.org');
  assert.equal(normalizeSiteOrigin('https://example.com:8443/'), 'https://example.com:8443');
  assert.equal(
    getSiteOrigin({ SITE_ORIGIN: 'http://localhost:3000' } as NodeJS.ProcessEnv),
    ORIGIN,
  );
  assert.equal(
    getSiteOrigin({ APP_URL: 'http://zunari.duckdns.org' } as NodeJS.ProcessEnv),
    ORIGIN,
  );
});

test('HTTPS redirects only target the exact production host', () => {
  const insecure = request('/u/alice?x=1', 'GET', {
    host: 'zunari.duckdns.org',
    'x-forwarded-proto': 'http',
  });
  assert.equal(getHttpsRedirectUrl(insecure), 'https://zunari.duckdns.org/u/alice?x=1');

  const portHost = request('/', 'GET', {
    host: 'zunari.duckdns.org:80',
    'x-forwarded-proto': 'http',
  });
  assert.equal(getHttpsRedirectUrl(portHost), 'https://zunari.duckdns.org/');

  for (const host of ['evilzunari.duckdns.org', 'zunari.duckdns.org.evil.example', 'localhost']) {
    const spoofed = request('/', 'GET', { host, 'x-forwarded-proto': 'http' });
    assert.equal(getHttpsRedirectUrl(spoofed), null);
  }

  const alreadySecure = request('/', 'GET', {
    host: 'zunari.duckdns.org',
    'x-forwarded-proto': 'https',
  });
  assert.equal(getHttpsRedirectUrl(alreadySecure), null);
});

test('media URLs stay on the public file endpoint or explicit HTTPS origins', () => {
  assert.equal(safeHttpUrl('/api/files/asset_1', ORIGIN), `${ORIGIN}/api/files/asset_1`);
  assert.equal(safeHttpUrl('/api/files/../../admin', ORIGIN), null);
  assert.equal(safeHttpUrl('javascript:alert(1)', ORIGIN), null);
  assert.equal(safeHttpUrl('https://cdn.example.com/a.jpg', ORIGIN), 'https://cdn.example.com/a.jpg');
});

test('HTML and XML escaping handle user-controlled content safely', () => {
  assert.equal(escapeHtml(`<script>"x" & 'y'</script>`), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  assert.equal(escapeXml(`<loc>a&b</loc>`), '&lt;loc&gt;a&amp;b&lt;/loc&gt;');
  assert.equal(truncate('a'.repeat(200), 20).length, 20);
  assert.match(truncate('one   two\nthree', 80), /^one two three$/);
});

test('homepage renders real metadata, canonical, social tags, and content', () => {
  const html = renderHomePage([post()], ORIGIN);
  assert.match(html, /<title>Zunari/);
  assert.match(html, /<link rel="canonical" href="https:\/\/zunari\.duckdns\.org\/" \/>/);
  assert.match(html, /<meta property="og:type" content="website" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(html, /"@type":"WebSite"/);
  assert.match(html, /Hello &lt;Zunari&gt; &amp; welcome/);
  assert.match(html, /href="https:\/\/zunari\.duckdns\.org\/u\/alice"/);
});

test('profile and post pages render canonical metadata and accurate structured data', () => {
  const profileHtml = renderProfilePage(profile(), [post()], ORIGIN);
  assert.match(profileHtml, /Alice Example \(@alice\) on Zunari/);
  assert.match(profileHtml, /<link rel="canonical" href="https:\/\/zunari\.duckdns\.org\/u\/alice" \/>/);
  assert.match(profileHtml, /<meta property="og:type" content="profile" \/>/);
  assert.match(profileHtml, /"@type":"Person"/);
  assert.match(profileHtml, /"alternateName":"alice"/);

  const postHtml = renderPostPage(
    post(),
    [post({ id: 'post_2', content: 'A public reply.', replyToId: 'post_1' })],
    ORIGIN,
  );
  assert.match(postHtml, /<link rel="canonical" href="https:\/\/zunari\.duckdns\.org\/post\/post_1" \/>/);
  assert.match(postHtml, /<meta property="og:type" content="article" \/>/);
  assert.match(postHtml, /"@type":"SocialMediaPosting"/);
  assert.match(postHtml, /"articleBody":"Hello \\u003cZunari\\u003e/);
  assert.match(postHtml, /"@type":"Comment"/);
});

test('Google Search Console verification meta is rendered only when configured', () => {
  const previous = process.env.GOOGLE_SITE_VERIFICATION;
  try {
    delete process.env.GOOGLE_SITE_VERIFICATION;
    assert.doesNotMatch(renderHomePage([], ORIGIN), /google-site-verification/);
    process.env.GOOGLE_SITE_VERIFICATION = 'owner-supplied-token_123';
    assert.match(
      renderHomePage([], ORIGIN),
      /<meta name="google-site-verification" content="owner-supplied-token_123" \/>/,
    );
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_SITE_VERIFICATION;
    else process.env.GOOGLE_SITE_VERIFICATION = previous;
  }
});

test('404 pages are real noindex responses and never claim success', () => {
  const html = renderNotFoundPage('profile', ORIGIN);
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(html, /Profile not found/);
});

test('sitemap entries include only eligible public content and are deduplicated', () => {
  const entries = buildSitemapEntries(
    ORIGIN,
    [
      { username: 'alice', suspendedAt: null },
      { username: 'alice', suspendedAt: null },
      { username: 'suspended', suspendedAt: Date.now() },
    ],
    [
      { id: 'post_1', createdAt: Date.parse('2024-05-01T12:00:00.000Z'), authorSuspendedAt: null },
      { id: 'post_1', createdAt: Date.parse('2024-05-01T12:00:00.000Z'), authorSuspendedAt: null },
      { id: 'post_2', createdAt: Date.parse('2024-05-02T12:00:00.000Z'), authorSuspendedAt: Date.now() },
    ],
    Date.parse('2024-05-01T12:00:00.000Z'),
  );
  const locations = entries.map((entry) => entry.loc);
  assert.deepEqual(locations, [
    'https://zunari.duckdns.org/',
    'https://zunari.duckdns.org/u/alice',
    'https://zunari.duckdns.org/post/post_1',
  ]);
  assert.equal(entries[0].lastmod, '2024-05-01T12:00:00.000Z');
});

test('sitemap XML is valid, escaped, and free of duplicate URLs', () => {
  const xml = renderUrlSet([
    { loc: 'https://zunari.duckdns.org/' },
    { loc: 'https://zunari.duckdns.org/u/a&b' },
    { loc: 'https://zunari.duckdns.org/u/a&b' },
    { loc: 'https://zunari.duckdns.org/post/post_1', lastmod: '2024-05-01T12:00:00.000Z' },
  ]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<url>/g) || []).length, 3);
  assert.match(xml, /a&amp;b/);
  assert.match(xml, /<lastmod>2024-05-01T12:00:00.000Z<\/lastmod>/);
  assert.doesNotMatch(xml, /<loc>https:\/\/zunari\.duckdns\.org\/u\/a&b<\/loc>/);
});

test('sitemap index paginates large content volumes', () => {
  const urls = buildSitemapIndexUrls(
    ORIGIN,
    { profiles: 20_001, posts: 40_001, latestPostAt: null },
    20_000,
  );
  assert.deepEqual(urls, [
    'https://zunari.duckdns.org/sitemaps/static-1.xml',
    'https://zunari.duckdns.org/sitemaps/profiles-1.xml',
    'https://zunari.duckdns.org/sitemaps/profiles-2.xml',
    'https://zunari.duckdns.org/sitemaps/posts-1.xml',
    'https://zunari.duckdns.org/sitemaps/posts-2.xml',
    'https://zunari.duckdns.org/sitemaps/posts-3.xml',
  ]);
  const xml = renderSitemapIndex(urls);
  assert.match(xml, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<sitemap>/g) || []).length, 6);
});

test('robots.txt allows public pages and assets while referencing the sitemap', () => {
  const robots = renderRobotsTxt(ORIGIN);
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Allow: \/assets\/$/m);
  assert.match(robots, /^Allow: \/api\/files\/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Disallow: \/admin$/m);
  assert.match(robots, /^Disallow: \/verify-email$/m);
  assert.match(robots, /^Disallow: \/reset-password$/m);
  assert.match(robots, /^Sitemap: https:\/\/zunari\.duckdns\.org\/sitemap\.xml$/m);
});

test('database queries enforce public visibility and suspension rules', () => {
  for (const sql of [
    PUBLIC_PROFILE_SQL,
    PUBLIC_POST_BY_ID_SQL,
    PUBLIC_RECENT_POSTS_SQL,
    PUBLIC_AUTHOR_POSTS_SQL,
    PUBLIC_POST_REPLIES_SQL,
    SITEMAP_PROFILES_SQL,
    SITEMAP_POSTS_SQL,
  ]) {
    assert.match(sql, /suspended_at IS NULL/);
  }
});

test('SEO routes return real status codes and content types', async () => {
  const handler = createSeoHandler({
    dataSource: dataSource({
      getRecentPosts: async () => [post()],
      getProfileByUsername: async (username) => username.toLowerCase() === 'alice' ? profile() : null,
      getProfilePosts: async () => [post()],
      getPostById: async (id) => id === 'post_1' ? post() : null,
      getPostReplies: async () => [],
      getSitemapCounts: async () => ({
        profiles: 1,
        posts: 1,
        latestPostAt: Date.parse('2024-05-01T12:00:00.000Z'),
      }),
      getSitemapProfiles: async () => [{ username: 'alice', suspendedAt: null }],
      getSitemapPosts: async () => [
        {
          id: 'post_1',
          createdAt: Date.parse('2024-05-01T12:00:00.000Z'),
          authorSuspendedAt: null,
        },
      ],
    }),
    isAuthenticated: async () => false,
  });

  const home = response();
  assert.equal(await handler(request('/'), home as unknown as ServerResponse), true);
  assert.equal(home.statusCode, 200);
  assert.equal(home.getHeader('content-type'), 'text/html; charset=utf-8');
  assert.match(home.body(), /Recent public posts/);

  const profilePage = response();
  assert.equal(await handler(request('/u/alice'), profilePage as unknown as ServerResponse), true);
  assert.equal(profilePage.statusCode, 200);
  assert.match(profilePage.body(), /Public posts by Alice Example/);

  const canonicalRedirect = response();
  assert.equal(
    await handler(request('/u/ALICE'), canonicalRedirect as unknown as ServerResponse),
    true,
  );
  assert.equal(canonicalRedirect.statusCode, 301);
  assert.equal(canonicalRedirect.getHeader('location'), '/u/alice');

  const aliasRedirect = response();
  assert.equal(
    await handler(request('/@alice/'), aliasRedirect as unknown as ServerResponse),
    true,
  );
  assert.equal(aliasRedirect.statusCode, 301);
  assert.equal(aliasRedirect.getHeader('location'), '/u/alice');

  const postPage = response();
  assert.equal(await handler(request('/post/post_1'), postPage as unknown as ServerResponse), true);
  assert.equal(postPage.statusCode, 200);
  assert.match(postPage.body(), /Post by Alice Example/);

  const missingProfile = response();
  assert.equal(
    await handler(request('/u/missing'), missingProfile as unknown as ServerResponse),
    true,
  );
  assert.equal(missingProfile.statusCode, 404);
  assert.equal(missingProfile.getHeader('x-robots-tag'), 'noindex, nofollow');

  const missingPost = response();
  assert.equal(
    await handler(request('/post/post_missing'), missingPost as unknown as ServerResponse),
    true,
  );
  assert.equal(missingPost.statusCode, 404);

  const sitemap = response();
  assert.equal(await handler(request('/sitemap.xml'), sitemap as unknown as ServerResponse), true);
  assert.equal(sitemap.statusCode, 200);
  assert.equal(sitemap.getHeader('content-type'), 'application/xml; charset=utf-8');
  assert.match(sitemap.body(), /<urlset/);
  assert.match(sitemap.body(), /https:\/\/zunari\.duckdns\.org\/u\/alice/);
  assert.match(sitemap.body(), /https:\/\/zunari\.duckdns\.org\/post\/post_1/);

  const robots = response();
  assert.equal(await handler(request('/robots.txt'), robots as unknown as ServerResponse), true);
  assert.equal(robots.statusCode, 200);
  assert.equal(robots.getHeader('content-type'), 'text/plain; charset=utf-8');
  assert.match(robots.body(), /Sitemap: https:\/\/zunari\.duckdns\.org\/sitemap\.xml/);
});

test('authenticated homepage requests fall through to the existing SPA', async () => {
  const handler = createSeoHandler({
    dataSource: dataSource(),
    isAuthenticated: async () => true,
  });
  const res = response();
  assert.equal(await handler(request('/'), res as unknown as ServerResponse), false);
  assert.equal(res.statusCode, 0);
  assert.equal(res.body(), '');
});

test('SEO routes handle database failures without leaking details', async () => {
  const handler = createSeoHandler({
    dataSource: dataSource({
      getRecentPosts: async () => { throw new Error('database password leaked'); },
      getProfileByUsername: async () => { throw new Error('database password leaked'); },
      getSitemapCounts: async () => { throw new Error('database password leaked'); },
    }),
    isAuthenticated: async () => false,
  });

  const home = response();
  assert.equal(await handler(request('/'), home as unknown as ServerResponse), true);
  assert.equal(home.statusCode, 503);
  assert.equal(home.getHeader('retry-after'), '60');
  assert.doesNotMatch(home.body(), /password|database/i);

  const profilePage = response();
  assert.equal(await handler(request('/u/alice'), profilePage as unknown as ServerResponse), true);
  assert.equal(profilePage.statusCode, 503);

  const sitemap = response();
  assert.equal(await handler(request('/sitemap.xml'), sitemap as unknown as ServerResponse), true);
  assert.equal(sitemap.statusCode, 503);
  assert.doesNotMatch(sitemap.body(), /password|database/i);
});

test('SEO routes reject unsupported methods and support HEAD', async () => {
  const handler = createSeoHandler({
    dataSource: dataSource({ getRecentPosts: async () => [post()] }),
    isAuthenticated: async () => false,
  });
  const postResponse = response();
  assert.equal(
    await handler(request('/sitemap.xml', 'POST'), postResponse as unknown as ServerResponse),
    true,
  );
  assert.equal(postResponse.statusCode, 405);
  assert.equal(postResponse.getHeader('allow'), 'GET, HEAD');

  const headResponse = response();
  assert.equal(
    await handler(request('/', 'HEAD'), headResponse as unknown as ServerResponse),
    true,
  );
  assert.equal(headResponse.statusCode, 200);
  assert.equal(headResponse.body(), '');
  assert.ok(Number(headResponse.getHeader('content-length')) > 0);
});
