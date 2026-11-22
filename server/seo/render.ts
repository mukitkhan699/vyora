import { config } from '../config.ts';
import type { PublicPost, PublicProfile, SitemapCounts } from './data.ts';
import {
  absoluteUrl,
  escapeHtml,
  escapeXml,
  getGoogleSiteVerification,
  jsonLd,
  postPath,
  profilePath,
  safeHttpUrl,
  safeWebsiteUrl,
  truncate,
} from './site.ts';

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

interface DocumentOptions {
  origin: string;
  title: string;
  description: string;
  canonical?: string;
  robots: string;
  ogType: string;
  image?: string | null;
  publishedTime?: string | null;
  profileUsername?: string | null;
  structuredData?: unknown;
  body: string;
}

const BRAND_NAME = config.appName || 'Zunari';
const BRAND_TAGLINE = config.appTagline || 'Real-Time Social Network';
const BRAND_DESCRIPTION =
  config.appDescription ||
  'A real-time social platform to share ideas, follow people, and join conversations.';

function logoUrl(origin: string): string {
  return absoluteUrl(origin, '/zunari-logo.jpg');
}

function formatIso(timestamp: number | null | undefined): string | null {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function formatDisplayDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

function renderDocument(options: DocumentOptions): string {
  const image = options.image || logoUrl(options.origin);
  const verification = getGoogleSiteVerification();
  const canonical = options.canonical
    ? `<link rel="canonical" href="${escapeHtml(options.canonical)}" />`
    : '';
  const structuredData = options.structuredData
    ? `<script type="application/ld+json">${jsonLd(options.structuredData)}</script>`
    : '';
  const publishedTime = options.publishedTime
    ? `<meta property="article:published_time" content="${escapeHtml(options.publishedTime)}" />`
    : '';
  const profileUsername = options.profileUsername
    ? `<meta property="profile:username" content="${escapeHtml(options.profileUsername)}" />`
    : '';
  const verificationMeta = verification
    ? `<meta name="google-site-verification" content="${escapeHtml(verification)}" />`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title)}</title>
  <meta name="description" content="${escapeHtml(options.description)}" />
  <meta name="robots" content="${escapeHtml(options.robots)}" />
  ${canonical}
  <meta property="og:site_name" content="${escapeHtml(BRAND_NAME)}" />
  <meta property="og:type" content="${escapeHtml(options.ogType)}" />
  <meta property="og:title" content="${escapeHtml(options.title)}" />
  <meta property="og:description" content="${escapeHtml(options.description)}" />
  <meta property="og:url" content="${escapeHtml(options.canonical || absoluteUrl(options.origin, '/'))}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:image:alt" content="${escapeHtml(`${BRAND_NAME} logo`)}" />
  ${publishedTime}
  ${profileUsername}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(options.title)}" />
  <meta name="twitter:description" content="${escapeHtml(options.description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <meta name="theme-color" content="#070a0f" />
  ${verificationMeta}
  <link rel="icon" type="image/jpeg" href="/zunari-logo.jpg" />
  <link rel="apple-touch-icon" href="/zunari-logo.jpg" />
  ${structuredData}
  <style>
    :root { color-scheme: dark; --bg:#070a0f; --panel:#0d121b; --panel-2:#111827; --border:#243041; --text:#e5edf7; --muted:#8b9bb0; --accent:#22d3ee; --accent-2:#a78bfa; }
    * { box-sizing: border-box; }
    html { background: var(--bg); }
    body { margin:0; background: radial-gradient(circle at 15% 0%, rgba(34,211,238,.12), transparent 32rem), radial-gradient(circle at 85% 10%, rgba(167,139,250,.10), transparent 30rem), var(--bg); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height:1.55; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .shell { width:min(100% - 2rem, 54rem); margin:0 auto; }
    header.site { border-bottom:1px solid var(--border); background:rgba(7,10,15,.78); backdrop-filter: blur(14px); position:sticky; top:0; z-index:10; }
    .site-inner { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.9rem 0; }
    .brand { display:flex; align-items:center; gap:.65rem; color:var(--text); font-weight:800; letter-spacing:-.02em; }
    .brand:hover { text-decoration:none; }
    .brand img { width:2rem; height:2rem; border-radius:.6rem; object-fit:cover; }
    nav.site-links { display:flex; align-items:center; gap:.75rem; font-size:.9rem; }
    nav.site-links a.secondary { color:var(--muted); }
    .button { display:inline-flex; align-items:center; justify-content:center; gap:.45rem; padding:.55rem .9rem; border-radius:999px; background:linear-gradient(135deg, var(--accent), #60a5fa); color:#041016; font-weight:800; border:0; }
    .button:hover { text-decoration:none; filter:brightness(1.08); }
    main { padding:2rem 0 3rem; }
    .hero { padding:1.2rem 0 1.6rem; }
    .eyebrow { margin:0 0 .5rem; color:var(--accent); font-size:.75rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
    h1 { margin:0; font-size:clamp(1.8rem, 4vw, 2.6rem); line-height:1.12; letter-spacing:-.035em; }
    h2 { margin:0 0 .85rem; font-size:1.15rem; letter-spacing:-.015em; }
    h3 { margin:0; font-size:1rem; }
    p { margin:.55rem 0; }
    .lede { max-width:44rem; color:var(--muted); font-size:1.02rem; }
    .panel { background:linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.012)); border:1px solid var(--border); border-radius:1.1rem; padding:1.1rem; }
    .section { margin-top:1.5rem; }
    .post { border:1px solid var(--border); border-radius:1rem; padding:1rem; background:var(--panel); margin-bottom:.85rem; }
    .post.reply { background:var(--panel-2); }
    .post-head { display:flex; flex-wrap:wrap; align-items:center; gap:.45rem; color:var(--muted); font-size:.86rem; margin-bottom:.55rem; }
    .post-head .author { color:var(--text); font-weight:750; }
    .post-head .handle { color:var(--muted); }
    .post-text { white-space:pre-wrap; overflow-wrap:anywhere; margin:.25rem 0 .7rem; }
    .post-actions { display:flex; flex-wrap:wrap; align-items:center; gap:1rem; color:var(--muted); font-size:.8rem; }
    .post-actions a { color:var(--muted); }
    .post-actions a:hover { color:var(--accent); }
    .media { display:grid; grid-template-columns:repeat(auto-fit, minmax(10rem, 1fr)); gap:.55rem; margin:.8rem 0; }
    .media img { width:100%; height:auto; max-height:22rem; object-fit:cover; border-radius:.8rem; border:1px solid var(--border); }
    .profile { display:flex; gap:1rem; align-items:flex-start; }
    .avatar { width:5.5rem; height:5.5rem; border-radius:999px; object-fit:cover; border:2px solid var(--border); background:var(--panel-2); flex:0 0 auto; }
    .avatar-fallback { width:5.5rem; height:5.5rem; border-radius:999px; display:flex; align-items:center; justify-content:center; font-size:1.6rem; font-weight:800; background:var(--panel-2); border:2px solid var(--border); color:var(--accent); flex:0 0 auto; }
    .profile-name { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; }
    .badge { display:inline-flex; align-items:center; border:1px solid var(--border); border-radius:999px; padding:.12rem .5rem; color:var(--accent); font-size:.7rem; font-weight:800; letter-spacing:.02em; }
    .meta { display:flex; flex-wrap:wrap; gap:.55rem 1rem; color:var(--muted); font-size:.84rem; margin-top:.65rem; }
    .muted { color:var(--muted); }
    .empty { color:var(--muted); border:1px dashed var(--border); border-radius:1rem; padding:1.2rem; text-align:center; }
    footer.site { border-top:1px solid var(--border); padding:1.4rem 0 2rem; color:var(--muted); font-size:.84rem; }
    footer.site .site-inner { align-items:flex-start; }
    @media (max-width: 640px) { .profile { flex-direction:column; } .site-inner { align-items:flex-start; } }
  </style>
</head>
<body>
  <header class="site">
    <div class="shell site-inner">
      <a class="brand" href="/"><img src="/zunari-logo.jpg" alt="${escapeHtml(BRAND_NAME)}" width="32" height="32" /><span>${escapeHtml(BRAND_NAME)}</span></a>
      <nav class="site-links" aria-label="Site">
        <a class="secondary" href="/">Public home</a>
        <a class="button" href="/login">Sign in</a>
      </nav>
    </div>
  </header>
  <main class="shell">
    ${options.body}
  </main>
  <footer class="site">
    <div class="shell site-inner">
      <div><strong>${escapeHtml(BRAND_NAME)}</strong> · ${escapeHtml(BRAND_TAGLINE)}</div>
      <div><a href="/">Public home</a> · <a href="/login">Sign in</a></div>
    </div>
  </footer>
</body>
</html>`;
}

function renderMedia(post: PublicPost, origin: string): string {
  const images = post.mediaUrls
    .map((url) => safeHttpUrl(url, origin))
    .filter((url): url is string => Boolean(url))
    .slice(0, 4);
  if (images.length === 0) return '';
  return `<div class="media">${images
    .map(
      (url) =>
        `<img src="${escapeHtml(url)}" alt="Image attached to a post by ${escapeHtml(post.author.name)}" loading="lazy" />`,
    )
    .join('')}</div>`;
}

function renderPostCard(post: PublicPost, origin: string, className = 'post'): string {
  const authorUrl = absoluteUrl(origin, profilePath(post.author.username));
  const postUrl = absoluteUrl(origin, postPath(post.id));
  const content = post.content.trim();
  return `<article class="${className}">
    <div class="post-head">
      <a class="author" href="${escapeHtml(authorUrl)}">${escapeHtml(post.author.name)}</a>
      <span class="handle">@${escapeHtml(post.author.username)}</span>
      <span aria-hidden="true">·</span>
      <time datetime="${escapeHtml(formatIso(post.createdAt) || '')}">${escapeHtml(formatDisplayDate(post.createdAt))}</time>
    </div>
    ${content ? `<p class="post-text">${escapeHtml(content)}</p>` : ''}
    ${renderMedia(post, origin)}
    <div class="post-actions">
      <a href="${escapeHtml(postUrl)}">View post</a>
      <span>${pluralize(post.repliesCount, 'reply', 'replies')}</span>
      <span>${pluralize(post.likesCount, 'like')}</span>
      <span>${pluralize(post.repostsCount, 'repost')}</span>
    </div>
  </article>`;
}

function renderPostList(posts: PublicPost[], origin: string, heading: string): string {
  return `<section class="section" aria-labelledby="posts-heading">
    <h2 id="posts-heading">${escapeHtml(heading)}</h2>
    ${posts.length > 0
      ? posts.map((post) => renderPostCard(post, origin)).join('')
      : '<p class="empty">No public posts yet.</p>'}
  </section>`;
}

function websiteJsonLd(origin: string): unknown {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: BRAND_NAME,
        url: `${origin}/`,
        description: BRAND_DESCRIPTION,
        logo: logoUrl(origin),
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: BRAND_NAME,
        url: `${origin}/`,
        description: BRAND_DESCRIPTION,
        inLanguage: 'en',
        publisher: { '@id': `${origin}/#organization` },
      },
    ],
  };
}

