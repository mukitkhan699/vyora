import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { createServer as netConnect, isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.ts';
import { INITIAL_USERS } from './db/store.ts';
import { dbAdapter } from './db/adapter.ts';

const scrypt = promisify(scryptCallback);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || String(config.port || 3000), 10) || 3000;
const DB_PATH = process.env.AUTH_DATABASE_PATH || path.join(rootDir, 'data', 'auth.db');
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
const COOKIE_SECURE = process.env.COOKIE_SECURE;
const PUBLIC_HOST = (process.env.PUBLIC_HOST || '').trim().toLowerCase();
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const TRUST_PROXY_HOPS = Math.max(0, Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10) || 1);
const TRUSTED_PROXY_ADDRESSES = (process.env.TRUSTED_PROXY_ADDRESSES || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || '587', 10) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `${config.appName} <${SMTP_USER}>` : `${config.appName} <no-reply@localhost>`);
const SMTP_ALLOW_INSECURE = process.env.SMTP_ALLOW_INSECURE === 'true';
const SMTP_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.SMTP_TIMEOUT_MS || '15000', 10) || 15000);
const SMTP_EHLO_NAME = (process.env.SMTP_EHLO_NAME || PUBLIC_HOST || 'localhost')
  .replace(/[^A-Za-z0-9.\-[\]:]/g, '')
  .slice(0, 255) || 'localhost';

const COOKIE_NAME = 'sid';
const SECURE_COOKIE_NAME = '__Host-sid';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_EMAIL_LENGTH = 254;
const MAX_EMAIL_BYTES = 128 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/;
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ANON_SESSION_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const MAX_HEADER_VALUE_BYTES = 4096;
const MAX_SCRYPT_CONCURRENT = Math.max(
  1,
  Number.parseInt(process.env.SCRYPT_MAX_CONCURRENT || '4', 10) || 4,
);

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: number;
}

export interface AuthSession {
  token: string;
  tokenHash: string;
  userId: number | null;
  username: string | null;
  email: string | null;
  emailVerified: number;
  userCreatedAt: number | null;
  csrfToken: string;
  expiresAt: number;
}

class HttpError extends Error {
  status: number;
  code: string;
  headers: Record<string, string>;
  details: Record<string, unknown> | null;

  constructor(
    status: number,
    message: string,
    code = 'REQUEST_FAILED',
    headers: Record<string, string> = {},
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.details = details;
  }
}

class SlidingWindowLimiter {
  limit: number;
  windowMs: number;
  maxKeys: number;
  buckets = new Map<string, number[]>();

  constructor(limit: number, windowMs: number, maxKeys = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  check(key: string): number {
    const now = Date.now();
    const entries = this.buckets.get(key);
    if (!entries) return 0;
    while (entries.length > 0 && entries[0] <= now - this.windowMs) entries.shift();
    if (entries.length === 0) {
      this.buckets.delete(key);
      return 0;
    }
    if (entries.length < this.limit) return 0;
    return Math.max(1, Math.ceil((entries[0] + this.windowMs - now) / 1000));
  }

  record(key: string): void {
    const now = Date.now();
    const entries = this.buckets.get(key) || [];
    entries.push(now);
    this.buckets.set(key, entries);
    if (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }

  sweep(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, entries] of this.buckets) {
      if (entries.length === 0 || entries[entries.length - 1] <= cutoff) this.buckets.delete(key);
    }
  }
}

const loginByIp = new SlidingWindowLimiter(10, 15 * 60 * 1000);
const loginByAccount = new SlidingWindowLimiter(8, 15 * 60 * 1000);
const registrationByIp = new SlidingWindowLimiter(5, 60 * 60 * 1000);
const sessionCreationByIp = new SlidingWindowLimiter(60, 60 * 1000);
const resendVerificationByUser = new SlidingWindowLimiter(3, 15 * 60 * 1000);
const resendVerificationByIp = new SlidingWindowLimiter(10, 15 * 60 * 1000);
const emailVerificationByIp = new SlidingWindowLimiter(20, 15 * 60 * 1000);
const passwordResetByIp = new SlidingWindowLimiter(5, 60 * 60 * 1000);
const passwordResetByAccount = new SlidingWindowLimiter(3, 60 * 60 * 1000);
const passwordResetConfirmByIp = new SlidingWindowLimiter(10, 60 * 60 * 1000);
const passwordChangeByUser = new SlidingWindowLimiter(5, 15 * 60 * 1000);

try {
  process.umask(0o077);
} catch {
  // Ignore platforms without umask support.
}

mkdirSync(path.dirname(DB_PATH), { recursive: true, mode: 0o700 });
try {
  chmodSync(path.dirname(DB_PATH), 0o700);
} catch {
  // Best-effort permission hardening.
}

const db = new DatabaseSync(DB_PATH);
try {
  chmodSync(DB_PATH, 0o600);
  statSync(`${DB_PATH}-wal`);
  chmodSync(`${DB_PATH}-wal`, 0o600);
} catch {
  // WAL files may not exist yet.
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA secure_delete = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
`);

try {
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email COLLATE NOCASE) WHERE email IS NOT NULL',
  );
} catch (error) {
  console.warn('Could not enforce unique email addresses:', (error as Error)?.message);
}

const statements = {
  insertUser: db.prepare(
    'INSERT INTO users (username, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)',
  ),
  userByUsername: db.prepare(
    'SELECT id, username, email, password_hash, email_verified, created_at FROM users WHERE username = ? COLLATE NOCASE',
  ),
  userByEmail: db.prepare(
    'SELECT id, username, email, password_hash, email_verified, created_at FROM users WHERE email = ? COLLATE NOCASE',
  ),
  userById: db.prepare(
    'SELECT id, username, email, password_hash, email_verified, created_at FROM users WHERE id = ?',
  ),
  updateUserEmailVerified: db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?'),
  updateUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  insertSession: db.prepare(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ),
  sessionByHash: db.prepare(`
    SELECT
      s.token_hash,
      s.user_id,
      s.csrf_token,
      s.expires_at,
      u.username,
      u.email,
      u.email_verified,
      u.created_at AS user_created_at
    FROM sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteSessionsForUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  deleteOtherSessionsForUser: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  insertEmailVerification: db.prepare(
    'INSERT INTO email_verifications (token_hash, user_id, email, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)',
  ),
  getEmailVerification: db.prepare(
    'SELECT token_hash, user_id, email, created_at, expires_at, used_at FROM email_verifications WHERE token_hash = ?',
  ),
  markEmailVerificationUsed: db.prepare(
    'UPDATE email_verifications SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
  ),
  deleteExpiredEmailVerifications: db.prepare(
    'DELETE FROM email_verifications WHERE expires_at <= ? OR used_at IS NOT NULL',
  ),
  deleteEmailVerificationsForUser: db.prepare('DELETE FROM email_verifications WHERE user_id = ?'),
  insertPasswordReset: db.prepare(
    'INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)',
  ),
  getPasswordReset: db.prepare(
    'SELECT token_hash, user_id, created_at, expires_at, used_at FROM password_resets WHERE token_hash = ?',
  ),
  markPasswordResetUsed: db.prepare(
    'UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
  ),
  deleteExpiredPasswordResets: db.prepare(
    'DELETE FROM password_resets WHERE expires_at <= ? OR used_at IS NOT NULL',
  ),
  deletePasswordResetsForUser: db.prepare('DELETE FROM password_resets WHERE user_id = ?'),
};

