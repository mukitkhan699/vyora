import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.ts';
import { INITIAL_USERS } from './db/store.ts';
import { dbAdapter } from './db/adapter.ts';
import { query, verifyDatabase, withTransaction } from './db/pool.ts';
import { HttpError } from './errors.ts';
import { publishSessionRevocation } from './realtime-events.ts';

export { HttpError } from './errors.ts';
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

const COOKIE_SECURE = process.env.COOKIE_SECURE;

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

export async function getSession(req: IncomingMessage): Promise<AuthSession | null> {
  const secure = isSecureRequest(req);
  const token =
    getCookie(req, secure ? SECURE_COOKIE_NAME : COOKIE_NAME) ||
    getCookie(req, COOKIE_NAME) ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (!token) return null;
  const result = await query<{
        token_hash: string;
        user_id: number | null;
        csrf_token: string;
        expires_at: number;
        username: string | null;
        email: string | null;
        email_verified: boolean | null;
        user_created_at: number | null;
      }>(
    `SELECT
       s.token_hash,
       s.user_id,
       s.csrf_token,
       s.expires_at,
       u.username,
       u.email,
       u.email_verified,
       u.created_at AS user_created_at
     FROM zunari_sessions AS s
     LEFT JOIN zunari_users AS u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  const row = result.rows[0];

  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await query('DELETE FROM zunari_sessions WHERE token_hash = $1', [row.token_hash]);
    return null;
  }

  return {
    token,
    tokenHash: row.token_hash,
    userId: row.user_id,
    username: row.username,
    email: row.email,
    emailVerified: row.email_verified === null ? 1 : Number(row.email_verified),
    userCreatedAt: row.user_created_at === null ? null : Number(row.user_created_at),
    csrfToken: row.csrf_token,
    expiresAt: Number(row.expires_at),
  };
}

export async function getAuthUser(req: IncomingMessage): Promise<AuthUser | null> {
  const session = await getSession(req);
  if (!session || !session.userId) return null;
  return {
    id: session.userId,
    username: session.username || '',
    email: session.email,
    emailVerified: Boolean(session.emailVerified),
    createdAt: session.userCreatedAt || 0,
  };
}

export async function createSession(user: Record<string, unknown> | null): Promise<AuthSession> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  const expiresAt = createdAt + (user ? SESSION_TTL_MS : ANON_SESSION_TTL_MS);

  await query(
    `INSERT INTO zunari_sessions (token_hash, user_id, csrf_token, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), (user?.id as number | undefined) ?? null, csrfToken, createdAt, expiresAt],
  );

  return {
    token,
    tokenHash: hashToken(token),
    userId: (user?.id as number | undefined) ?? null,
    username: (user?.username as string | undefined) ?? null,
    email: (user?.email as string | undefined) ?? null,
    emailVerified: user?.email_verified === undefined ? 1 : Number(user.email_verified),
    userCreatedAt:
      user?.created_at === undefined || user.created_at === null
        ? null
        : Number(user.created_at),
    csrfToken,
    expiresAt,
  };
}

export async function requireSessionWithCsrf(req: IncomingMessage): Promise<AuthSession> {
  const session = await getSession(req);
  if (!session) {
    throw new HttpError(403, 'Session required. Please sign in.', 'SESSION_REQUIRED');
  }

  const csrfHeader = req.headers['x-csrf-token'];
  if (!csrfHeader || !safeEqual(csrfHeader, session.csrfToken)) {
    throw new HttpError(403, 'Security token invalid. Please refresh the page.', 'CSRF_INVALID');
  }

  return session;
}

export function validateStateChangingRequest(req: IncomingMessage): void {
  const contentType = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json.', 'UNSUPPORTED_MEDIA_TYPE');
  }

  const originHeader = req.headers.origin;
  if (originHeader) {
    let requestOrigin: string;
    try {
      requestOrigin = new URL(originHeader).origin;
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.', 'ORIGIN_INVALID');
    }

    let expectedOrigin: string | undefined;
    const appUrl = process.env.APP_URL?.trim();
    if (appUrl) {
      try {
        expectedOrigin = new URL(appUrl).origin;
      } catch {
        throw new HttpError(403, 'Request origin is not allowed.', 'ORIGIN_INVALID');
      }
    } else if (req.headers.host) {
      const forwardedProto = req.headers['x-forwarded-proto'];
      const protocol =
        typeof forwardedProto === 'string'
          ? forwardedProto.split(',')[0].trim().toLowerCase()
          : COOKIE_SECURE === 'true' || (req.socket as { encrypted?: boolean }).encrypted
            ? 'https'
            : 'http';
      if (protocol === 'http' || protocol === 'https') {
        expectedOrigin = `${protocol}://${req.headers.host}`;
      }
    }

    if (!expectedOrigin || requestOrigin !== expectedOrigin) {
      throw new HttpError(403, 'Request origin is not allowed.', 'ORIGIN_INVALID');
    }
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
  sendJson(res, 500, { error: 'Internal server error.', code: 'INTERNAL_ERROR' });
}

