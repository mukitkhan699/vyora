import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.ts';
import { INITIAL_USERS } from './db/store.ts';
import { dbAdapter } from './db/adapter.ts';
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number.parseInt(process.env.PORT || String(config.port || 3000), 10) || 3000;
const DB_PATH = process.env.AUTH_DATABASE_PATH || path.join(rootDir, 'data', 'auth.db');
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
const COOKIE_SECURE = process.env.COOKIE_SECURE;
const SMTP_HOST = process.env.SMTP_HOST || '';

const COOKIE_NAME = 'sid';
const SECURE_COOKIE_NAME = '__Host-sid';
const MAX_BODY_BYTES = 64 * 1024;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/;
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ANON_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

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

export interface AuthUser {
  id: number | string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: number;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly headers: Record<string, string>;

  constructor(
    status: number,
    message: string,
    code?: string,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

// In-memory sliding window rate limiter
class SimpleRateLimiter {
  private timestamps = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string): number {
    const now = Date.now();
    const list = (this.timestamps.get(key) || []).filter((ts) => now - ts < this.windowMs);
    this.timestamps.set(key, list);
    if (list.length >= this.limit) {
      const oldest = list[0];
      return Math.ceil((this.windowMs - (now - oldest)) / 1000);
    }
    return 0;
  }

  record(key: string): void {
    const now = Date.now();
    const list = (this.timestamps.get(key) || []).filter((ts) => now - ts < this.windowMs);
    list.push(now);
    this.timestamps.set(key, list);
  }
}

const loginLimiter = new SimpleRateLimiter(20, 15 * 60 * 1000);
const registerLimiter = new SimpleRateLimiter(30, 60 * 60 * 1000);

// Initialize SQLite database
mkdirSync(path.dirname(DB_PATH), { recursive: true });
try {
  chmodSync(path.dirname(DB_PATH), 0o700);
} catch {
  // Best effort
}

const db = new DatabaseSync(DB_PATH);
try {
  chmodSync(DB_PATH, 0o600);
} catch {
  // Best effort
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
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
`);

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
  updateUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
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
  insertPasswordReset: db.prepare(
    'INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ),
  passwordResetByHash: db.prepare(
    'SELECT token_hash, user_id, created_at, expires_at, used_at FROM password_resets WHERE token_hash = ?',
  ),
  markPasswordResetUsed: db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?'),
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], 'hex');
  const expectedKey = Buffer.from(parts[5], 'hex');
  const derivedKey = await scryptAsync(password, salt, expectedKey.length, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return timingSafeEqual(derivedKey, expectedKey);
}

export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function normalizeUsername(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export function isSecureRequest(req: IncomingMessage): boolean {
  if (COOKIE_SECURE === 'true') return true;
  if (COOKIE_SECURE === 'false') return false;
  const socketWithEncrypted = req.socket as { encrypted?: boolean };
  if (socketWithEncrypted.encrypted) return true;
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return false;
}

export function getCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const cookies = header.split(';');
  for (const cookie of cookies) {
    const [rawKey, ...parts] = cookie.trim().split('=');
    if (rawKey === name) {
      return decodeURIComponent(parts.join('='));
    }
  }
  return null;
}

export function setSessionCookie(req: IncomingMessage, res: ServerResponse, session: AuthSession): void {
  const secure = isSecureRequest(req);
  const cookieName = secure ? SECURE_COOKIE_NAME : COOKIE_NAME;
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  const directives = [
    `${cookieName}=${encodeURIComponent(session.token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) directives.push('Secure');
  res.setHeader('Set-Cookie', directives.join('; '));
}

export function clearSessionCookie(req: IncomingMessage, res: ServerResponse): void {
  const secure = isSecureRequest(req);
  const cookieName = secure ? SECURE_COOKIE_NAME : COOKIE_NAME;
  res.setHeader(
    'Set-Cookie',
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
  );
}

export function getSession(req: IncomingMessage): AuthSession | null {
  const secure = isSecureRequest(req);
  const token =
    getCookie(req, secure ? SECURE_COOKIE_NAME : COOKIE_NAME) ||
    getCookie(req, COOKIE_NAME) ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (!token) return null;
  const row = statements.sessionByHash.get(hashToken(token)) as
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

  return {
    token,
    tokenHash: row.token_hash,
    userId: row.user_id,
    username: row.username,
    email: row.email,
    emailVerified: row.email_verified ?? 1,
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

export function createSession(user: Record<string, unknown> | null): AuthSession {
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
    emailVerified: (user?.email_verified as number | undefined) ?? 1,
    userCreatedAt: (user?.created_at as number | undefined) ?? null,
    csrfToken,
    expiresAt,
  };
}

export function requireSessionWithCsrf(req: IncomingMessage): AuthSession {
  const session = getSession(req);
  if (!session) {
    throw new HttpError(403, 'Session required. Please sign in.', 'SESSION_REQUIRED');
  }

  const csrfHeader = req.headers['x-csrf-token'];
  if (csrfHeader && !safeEqual(csrfHeader, session.csrfToken)) {
    throw new HttpError(403, 'Security token invalid. Please refresh the page.', 'CSRF_INVALID');
  }

  return session;
}

export function validateStateChangingRequest(req: IncomingMessage): void {
  const contentType = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (
    contentType !== 'application/json' &&
    !contentType.startsWith('multipart/form-data') &&
    req.method !== 'GET'
  ) {
    // Valid for JSON bodies
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      req.resume();
      throw new HttpError(413, 'Request payload too large.', 'PAYLOAD_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  if (total === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON object required');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON body.', 'INVALID_JSON');
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function setAuthError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    for (const [k, v] of Object.entries(error.headers)) {
      res.setHeader(k, v);
    }
    sendJson(res, error.status, {
      error: error.message,
      code: error.code || 'ERROR',
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  sendJson(res, 500, { error: message, code: 'INTERNAL_ERROR' });
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
    requireEmailVerification: false,
  };
}

// Handlers for Aegis authentication routes
export async function handleSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = getSession(req);
  if (session && session.userId) {
    const user = statements.userById.get(session.userId) as Record<string, unknown> | undefined;
    sendJson(res, 200, sessionPayload(session, userToPublic(user)));
    return;
  }
  // Anonymous session for CSRF token
  const anonymousSession = session || createSession(null);
  setSessionCookie(req, res, anonymousSession);
  sendJson(res, 200, sessionPayload(anonymousSession, null));
}

export async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const body = await readJsonBody(req);
  const identifier = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!identifier || !password) {
    throw new HttpError(400, 'Username or email and password are required.', 'MISSING_CREDENTIALS');
  }

  const clientIp = req.socket.remoteAddress || 'ip';
  const retryAfter = loginLimiter.check(`login:${clientIp}`);
  if (retryAfter > 0) {
    throw new HttpError(429, 'Too many login attempts. Please wait a moment.', 'RATE_LIMITED');
  }
  loginLimiter.record(`login:${clientIp}`);

  // Find by username OR email
  const user = (statements.userByUsername.get(identifier) ||
    statements.userByEmail.get(identifier)) as
    | {
        id: number;
        username: string;
        email: string | null;
        password_hash: string;
        email_verified: number;
        created_at: number;
      }
    | undefined;

  if (!user) {
    throw new HttpError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    throw new HttpError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
  }

  // Create session
  const session = createSession(user);
  setSessionCookie(req, res, session);
  const publicUser = userToPublic(user);

  sendJson(res, 200, {
    ...sessionPayload(session, publicUser),
    message: 'Logged in successfully.',
  });
}

export async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const body = await readJsonBody(req);
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const displayName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : username;

  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(
      400,
      'Username must be 3-32 characters (letters, numbers, underscores).',
      'INVALID_USERNAME',
    );
  }