function withImmediateTransaction<T>(callback: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors.
    }
    throw error;
  }
}

class Semaphore {
  max: number;
  active = 0;
  queue: Array<{ resolve: () => void; timeout: NodeJS.Timeout | null }> = [];

  constructor(max: number) {
    this.max = max;
  }

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, timeout: null as NodeJS.Timeout | null };
      entry.timeout = setTimeout(() => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new HttpError(503, 'Service temporarily unavailable.', 'SERVICE_BUSY'));
      }, 5000);
      this.queue.push(entry);
    }).then(() => {
      this.active += 1;
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) {
      if (next.timeout) clearTimeout(next.timeout);
      next.resolve();
    }
  }
}

const scryptSemaphore = new Semaphore(MAX_SCRYPT_CONCURRENT);

async function hashPassword(password: string): Promise<string> {
  await scryptSemaphore.acquire();
  try {
    const salt = randomBytes(16);
    const derivedKey = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    });
    return [
      'scrypt',
      SCRYPT_N,
      SCRYPT_R,
      SCRYPT_P,
      salt.toString('base64url'),
      (derivedKey as Buffer).toString('base64url'),
    ].join('$');
  } finally {
    scryptSemaphore.release();
  }
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  await scryptSemaphore.acquire();
  try {
    const [scheme, n, r, p, saltValue, hashValue] = String(storedHash).split('$');
    if (
      scheme !== 'scrypt' ||
      Number(n) !== SCRYPT_N ||
      Number(r) !== SCRYPT_R ||
      Number(p) !== SCRYPT_P ||
      typeof saltValue !== 'string' ||
      typeof hashValue !== 'string'
    ) {
      return false;
    }

    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(hashValue, 'base64url');
    if (salt.length < 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;

    const actual = (await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    })) as Buffer;

    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  } finally {
    scryptSemaphore.release();
  }
}

const DUMMY_PASSWORD_HASH = await (async () => {
  await scryptSemaphore.acquire();
  try {
    const salt = randomBytes(16);
    const derivedKey = (await scrypt(randomBytes(32).toString('base64url'), salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    })) as Buffer;
    return [
      'scrypt',
      SCRYPT_N,
      SCRYPT_R,
      SCRYPT_P,
      salt.toString('base64url'),
      derivedKey.toString('base64url'),
    ].join('$');
  } finally {
    scryptSemaphore.release();
  }
})();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function hashLimiterKey(value: string): string {
  return createHash('sha256').update(value || 'invalid').digest('base64url');
}

function safeEqual(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return false;
  if (value.includes('\r') || value.includes('\n')) return false;
  if (!EMAIL_PATTERN.test(value)) return false;
  const at = value.lastIndexOf('@');
  return at > 0 && at <= 64 && value.length - at - 1 > 0 && value.length - at - 1 <= 253;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    req.resume();
    throw new HttpError(413, 'Request body is too large.', 'BODY_TOO_LARGE');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      req.resume();
      throw new HttpError(413, 'Request body is too large.', 'BODY_TOO_LARGE');
    }
    chunks.push(buffer);
  }

  if (total === 0) {
    throw new HttpError(400, 'A JSON request body is required.', 'INVALID_JSON');
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Body must be an object.');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON request body.', 'INVALID_JSON');
  }
}

function getCookie(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header.length > 8192) return null;
  const secure = isSecureRequest(req);
  const wanted = secure ? SECURE_COOKIE_NAME : COOKIE_NAME;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== wanted) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function setSessionCookie(req: IncomingMessage, res: ServerResponse, session: AuthSession): void {
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  const secure = isSecureRequest(req);
  if (secure) {
    res.setHeader('Set-Cookie', [
      `${SECURE_COOKIE_NAME}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Secure`,
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    ]);
    return;
  }
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`,
  );
}

function clearSessionCookie(req: IncomingMessage, res: ServerResponse): void {
  const secure = isSecureRequest(req);
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`,
    `${SECURE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`,
  ]);
}

export function getSession(req: IncomingMessage): AuthSession | null {
  const token = getCookie(req);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const row = statements.sessionByHash.get(tokenHash) as
    | {
        token_hash: string;
        user_id: number | null;
        csrf_token: string;
        expires_at: number;
        username: string | null;
        email: string | null;
        email_verified: number | null;
        user_created_at: number | null;
      }
    | undefined;

  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    statements.deleteSession.run(row.token_hash);
    return null;
  }
  if (row.user_id !== null && row.username === null) {
    statements.deleteSession.run(row.token_hash);
    return null;
  }

  return {
    token,
    tokenHash: row.token_hash,
    userId: row.user_id,
    username: row.username,
    email: row.email ?? null,
    emailVerified: row.email_verified ?? 0,
    userCreatedAt: row.user_created_at,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
  };
}

export function getAuthUser(req: IncomingMessage): AuthUser | null {
  const session = getSession(req);
  if (!session || !session.userId) return null;
  return {
    id: session.userId,
    username: session.username || '',
    email: session.email,
    emailVerified: Boolean(session.emailVerified),
    createdAt: session.userCreatedAt || 0,
  };
}

function createSession(user: Record<string, unknown> | null): AuthSession {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  const expiresAt = createdAt + (user ? SESSION_TTL_MS : ANON_SESSION_TTL_MS);

  statements.insertSession.run(
    hashToken(token),
    (user?.id as number | undefined) ?? null,
    csrfToken,
    createdAt,
    expiresAt,
  );

  return {
    token,
    tokenHash: hashToken(token),
    userId: (user?.id as number | undefined) ?? null,
    username: (user?.username as string | undefined) ?? null,
    email: (user?.email as string | undefined) ?? null,
    emailVerified: (user?.email_verified as number | undefined) ?? 0,
    userCreatedAt: (user?.created_at as number | undefined) ?? null,
    csrfToken,
    expiresAt,
  };
}

function requireSessionWithCsrf(req: IncomingMessage): AuthSession {
  const session = getSession(req);
  if (!session) {
    throw new HttpError(
      403,
      'Your session has expired. Refresh the page and try again.',
      'SESSION_REQUIRED',
    );
  }
  const csrfToken = req.headers['x-csrf-token'];
  if (!safeEqual(csrfToken, session.csrfToken)) {
    throw new HttpError(
      403,
      'Security token is invalid. Refresh the page and try again.',
      'CSRF_INVALID',
    );
  }
  return session;
}

function getRequestHost(req: IncomingMessage): string {
  if (PUBLIC_HOST) return PUBLIC_HOST;
  return String(req.headers.host || '').toLowerCase();
}