export function renderHomePage(posts: PublicPost[], origin: string): string {
  const title = `${BRAND_NAME} — ${BRAND_TAGLINE}`;
  const description = truncate(BRAND_DESCRIPTION, 160);
  return renderDocument({
    origin,
    title,
    description,
    canonical: `${origin}/`,
    robots: 'index, follow',
    ogType: 'website',
    structuredData: websiteJsonLd(origin),
    body: `<section class="hero">
      <p class="eyebrow">Public home</p>
      <h1>${escapeHtml(BRAND_NAME)}</h1>
      <p class="lede">${escapeHtml(BRAND_DESCRIPTION)}</p>
      <p><a class="button" href="/login">Sign in to ${escapeHtml(BRAND_NAME)}</a></p>
    </section>
    <section class="panel" aria-labelledby="about-heading">
      <h2 id="about-heading">About ${escapeHtml(BRAND_NAME)}</h2>
      <p class="muted">${escapeHtml(BRAND_NAME)} is a public social network for sharing ideas, following creators, and joining conversations. Public profiles and posts are available without an account.</p>
    </section>
    ${renderPostList(posts, origin, 'Recent public posts')}`,
  });
}

export function renderProfilePage(
  profile: PublicProfile,
  posts: PublicPost[],
  origin: string,
): string {
  const canonical = absoluteUrl(origin, profilePath(profile.username));
  const title = `${profile.name} (@${profile.username}) on ${BRAND_NAME}`;
  const description = truncate(
    profile.bio || `View ${profile.name}'s public profile and posts on ${BRAND_NAME}.`,
    160,
  );
  const avatar = safeHttpUrl(profile.avatarUrl, origin);
  const website = safeWebsiteUrl(profile.website, origin);
  const profileImage = avatar || logoUrl(origin);
  const sameAs = website ? [website] : undefined;

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': canonical,
    name: profile.name,
    alternateName: profile.username,
    url: canonical,
    ...(profile.bio ? { description: profile.bio } : {}),
    ...(avatar ? { image: avatar } : {}),
    ...(sameAs ? { sameAs } : {}),
    ...(profile.location ? { homeLocation: { '@type': 'Place', name: profile.location } } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
  };

  const avatarHtml = avatar
    ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(profile.name)}" />`
    : `<div class="avatar-fallback" aria-hidden="true">${escapeHtml(profile.name.trim().slice(0, 1).toUpperCase() || '?')}</div>`;

  return renderDocument({
    origin,
    title,
    description,
    canonical,
    robots: 'index, follow',
    ogType: 'profile',
    image: profileImage,
    profileUsername: profile.username,
    structuredData,
    body: `<section class="hero" aria-labelledby="profile-name">
      <div class="profile">
        ${avatarHtml}
        <div>
          <div class="profile-name">
            <h1 id="profile-name">${escapeHtml(profile.name)}</h1>
            ${profile.verified ? '<span class="badge">Verified</span>' : ''}
            ${profile.isGold ? '<span class="badge">Gold</span>' : ''}
          </div>
          <p class="muted">@${escapeHtml(profile.username)}</p>
          ${profile.bio ? `<p>${escapeHtml(profile.bio)}</p>` : ''}
          <div class="meta">
            ${profile.location ? `<span>${escapeHtml(profile.location)}</span>` : ''}
            ${website ? `<a href="${escapeHtml(website)}" rel="nofollow ugc noopener">${escapeHtml(website)}</a>` : ''}
            <span>${escapeHtml(profile.joinedDate)}</span>
            <span>${pluralize(profile.followersCount, 'follower')}</span>
            <span>${pluralize(profile.followingCount, 'following', 'following')}</span>
          </div>
        </div>
      </div>
    </section>
    ${renderPostList(posts, origin, `Public posts by ${profile.name}`)}`,
  });
}