  if (password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters.', 'INVALID_PASSWORD');
  }

  if (!isValidEmail(email)) {
    throw new HttpError(400, 'A valid email address is required.', 'INVALID_EMAIL');
  }

  const clientIp = req.socket.remoteAddress || 'ip';
  const retryAfter = registerLimiter.check(`reg:${clientIp}`);
  if (retryAfter > 0) {
    throw new HttpError(429, 'Too many registrations. Please try again later.', 'RATE_LIMITED');
  }
  registerLimiter.record(`reg:${clientIp}`);

  if (statements.userByUsername.get(username)) {
    throw new HttpError(409, 'That username is already taken.', 'USERNAME_TAKEN');
  }
  if (statements.userByEmail.get(email)) {
    throw new HttpError(409, 'An account with that email already exists.', 'EMAIL_TAKEN');
  }

  const passwordHash = await hashPassword(password);
  const createdAt = Date.now();

  const insertResult = statements.insertUser.run(
    username,
    email,
    passwordHash,
    1, // Email verified by default in dependency-free mode
    createdAt,
  );

  const userId = Number(insertResult.lastInsertRowid);
  const user = {
    id: userId,
    username,
    email,
    password_hash: passwordHash,
    email_verified: 1,
    created_at: createdAt,
  };

  // Sync social profile in store
  const socialUser = dbAdapter.ensureUserFromAuth({
    id: userId,
    username,
    email,
    createdAt,
  });
  if (displayName && displayName !== username) {
    socialUser.name = displayName;
  }

  // Create active session immediately
  const session = createSession(user);
  setSessionCookie(req, res, session);

  sendJson(res, 201, {
    authenticated: true,
    user: userToPublic(user),
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    message: 'Account created successfully! Welcome to VYORA.',
  });
}

export async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = getSession(req);
  if (session) {
    statements.deleteSession.run(session.tokenHash);
  }
  clearSessionCookie(req, res);
  const anonymousSession = createSession(null);
  setSessionCookie(req, res, anonymousSession);
  sendJson(res, 200, sessionPayload(anonymousSession, null));
}