function validateStateChangingRequest(req: IncomingMessage): void {
  const contentType = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json.', 'INVALID_CONTENT_TYPE');
  }

  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof origin !== 'string' && typeof fetchSite !== 'string') {
    throw new HttpError(403, 'Request origin rejected.', 'ORIGIN_REJECTED');
  }

  if (typeof origin === 'string') {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, 'Request origin rejected.', 'ORIGIN_REJECTED');
    }
    const expectedHost = getRequestHost(req);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.host.toLowerCase() !== expectedHost
    ) {
      throw new HttpError(403, 'Request origin rejected.', 'ORIGIN_REJECTED');
    }
  }

  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'Cross-site request rejected.', 'ORIGIN_REJECTED');
  }
}

function normalizeIpAddress(value: string): string {
  const address = String(value || '').trim().toLowerCase();
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return address.slice(7);
  return address;
}

function isTrustedProxyAddress(remoteAddress: string): boolean {
  if (!TRUST_PROXY || TRUSTED_PROXY_ADDRESSES.length === 0) return false;
  const remote = normalizeIpAddress(remoteAddress);
  return TRUSTED_PROXY_ADDRESSES.some((entry) => normalizeIpAddress(entry) === remote);
}

function getClientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress || 'unknown';
  if (isTrustedProxyAddress(remote)) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length <= MAX_HEADER_VALUE_BYTES) {
      const parts = forwardedFor.split(',').map((part) => part.trim()).filter(Boolean);
      if (parts.length > 0) {
        const hopIndex = parts.length - Math.max(1, TRUST_PROXY_HOPS);
        const candidate = parts[hopIndex >= 0 ? hopIndex : 0];
        if (isIP(candidate)) return normalizeIpAddress(candidate);
      }
    }
  }
  return isIP(remote) ? normalizeIpAddress(remote) : remote;
}

function isSecureRequest(req: IncomingMessage): boolean {
  if (COOKIE_SECURE === 'true') return true;
  if (COOKIE_SECURE === 'false') return false;
  if (req.socket.encrypted) return true;
  const remote = req.socket.remoteAddress || 'unknown';
  if (isTrustedProxyAddress(remote)) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    if (typeof forwardedProto === 'string' && forwardedProto.length <= MAX_HEADER_VALUE_BYTES) {
      const parts = forwardedProto.split(',').map((part) => part.trim().toLowerCase());
      if (parts.length > 0) {
        return parts[parts.length - Math.max(1, TRUST_PROXY_HOPS)] === 'https';
      }
    }
  }
  return false;
}

function userToPublic(user: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!user) return null;
  const authId = Number(user.id);
  const username = String(user.username || '');
  const social = dbAdapter.syncAuthProfile({
    id: authId,
    username,
    email: (user.email as string | null) ?? null,
    createdAt: Number(user.created_at || 0),
  });

  return {
    ...social,
    email: (user.email as string | null) ?? null,
    emailVerified: Boolean(user.email_verified),
    createdAt: Number(user.created_at || 0),
  };
}

function sessionPayload(session: AuthSession, user: Record<string, unknown> | null) {
  return {
    authenticated: Boolean(user),
    user,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
  };
}

function invalidCredentialsError(): HttpError {
  return new HttpError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
}

function emailTakenError(): HttpError {
  return new HttpError(409, 'An account with that email address already exists.', 'EMAIL_TAKEN');
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function handleSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let session = getSession(req);
  if (!session) {
    const clientIp = getClientIp(req);
    const key = hashLimiterKey(`anon:${clientIp}`);
    const retryAfter = sessionCreationByIp.check(key);
    if (retryAfter > 0) {
      throw new HttpError(429, 'Too many requests. Please try again later.', 'RATE_LIMITED', {
        'Retry-After': String(retryAfter),
      });
    }
    sessionCreationByIp.record(key);
    session = createSession(null);
    setSessionCookie(req, res, session);
  }

  let user: Record<string, unknown> | null = session.userId
    ? userToPublic({
        id: session.userId,
        username: session.username || '',
        email: session.email,
        email_verified: session.emailVerified,
        created_at: session.userCreatedAt || 0,
      })
    : null;

  if (user) {
    const fresh = statements.userById.get(session.userId) as Record<string, unknown> | undefined;
    if (fresh) user = userToPublic(fresh);
  }

  sendJson(res, 200, sessionPayload(session, user));
}

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const session = requireSessionWithCsrf(req);
  const body = await readJsonBody(req);
  const username = normalizeUsername(body.username);
  const password = body.password;

  if (
    !USERNAME_PATTERN.test(username) ||
    typeof password !== 'string' ||
    password.length < 1 ||
    password.length > 1024
  ) {
    throw invalidCredentialsError();
  }

  const clientIp = getClientIp(req);
  const ipKey = hashLimiterKey(`ip:${clientIp}`);
  const accountKey = hashLimiterKey(`account:${username.toLowerCase()}`);
  const retryAfter = Math.max(loginByIp.check(ipKey), loginByAccount.check(accountKey));
  if (retryAfter > 0) {
    throw new HttpError(429, 'Too many sign-in attempts. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfter),
    });
  }
  loginByIp.record(ipKey);
  loginByAccount.record(accountKey);

  const user = statements.userByUsername.get(username) as Record<string, unknown> | undefined;
  const passwordMatches = await verifyPassword(
    password,
    (user?.password_hash as string) || DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) throw invalidCredentialsError();
  loginByAccount.clear(accountKey);

  const fresh = statements.userById.get(user.id) as Record<string, unknown> | undefined;
  if (fresh) {
    user.email = fresh.email;
    user.email_verified = fresh.email_verified;
  }

  if (REQUIRE_EMAIL_VERIFICATION && Number(user.email_verified) !== 1) {
    throw new HttpError(
      403,
      'Please verify your email address before signing in. Check your inbox for the verification link.',
      'EMAIL_NOT_VERIFIED',
      {},
      { email: (user.email as string | null) ?? null },
    );
  }

  const anonKey = hashLimiterKey(`anon:${getClientIp(req)}`);
  const retryAfterAnon = sessionCreationByIp.check(anonKey);
  if (retryAfterAnon > 0) {
    throw new HttpError(429, 'Too many requests. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfterAnon),
    });
  }

  statements.deleteSession.run(session.tokenHash);
  sessionCreationByIp.record(anonKey);
  const newSession = createSession(user);
  setSessionCookie(req, res, newSession);
  sendJson(
    res,
    200,
    sessionPayload(newSession, userToPublic(user)),
  );
}