export function renderPostPage(
  post: PublicPost,
  replies: PublicPost[],
  origin: string,
): string {
  const canonical = absoluteUrl(origin, postPath(post.id));
  const authorUrl = absoluteUrl(origin, profilePath(post.author.username));
  const content = post.content.trim();
  const titleSnippet = truncate(content || `Post by ${post.author.name}`, 60);
  const title = `${titleSnippet} — ${post.author.name} (@${post.author.username}) on ${BRAND_NAME}`;
  const description = truncate(
    content || `View this post by ${post.author.name} on ${BRAND_NAME}.`,
    160,
  );
  const firstMedia = post.mediaUrls
    .map((url) => safeHttpUrl(url, origin))
    .find((url): url is string => Boolean(url));
  const authorAvatar = safeHttpUrl(post.author.avatarUrl, origin);
  const image = firstMedia || authorAvatar || logoUrl(origin);
  const publishedTime = formatIso(post.createdAt);

  const commentData = replies.map((reply) => ({
    '@type': 'Comment',
    text: reply.content,
    dateCreated: formatIso(reply.createdAt),
    url: absoluteUrl(origin, postPath(reply.id)),
    author: {
      '@type': 'Person',
      name: reply.author.name,
      alternateName: reply.author.username,
      url: absoluteUrl(origin, profilePath(reply.author.username)),
    },
  }));

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    '@id': canonical,
    url: canonical,
    headline: truncate(content || `Post by ${post.author.name}`, 110),
    ...(content ? { articleBody: content } : {}),
    datePublished: publishedTime,
    ...(firstMedia ? { image: firstMedia } : {}),
    author: {
      '@type': 'Person',
      name: post.author.name,
      alternateName: post.author.username,
      url: authorUrl,
      ...(authorAvatar ? { image: authorAvatar } : {}),
    },
    isPartOf: { '@type': 'WebSite', name: BRAND_NAME, url: `${origin}/` },
    interactionStatistic: [
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/LikeAction',
        userInteractionCount: post.likesCount,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: post.repliesCount,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/ShareAction',
        userInteractionCount: post.repostsCount,
      },
    ],
    ...(commentData.length > 0 ? { comment: commentData } : {}),
  };

  return renderDocument({
    origin,
    title,
    description,
    canonical,
    robots: 'index, follow',
    ogType: 'article',
    image,
    publishedTime,
    structuredData,
    body: `<section class="hero" aria-labelledby="post-heading">
      <p class="eyebrow">Public post</p>
      <h1 id="post-heading">Post by ${escapeHtml(post.author.name)}</h1>
      <p class="muted"><a href="${escapeHtml(authorUrl)}">@${escapeHtml(post.author.username)}</a> · <time datetime="${escapeHtml(publishedTime || '')}">${escapeHtml(formatDisplayDate(post.createdAt))}</time></p>
    </section>
    ${renderPostCard(post, origin)}
    ${replies.length > 0
      ? `<section class="section" aria-labelledby="replies-heading"><h2 id="replies-heading">Replies</h2>${replies
          .map((reply) => renderPostCard(reply, origin, 'post reply'))
          .join('')}</section>`
      : ''}`,
  });
}