async function userToPublic(
  user: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | null> {
  if (!user) return null;
  const authId = Number(user.id);
  const username = String(user.username || '');
  const social = await dbAdapter.syncAuthProfile({
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
  const session = await getSession(req);
  if (session && session.userId) {
    const result = await query<Record<string, unknown>>(
      'SELECT id, username, email, email_verified, created_at FROM zunari_users WHERE id = $1',
      [session.userId],
    );
    sendJson(res, 200, sessionPayload(session, await userToPublic(result.rows[0])));
    return;
  }
  // Anonymous session for CSRF token
  const anonymousSession = session || (await createSession(null));
  setSessionCookie(req, res, anonymousSession);
  sendJson(res, 200, sessionPayload(anonymousSession, null));
}

export async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  await requireSessionWithCsrf(req);
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
  const userResult = await query<{
    id: number;
    username: string;
    email: string | null;
    password_hash: string;
    email_verified: boolean;
    created_at: number | string;
  }>(
    `SELECT id, username, email, password_hash, email_verified, created_at
     FROM zunari_users
     WHERE lower(username) = lower($1) OR lower(email) = lower($1)
     LIMIT 1`,
    [identifier],
  );
  const user = userResult.rows[0];

  if (!user) {
    throw new HttpError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    throw new HttpError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
  }

  // Create session
  const session = await createSession(user);
  setSessionCookie(req, res, session);
  const publicUser = await userToPublic(user);

  sendJson(res, 200, {
    ...sessionPayload(session, publicUser),
    message: 'Logged in successfully.',
  });
}

export async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  await requireSessionWithCsrf(req);
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

  const passwordHash = await hashPassword(password);
  const existingAccount = await query(
    `SELECT 1 FROM zunari_users
     WHERE lower(username) = lower($1) OR lower(email) = lower($2)
     LIMIT 1`,
    [username, email],
  );
  if (existingAccount.rowCount) {
    throw new HttpError(
      409,
      'That username or email address is unavailable.',
      'ACCOUNT_CONFLICT',
    );
  }

  const createdAt = Date.now();

  let inserted;
  try {
    inserted = await withTransaction(async (connection) => {
      const nextId = await connection.query<{ id: number }>(
        "SELECT nextval(pg_get_serial_sequence('zunari_users', 'id'))::integer AS id",
      );
      return connection.query<{
        id: number;
        username: string;
        email: string;
        password_hash: string;
        email_verified: boolean;
        created_at: number | string;
      }>(
        `INSERT INTO zunari_users
           (id, public_id, username, name, email, password_hash, email_verified, created_at,
            joined_date, avatar_url, banner_url, bio, following_count)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $10, $11, 1)
         RETURNING id, username, email, password_hash, email_verified, created_at`,
        [
          nextId.rows[0].id,
          `user_auth_${nextId.rows[0].id}`,
          username,
          displayName,
          email,
          passwordHash,
          createdAt,
          `Joined ${new Date(createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
          INITIAL_USERS[0].avatarUrl,
          INITIAL_USERS[0].bannerUrl || null,
          'New Zunari member',
        ],
      );
    });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === '23505')) {
      throw error;
    }
    const existing = await query(
      'SELECT 1 FROM zunari_users WHERE lower(username) = lower($1) OR lower(email) = lower($2) LIMIT 1',
      [username, email],
    );
    if (existing.rowCount) {
      throw new HttpError(
        409,
        'That username or email address is unavailable.',
        'ACCOUNT_CONFLICT',
      );
    }
    throw error;
  }
  const user = inserted.rows[0];
  const socialUser = await dbAdapter.ensureUserFromAuth({
    id: Number(user.id),
    username,
    email,
    createdAt,
  });
  await dbAdapter.updateProfile(socialUser.id, { name: displayName });

  const mukitExists = await query('SELECT 1 FROM zunari_users WHERE public_id = $1', ['user_mukit']);
  if (mukitExists.rowCount) {
    await query(
      `INSERT INTO zunari_follows (follower_id, following_id, created_at)
       VALUES ($1, 'user_mukit', $2) ON CONFLICT DO NOTHING`,
      [`user_auth_${user.id}`, createdAt],
    );
  }

  // Create active session immediately
  const session = await createSession(user);
  setSessionCookie(req, res, session);

  sendJson(res, 201, {
    authenticated: true,
    user: await userToPublic(user),
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    message: 'Account created successfully! Welcome to Zunari.',
  });
}

export async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const session = await requireSessionWithCsrf(req);
  await query('DELETE FROM zunari_sessions WHERE token_hash = $1', [session.tokenHash]);
  publishSessionRevocation({ tokenHash: session.tokenHash });
  clearSessionCookie(req, res);
  const anonymousSession = await createSession(null);
  setSessionCookie(req, res, anonymousSession);
  sendJson(res, 200, sessionPayload(anonymousSession, null));
}

export async function handleChangePassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  const session = await requireSessionWithCsrf(req);
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

  const userResult = await query<{ id: number; password_hash: string }>(
    'SELECT id, password_hash FROM zunari_users WHERE id = $1',
    [session.userId],
  );
  const user = userResult.rows[0];

  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'Current password incorrect.', 'INVALID_PASSWORD');
  }

  const newHash = await hashPassword(newPassword);
  await withTransaction(async (connection) => {
    await connection.query('UPDATE zunari_users SET password_hash = $1 WHERE id = $2', [
      newHash,
      session.userId,
    ]);
    await connection.query('DELETE FROM zunari_sessions WHERE user_id = $1', [session.userId]);
  });
  publishSessionRevocation({ userId: session.userId });
  const nextSession = await createSession(user);
  setSessionCookie(req, res, nextSession);

  sendJson(res, 200, {
    changed: true,
    message: 'Password updated successfully.',
    csrfToken: nextSession.csrfToken,
    expiresAt: nextSession.expiresAt,
  });
}

export async function handleForgotPassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  await requireSessionWithCsrf(req);
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Valid email required.', 'INVALID_EMAIL');
  }

  const userResult = await query<{ id: number }>(
    'SELECT id FROM zunari_users WHERE lower(email) = lower($1)',
    [email],
  );
  const user = userResult.rows[0];
  if (user) {
    const token = randomBytes(24).toString('base64url');
    await query(
      `INSERT INTO zunari_password_resets (token_hash, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [hashToken(token), user.id, Date.now(), Date.now() + 60 * 60 * 1000],
    );
  }

  sendJson(res, 200, {
    sent: true,
    message: 'If that email exists in our system, reset instructions have been recorded.',
  });
}

export async function handleResetPassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  validateStateChangingRequest(req);
  await requireSessionWithCsrf(req);
  const body = await readJsonBody(req);
  const token = String(body.token || '');
  const newPassword = String(body.password || '');

  if (!token || newPassword.length < 8) {
    throw new HttpError(400, 'Valid token and 8+ character password required.', 'INVALID_REQUEST');
  }

  const resetResult = await query<{
    token_hash: string;
    user_id: number;
    expires_at: number;
    used_at: number | null;
  }>(
    `SELECT token_hash, user_id, expires_at, used_at
     FROM zunari_password_resets WHERE token_hash = $1`,
    [hashToken(token)],
  );
  const resetRecord = resetResult.rows[0];

  if (!resetRecord || resetRecord.used_at !== null || resetRecord.expires_at < Date.now()) {
    throw new HttpError(400, 'Reset token is invalid or has expired.', 'INVALID_TOKEN');
  }

  const newHash = await hashPassword(newPassword);
  await withTransaction(async (connection) => {
    await connection.query('UPDATE zunari_users SET password_hash = $1 WHERE id = $2', [
      newHash,
      resetRecord.user_id,
    ]);
    await connection.query(
      'UPDATE zunari_password_resets SET used_at = $1 WHERE token_hash = $2',
      [Date.now(), resetRecord.token_hash],
    );
    await connection.query('DELETE FROM zunari_sessions WHERE user_id = $1', [
      resetRecord.user_id,
    ]);
  });

  publishSessionRevocation({ userId: resetRecord.user_id });
  clearSessionCookie(req, res);
  const anonymousSession = await createSession(null);
  setSessionCookie(req, res, anonymousSession);
  sendJson(res, 200, {
    reset: true,
    message: 'Password reset successfully. You can now sign in.',
    csrfToken: anonymousSession.csrfToken,
    expiresAt: anonymousSession.expiresAt,
  });
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

export async function initAuth(): Promise<void> {
}

export async function seedDemoAccounts(): Promise<void> {
  const defaultPassword = 'vyora123';
  const hashedPassword = await hashPassword(defaultPassword);

  for (const user of INITIAL_USERS) {
    const existing = await query(
      'SELECT 1 FROM zunari_users WHERE lower(username) = lower($1) LIMIT 1',
      [user.username],
    );
    if (!existing.rowCount) {
      await query(
        `INSERT INTO zunari_users
           (public_id, username, name, email, password_hash, email_verified, created_at, joined_date,
            avatar_url, banner_url, bio, location, website, verified, is_gold,
            followers_count, following_count)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT DO NOTHING`,
        [
          user.id,
          user.username,
          user.name,
          `${user.username}@vyora.network`,
          hashedPassword,
          Date.now(),
          user.joinedDate,
          user.avatarUrl,
          user.bannerUrl || null,
          user.bio || null,
          user.location || null,
          user.website || null,
          user.verified,
          Boolean(user.isGold),
          user.followersCount,
          user.followingCount,
        ],
      );
    }
  }
}

export function renderEmailVerificationPage(token: string) {
  return {
    status: 200,
    html: `<!doctype html><html><body><h1>Email Verified</h1><p>Your address has been confirmed. You can now <a href="/">sign in to Zunari</a>.</p></body></html>`,
  };
}

export function renderPasswordResetPage(token: string) {
  return {
    status: 200,
    html: `<!doctype html><html><body><h1>Reset Password</h1><p>Please use the Zunari interface to reset your password.</p></body></html>`,
  };
}