async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const session = requireSessionWithCsrf(req);
  const body = await readJsonBody(req);
  const username = normalizeUsername(body.username);
  const password = body.password;
  const email = normalizeEmail(body.email);

  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(
      400,
      'Username must be 3-32 characters using letters, numbers, or underscores.',
      'INVALID_USERNAME',
    );
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    throw new HttpError(400, 'Password must be between 12 and 1024 characters.', 'INVALID_PASSWORD');
  }
  if (!isValidEmail(email)) {
    throw new HttpError(400, 'A valid email address is required for account creation.', 'INVALID_EMAIL');
  }

  const registrationKey = hashLimiterKey(`register:${getClientIp(req)}`);
  const retryAfter = registrationByIp.check(registrationKey);
  if (retryAfter > 0) {
    throw new HttpError(
      429,
      'Too many accounts created from this network. Please try again later.',
      'RATE_LIMITED',
      { 'Retry-After': String(retryAfter) },
    );
  }
  registrationByIp.record(registrationKey);

  const passwordHash = await hashPassword(password);
  if (statements.userByEmail.get(email)) throw emailTakenError();

  let userId: number;
  try {
    const result = statements.insertUser.run(username, email, passwordHash, 0, Date.now());
    userId = Number(result.lastInsertRowid);
  } catch (error) {
    const message = String((error as Error)?.message);
    if (message.includes('UNIQUE constraint failed')) {
      if (message.includes('users.email')) throw emailTakenError();
      throw new HttpError(409, 'That username is already taken.', 'USERNAME_TAKEN');
    }
    throw error;
  }

  const user = {
    id: userId,
    username,
    email,
    email_verified: 0,
    created_at: Date.now(),
  };

  try {
    await sendEmailVerification(userId, email);
  } catch (error) {
    console.error('Failed to send verification email:', (error as Error)?.message || error);
    try {
      withImmediateTransaction(() => {
        statements.deleteEmailVerificationsForUser.run(userId);
        statements.deleteUser.run(userId);
      });
    } catch (cleanupError) {
      console.error('Failed to roll back registration:', (cleanupError as Error)?.message || cleanupError);
    }
    throw new HttpError(
      503,
      'We could not send the verification email. Please try again later.',
      'EMAIL_SEND_FAILED',
    );
  }

  const anonKey = hashLimiterKey(`anon:${getClientIp(req)}`);
  const retryAfterAnon = sessionCreationByIp.check(anonKey);
  if (retryAfterAnon > 0) {
    throw new HttpError(429, 'Too many requests. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfterAnon),
    });
  }

  statements.deleteSession.run(session.tokenHash);
  sessionCreationByIp.record(anonKey);
  const anonymousSession = createSession(null);
  setSessionCookie(req, res, anonymousSession);

  sendJson(res, 201, {
    ...sessionPayload(anonymousSession, null),
    emailVerificationRequired: true,
    email,
    message: 'Account created. Check your email to verify your account before signing in.',
  });
}

async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const session = requireSessionWithCsrf(req);

  const anonKey = hashLimiterKey(`anon:${getClientIp(req)}`);
  const retryAfterAnon = sessionCreationByIp.check(anonKey);
  if (retryAfterAnon > 0) {
    throw new HttpError(429, 'Too many requests. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfterAnon),
    });
  }

  statements.deleteSession.run(session.tokenHash);
  sessionCreationByIp.record(anonKey);
  const anonymousSession = createSession(null);
  setSessionCookie(req, res, anonymousSession);
  sendJson(res, 200, sessionPayload(anonymousSession, null));
}

async function handleVerifyEmail(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const ipKey = hashLimiterKey(`verify-email-ip:${getClientIp(req)}`);
  const retryAfter = emailVerificationByIp.check(ipKey);
  if (retryAfter > 0) {
    throw new HttpError(429, 'Too many verification attempts. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfter),
    });
  }
  emailVerificationByIp.record(ipKey);

  const body = await readJsonBody(req);
  const token = typeof body.token === 'string' ? body.token : '';
  const result = verifyEmailToken(token);
  if (!result.ok) throw new HttpError(400, result.message, result.code || 'VERIFICATION_FAILED');
  sendJson(res, 200, { verified: true, message: result.message });
}

async function handleResendVerification(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const session = requireSessionWithCsrf(req);
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);

  const clientIp = getClientIp(req);
  const ipKey = hashLimiterKey(`resend-verification-ip:${clientIp}`);
  let accountKey = ipKey;
  let user: Record<string, unknown> | undefined;

  if (session.userId) {
    accountKey = hashLimiterKey(`resend-verification-user:${session.userId}`);
    user = statements.userById.get(session.userId) as Record<string, unknown> | undefined;
  } else if (username && USERNAME_PATTERN.test(username)) {
    accountKey = hashLimiterKey(`resend-verification-username:${username.toLowerCase()}`);
    user = statements.userByUsername.get(username) as Record<string, unknown> | undefined;
  } else if (email && isValidEmail(email)) {
    accountKey = hashLimiterKey(`resend-verification-email:${email}`);
    user = statements.userByEmail.get(email) as Record<string, unknown> | undefined;
  }

  const retryAfter = Math.max(
    resendVerificationByUser.check(accountKey),
    resendVerificationByIp.check(ipKey),
  );
  if (retryAfter > 0) {
    throw new HttpError(429, 'Too many verification requests. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfter),
    });
  }
  resendVerificationByUser.record(accountKey);
  resendVerificationByIp.record(ipKey);

  const genericResponse = {
    sent: true,
    message:
      'If an account matching those details still needs verification, a verification email has been sent.',
  };

  if (!user || Number(user.email_verified) === 1) {
    sendJson(res, 200, genericResponse);
    return;
  }

  const userEmail = normalizeEmail(user.email);
  if (!userEmail || !isValidEmail(userEmail)) {
    sendJson(res, 200, genericResponse);
    return;
  }

  setImmediate(() => {
    sendEmailVerification(Number(user.id), userEmail).catch((error) => {
      console.error('Failed to resend verification email:', (error as Error)?.message || error);
    });
  });
  sendJson(res, 200, genericResponse);
}

async function handleForgotPassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Enter a valid email address.', 'INVALID_EMAIL');
  }

  const ipKey = hashLimiterKey(`forgot-password:${getClientIp(req)}`);
  const retryAfterIp = passwordResetByIp.check(ipKey);
  if (retryAfterIp > 0) {
    throw new HttpError(429, 'Too many password reset requests. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfterIp),
    });
  }
  passwordResetByIp.record(ipKey);

  const accountKey = hashLimiterKey(`forgot-password-account:${email}`);
  if (passwordResetByAccount.check(accountKey) === 0) {
    passwordResetByAccount.record(accountKey);
    const user = statements.userByEmail.get(email) as Record<string, unknown> | undefined;
    if (user) {
      setImmediate(() => {
        sendPasswordResetEmail(Number(user.id), normalizeEmail(user.email) || email).catch((error) => {
          console.error('Failed to send password reset email:', (error as Error)?.message || error);
        });
      });
    }
  }

  sendJson(res, 200, {
    sent: true,
    message: 'If an account with that email exists, a password reset link has been sent.',
  });
}