export function renderNotFoundPage(kind: 'profile' | 'post' | 'page', origin: string): string {
  const label = kind === 'profile' ? 'Profile' : kind === 'post' ? 'Post' : 'Page';
  return renderDocument({
    origin,
    title: `${label} not found — ${BRAND_NAME}`,
    description: `The requested ${label.toLowerCase()} is unavailable on ${BRAND_NAME}.`,
    robots: 'noindex, nofollow',
    ogType: 'website',
    body: `<section class="hero">
      <p class="eyebrow">404</p>
      <h1>${escapeHtml(label)} not found</h1>
      <p class="lede">This ${escapeHtml(label.toLowerCase())} does not exist, was deleted, or is not publicly available.</p>
      <p><a class="button" href="/">Go to ${escapeHtml(BRAND_NAME)} public home</a></p>
    </section>`,
  });
}

export function renderServiceUnavailablePage(origin: string): string {
  return renderDocument({
    origin,
    title: `Temporarily unavailable — ${BRAND_NAME}`,
    description: `${BRAND_NAME} is temporarily unable to load this public page.`,
    robots: 'noindex, nofollow',
    ogType: 'website',
    body: `<section class="hero">
      <p class="eyebrow">503</p>
      <h1>Temporarily unavailable</h1>
      <p class="lede">${escapeHtml(BRAND_NAME)} could not load this public page right now. Please try again shortly.</p>
      <p><a class="button" href="/">Go to ${escapeHtml(BRAND_NAME)} public home</a></p>
    </section>`,
  });
}

