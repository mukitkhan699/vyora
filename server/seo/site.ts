import type { IncomingMessage } from 'node:http';

export const PRODUCTION_ORIGIN = 'https://zunari.duckdns.org';

export function normalizeSiteOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  ) {
    return null;
  }
  parsed.protocol = 'https:';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.origin;
}

export function getSiteOrigin(environment: NodeJS.ProcessEnv = process.env): string {
  return (
    normalizeSiteOrigin(environment.SITE_ORIGIN) ||
    normalizeSiteOrigin(environment.APP_URL) ||
    PRODUCTION_ORIGIN
  );
}

export function getGoogleSiteVerification(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const token = environment.GOOGLE_SITE_VERIFICATION?.trim();
  if (!token || token.length > 256) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(token)) return null;
  return token;
}

export function absoluteUrl(origin: string, pathname: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${origin}${path}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function truncate(value: string, maxLength = 160): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function safeHttpUrl(value: string | null | undefined, origin: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\/api\/files\/[A-Za-z0-9_-]+$/.test(trimmed)) {
    return absoluteUrl(origin, trimmed);
  }
  if (trimmed.startsWith('/')) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function safeWebsiteUrl(value: string | null | undefined, origin: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return safeHttpUrl(trimmed, origin);
  }
}

export function jsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function profilePath(username: string): string {
  return `/u/${encodeURIComponent(username.trim().toLowerCase())}`;
}

export function postPath(postId: string): string {
  return `/post/${encodeURIComponent(postId)}`;
}

export function getHttpsRedirectUrl(
  req: IncomingMessage,
  requestUrl?: URL,
): string | null {
  const host = String(req.headers.host || '').trim().toLowerCase();
  const hostname = host.split(':')[0];
  if (hostname !== 'zunari.duckdns.org') return null;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol =
    typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim().toLowerCase()
      : (req.socket as { encrypted?: boolean }).encrypted
        ? 'https'
        : 'http';
  if (protocol !== 'http') return null;
  let path = '/';
  let search = '';
  if (requestUrl) {
    path = requestUrl.pathname;
    search = requestUrl.search;
  } else {
    try {
      const parsed = new URL(req.url || '/', `http://${host}`);
      path = parsed.pathname;
      search = parsed.search;
    } catch {
      return null;
    }
  }
  return `https://${hostname}${path}${search}`;
}