async function handleResetPassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const body = await readJsonBody(req);
  const token = typeof body.token === 'string' ? body.token : '';
  const password = body.password;

  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    throw new HttpError(400, 'Password must be between 12 and 1024 characters.', 'INVALID_PASSWORD');
  }

  const ipKey = hashLimiterKey(`reset-password:${getClientIp(req)}`);
  const retryAfter = passwordResetConfirmByIp.check(ipKey);
  if (retryAfter > 0) {
    throw new HttpError(429, 'Too many password reset attempts. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfter),
    });
  }
  passwordResetConfirmByIp.record(ipKey);

  const initial = getPasswordResetRecord(token);
  if (!initial.ok) throw new HttpError(400, initial.message, initial.code);

  const passwordHash = await hashPassword(password);
  const consumed = withImmediateTransaction(() => {
    const current = getPasswordResetRecord(token);
    if (!current.ok) return current;
    const now = Date.now();
    const marked = statements.markPasswordResetUsed.run(now, current.row.token_hash, now);
    if (Number(marked.changes) !== 1) {
      return { ok: false, message: 'Invalid or expired password reset link.', code: 'INVALID_TOKEN' };
    }
    statements.updateUserPassword.run(passwordHash, current.row.user_id);
    statements.deletePasswordResetsForUser.run(current.row.user_id);
    statements.deleteSessionsForUser.run(current.row.user_id);
    return { ok: true };
  });

  if (!consumed.ok) throw new HttpError(400, consumed.message, consumed.code);
  sendJson(res, 200, {
    reset: true,
    message: 'Your password has been reset. You can now sign in with your new password.',
  });
}

async function handleChangePassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const session = requireSessionWithCsrf(req);
  const body = await readJsonBody(req);
  const currentPassword = body.currentPassword;
  const newPassword = body.newPassword;

  if (
    typeof currentPassword !== 'string' ||
    currentPassword.length < 1 ||
    currentPassword.length > 1024
  ) {
    throw new HttpError(400, 'Enter your current password.', 'INVALID_CURRENT_PASSWORD');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 1024) {
    throw new HttpError(400, 'New password must be between 12 and 1024 characters.', 'INVALID_PASSWORD');
  }

  const userKey = hashLimiterKey(`change-password:${session.userId}`);
  const retryAfter = passwordChangeByUser.check(userKey);
  if (retryAfter > 0) {
    throw new HttpError(429, 'Too many password change attempts. Please try again later.', 'RATE_LIMITED', {
      'Retry-After': String(retryAfter),
    });
  }
  passwordChangeByUser.record(userKey);

  const user = statements.userById.get(session.userId) as Record<string, unknown> | undefined;
  if (!user) {
    throw new HttpError(401, 'Your session is no longer valid. Please sign in again.', 'SESSION_REQUIRED');
  }

  const matches = await verifyPassword(currentPassword, String(user.password_hash));
  if (!matches) throw new HttpError(400, 'Current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
  if (currentPassword === newPassword) {
    throw new HttpError(
      400,
      'Choose a new password that is different from your current one.',
      'PASSWORD_UNCHANGED',
    );
  }

  const passwordHash = await hashPassword(newPassword);
  statements.updateUserPassword.run(passwordHash, user.id);
  statements.deletePasswordResetsForUser.run(user.id);
  statements.deleteOtherSessionsForUser.run(user.id, session.tokenHash);
  passwordChangeByUser.clear(userKey);
  sendJson(res, 200, { changed: true, message: 'Password updated successfully.' });
}

function peekEmailVerification(token: string) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return { ok: false, message: 'Invalid or expired verification link.', code: 'INVALID_TOKEN' } as const;
  }
  const row = statements.getEmailVerification.get(hashToken(token)) as Record<string, unknown> | undefined;
  if (!row) {
    return { ok: false, message: 'Invalid or expired verification link.', code: 'INVALID_TOKEN' } as const;
  }
  const user = statements.userById.get(row.user_id) as Record<string, unknown> | undefined;
  if (!user) {
    return { ok: false, message: 'Invalid or expired verification link.', code: 'INVALID_TOKEN' } as const;
  }
  const emailMatches = !row.email || normalizeEmail(user.email) === normalizeEmail(row.email);
  if (row.used_at) {
    if (Number(user.email_verified) === 1 && emailMatches) {
      return { ok: true, alreadyVerified: true, row, user } as const;
    }
    return { ok: false, message: 'Invalid or expired verification link.', code: 'INVALID_TOKEN' } as const;
  }
  if (Number(row.expires_at) <= Date.now()) {
    return { ok: false, message: 'This verification link has expired.', code: 'EXPIRED_TOKEN' } as const;
  }
  if (!emailMatches) {
    return { ok: false, message: 'Invalid or expired verification link.', code: 'INVALID_TOKEN' } as const;
  }
  return { ok: true, alreadyVerified: false, row, user } as const;
}

function verifyEmailToken(token: string) {
  const peeked = peekEmailVerification(token);
  if (!peeked.ok) return peeked;
  if (peeked.alreadyVerified) return { ok: true, message: 'Email verified successfully.' } as const;

  try {
    return withImmediateTransaction(() => {
      const row = statements.getEmailVerification.get(peeked.row.token_hash) as Record<string, unknown> | null;
      if (!row || row.used_at || Number(row.expires_at) <= Date.now()) {
        return { ok: false, message: 'Invalid or expired verification link.', code: 'INVALID_TOKEN' } as const;
      }
      const now = Date.now();
      const marked = statements.markEmailVerificationUsed.run(now, row.token_hash, now);
      if (Number(marked.changes) !== 1) {
        return { ok: false, message: 'Invalid or expired verification link.', code: 'INVALID_TOKEN' } as const;
      }
      statements.updateUserEmailVerified.run(row.user_id);
      return { ok: true, message: 'Email verified successfully.' } as const;
    });
  } catch (error) {
    console.error('Failed to verify email:', (error as Error)?.message || error);
    return { ok: false, message: 'Failed to verify email.', code: 'VERIFICATION_FAILED' } as const;
  }
}

function getPasswordResetRecord(token: string) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return { ok: false, message: 'Invalid or expired password reset link.', code: 'INVALID_TOKEN' } as const;
  }
  const row = statements.getPasswordReset.get(hashToken(token)) as Record<string, unknown> | undefined;
  if (!row || row.used_at) {
    return { ok: false, message: 'Invalid or expired password reset link.', code: 'INVALID_TOKEN' } as const;
  }
  if (Number(row.expires_at) <= Date.now()) {
    return { ok: false, message: 'This password reset link has expired.', code: 'EXPIRED_TOKEN' } as const;
  }
  return { ok: true, row } as const;
}

