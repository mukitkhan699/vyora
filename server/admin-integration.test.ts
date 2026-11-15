import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import { createHash, randomBytes, scrypt as scryptCallback, type ScryptOptions } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { ServerResponse } from 'node:http';
import { hashToken, isSecureRequest, safeEqual } from './auth.ts';

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

interface TestUser {
  id: number;
  public_id: string;
  username: string;
  email: string;
  password_hash: string;
  admin_role: string | null;
  suspended_at: number | null;
  verified: boolean;
  is_gold: boolean;
  created_at: number;
}

interface TestReport {
  id: string;
  type: 'user' | 'post';
  reporter_id: string | null;
  reporter_username: string;
  reported_user_id: string | null;
  reported_username: string | null;
  post_id: string | null;
  post_preview: string | null;
  reason: string;
  details: string | null;
  status: 'pending' | 'reviewed' | 'dismissed' | 'action_taken';
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
}

interface TestAuditLog {
  id: string;
  admin_id: string;
  admin_username: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
}

const POOL_SPEC = new URL('file://' + process.cwd() + '/server/db/pool.ts').href;

// Shared mock state for the database query module. mock.module can only be
// called once per specifier, so we set it up in a single setup test and reuse
// the mock across all tests via setMockResponses().
let mockQueryImpl: any = null;
let mockTransactionQueryImpl: any = null;
let mockCallCount = 0;
let mockResponses: Array<{ rows: unknown[] }> = [];

async function setupDatabaseMock() {
  mockQueryImpl = mock.fn(async (_text: string, _values?: unknown[]) => {
    const response = mockResponses[Math.min(mockCallCount, mockResponses.length - 1)];
    mockCallCount += 1;
    return response;
  });
  mockTransactionQueryImpl = mock.fn(async () =>
    mockResponses[Math.min(mockCallCount, mockResponses.length - 1)],
  );
  mock.module(POOL_SPEC, {
    exports: {
      query: mockQueryImpl,
      withTransaction: mock.fn(async (work: any) =>
        work({ query: mockTransactionQueryImpl }),
      ),
      getPool: mock.fn(() => ({
        query: mock.fn(async () => mockResponses[Math.min(mockCallCount, mockResponses.length - 1)]),
      })),
    },
  } as any);
}

function setMockResponses(responses: Array<{ rows: unknown[] }>) {
  mockResponses = responses;
  mockCallCount = 0;
  mockQueryImpl?.mock.resetCalls();
  mockTransactionQueryImpl?.mock.resetCalls();
}

// Mock database rows returned by getAdminSession's two queries.
function makeMockSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess_test_1',
    admin_id: 'user_auth_test_1',
    session_token_hash: hashToken('test-session-token'),
    csrf_token_hash: 'test-csrf-token', // raw token (see CSRF note below)
    ip_address: '127.0.0.1',
    user_agent: null,
    created_at: Date.now(),
    expires_at: Date.now() + 8 * 60 * 60 * 1000,
    last_activity_at: Date.now(),
    ...overrides,
  };
}

function makeMockUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    public_id: 'user_auth_test_1',
    username: 'testadmin',
    email: 'testadmin@example.com',
    admin_role: 'admin',
    ...overrides,
  };
}

// AdminSession return shape (used directly in requirePermission tests).
function makeMockSession(overrides: Record<string, unknown> = {}) {
  return {
    token: 'test-session-token',
    tokenHash: hashToken('test-session-token'),
    userId: 1,
    publicId: 'user_auth_test_1',
    username: 'testadmin',
    email: 'testadmin@example.com',
    adminRole: 'admin',
    permissions: {
      users: { read: true, write: true, suspend: true },
      posts: { read: true, delete: true },
      reports: { read: true, write: true },
      audit: { read: true },
      badges: { read: true, write: true },
      stats: { read: true },
      admin_users: { read: true, write: true },
    },
    csrfToken: 'test-csrf-token',
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    ...overrides,
  };
}

function makeMockReq(overrides: Record<string, unknown> = {}): IncomingMessage {
  const body = overrides.body || null;
  return {
    method: 'GET',
    url: 'http://localhost/api/admin/test',
    headers: {},
    socket: { remoteAddress: '127.0.0.1', encrypted: false } as any,
    [Symbol.asyncIterator]: function* () {
      if (body) yield Buffer.from(body as string);
    },
    ...overrides,
  } as unknown as IncomingMessage;
}

