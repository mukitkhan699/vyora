import { createHash, createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from './config.ts';
import { query } from './db/pool.ts';
import { HttpError } from './errors.ts';

export interface RateLimitStore {
  increment(scope: string, subject: string, windowStart: number, now: number): Promise<number>;
}

export interface RateLimitRule {
  name: string;
  scope: string;
  subject: string;
  limit: number;
  windowMs: number;
}

export type RateLimitLogger = (message: string, details: Record<string, unknown>) => void;

const REPORT_USER_LIMIT = 10;
const REPORT_USER_WINDOW_MS = 10 * 60 * 1000;
const REPORT_IP_LIMIT = 120;
const REPORT_IP_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

const defaultLogger: RateLimitLogger = (message, details) => {
  console.warn(message, JSON.stringify(details));
};

class PostgresRateLimitStore implements RateLimitStore {
  async increment(scope: string, subject: string, windowStart: number, now: number): Promise<number> {
    const result = await query<{ request_count: number }>(
      `INSERT INTO zunari_rate_limits (scope, subject, window_start, request_count, updated_at)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (scope, subject, window_start)
       DO UPDATE SET
         request_count = zunari_rate_limits.request_count + 1,
         updated_at = EXCLUDED.updated_at
       RETURNING request_count`,
      [scope, subject, windowStart, now],
    );
    return Number(result.rows[0]?.request_count || 0);
  }
}

export const postgresRateLimitStore = new PostgresRateLimitStore();

function normalizeIp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[')) {
    const closingBracket = trimmed.indexOf(']');
    if (closingBracket > 0) return trimmed.slice(1, closingBracket);
  }
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed);
  if (ipv4WithPort) return ipv4WithPort[1];
  return trimmed;
}

/**
 * Resolves the client IP without silently trusting spoofable headers.
 *
 * `trustProxyHops` is the number of reverse proxies that are known to append
 * to X-Forwarded-For. When it is 0 (the default), only the TCP peer address is
 * used. Set TRUST_PROXY_HOPS only when every hop in front of the app is
 * controlled and configured to overwrite/append X-Forwarded-For correctly.
 */
export function getClientIp(req: IncomingMessage, trustProxyHops = 0): string {
  if (trustProxyHops > 0) {
    const header = req.headers['x-forwarded-for'];
    const forwarded = Array.isArray(header) ? header.join(',') : header;
    if (forwarded) {
      const addresses = forwarded
        .split(',')
        .map((address) => normalizeIp(address))
        .filter(Boolean);
      const index = addresses.length - trustProxyHops;
      const candidate = index >= 0 ? addresses[index] : undefined;
      if (candidate) return candidate;
    }
  }
  return normalizeIp(req.socket.remoteAddress || '') || 'unknown';
}

export function hashRateLimitSubject(subject: string): string {
  return createHmac('sha256', config.rateLimitHmacSecret).update(subject).digest('hex').slice(0, 32);
}

export function buildReportRateLimitRules(userId: string, clientIp: string): RateLimitRule[] {
  return [
    {
      name: 'report-user',
      scope: 'report:create:user',
      subject: userId,
      limit: REPORT_USER_LIMIT,
      windowMs: REPORT_USER_WINDOW_MS,
    },
    {
      name: 'report-ip',
      scope: 'report:create:ip',
      subject: hashRateLimitSubject(clientIp),
      limit: REPORT_IP_LIMIT,
      windowMs: REPORT_IP_WINDOW_MS,
    },
  ];
}

export async function enforceRateLimits(
  rules: RateLimitRule[],
  options: {
    now?: number;
    store?: RateLimitStore;
    log?: RateLimitLogger;
    context?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  const store = options.store ?? postgresRateLimitStore;
  const log = options.log ?? defaultLogger;
  const violations: Array<{ rule: RateLimitRule; count: number; retryAfter: number }> = [];

  for (const rule of rules) {
    const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
    const count = await store.increment(rule.scope, rule.subject, windowStart, now);
    if (count > rule.limit) {
      violations.push({
        rule,
        count,
        retryAfter: Math.max(1, Math.ceil((windowStart + rule.windowMs - now) / 1000)),
      });
    }
  }

  if (violations.length) {
    for (const violation of violations) {
      log('[rate-limit] report rate limit exceeded', {
        ...options.context,
        rule: violation.rule.name,
        scope: violation.rule.scope,
        subject: violation.rule.subject,
        count: violation.count,
        limit: violation.rule.limit,
        retryAfter: violation.retryAfter,
      });
    }
    const retryAfter = Math.max(...violations.map((violation) => violation.retryAfter));
    throw new HttpError(
      429,
      'Too many reports. Please try again later.',
      'RATE_LIMITED',
      { 'Retry-After': String(retryAfter) },
    );
  }
}

export async function enforceReportRateLimit(
  req: IncomingMessage,
  userId: string,
  options: {
    now?: number;
    store?: RateLimitStore;
    log?: RateLimitLogger;
    trustProxyHops?: number;
  } = {},
): Promise<void> {
  const clientIp = getClientIp(req, options.trustProxyHops ?? config.trustProxyHops);
  const rules = buildReportRateLimitRules(userId, clientIp);
  await enforceRateLimits(rules, {
    ...options,
    context: {
      userId,
      method: req.method,
      path: (req.url || '').split('?', 1)[0],
    },
  });
}

export async function cleanupExpiredRateLimits(now = Date.now()): Promise<void> {
  await query('DELETE FROM zunari_rate_limits WHERE window_start < $1', [
    now - RATE_LIMIT_RETENTION_MS,
  ]);
}