async function sendEmailVerification(userId: number, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new HttpError(400, 'A valid email address is required.', 'INVALID_EMAIL');
  }

  statements.deleteEmailVerificationsForUser.run(userId);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const createdAt = Date.now();
  const expiresAt = createdAt + EMAIL_VERIFICATION_TTL_MS;
  statements.insertEmailVerification.run(tokenHash, userId, normalized, createdAt, expiresAt);

  const verifyUrl = `${APP_BASE_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const subject = `Verify your email for ${config.appName}`;
  const text = `Welcome to ${config.appName}.\n\nVerify your email address:\n${verifyUrl}\n\nThis link expires in 24 hours.`;
  const html = `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,sans-serif;background:#080c0a;color:#f0f5ef;padding:40px"><div style="max-width:520px;margin:0 auto;background:#0e1512;border:1px solid rgba(226,243,231,0.1);border-radius:16px;padding:40px"><h1 style="margin:0 0 16px">Verify your email</h1><p style="color:#bdc9c2">Confirm your address to finish setting up your ${escapeHtml(config.appName)} account.</p><p style="margin:32px 0"><a href="${escapeHtml(verifyUrl)}" style="background:#c4f77b;color:#0a1306;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600">Verify email</a></p><p style="color:#98a79e;font-size:14px">Or open:<br><a href="${escapeHtml(verifyUrl)}" style="color:#c4f77b">${escapeHtml(verifyUrl)}</a></p></div></body></html>`;

  if (!smtpIsConfigured()) {
    if (IS_PRODUCTION) {
      throw new HttpError(503, 'Email delivery is not configured.', 'EMAIL_UNAVAILABLE');
    }
    console.log(`[EMAIL:DEV] To: ${normalized} | Subject: ${subject}\n${text}\nVERIFY_URL: ${verifyUrl}`);
    return;
  }

  await sendMail({ to: normalized, subject, text, html });
}

async function sendPasswordResetEmail(userId: number, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new HttpError(400, 'A valid email address is required.', 'INVALID_EMAIL');
  }

  statements.deletePasswordResetsForUser.run(userId);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const createdAt = Date.now();
  const expiresAt = createdAt + PASSWORD_RESET_TTL_MS;
  statements.insertPasswordReset.run(tokenHash, userId, createdAt, expiresAt);

  const resetUrl = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const subject = `Reset your ${config.appName} password`;
  const text = `We received a request to reset your ${config.appName} password.\n\nChoose a new password:\n${resetUrl}\n\nThis link expires in 1 hour.`;
  const html = `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,sans-serif;background:#080c0a;color:#f0f5ef;padding:40px"><div style="max-width:520px;margin:0 auto;background:#0e1512;border:1px solid rgba(226,243,231,0.1);border-radius:16px;padding:40px"><h1 style="margin:0 0 16px">Reset your password</h1><p style="color:#bdc9c2">Choose a new password for your ${escapeHtml(config.appName)} account.</p><p style="margin:32px 0"><a href="${escapeHtml(resetUrl)}" style="background:#c4f77b;color:#0a1306;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600">Reset password</a></p><p style="color:#98a79e;font-size:14px">This link expires in 1 hour.</p></div></body></html>`;

  if (!smtpIsConfigured()) {
    if (IS_PRODUCTION) {
      throw new HttpError(503, 'Email delivery is not configured.', 'EMAIL_UNAVAILABLE');
    }
    console.log(`[EMAIL:DEV] To: ${normalized} | Subject: ${subject}\n${text}\nRESET_URL: ${resetUrl}`);
    return;
  }

  await sendMail({ to: normalized, subject, text, html });
}

export async function initAuth(): Promise<void> {
  const now = Date.now();
  try {
    statements.deleteExpiredSessions.run(now);
    statements.deleteExpiredEmailVerifications.run(now);
    statements.deleteExpiredPasswordResets.run(now);
  } catch {
    // Cleanup is best-effort.
  }

  const seededHash = await hashPassword('vyora123');
  for (const seed of INITIAL_USERS) {
    const existing = statements.userByUsername.get(seed.username.toLowerCase()) as
      | Record<string, unknown>
      | undefined;
    if (existing) continue;
    try {
      statements.insertUser.run(
        seed.username.toLowerCase(),
        `${seed.username.toLowerCase()}@demo.vyora.local`,
        seededHash,
        1,
        Date.now(),
      );
    } catch (error) {
      const message = String((error as Error)?.message);
      if (!message.includes('UNIQUE constraint failed')) {
        console.warn('Could not seed demo account:', message);
      }
    }
  }

  const sweep = setInterval(() => {
    const timestamp = Date.now();
    statements.deleteExpiredSessions.run(timestamp);
    try {
      statements.deleteExpiredEmailVerifications.run(timestamp);
      statements.deleteExpiredPasswordResets.run(timestamp);
    } catch {
      // Ignore.
    }
    loginByIp.sweep();
    loginByAccount.sweep();
    registrationByIp.sweep();
    sessionCreationByIp.sweep();
    resendVerificationByUser.sweep();
    resendVerificationByIp.sweep();
    emailVerificationByIp.sweep();
    passwordResetByIp.sweep();
    passwordResetByAccount.sweep();
    passwordResetConfirmByIp.sweep();
    passwordChangeByUser.sweep();
  }, 5 * 60 * 1000);
  sweep.unref();
}

export function renderEmailVerificationPage(token: string): { status: number; html: string } {
  const peeked = peekEmailVerification(token);
  if (!peeked.ok) {
    return { status: 400, html: authPage('Verification failed', peeked.message, '') };
  }
  if (peeked.alreadyVerified) {
    return { status: 200, html: authPage('Email verified', 'Your email is already verified. You can sign in now.', '') };
  }
  return {
    status: 200,
    html: authPage(
      'Verify your email',
      'Confirm this address to finish activating your account.',
      `<button id="verify" type="button" style="width:100%;border:0;border-radius:12px;background:#c4f77b;color:#0a1306;font-weight:700;padding:13px 18px;font-size:15px;cursor:pointer">Verify email</button>
       <p id="result" role="status" aria-live="polite" style="margin:16px 0 0;color:#bdc9c2;font-size:14px"></p>
       <script>
         document.getElementById('verify').addEventListener('click', async () => {
           const button = document.getElementById('verify');
           const result = document.getElementById('result');
           button.disabled = true;
           button.textContent = 'Verifying...';
           try {
             const response = await fetch('/api/auth/verify-email', {
               method: 'POST', credentials: 'same-origin', cache: 'no-store',
               headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
               body: JSON.stringify({ token: ${JSON.stringify(token)} })
             });
             const data = await response.json().catch(() => ({}));
             result.textContent = response.ok ? (data.message || 'Email verified successfully.') : (data.error || 'Verification failed.');
             result.style.color = response.ok ? '#a8f1c0' : '#ffb4a8';
             button.textContent = response.ok ? 'Email verified' : 'Try again';
             button.disabled = response.ok;
           } catch {
             result.textContent = 'Unable to reach the server. Please try again.';
             result.style.color = '#ffb4a8';
             button.disabled = false;
             button.textContent = 'Verify email';
           }
         });
       </script>`,
    ),
  };
}