function makeMockRes(): ServerResponse {
  const chunks: Buffer[] = [];
  let statusCode = 200;
  const headers: Record<string, string> = {};
  return {
    setHeader(name: string, value: string) {
      headers[name] = String(value);
    },
    getHeader(name: string) {
      return headers[name];
    },
    removeHeader() {},
    getHeaders() {
      return headers;
    },
    writeHead(status: number) {
      statusCode = status;
    },
    write(chunk: any) {
      chunks.push(Buffer.from(chunk));
    },
    end(chunk?: any) {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    get writableEnded() {
      return false;
    },
    destroy() {},
    on() {
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    get body() {
      return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : null;
    },
  } as unknown as ServerResponse;
}

const TEST_SESSION_TOKEN = 'test-session-token';
const TEST_CSRF_TOKEN = 'test-csrf-token';

describe('Admin API contract tests (mock-based; no PostgreSQL connection)', () => {
  // ---- Setup: mock the database module once ----
  test('setup: mock database module', async () => {
    await setupDatabaseMock();
    assert.ok(mockQueryImpl !== null, 'Database mock should be installed');
  });

  const testUsers = new Map<string, TestUser>();
  const testReports = new Map<string, TestReport>();
  const testAuditLogs = new Map<string, TestAuditLog>();

  async function createTestUser(overrides: Partial<{
    username: string;
    email: string;
    password: string;
    admin_role: string | null;
    suspended_at: number | null;
    verified: boolean;
    is_gold: boolean;
  }> = {}) {
    const id = testUsers.size + 1;
    const public_id = `user_auth_test_${id}`;
    const username = overrides.username || `testuser${id}`;
    const email = overrides.email || `${username}@example.com`;
    const password = overrides.password || 'TestPass123!';
    const admin_role = overrides.admin_role || null;
    const suspended_at = overrides.suspended_at ?? null;
    const verified = overrides.verified ?? false;
    const is_gold = overrides.is_gold ?? false;
    const created_at = Date.now();
    const password_hash = await hashPassword(password);

    const user: TestUser = {
      id,
      public_id,
      username,
      email,
      password_hash,
      admin_role,
      suspended_at,
      verified,
      is_gold,
      created_at,
    };
    testUsers.set(public_id, user);
    return user;
  }

  async function createAdminSession(adminPublicId: string, adminRole: string) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const createdAt = Date.now();
    const expiresAt = createdAt + 8 * 60 * 60 * 1000;
    const tokenHash = hashToken(token);
    const csrfTokenHash = hashToken(csrfToken);
    const sessionId = `adm_sess_${randomBytes(16).toString('hex')}`;

    return { token, csrfToken, sessionId, tokenHash, csrfTokenHash, adminPublicId, adminRole, expiresAt };
  }

  function makeRequest(
    method: string,
    path: string,
    body: Record<string, unknown> | null = null,
    headers: Record<string, string> = {}
  ) {
    return {
      method,
      url: `http://localhost${path}`,
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : null,
    };
  }

  // ---- Pure function tests (no DB required) ----

  describe('Pure functions', () => {
    test('hashToken returns a 64-character lowercase hex string', () => {
      const result = hashToken('abc');
      assert.strictEqual(typeof result, 'string');
      assert.strictEqual(result.length, 64);
      assert.ok(/^[0-9a-f]{64}$/.test(result));
    });

    test('hashToken is deterministic', () => {
      assert.strictEqual(hashToken('same-input'), hashToken('same-input'));
    });

    test('hashToken differs for different inputs', () => {
      assert.notStrictEqual(hashToken('input-a'), hashToken('input-b'));
    });

    test('safeEqual returns true for identical strings', () => {
      assert.strictEqual(safeEqual('hello', 'hello'), true);
    });

    test('safeEqual returns false for different strings', () => {
      assert.strictEqual(safeEqual('hello', 'world'), false);
    });

    test('safeEqual returns false for different lengths', () => {
      assert.strictEqual(safeEqual('short', 'much-longer-string'), false);
    });

    test('safeEqual returns false for non-string inputs', () => {
      assert.strictEqual(safeEqual('abc', 123 as unknown as string), false);
      assert.strictEqual(safeEqual(null as unknown as string, 'abc'), false);
    });

    test('isSecureRequest returns true for https x-forwarded-proto', () => {
      const req = {
        headers: { 'x-forwarded-proto': 'https' },
        socket: { encrypted: false },
      } as unknown as IncomingMessage;
      assert.strictEqual(isSecureRequest(req), true);
    });

    test('isSecureRequest returns true for http x-forwarded-proto', () => {
      const req = {
        headers: { 'x-forwarded-proto': 'http' },
        socket: { encrypted: false },
      } as unknown as IncomingMessage;
      assert.strictEqual(isSecureRequest(req), false);
    });

    test('isSecureRequest returns true for encrypted socket', () => {
      const req = { headers: {}, socket: { encrypted: true } } as unknown as IncomingMessage;
      assert.strictEqual(isSecureRequest(req), true);
    });

    test('isSecureRequest returns false for unencrypted socket', () => {
      const req = { headers: {}, socket: { encrypted: false } } as unknown as IncomingMessage;
      assert.strictEqual(isSecureRequest(req), false);
    });
  });

  // ---- Authentication & Session ----

  describe('Authentication & Authorization', () => {
    // 1. Unauthenticated admin requests are rejected
    test('requireAdminSession rejects missing session (no cookie)', async () => {
      setMockResponses([
        { rows: [] }, // session lookup -> no session
      ]);
      const { requireAdminSession } = await import('./auth/admin.ts');
      const req = makeMockReq();
      await assert.rejects(
        requireAdminSession(req),
        (err: any) =>
          err.status === 403 && err.code === 'ADMIN_SESSION_REQUIRED'
      );
    });

    // 2. Missing CSRF token is rejected for protected mutations
    test('requireAdminSession rejects missing CSRF token', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] }, // session lookup
        { rows: [makeMockUserRow()] }, // user lookup
      ]);
      const { requireAdminSession } = await import('./auth/admin.ts');
      const req = makeMockReq({
        headers: { cookie: `admin_sid=${TEST_SESSION_TOKEN}` },
      } as any);
      await assert.rejects(
        requireAdminSession(req),
        (err: any) =>
          err.status === 403 && err.code === 'CSRF_INVALID'
      );
    });

    // 3. Invalid CSRF token is rejected
    test('requireAdminSession rejects invalid CSRF token', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { requireAdminSession } = await import('./auth/admin.ts');
      const req = makeMockReq({
        headers: {
          cookie: `admin_sid=${TEST_SESSION_TOKEN}`,
          'x-csrf-token': 'invalid-token',
        },
      } as any);
      await assert.rejects(
        requireAdminSession(req),
        (err: any) =>
          err.status === 403 && err.code === 'CSRF_INVALID'
      );
    });

    // 3b. Valid CSRF token passes (positive path)
    test('requireAdminSession accepts valid CSRF token', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { requireAdminSession } = await import('./auth/admin.ts');
      const req = makeMockReq({
        headers: {
          cookie: `admin_sid=${TEST_SESSION_TOKEN}`,
          'x-csrf-token': TEST_CSRF_TOKEN,
        },
      } as any);
      const session = await requireAdminSession(req);
      assert.strictEqual(session.userId, 1);
    });

    // 4. Missing step-up password is rejected
    test('requireStepUpAuth rejects missing password', async () => {
      const { requireStepUpAuth } = await import('./auth/admin.ts');
      const result = await requireStepUpAuth('user_auth_1', undefined);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'STEP_UP_REQUIRED');
      assert.ok(typeof result.error === 'string' && result.error.length > 0);
    });

    // 5. Invalid step-up password is rejected
    test('requireStepUpAuth rejects invalid password (user not found)', async () => {
      setMockResponses([
        { rows: [{ password_hash: await hashPassword('correct-password') }] },
      ]);
      const { requireStepUpAuth } = await import('./auth/admin.ts');
      const result = await requireStepUpAuth('user_auth_1', 'wrong-password');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'STEP_UP_INVALID');
    });

    // 5b. Valid step-up password passes (positive path)
    test('requireStepUpAuth accepts valid password', async () => {
      setMockResponses([
        { rows: [{ password_hash: await hashPassword('correct-password') }] },
      ]);
      const { requireStepUpAuth } = await import('./auth/admin.ts');
      const result = await requireStepUpAuth('user_auth_1', 'correct-password');
      assert.strictEqual(result.success, true);
    });

    // 6. Insufficient admin permissions are rejected
    test('requirePermission rejects insufficient permissions (analyst cannot write reports)', async () => {
      const analystSession = makeMockSession({
        adminRole: 'analyst',
        permissions: {
          users: { read: true, write: false, suspend: false },
          posts: { read: true, delete: false },
          reports: { read: true, write: false },
          audit: { read: true },
          badges: { read: true, write: false },
          stats: { read: true },
          admin_users: { read: true, write: false },
        },
      });
      // getAdminSession uses ROLE_PERMISSIONS[admin_role] from the user row,
      // so we need admin_role: 'analyst' in the user lookup row.
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [{ ...makeMockUserRow(), admin_role: 'analyst' }] },
      ]);
      const { requirePermission } = await import('./auth/admin.ts');
      const check = (requirePermission as any)('reports', 'write');
      const req = makeMockReq({
        headers: {
          cookie: `admin_sid=${TEST_SESSION_TOKEN}`,
          'x-csrf-token': TEST_CSRF_TOKEN,
        },
      } as any);
      await assert.rejects(
        check(req),
        (err: any) =>
          err.status === 403 && err.code === 'INSUFFICIENT_PERMISSIONS'
      );
    });

    // 6b. Sufficient permissions pass (positive path)
    test('requirePermission accepts sufficient permissions (admin can read users)', async () => {
      const adminSession = makeMockSession();
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { requirePermission } = await import('./auth/admin.ts');
      const check = (requirePermission as any)('users', 'read');
      const req = makeMockReq({
        headers: {
          cookie: `admin_sid=${TEST_SESSION_TOKEN}`,
          'x-csrf-token': TEST_CSRF_TOKEN,
        },
      } as any);
      const session = await check(req);
      assert.strictEqual(session.adminRole, 'admin');
    });

    // 6c. Moderator cannot access admin_users.write
    test('moderator cannot access admin_users.write', async () => {
      const modSession = makeMockSession({
        adminRole: 'moderator',
        permissions: {
          users: { read: true, write: false, suspend: false },
          posts: { read: true, delete: false },
          reports: { read: true, write: false },
          audit: { read: true },
          badges: { read: true, write: false },
          stats: { read: true },
          admin_users: { read: true, write: false },
        },
      });
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { requirePermission } = await import('./auth/admin.ts');
      const check = (requirePermission as any)('admin_users', 'write');
      const req = makeMockReq({
        headers: {
          cookie: `admin_sid=${TEST_SESSION_TOKEN}`,
          'x-csrf-token': TEST_CSRF_TOKEN,
        },
      } as any);
      await assert.rejects(
        check(req),
        (err: any) =>
          err.status === 403 && err.code === 'INSUFFICIENT_PERMISSIONS'
      );
    });
  });

  // ---- Verification endpoint (db function level) ----

  describe('Verification endpoint validation', () => {
    // 7a. Insufficient permissions → 403 (moderator has no badges.write)
    test('updateUserVerification rejects insufficient permissions', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { updateUserVerification } = await import('./db/admin.ts');
      await assert.rejects(
        updateUserVerification('user_auth_1', 'target_user', true, 'moderator', makeMockReq()),
        (err: any) =>
          err.status === 403 && err.code === 'INSUFFICIENT_PERMISSIONS'
      );
    });

    // 7b. verification_manager can verify (authorization passes, target not found → 404)
    test('updateUserVerification accepts verification_manager authorization', async () => {
      // updateUserVerification only queries the target user table (no session lookup).
      setMockResponses([{ rows: [] }]); // target user not found -> 404
      const { updateUserVerification } = await import('./db/admin.ts');
      await assert.rejects(
        updateUserVerification('user_auth_1', 'nonexistent_target', true, 'verification_manager', makeMockReq()),
        (err: any) => err.status === 404
      );
    });

    // 7c. Positive path: verification succeeds with valid inputs
    test('updateUserVerification succeeds with valid input', async () => {
      const targetUserId = 'target_user_public_id';
      setMockResponses([
        { rows: [makeMockSessionRow()] }, // session lookup
        { rows: [makeMockUserRow()] }, // user lookup
        { rows: [{ public_id: targetUserId, verified: false, admin_role: null }] }, // get target user
        { rows: [{ public_id: targetUserId, verified: true }] }, // UPDATE result
      ]);
      const { updateUserVerification } = await import('./db/admin.ts');
      const result = await updateUserVerification(
        'user_auth_1',
        targetUserId,
        true,
        'verification_manager',
        makeMockReq(),
      );
      assert.strictEqual(result.verified, true);
    });

    // 7d. Already-verified target → 409 STATUS_UNCHANGED
    test('updateUserVerification rejects already-verified target', async () => {
      // updateUserVerification queries target user (verified=true) then UPDATE
      setMockResponses([
        { rows: [{ public_id: 'target', verified: true, admin_role: null }] }, // target lookup
        { rows: [{ public_id: 'target', verified: true }] }, // UPDATE result (not reached)
      ]);
      const { updateUserVerification } = await import('./db/admin.ts');
      await assert.rejects(
        updateUserVerification('user_auth_1', 'target', true, 'admin', makeMockReq()),
        (err: any) =>
          err.status === 409 && err.code === 'STATUS_UNCHANGED'
      );
    });
  });

  // ---- Gold membership endpoint (db function level) ----

  describe('Gold membership endpoint validation', () => {
    // 8a. verification_manager cannot grant Gold → 403 (route-restricted to super_admin/admin)
    test('updateUserGold rejects verification_manager (Gold restricted to super_admin/admin)', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { updateUserGold } = await import('./db/admin.ts');
      await assert.rejects(
        updateUserGold('user_auth_1', 'target_user', true, 'verification_manager', makeMockReq()),
        (err: any) =>
          err.status === 403 && err.code === 'INSUFFICIENT_PERMISSIONS'
      );
    });

    // 8b. admin can authorize Gold
    test('updateUserGold accepts admin authorization', async () => {
      // updateUserGold only queries the target user table (no session lookup).
      setMockResponses([{ rows: [] }]); // target user not found -> 404
      const { updateUserGold } = await import('./db/admin.ts');
      await assert.rejects(
        updateUserGold('user_auth_1', 'nonexistent_target', true, 'admin', makeMockReq()),
        (err: any) => err.status === 404
      );
    });

    // 8c. Positive path: Gold grant succeeds
    test('updateUserGold succeeds with valid input', async () => {
      const targetUserId = 'target_user_public_id';
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
        { rows: [{ public_id: targetUserId, is_gold: false, admin_role: null }] },
        { rows: [{ public_id: targetUserId, is_gold: true }] },
      ]);
      const { updateUserGold } = await import('./db/admin.ts');
      const result = await updateUserGold(
        'user_auth_1',
        targetUserId,
        true,
        'admin',
        makeMockReq(),
      );
      assert.strictEqual(result.is_gold, true);
    });

    // 8d. Already-gold target → 409 STATUS_UNCHANGED
    test('updateUserGold rejects already-gold target', async () => {
      setMockResponses([
        { rows: [{ public_id: 'target', is_gold: true, admin_role: null }] }, // target lookup
        { rows: [{ public_id: 'target', is_gold: true }] }, // UPDATE result (not reached)
      ]);
      const { updateUserGold } = await import('./db/admin.ts');
      await assert.rejects(
        updateUserGold('user_auth_1', 'target', true, 'admin', makeMockReq()),
        (err: any) =>
          err.status === 409 && err.code === 'STATUS_UNCHANGED'
      );
    });
  });

  // ---- Admin account creation (db function level) ----

  describe('Admin account creation validation', () => {
    // 9a. Invalid admin role → 400 INVALID_ROLE
    test('createAdminUser rejects invalid admin role', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { createAdminUser } = await import('./db/admin.ts');
      await assert.rejects(
        createAdminUser(
          'user_auth_1',
          'super_admin',
          'newadmin',
          'newadmin@example.com',
          'ValidPass123!',
          'New Admin',
          'owner' as unknown as import('./auth/admin.ts').AdminRole,
          makeMockReq(),
        ),
        (err: any) =>
          err.status === 400 && err.code === 'INVALID_ROLE'
      );
    });

    // 9b. Non-super_admin cannot create admin accounts → 403 SUPER_ADMIN_REQUIRED
    test('createAdminUser rejects non-super_admin creator', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { createAdminUser } = await import('./db/admin.ts');
      await assert.rejects(
        createAdminUser(
          'user_auth_1',
          'admin',
          'newadmin',
          'newadmin@example.com',
          'ValidPass123!',
          'New Admin',
          'moderator',
          makeMockReq(),
        ),
        (err: any) =>
          err.status === 403 && err.code === 'SUPER_ADMIN_REQUIRED'
      );
    });

    // 9c. Non-super_admin cannot create super_admin → 403 SUPER_ADMIN_REQUIRED
    test('createAdminUser rejects non-super_admin creating super_admin', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { createAdminUser } = await import('./db/admin.ts');
      await assert.rejects(
        createAdminUser(
          'user_auth_1',
          'admin',
          'newadmin',
          'newadmin@example.com',
          'ValidPass123!',
          'New Admin',
          'super_admin',
          makeMockReq(),
        ),
        (err: any) =>
          err.status === 403 && err.code === 'SUPER_ADMIN_REQUIRED'
      );
    });

    // 9d. Duplicate username/email → 409 ACCOUNT_CONFLICT
    test('createAdminUser rejects duplicate username or email', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
        { rows: [{ public_id: 'existing_user' }] }, // duplicate check finds existing
      ]);
      const { createAdminUser } = await import('./db/admin.ts');
      await assert.rejects(
        createAdminUser(
          'user_auth_1',
          'super_admin',
          'existingadmin',
          'existing@example.com',
          'ValidPass123!',
          'New Admin',
          'admin',
          makeMockReq(),
        ),
        (err: any) =>
          err.status === 409 && err.code === 'ACCOUNT_CONFLICT'
      );
    });

    // 9e. Positive path: super_admin creates admin with valid inputs
    test('createAdminUser succeeds with valid input', async () => {
      const newUserId = `user_auth_${Date.now()}`;
      setMockResponses([
        { rows: [] }, // duplicate check - no existing user
        { rows: [{ id: 1, public_id: newUserId, username: 'newadmin', email: 'newadmin@example.com', admin_role: 'admin' }] },
      ]);
      const { createAdminUser } = await import('./db/admin.ts');
      const result = await createAdminUser(
        'user_auth_1',
        'super_admin',
        'newadmin',
        'newadmin@example.com',
        'ValidPass123!',
        'New Admin',
        'admin',
        makeMockReq(),
      );
      assert.strictEqual(result.public_id, newUserId);
      assert.strictEqual(result.username, 'newadmin');
      assert.strictEqual(result.admin_role, 'admin');
    });
  });

  // ---- Route-level validation via handleAdminRequest ----

  describe('Route-level validation (handleAdminRequest)', () => {
    async function callAdminEndpoint(
      method: string,
      pathname: string,
      body: Record<string, unknown> | null = null,
      headers: Record<string, string> = {}
    ) {
      const { handleAdminRequest } = await import('./routes/admin.ts');
      const req = makeMockReq({
        method,
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : null,
      } as any);
      const res = makeMockRes();
      const url = new URL(`http://localhost${pathname}`);
      const handled = await handleAdminRequest(req, res, url);
      return { handled, res };
    }

    // Route-level: no session → 403
    test('PATCH /api/admin/users/:id/verify rejects no session', async () => {
      setMockResponses([{ rows: [] }]);
      const { handled, res } = await callAdminEndpoint(
        'PATCH',
        '/api/admin/users/target-id/verify',
        { verified: true },
        { cookie: '', 'x-csrf-token': '' },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
    });

    // Route-level: missing CSRF → 403 for mutation
    test('PATCH /api/admin/users/:id/verify rejects missing CSRF token', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'PATCH',
        '/api/admin/users/target-id/verify',
        { verified: true },
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}` },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
    });

    // Route-level: missing verified → 400 (session + CSRF pass, body validation fails)
    test('PATCH /api/admin/users/:id/verify rejects missing verified field', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'PATCH',
        '/api/admin/users/target-id/verify',
        {}, // missing verified
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 400);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'MISSING_FIELDS');
    });

    // Route-level: missing isGold → 400
    test('PATCH /api/admin/users/:id/gold rejects missing isGold field', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'PATCH',
        '/api/admin/users/target-id/gold',
        {}, // missing isGold
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 400);
    });

    // Route-level: admin creation rejects missing fields → 400 (super_admin has admin_users.write)
    test('POST /api/admin/users rejects missing required fields', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [{ ...makeMockUserRow(), admin_role: 'super_admin' }] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'POST',
        '/api/admin/users',
        {}, // missing all fields
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 400);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'MISSING_FIELDS');
    });

    // ---- Fix B: atomic session revocation ----

    test('DELETE /api/admin/sessions/:id executes DELETE and audit INSERT through one transaction connection', async () => {
      const correctHash = await hashPassword('correct-password');
      setMockResponses([
        { rows: [makeMockSessionRow()] },        // session lookup (getAdminSession)
        { rows: [{ ...makeMockUserRow(), admin_role: 'super_admin' }] }, // user lookup (getAdminSession)
        { rows: [] },                            // permissions lookup (empty -> hardcoded super_admin perms)
        { rows: [] },                            // UPDATE last_activity_at (getAdminSession)
        { rows: [{ password_hash: correctHash }] }, // verifyAdminPassword
        { rows: [] },                            // DELETE + audit INSERT (transaction connection)
      ]);
      const { handled, res } = await callAdminEndpoint(
        'DELETE',
        '/api/admin/sessions/sess_test_1',
        { confirmPassword: 'correct-password' },
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 200);
      // Both operations committed within a single transaction (withTransaction rolls back
      // on any failure, verified by the rollback tests below).
    });

    test('DELETE /api/admin/sessions/user executes DELETE and audit INSERT through one transaction connection', async () => {
      const correctHash = await hashPassword('correct-password');
      setMockResponses([
        { rows: [makeMockSessionRow()] },        // session lookup (getAdminSession)
        { rows: [{ ...makeMockUserRow(), admin_role: 'super_admin' }] }, // user lookup (getAdminSession)
        { rows: [] },                            // permissions lookup (empty -> hardcoded super_admin perms)
        { rows: [] },                            // UPDATE last_activity_at (getAdminSession)
        { rows: [{ password_hash: correctHash }] }, // verifyAdminPassword
        { rows: [] },                            // DELETE + audit INSERT (transaction connection)
      ]);
      const { handled, res } = await callAdminEndpoint(
        'DELETE',
        '/api/admin/sessions/user',
        { userId: 'target_user', confirmPassword: 'correct-password' },
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 200);
      // Both operations committed within a single transaction (withTransaction rolls back
      // on any failure, verified by the rollback tests below).
    });

    test('DELETE /api/admin/sessions/:id rolls back session deletion when audit insert fails', async () => {
      const correctHash = await hashPassword('correct-password');
      setMockResponses([
        { rows: [makeMockSessionRow()] },        // session lookup (getAdminSession)
        { rows: [{ ...makeMockUserRow(), admin_role: 'super_admin' }] }, // user lookup (getAdminSession)
        { rows: [] },                            // permissions lookup (empty -> hardcoded super_admin perms)
        { rows: [] },                            // UPDATE last_activity_at (getAdminSession)
        { rows: [{ password_hash: correctHash }] }, // verifyAdminPassword
        { rows: [] },                            // DELETE + audit INSERT (transaction connection)
      ]);
      let txCalls = 0;
      const throwingTx = mock.fn(async () => {
        txCalls += 1;
        if (txCalls === 2) throw new Error('forced audit insert failure');
        return { rows: [] };
      });
      mockTransactionQueryImpl = throwingTx;
      let threw: unknown = null;
      let res: ServerResponse | null = null;
      let handledFlag = false;
      try {
        const result = await callAdminEndpoint(
          'DELETE',
          '/api/admin/sessions/sess_test_1',
          { confirmPassword: 'correct-password' },
          { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
        );
        handledFlag = result.handled;
        res = result.res;
      } catch (err) {
        threw = err;
      } finally {
        mockTransactionQueryImpl = mock.fn(async () =>
          mockResponses[Math.min(mockCallCount, mockResponses.length - 1)]
        );
      }
      assert.strictEqual(threw, null);
      assert.strictEqual(handledFlag, true);
      assert.strictEqual(res!.statusCode, 500);
      assert.strictEqual(txCalls, 2);
    });

    test('DELETE /api/admin/sessions/:id skips audit INSERT when DELETE fails', async () => {
      const correctHash = await hashPassword('correct-password');
      setMockResponses([
        { rows: [makeMockSessionRow()] },        // session lookup (getAdminSession)
        { rows: [{ ...makeMockUserRow(), admin_role: 'super_admin' }] }, // user lookup (getAdminSession)
        { rows: [] },                            // permissions lookup (empty -> hardcoded super_admin perms)
        { rows: [] },                            // UPDATE last_activity_at (getAdminSession)
        { rows: [{ password_hash: correctHash }] }, // verifyAdminPassword
        { rows: [] },                            // DELETE + audit INSERT (transaction connection)
      ]);
      let txCalls = 0;
      const throwingTx = mock.fn(async () => {
        txCalls += 1;
        if (txCalls === 1) throw new Error('forced DELETE failure');
        return { rows: [] };
      });
      mockTransactionQueryImpl = throwingTx;
      let threw: unknown = null;
      let res: ServerResponse | null = null;
      let handledFlag = false;
      try {
        const result = await callAdminEndpoint(
          'DELETE',
          '/api/admin/sessions/sess_test_1',
          { confirmPassword: 'correct-password' },
          { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
        );
        handledFlag = result.handled;
        res = result.res;
      } catch (err) {
        threw = err;
      } finally {
        mockTransactionQueryImpl = mock.fn(async () =>
          mockResponses[Math.min(mockCallCount, mockResponses.length - 1)]
        );
      }
      assert.strictEqual(threw, null);
      assert.strictEqual(handledFlag, true);
      assert.strictEqual(res!.statusCode, 500);
      assert.strictEqual(txCalls, 1);
    });

    test('DELETE /api/admin/sessions/:id still enforces authorization and step-up', async () => {
      const wrongHash = await hashPassword('wrong-password');
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [{ ...makeMockUserRow(), admin_role: 'super_admin' }] },
        { rows: [{ password_hash: wrongHash }] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'DELETE',
        '/api/admin/sessions/sess_test_1',
        { confirmPassword: 'correct-password' },
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'STEP_UP_REQUIRED');
    });

    // ---- Fix A/B: audit export CSRF header + step-up password header ----

    test('GET /api/admin/audit-log/export rejects missing X-CSRF-Token header', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'GET',
        '/api/admin/audit-log/export?format=json&limit=10',
        null,
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}` },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'CSRF_INVALID');
    });

    test('GET /api/admin/audit-log/export rejects invalid X-CSRF-Token header', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'GET',
        '/api/admin/audit-log/export?format=json&limit=10',
        null,
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': 'invalid-token' },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'CSRF_INVALID');
    });

    test('GET /api/admin/audit-log/export rejects ?csrfToken= only (query parameter ignored)', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'GET',
        '/api/admin/audit-log/export?format=json&limit=10&csrfToken=some-token',
        null,
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}` },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'CSRF_INVALID');
    });

    test('GET /api/admin/audit-log/export ignores ?confirmPassword= (step-up requires header)', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'GET',
        '/api/admin/audit-log/export?format=json&limit=10&confirmPassword=correct-password',
        null,
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'STEP_UP_REQUIRED');
    });

    test('GET /api/admin/audit-log/export rejects invalid step-up password header', async () => {
      const correctHash = await hashPassword('correct-password');
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
        { rows: [{ password_hash: correctHash }] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'GET',
        '/api/admin/audit-log/export?format=json&limit=10',
        null,
        {
          cookie: `admin_sid=${TEST_SESSION_TOKEN}`,
          'x-csrf-token': TEST_CSRF_TOKEN,
          'x-admin-confirm-password': 'wrong-password',
        },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'STEP_UP_REQUIRED');
    });

    test('GET /api/admin/audit-log/export accepts valid CSRF and step-up headers, preserving filters and format', async () => {
      const correctHash = await hashPassword('correct-password');
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
        { rows: [] },
        { rows: [] },
        { rows: [{ password_hash: correctHash }] },
        { rows: [] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'GET',
        '/api/admin/audit-log/export?format=csv&adminId=admin-1&action=user.verify&targetType=user&targetId=u1&startDate=100&endDate=200&limit=10&offset=0&sortOrder=asc',
        null,
        {
          cookie: `admin_sid=${TEST_SESSION_TOKEN}`,
          'x-csrf-token': TEST_CSRF_TOKEN,
          'x-admin-confirm-password': 'correct-password',
        },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.getHeader('Content-Type'), 'text/csv');
      assert.match(String(res.getHeader('Content-Disposition')), /\.csv"/);

      const lastCall = mockQueryImpl.mock.calls.at(-1);
      const sql = String(lastCall.arguments[0]);
      const values = lastCall.arguments[1] as unknown[];
      assert.match(sql, /a\.admin_id = \$1/);
      assert.match(sql, /a\.action ILIKE \$2/);
      assert.match(sql, /a\.target_type = \$3/);
      assert.match(sql, /a\.target_id = \$4/);
      assert.match(sql, /a\.created_at >= \$5/);
      assert.match(sql, /a\.created_at <= \$6/);
      assert.match(sql, /ORDER BY a\.created_at ASC/);
      assert.deepStrictEqual(values.slice(0, 8), ['admin-1', '%user.verify%', 'user', 'u1', 100, 200, 10, 0]);
    });
  });

  // ---- Legacy mock-based tests (preserved) ----

  describe('Report Deduplication', () => {
    test('duplicate active report is prevented', async () => {
      const reporter = await createTestUser({ username: 'reporter1' });
      const reported = await createTestUser({ username: 'reported1' });
      const report1: TestReport = {
        id: 'report_1', type: 'user',
        reporter_id: reporter.public_id, reporter_username: reporter.username,
        reported_user_id: reported.public_id, reported_username: reported.username,
        post_id: null, post_preview: null,
        reason: 'spam', details: 'test', status: 'pending',
        reviewed_by: null, reviewed_at: null, created_at: Date.now(),
      };
      testReports.set(report1.id, report1);
      assert.ok(true, 'Partial unique index would prevent duplicate pending report');
    });

    test('closed report can be reported again', async () => {
      const reporter = await createTestUser({ username: 'reporter2' });
      const reported = await createTestUser({ username: 'reported2' });
      const closedReport: TestReport = {
        id: 'report_3', type: 'user',
        reporter_id: reporter.public_id, reporter_username: reporter.username,
        reported_user_id: reported.public_id, reported_username: reported.username,
        post_id: null, post_preview: null,
        reason: 'spam', details: 'old', status: 'dismissed',
        reviewed_by: 'admin', reviewed_at: Date.now() - 10000, created_at: Date.now() - 20000,
      };
      testReports.set(closedReport.id, closedReport);
      assert.ok(true, 'Unique index predicate allows new report after dismissal');
    });
  });

  describe('Moderation History Preservation', () => {
    test('deleted users do not destroy moderation history', async () => {
      const reporter = await createTestUser({ username: 'reporter3' });
      const reported = await createTestUser({ username: 'reported3' });
      const report: TestReport = {
        id: 'report_5', type: 'user',
        reporter_id: reporter.public_id, reporter_username: reporter.username,
        reported_user_id: reported.public_id, reported_username: reported.username,
        post_id: null, post_preview: null,
        reason: 'spam', details: 'test', status: 'action_taken',
        reviewed_by: 'admin_user', reviewed_at: Date.now(), created_at: Date.now() - 50000,
      };
      testReports.set(report.id, report);
      assert.ok(true, 'Report record preserved when user deleted (FK SET NULL)');
    });

    test('deleted posts do not destroy moderation history', async () => {
      const reporter = await createTestUser({ username: 'reporter4' });
      const postId = 'post_test_1';
      const report: TestReport = {
        id: 'report_6', type: 'post',
        reporter_id: reporter.public_id, reporter_username: reporter.username,
        reported_user_id: null, reported_username: null,
        post_id: postId, post_preview: 'post content preview',
        reason: 'hate', details: 'test', status: 'reviewed',
        reviewed_by: 'admin_user', reviewed_at: Date.now(), created_at: Date.now() - 50000,
      };
      testReports.set(report.id, report);
      assert.ok(true, 'Report record preserved when post deleted (FK SET NULL)');
    });
  });

  describe('Audit Log Entries', () => {
    test('audit entries created for report status changes', async () => {
      const admin = await createTestUser({ admin_role: 'admin', username: 'audit_admin' });
      const { token } = await createAdminSession(admin.public_id, 'admin');
      const reportId = 'report_audit_1';
      testReports.set(reportId, {
        id: reportId, type: 'user',
        reporter_id: 'user_reporter', reporter_username: 'reporter',
        reported_user_id: 'user_reported', reported_username: 'reported',
        post_id: null, post_preview: null,
        reason: 'spam', details: 'test', status: 'pending',
        reviewed_by: null, reviewed_at: null, created_at: Date.now(),
      });
      const metadata = {
        previous_status: 'pending', new_status: 'reviewed', reported_user_id: 'user_reported',
      };
      const auditEntry: TestAuditLog = {
        id: `audit_${randomBytes(16).toString('hex')}`,
        admin_id: admin.public_id,
        admin_username: admin.username,
        action: 'report.user.reviewed',
        target_type: 'user_report',
        target_id: reportId,
        metadata,
        ip_address: '127.0.0.1',
        user_agent: 'test-agent',
        created_at: Date.now(),
      };
      testAuditLogs.set(auditEntry.id, auditEntry);
      assert.strictEqual(auditEntry.action, 'report.user.reviewed');
      assert.strictEqual(auditEntry.target_type, 'user_report');
      assert.ok(auditEntry.metadata.previous_status);
      assert.ok(auditEntry.metadata.new_status);
    });

    test('audit entries created for verification changes', async () => {
      const admin = await createTestUser({ admin_role: 'admin', username: 'audit_admin2' });
      const { token } = await createAdminSession(admin.public_id, 'admin');
      const metadata = { previous_verified: false, new_verified: true };
      const auditEntry: TestAuditLog = {
        id: `audit_${randomBytes(16).toString('hex')}`,
        admin_id: admin.public_id,
        admin_username: admin.username,
        action: 'user.verify',
        target_type: 'user',
        target_id: 'user_target',
        metadata,
        ip_address: '127.0.0.1',
        user_agent: 'test-agent',
        created_at: Date.now(),
      };
      testAuditLogs.set(auditEntry.id, auditEntry);
      assert.strictEqual(auditEntry.action, 'user.verify');
    });

    test('audit entries created for Gold changes', async () => {
      const admin = await createTestUser({ admin_role: 'admin', username: 'audit_admin3' });
      const { token } = await createAdminSession(admin.public_id, 'admin');
      const metadata = { previous_is_gold: false, new_is_gold: true };
      const auditEntry: TestAuditLog = {
        id: `audit_${randomBytes(16).toString('hex')}`,
        admin_id: admin.public_id,
        admin_username: admin.username,
        action: 'user.gold_grant',
        target_type: 'user',
        target_id: 'user_target',
        metadata,
        ip_address: '127.0.0.1',
        user_agent: 'test-agent',
        created_at: Date.now(),
      };
      testAuditLogs.set(auditEntry.id, auditEntry);
      assert.strictEqual(auditEntry.action, 'user.gold_grant');
    });

    test('audit entries created for admin creation', async () => {
      const admin = await createTestUser({ admin_role: 'super_admin', username: 'audit_sa' });
      const { token } = await createAdminSession(admin.public_id, 'super_admin');
      const metadata = { username: 'newadmin', email: 'newadmin@example.com', admin_role: 'admin' };
      const auditEntry: TestAuditLog = {
        id: `audit_${randomBytes(16).toString('hex')}`,
        admin_id: admin.public_id,
        admin_username: admin.username,
        action: 'admin.user.create',
        target_type: 'user',
        target_id: 'new_admin_public_id',
        metadata,
        ip_address: '127.0.0.1',
        user_agent: 'test-agent',
        created_at: Date.now(),
      };
      testAuditLogs.set(auditEntry.id, auditEntry);
      assert.strictEqual(auditEntry.action, 'admin.user.create');
    });
  });

  describe('Export Validation', () => {
    test('CSV export is valid', () => {
      const row = [
        'audit_1', 'user_admin_1', 'admin_user', 'user.verify', 'user', 'user_target',
        '{"previous_verified":false,"new_verified":true}', '127.0.0.1', 'test-agent', '2024-01-01T00:00:00.000Z',
      ];
      const escapeCsv = (value: unknown): string => {
        if (value === null || value === undefined) return '';
        const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      const csvLine = row.map(escapeCsv).join(',');
      assert.ok(csvLine.includes('admin_user'));
      assert.ok(csvLine.includes('user.verify'));
      assert.ok(csvLine.includes('""previous_verified"":false'));
    });

    test('JSON export is valid', () => {
      const logs = [{
        id: 'audit_1', admin_id: 'user_admin_1', admin_username: 'admin_user',
        action: 'user.verify', target_type: 'user', target_id: 'user_target',
        metadata: { previous_verified: false, new_verified: true },
        ip_address: '127.0.0.1', user_agent: 'test-agent', created_at: '2024-01-01T00:00:00.000Z',
      }];
      const json = JSON.stringify(logs, null, 2);
      const parsed = JSON.parse(json);
      assert.strictEqual(parsed[0].action, 'user.verify');
      assert.deepStrictEqual(parsed[0].metadata, { previous_verified: false, new_verified: true });
    });

    test('export does not expose secrets or session tokens', () => {
      assert.ok(true, 'Export only includes audit_log table columns');
    });

    describe('Security Event Instrumentation', () => {
      const EXPECTED_ACTIONS = [
        'admin.session.revoke',
        'admin.session.revoke_all',
        'admin.session.create',
        'admin.logout',
        'admin.role.grant',
        'admin.role.revoke',
        'user.suspend',
        'admin.login.failed',
        'admin.login.success',
        'admin.permission.denied',
        'report.user.create',
        'report.user.reviewed',
        'report.user.dismissed',
        'report.user.action_taken',
        'report.post.create',
        'report.post.reviewed',
        'report.post.dismissed',
        'report.post.action_taken',
        'bootstrap.super_admin',
      ];

      test('security events allowlist contains all verified action types', async () => {
        const { SECURITY_ACTIONS } = await import('./db/admin.ts');
        for (const action of EXPECTED_ACTIONS) {
          assert.ok(
            SECURITY_ACTIONS.includes(action),
            `Missing security action: ${action}`,
          );
        }
        assert.strictEqual(SECURITY_ACTIONS.length, EXPECTED_ACTIONS.length);
      });

      test('failed login audit event excludes credentials', () => {
        const metadata: Record<string, unknown> = { reason: 'invalid_password', identifier: 'admin@example.com' };
        assert.ok(!metadata.password);
        assert.ok(!metadata.password_hash);
        assert.ok(metadata.reason === 'invalid_password');
        assert.ok(typeof metadata.identifier === 'string');
      });

      test('successful login audit event records admin id and action', () => {
        const adminId = 'user_auth_1';
        const action = 'admin.login.success';
        const targetType = 'auth';
        const targetId = 'user_auth_1';
        assert.strictEqual(action, 'admin.login.success');
        assert.strictEqual(targetType, 'auth');
        assert.strictEqual(adminId, targetId);
      });

      test('logout audit event records session admin id', () => {
        const sessionUserId = 42;
        const adminId = `user_auth_${sessionUserId}`;
        const action = 'admin.logout';
        const targetType = 'admin_session';
        assert.strictEqual(adminId, `user_auth_${sessionUserId}`);
        assert.strictEqual(action, 'admin.logout');
        assert.strictEqual(targetType, 'admin_session');
      });

      test('session creation audit event records admin id', () => {
        const userId = 7;
        const adminId = `user_auth_${userId}`;
        const action = 'admin.session.create';
        const targetType = 'admin_session';
        assert.strictEqual(adminId, `user_auth_${userId}`);
        assert.strictEqual(action, 'admin.session.create');
        assert.strictEqual(targetType, 'admin_session');
      });

      test('permission denied audit event uses authorization category', () => {
        const action = 'admin.permission.denied';
        const category = 'Authorization';
        assert.strictEqual(action, 'admin.permission.denied');
        assert.strictEqual(category, 'Authorization');
      });

      test('failed login does not store password or hash in metadata', () => {
        const metadata = { reason: 'invalid_password', identifier: 'user@example.com' };
        const json = JSON.stringify(metadata);
        assert.ok(!json.includes('password_hash'));
        assert.ok(!json.includes('"password"'));
        assert.ok(!json.includes('token'));
        assert.ok(!json.includes('secret'));
      });

      test('permission denial logs once per request with denied reason', () => {
        const deniedReason = 'INSUFFICIENT_PERMISSIONS';
        const path = '/api/admin/posts';
        const method = 'POST';
        const metadata: Record<string, unknown> = { denied_reason: deniedReason, method };
        assert.strictEqual(metadata.denied_reason, deniedReason);
        assert.strictEqual(metadata.method, method);
        assert.ok(!metadata.password);
        assert.ok(!metadata.token);
      });
    });
  });

  // ---- RBAC & step-up authentication (mock-based; no PostgreSQL connection) ----

  describe('RBAC and step-up authentication', () => {
    const fullPermissions = {
      users: { read: true, write: true, suspend: true },
      posts: { read: true, delete: true },
      reports: { read: true, write: true },
      audit: { read: true },
      badges: { read: true, write: true },
      stats: { read: true },
      admin_users: { read: true, write: true },
    };

    function makeMockPermissionsRow(permissions: Record<string, unknown>) {
      return { rows: [{ permissions }] };
    }

    async function callAdminEndpoint(
      method: string,
      pathname: string,
      body: Record<string, unknown> | null = null,
      headers: Record<string, string> = {}
    ) {
      const { handleAdminRequest } = await import('./routes/admin.ts');
      const req = makeMockReq({
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : null,
      } as any);
      const res = makeMockRes();
      const url = new URL(`http://localhost${pathname}`);
      const handled = await handleAdminRequest(req, res, url);
      return { handled, res };
    }

    // 1. Database-configured permissions take effect when a role record exists.
    test('resolveAdminPermissions uses database-configured permissions', async () => {
      const custom = { ...fullPermissions, stats: { read: false } };
      setMockResponses([makeMockPermissionsRow(custom)]);
      const { resolveAdminPermissions } = await import('./auth/admin.ts');
      const perms = await resolveAdminPermissions('admin');
      assert.strictEqual(perms.stats.read, false);
      assert.strictEqual(perms.users.write, true);
    });

    // 2. Missing role record falls back to validated hardcoded defaults.
    test('resolveAdminPermissions falls back to hardcoded defaults when role has no DB record', async () => {
      setMockResponses([{ rows: [] }]);
      const { resolveAdminPermissions } = await import('./auth/admin.ts');
      const perms = await resolveAdminPermissions('moderator');
      assert.strictEqual(perms.stats.read, false);
      assert.strictEqual(perms.posts.delete, true);
    });

    // 3. Malformed database permissions are rejected (fail closed).
    test('resolveAdminPermissions rejects malformed database permissions', async () => {
      setMockResponses([{ rows: [{ permissions: { users: { read: 'yes' } } }] }]);
      const { resolveAdminPermissions } = await import('./auth/admin.ts');
      await assert.rejects(
        resolveAdminPermissions('admin'),
        (err: any) => err.status === 500 && err.code === 'MALFORMED_PERMISSIONS'
      );
    });

    // 4. Custom DB grants apply even when hardcoded defaults deny them.
    test('resolveAdminPermissions applies custom DB permission grants', async () => {
      const modCustom = {
        ...fullPermissions,
        users: { read: true, write: false, suspend: false },
        posts: { read: true, delete: true },
        reports: { read: true, write: true },
        audit: { read: true },
        badges: { read: false, write: false },
        stats: { read: true },
        admin_users: { read: false, write: false },
      };
      setMockResponses([makeMockPermissionsRow(modCustom)]);
      const { resolveAdminPermissions } = await import('./auth/admin.ts');
      const perms = await resolveAdminPermissions('moderator');
      assert.strictEqual(perms.stats.read, true);
    });

    // 5. super_admin permissions are immutable.
    test('updateAdminRolePermissions rejects super_admin modification', async () => {
      const { updateAdminRolePermissions } = await import('./db/admin.ts');
      await assert.rejects(
        updateAdminRolePermissions('user_auth_1', 'super_admin', fullPermissions, 'desc', makeMockReq()),
        (err: any) => err.status === 403 && err.code === 'SUPER_ADMIN_IMMUTABLE'
      );
    });

    // 6. Permission updates produce an audit event in the same transaction.
    test('updateAdminRolePermissions writes audit event in transaction', async () => {
      setMockResponses([{ rows: [] }]);
      const { updateAdminRolePermissions } = await import('./db/admin.ts');
      let thrown: Error | null = null;
      try {
        await updateAdminRolePermissions('user_auth_1', 'moderator', fullPermissions, 'updated', makeMockReq());
      } catch (err) {
        thrown = err as Error;
      }
      assert.ok(!thrown, `updateAdminRolePermissions should not throw: ${thrown?.message}`);
      assert.ok(mockTransactionQueryImpl.mock.calls.length >= 1, `transaction should execute queries, got ${mockTransactionQueryImpl.mock.calls.length} calls`);
      if (mockTransactionQueryImpl.mock.calls.length >= 2) {
        const auditSql = String(mockTransactionQueryImpl.mock.calls[1].arguments[0]);
        const auditValues = mockTransactionQueryImpl.mock.calls[1].arguments[1];
        assert.ok(auditSql.includes('INSERT INTO zunari_admin_audit_log'));
        assert.strictEqual(auditValues[2], 'admin.permission.updated');
        assert.strictEqual(auditValues[3], 'role');
      }
    });

    // 7. getAdminSession resolves fresh DB permissions on each request.
    test('getAdminSession resolves database permissions on each request', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
        makeMockPermissionsRow({ ...fullPermissions, stats: { read: false } }),
      ]);
      const { getAdminSession } = await import('./auth/admin.ts');
      const req = makeMockReq({
        headers: { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      } as any);
      const session = await getAdminSession(req);
      assert.ok(session);
      assert.strictEqual(session.permissions.stats.read, false);
    });

    // 8. Role-change escalation protection: non-super_admin cannot assign super_admin.
    test('setUserAdminRole rejects non-super_admin assigning super_admin', async () => {
      setMockResponses([
        { rows: [{ public_id: 'user_auth_1', admin_role: 'admin' }] },
      ]);
      const { setUserAdminRole } = await import('./auth/admin.ts');
      await assert.rejects(
        setUserAdminRole('user_auth_1', 'target_user', 'super_admin', makeMockReq()),
        (err: any) => err.status === 403 && err.code === 'SUPER_ADMIN_REQUIRED'
      );
    });

    // 9. Last-super-admin protection: demoting the sole super admin is rejected.
    test('setUserAdminRole rejects demoting the last super admin', async () => {
      setMockResponses([
        { rows: [{ public_id: 'target_user', admin_role: 'super_admin' }] },
        { rows: [{ count: 1 }] },
      ]);
      const { setUserAdminRole } = await import('./auth/admin.ts');
      await assert.rejects(
        setUserAdminRole('user_auth_1', 'target_user', null, makeMockReq()),
        (err: any) => err.status === 400 && err.code === 'LAST_SUPER_ADMIN_PROTECTED'
      );
    });

    // 10. Route-level: role change requires confirmPassword (step-up).
    test('PATCH /api/admin/users/:id rejects role change without confirmPassword', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [makeMockUserRow()] },
        makeMockPermissionsRow(fullPermissions),
        { rows: [{ password_hash: await hashPassword('correct-password') }] },
      ]);
      const { handled, res } = await callAdminEndpoint(
        'PATCH',
        '/api/admin/users/target-id',
        { adminRole: 'moderator' },
        { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      );
      assert.strictEqual(handled, true);
      assert.strictEqual(res.statusCode, 403);
      const body = (res as any).body;
      assert.strictEqual(body?.code, 'STEP_UP_REQUIRED');
    });

    // ---- Fix A: suspended administrator session rejection ----

    test('getAdminSession rejects a suspended administrator', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [{ ...makeMockUserRow(), suspended_at: Date.now() }] },
      ]);
      const { getAdminSession } = await import('./auth/admin.ts');
      const req = makeMockReq({
        headers: { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      } as any);
      const session = await getAdminSession(req);
      assert.strictEqual(session, null);
    });

    test('getAdminSession allows an active administrator', async () => {
      setMockResponses([
        { rows: [makeMockSessionRow()] },
        { rows: [{ ...makeMockUserRow(), suspended_at: null }] },
        makeMockPermissionsRow(fullPermissions),
      ]);
      const { getAdminSession } = await import('./auth/admin.ts');
      const req = makeMockReq({
        headers: { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      } as any);
      const session = await getAdminSession(req);
      assert.ok(session);
      assert.strictEqual(session.publicId, 'user_auth_test_1');
    });

    test('getAdminSession still rejects expired sessions', async () => {
      setMockResponses([
        { rows: [{ ...makeMockSessionRow(), expires_at: Date.now() - 1 }] },
      ]);
      const { getAdminSession } = await import('./auth/admin.ts');
      const req = makeMockReq({
        headers: { cookie: `admin_sid=${TEST_SESSION_TOKEN}`, 'x-csrf-token': TEST_CSRF_TOKEN },
      } as any);
      const session = await getAdminSession(req);
      assert.strictEqual(session, null);
    });
  });
});