export function renderRobotsTxt(origin: string): string {
  return `User-agent: *
Allow: /
Allow: /assets/
Allow: /api/files/
Disallow: /api/
Disallow: /admin
Disallow: /login
Disallow: /verify-email
Disallow: /reset-password
Disallow: /settings
Disallow: /messages
Disallow: /notifications
Disallow: /bookmarks

Sitemap: ${origin}/sitemap.xml
`;
}

export function buildSitemapEntries(
  origin: string,
  profiles: Array<{ username: string; suspendedAt?: number | null }>,
  posts: Array<{ id: string; createdAt: number; authorSuspendedAt?: number | null }>,
  latestPostAt: number | null,
  includeHome = true,
): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: SitemapEntry) => {
    if (!entry.loc || seen.has(entry.loc)) return;
    seen.add(entry.loc);
    entries.push(entry);
  };

  if (includeHome) {
    add({
      loc: `${origin}/`,
      ...(latestPostAt ? { lastmod: formatIso(latestPostAt) || undefined } : {}),
    });
  }

  for (const profile of profiles) {
    if (profile.suspendedAt) continue;
    if (!profile.username) continue;
    add({ loc: absoluteUrl(origin, profilePath(profile.username)) });
  }

  for (const post of posts) {
    if (post.authorSuspendedAt) continue;
    if (!post.id) continue;
    add({
      loc: absoluteUrl(origin, postPath(post.id)),
      lastmod: formatIso(post.createdAt) || undefined,
    });
  }

  return entries;
}

export function renderUrlSet(entries: SitemapEntry[]): string {
  const seen = new Set<string>();
  const urls = entries
    .filter((entry) => {
      if (!entry.loc || seen.has(entry.loc)) return false;
      seen.add(entry.loc);
      return true;
    })
    .map((entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ''}
  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function buildSitemapIndexUrls(
  origin: string,
  counts: SitemapCounts,
  chunkSize: number,
): string[] {
  const urls = [`${origin}/sitemaps/static-1.xml`];
  const profileChunks = Math.ceil(counts.profiles / chunkSize);
  const postChunks = Math.ceil(counts.posts / chunkSize);
  for (let index = 1; index <= profileChunks; index += 1) {
    urls.push(`${origin}/sitemaps/profiles-${index}.xml`);
  }
  for (let index = 1; index <= postChunks; index += 1) {
    urls.push(`${origin}/sitemaps/posts-${index}.xml`);
  }
  return urls;
}

export function renderSitemapIndex(sitemapUrls: string[]): string {
  const seen = new Set<string>();
  const entries = sitemapUrls
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((url) => `  <sitemap>\n    <loc>${escapeXml(url)}</loc>\n  </sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>
`;
}