export function renderPasswordResetPage(token: string): { status: number; html: string } {
  const record = getPasswordResetRecord(token);
  if (!record.ok) {
    return { status: 400, html: authPage('Reset link unavailable', record.message, '') };
  }
  return {
    status: 200,
    html: authPage(
      'Choose a new password',
      'Use at least 12 characters. This link can only be used once.',
      `<form id="reset-form" style="display:flex;flex-direction:column;gap:14px">
         <label style="font-size:13px;color:#bdc9c2">New password
           <input id="password" type="password" minlength="12" maxlength="1024" required style="margin-top:7px;width:100%;box-sizing:border-box;border-radius:12px;border:1px solid rgba(226,243,231,0.15);background:#0a100d;color:#f0f5ef;padding:12px 14px;font-size:15px">
         </label>
         <label style="font-size:13px;color:#bdc9c2">Confirm password
           <input id="confirm" type="password" minlength="12" maxlength="1024" required style="margin-top:7px;width:100%;box-sizing:border-box;border-radius:12px;border:1px solid rgba(226,243,231,0.15);background:#0a100d;color:#f0f5ef;padding:12px 14px;font-size:15px">
         </label>
         <button type="submit" style="width:100%;border:0;border-radius:12px;background:#c4f77b;color:#0a1306;font-weight:700;padding:13px 18px;font-size:15px;cursor:pointer">Update password</button>
         <p id="result" role="status" aria-live="polite" style="margin:0;color:#bdc9c2;font-size:14px"></p>
       </form>
       <script>
         document.getElementById('reset-form').addEventListener('submit', async (event) => {
           event.preventDefault();
           const password = document.getElementById('password').value;
           const confirm = document.getElementById('confirm').value;
           const result = document.getElementById('result');
           if (password.length < 12) { result.textContent = 'Use a password with at least 12 characters.'; result.style.color = '#ffb4a8'; return; }
           if (password !== confirm) { result.textContent = 'Passwords do not match.'; result.style.color = '#ffb4a8'; return; }
           const button = event.target.querySelector('button');
           button.disabled = true;
           button.textContent = 'Updating...';
           try {
             const response = await fetch('/api/auth/reset-password', {
               method: 'POST', credentials: 'same-origin', cache: 'no-store',
               headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
               body: JSON.stringify({ token: ${JSON.stringify(token)}, password })
             });
             const data = await response.json().catch(() => ({}));
             result.textContent = response.ok ? (data.message || 'Password updated.') : (data.error || 'Unable to reset password.');
             result.style.color = response.ok ? '#a8f1c0' : '#ffb4a8';
             button.textContent = response.ok ? 'Password updated' : 'Try again';
             button.disabled = response.ok;
           } catch {
             result.textContent = 'Unable to reach the server. Please try again.';
             result.style.color = '#ffb4a8';
             button.disabled = false;
             button.textContent = 'Update password';
           }
         });
       </script>`,
    ),
  };
}