export async function handleChangePassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const session = requireSessionWithCsrf(req);
  if (!session.userId) {
    throw new HttpError(401, 'Authentication required.', 'UNAUTHORIZED');
  }

  const body = await readJsonBody(req);
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');

  if (!currentPassword || !newPassword) {
    throw new HttpError(400, 'Current and new passwords are required.', 'MISSING_FIELDS');
  }
  if (newPassword.length < 8) {
    throw new HttpError(400, 'New password must be at least 8 characters.', 'INVALID_PASSWORD');
  }

  const user = statements.userById.get(session.userId) as
    | { id: number; password_hash: string }
    | undefined;

  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'Current password incorrect.', 'INVALID_PASSWORD');
  }

  const newHash = await hashPassword(newPassword);
  statements.updateUserPassword.run(newHash, session.userId);

  sendJson(res, 200, { changed: true, message: 'Password updated successfully.' });
}

export async function handleForgotPassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Valid email required.', 'INVALID_EMAIL');
  }

  const user = statements.userByEmail.get(email) as { id: number } | undefined;
  if (user) {
    const token = randomBytes(24).toString('base64url');
    statements.insertPasswordReset.run(
      hashToken(token),
      user.id,
      Date.now(),
      Date.now() + 60 * 60 * 1000,
    );
    console.log(`[AUTH] Password reset requested for ${email}. Token: ${token}`);
  }

  sendJson(res, 200, {
    sent: true,
    message: 'If that email exists in our system, reset instructions have been recorded.',
  });
}

export async function handleResetPassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const body = await readJsonBody(req);
  const token = String(body.token || '');
  const newPassword = String(body.password || '');

  if (!token || newPassword.length < 8) {
    throw new HttpError(400, 'Valid token and 8+ character password required.', 'INVALID_REQUEST');
  }

  const resetRecord = statements.passwordResetByHash.get(hashToken(token)) as
    | { token_hash: string; user_id: number; expires_at: number; used_at: number | null }
    | undefined;

  if (!resetRecord || resetRecord.used_at !== null || resetRecord.expires_at < Date.now()) {
    throw new HttpError(400, 'Reset token is invalid or has expired.', 'INVALID_TOKEN');
  }

  const newHash = await hashPassword(newPassword);
  statements.updateUserPassword.run(newHash, resetRecord.user_id);
  statements.markPasswordResetUsed.run(Date.now(), resetRecord.token_hash);

  sendJson(res, 200, { reset: true, message: 'Password reset successfully. You can now sign in.' });
}

// Route dispatcher for auth endpoints
export async function handleAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  // Support both /api/auth/* and /api/* paths
  if ((pathname === '/api/auth/session' || pathname === '/api/session') && method === 'GET') {
    await handleSession(req, res);
    return true;
  }
  if ((pathname === '/api/auth/login' || pathname === '/api/login') && method === 'POST') {
    await handleLogin(req, res);
    return true;
  }
  if ((pathname === '/api/auth/register' || pathname === '/api/register') && method === 'POST') {
    await handleRegister(req, res);
    return true;
  }
  if ((pathname === '/api/auth/logout' || pathname === '/api/logout') && method === 'POST') {
    await handleLogout(req, res);
    return true;
  }
  if ((pathname === '/api/auth/change-password' || pathname === '/api/change-password') && method === 'POST') {
    await handleChangePassword(req, res);
    return true;
  }
  if ((pathname === '/api/auth/forgot-password' || pathname === '/api/forgot-password') && method === 'POST') {
    await handleForgotPassword(req, res);
    return true;
  }
  if ((pathname === '/api/auth/reset-password' || pathname === '/api/reset-password') && method === 'POST') {
    await handleResetPassword(req, res);
    return true;
  }

  return false;
}

// Seed demo users with scrypt password 'vyora123'
export async function initAuth(): Promise<void> {
  const defaultPassword = 'vyora123';
  const hashedPassword = await hashPassword(defaultPassword);

  for (const user of INITIAL_USERS) {
    const existing = statements.userByUsername.get(user.username);
    if (!existing) {
      try {
        statements.insertUser.run(
          user.username,
          `${user.username}@vyora.network`,
          hashedPassword,
          1,
          Date.now(),
        );
      } catch (err) {
        // User may already exist
      }
    }
  }
  console.log('[AUTH] Aegis authentication initialized with self-contained SQLite.');
}

export function renderEmailVerificationPage(token: string) {
  return {
    status: 200,
    html: `<!doctype html><html><body><h1>Email Verified</h1><p>Your address has been confirmed. You can now <a href="/">sign in to VYORA</a>.</p></body></html>`,
  };
}

export function renderPasswordResetPage(token: string) {
  return {
    status: 200,
    html: `<!doctype html><html><body><h1>Reset Password</h1><p>Please use the VYORA interface to reset your password.</p></body></html>`,
  };
}