function authPage(title: string, message: string, extra: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)} · ${escapeHtml(config.appName)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:
    radial-gradient(circle at 10% 10%, rgba(0,242,254,0.08), transparent 34rem),
    radial-gradient(circle at 90% 90%, rgba(121,40,202,0.1), transparent 34rem), #080c0a;
    color:#f0f5ef; font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  .card { width:100%; max-width:440px; padding:38px; border-radius:22px; background:rgba(14,21,18,0.9);
    border:1px solid rgba(226,243,231,0.1); box-shadow:0 30px 90px rgba(0,0,0,0.42); }
  .brand { display:flex; align-items:center; gap:11px; margin-bottom:28px; font-weight:800; letter-spacing:-0.02em; }
  .mark { width:38px; height:38px; border-radius:11px; display:grid; place-items:center;
    background:linear-gradient(135deg,#7928ca,#00f2fe); color:#fff; font-size:16px; font-weight:900; }
  .kicker { margin:0 0 8px; color:#98a79e; font-size:11px; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; }
  h1 { margin:0 0 12px; font-size:30px; line-height:1.15; letter-spacing:-0.03em; }
  p.lede { margin:0 0 24px; color:#bdc9c2; font-size:15px; line-height:1.6; }
  a { color:#c4f77b; }
  .foot { margin:22px 0 0; color:#98a79e; font-size:12px; }
</style>
</head>
<body>
  <main class="card">
    <div class="brand"><span class="mark">V</span><span>${escapeHtml(config.appName)}</span></div>
    <p class="kicker">Account security</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="lede">${escapeHtml(message)}</p>
    ${extra}
    <p class="foot"><a href="/">Back to ${escapeHtml(config.appName)}</a></p>
  </main>
</body>
</html>`;
}

export async function handleAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const pathname = url.pathname;
  const route = pathname.replace(/^\/api\/auth/, '') || '/';

  if (pathname === '/api/auth/demo-accounts' || pathname === '/api/auth/demo') {
    return false;
  }

  if (route === '/session' && req.method === 'GET') {
    await handleSession(req, res);
    return true;
  }
  if (route === '/login' && req.method === 'POST') {
    await handleLogin(req, res);
    return true;
  }
  if (route === '/register' && req.method === 'POST') {
    await handleRegister(req, res);
    return true;
  }
  if (route === '/logout' && req.method === 'POST') {
    await handleLogout(req, res);
    return true;
  }
  if (route === '/verify-email' && req.method === 'POST') {
    await handleVerifyEmail(req, res);
    return true;
  }
  if (route === '/resend-verification' && req.method === 'POST') {
    await handleResendVerification(req, res);
    return true;
  }
  if (route === '/forgot-password' && req.method === 'POST') {
    await handleForgotPassword(req, res);
    return true;
  }
  if (route === '/reset-password' && req.method === 'POST') {
    await handleResetPassword(req, res);
    return true;
  }
  if (route === '/change-password' && req.method === 'POST') {
    await handleChangePassword(req, res);
    return true;
  }

  if (
    ['/session', '/login', '/register', '/logout', '/verify-email', '/resend-verification',
      '/forgot-password', '/reset-password', '/change-password'].includes(route)
  ) {
    sendJson(res, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    return true;
  }

  return false;
}

export function setAuthError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof HttpError) {
    for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
    sendJson(res, error.status, {
      ...(error.details || {}),
      error: error.message,
      code: error.code,
    });
    return;
  }
  console.error('Unexpected auth request error:', error);
  sendJson(res, 500, { error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' });
}

function sanitizeHeaderValue(value: unknown): string {
  return String(value).replace(/[\r\n]/g, ' ').trim();
}

function sanitizeMailbox(value: unknown): string {
  const match = String(value).match(/<([^>]+)>/);
  return sanitizeHeaderValue(match ? match[1] : value)
    .replace(/[<>,;:]/g, '')
    .trim();
}

function dotStuffLine(line: string): string {
  return line.startsWith('.') ? `.${line}` : line;
}

function smtpIsConfigured(): boolean {
  if (!SMTP_HOST) return false;
  return Boolean(SMTP_USER) === Boolean(SMTP_PASS);
}

function buildMailMessage(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const headers = [
    `From: ${sanitizeMailbox(input.from)}`,
    `To: ${sanitizeMailbox(input.to)}`,
    `Subject: ${sanitizeHeaderValue(input.subject)}`,
    'MIME-Version: 1.0',
    `Date: ${new Date().toUTCString()}`,
    'Content-Type: text/html; charset=utf-8',
  ];
  const body = String(input.html)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(dotStuffLine)
    .join('\r\n');
  return [...headers, '', body, '.'].join('\r\n');
}

class SmtpSession {
  socket: any;
  timeoutMs: number;
  buffer = '';
  current: { code: number; lines: string[] } | null = null;
  responses: Array<{ code: number; lines: string[] }> = [];
  waiters: Array<{
    resolve: (value: { code: number; lines: string[] }) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout | null;
  }> = [];
  error: Error | null = null;

  constructor(socket: any, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }

  attach(socket: any): void {
    this.socket = socket;
    this.buffer = '';
    this.current = null;
    this.onData = (chunk: Buffer) => this.handleData(chunk);
    this.onError = (error: Error) => this.fail(error);
    this.onEnd = () => this.fail(new Error('SMTP connection closed.'));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('end', this.onEnd);
    socket.on('close', this.onEnd);
  }

  onData: (chunk: Buffer) => void = () => {};
  onError: (error: Error) => void = () => {};
  onEnd: () => void = () => {};

  detach(): void {
    if (!this.socket) return;
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('error', this.onError);
    this.socket.removeListener('end', this.onEnd);
    this.socket.removeListener('close', this.onEnd);
  }

  handleData(chunk: Buffer): void {
    if (this.error) return;
    this.buffer += chunk.toString('utf8');
    if (this.buffer.length > 64 * 1024) {
      this.fail(new Error('SMTP response is too large.'));
      return;
    }
    let index: number;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) continue;
      const code = Number(match[1]);
      if (!this.current) this.current = { code, lines: [] };
      if (this.current.code !== code) {
        this.fail(new Error('Malformed SMTP response.'));
        return;
      }
      this.current.lines.push(match[3]);
      if (match[2] === ' ') {
        const response = this.current;
        this.current = null;
        const waiter = this.waiters.shift();
        if (waiter) {
          if (waiter.timer) clearTimeout(waiter.timer);
          waiter.resolve(response);
        } else {
          this.responses.push(response);
        }
      }
    }
  }

  fail(error: Error): void {
    if (this.error) return;
    this.error = error;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  readResponse(): Promise<{ code: number; lines: string[] }> {
    if (this.responses.length > 0) return Promise.resolve(this.responses.shift()!);
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null as NodeJS.Timeout | null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new Error('SMTP timeout.'));
      }, this.timeoutMs);
      this.waiters.push(waiter);
    });
  }

  write(data: string): void {
    if (this.error) throw this.error;
    this.socket.write(data);
  }

  async expect(expectedCodes: number[], label: string) {
    const response = await this.readResponse();
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`SMTP ${label} failed (${response.code}): ${response.lines.join(' ').slice(0, 200)}`);
    }
    return response;
  }

  async command(line: string, expectedCodes: number[], label: string) {
    this.write(`${line}\r\n`);
    return this.expect(expectedCodes, label);
  }
}

function parseSmtpCapabilities(lines: string[]): Set<string> {
  const capabilities = new Set<string>();
  for (const line of lines) {
    const [name] = String(line).trim().split(/\s+/);
    if (name) capabilities.add(name.toUpperCase());
  }
  return capabilities;
}

async function sendMail(input: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const recipient = sanitizeMailbox(input.to);
  const envelopeFrom = sanitizeMailbox(SMTP_FROM);
  if (!recipient || !isValidEmail(recipient)) {
    throw new HttpError(400, 'A valid email address is required.', 'INVALID_EMAIL');
  }
  if (!envelopeFrom) {
    throw new HttpError(500, 'A valid sender address is required.', 'EMAIL_SEND_FAILED');
  }
  if (Buffer.byteLength(input.text, 'utf8') > MAX_EMAIL_BYTES) {
    throw new HttpError(500, 'Failed to send email.', 'EMAIL_SEND_FAILED');
  }
  if (!smtpIsConfigured()) {
    throw new HttpError(503, 'Email delivery is not configured.', 'EMAIL_UNAVAILABLE');
  }

  const implicitTls = SMTP_SECURE || SMTP_PORT === 465;
  const message = buildMailMessage({ ...input, from: SMTP_FROM });
  const tlsOptions = {
    host: SMTP_HOST,
    servername: isIP(SMTP_HOST) ? undefined : SMTP_HOST,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2' as const,
  };

  let socket: any;
  let session: SmtpSession | null = null;
  let timer: NodeJS.Timeout | null = null;

  try {
    socket = implicitTls
      ? tlsConnect({ ...tlsOptions, port: SMTP_PORT })
      : netConnect({ host: SMTP_HOST, port: SMTP_PORT });

    session = new SmtpSession(socket, SMTP_TIMEOUT_MS);
    timer = setTimeout(() => {
      try {
        socket.destroy();
      } catch {
        // Ignore.
      }
      session?.fail(new Error('SMTP timeout.'));
    }, SMTP_TIMEOUT_MS);

    await session.expect([220], 'greeting');
    let ehlo = await session.command(`EHLO ${SMTP_EHLO_NAME}`, [250], 'EHLO');
    let capabilities = parseSmtpCapabilities(ehlo.lines);

    if (!implicitTls) {
      if (capabilities.has('STARTTLS')) {
        await session.command('STARTTLS', [220], 'STARTTLS');
        session.detach();
        socket = tlsConnect({ ...tlsOptions, socket });
        session = new SmtpSession(socket, SMTP_TIMEOUT_MS);
        ehlo = await session.command(`EHLO ${SMTP_EHLO_NAME}`, [250], 'EHLO');
        capabilities = parseSmtpCapabilities(ehlo.lines);
      } else if (!SMTP_ALLOW_INSECURE) {
        throw new Error('SMTP server does not support STARTTLS.');
      }
    }

    if (SMTP_USER || SMTP_PASS) {
      if (socket.encrypted !== true && !SMTP_ALLOW_INSECURE) {
        throw new Error('SMTP authentication requires TLS.');
      }
      const authToken = Buffer.from(`\0${SMTP_USER}\0${SMTP_PASS}`).toString('base64');
      await session.command(`AUTH PLAIN ${authToken}`, [235], 'AUTH');
    } else if (socket.encrypted !== true && !SMTP_ALLOW_INSECURE) {
      throw new Error('Refusing to send email over an insecure SMTP connection.');
    }

    await session.command(`MAIL FROM:<${envelopeFrom}>`, [250], 'MAIL FROM');
    await session.command(`RCPT TO:<${recipient}>`, [250, 251], 'RCPT TO');
    await session.command('DATA', [354], 'DATA');
    session.write(`${message}\r\n`);
    await session.expect([250], 'message');
    try {
      await session.command('QUIT', [221], 'QUIT');
    } catch {
      // The message is already accepted.
    }
    session.detach();
    socket.end();
  } catch (error) {
    try {
      socket?.destroy();
    } catch {
      // Ignore.
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    session?.detach();
  }
}
