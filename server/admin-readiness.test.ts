import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { adminApi } from '../src/services/adminApi.ts';
import { applySecurityHeaders } from './security-headers.ts';

const ADMIN_API_SOURCE = readFileSync(
  new URL('../src/services/adminApi.ts', import.meta.url),
  'utf8',
);
const ADMIN_ROUTES_SOURCE = readFileSync(
  new URL('./routes/admin.ts', import.meta.url),
  'utf8',
);
const AUDIT_LOG_VIEW_SOURCE = readFileSync(
  new URL('../src/components/admin/AuditLogView.tsx', import.meta.url),
  'utf8',
);
const SERVER_SOURCE = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const DASHBOARD_SOURCE = readFileSync(
  new URL('../src/components/admin/AdminDashboard.tsx', import.meta.url),
  'utf8',
);
const PLATFORM_ANALYTICS_SOURCE = readFileSync(
  new URL('../src/components/admin/PlatformAnalyticsScreen.tsx', import.meta.url),
  'utf8',
);

function captureHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = String(value);
    },
  } as unknown as ServerResponse;
  applySecurityHeaders(req, res);
  return headers;
}

describe('Admin audit export client request (mocked fetch; no database)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    adminApi.setCsrfToken(null);
  });

  test('sends CSRF and step-up password in headers, never in the URL', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        contentType: 'text/csv',
        filename: 'audit-log.csv',
        data: 'id,action',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    adminApi.setCsrfToken('csrf-session-token');
    await adminApi.exportAuditLog({
      format: 'csv',
      adminId: 'admin-1',
      action: 'user.verify',
      targetType: 'user',
      targetId: 'user-1',
      startDate: 1000,
      endDate: 2000,
      limit: 25,
      offset: 50,
      sortOrder: 'asc',
      csrfToken: 'csrf-session-token',
      confirmPassword: 'step-up-secret',
    });

    const url = new URL(capturedUrl);
    assert.strictEqual(url.pathname, '/api/admin/audit-log/export');
    assert.strictEqual(url.searchParams.has('csrfToken'), false);
    assert.strictEqual(url.searchParams.has('confirmPassword'), false);
    assert.strictEqual(capturedUrl.includes('step-up-secret'), false);
    assert.strictEqual(capturedUrl.includes('csrf-session-token'), false);

    // Existing filters and format are preserved as query parameters.
    assert.strictEqual(url.searchParams.get('format'), 'csv');
    assert.strictEqual(url.searchParams.get('adminId'), 'admin-1');
    assert.strictEqual(url.searchParams.get('action'), 'user.verify');
    assert.strictEqual(url.searchParams.get('targetType'), 'user');
    assert.strictEqual(url.searchParams.get('targetId'), 'user-1');
    assert.strictEqual(url.searchParams.get('startDate'), '1000');
    assert.strictEqual(url.searchParams.get('endDate'), '2000');
    assert.strictEqual(url.searchParams.get('limit'), '25');
    assert.strictEqual(url.searchParams.get('offset'), '50');
    assert.strictEqual(url.searchParams.get('sortOrder'), 'asc');

    const headers = new Headers(capturedInit?.headers);
    assert.strictEqual(headers.get('x-csrf-token'), 'csrf-session-token');
    assert.strictEqual(headers.get('x-admin-confirm-password'), 'step-up-secret');
  });

  test('does not send a step-up header when no confirmation is supplied', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ contentType: 'json', filename: 'x.json', data: '[]' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    adminApi.setCsrfToken('csrf-session-token');
    await adminApi.exportAuditLog({
      format: 'json',
      csrfToken: 'csrf-session-token',
    });

    const headers = new Headers(capturedInit?.headers);
    assert.strictEqual(headers.get('x-csrf-token'), 'csrf-session-token');
    assert.strictEqual(headers.has('x-admin-confirm-password'), false);
  });
});

describe('Audit export request format source guards (source-level regression)', () => {
  test('client serialises CSRF and step-up password only through headers', () => {
    assert.strictEqual(ADMIN_API_SOURCE.includes("searchParams.set('csrfToken'"), false);
    assert.strictEqual(ADMIN_API_SOURCE.includes("searchParams.set('confirmPassword'"), false);
    assert.ok(ADMIN_API_SOURCE.includes("headers['X-CSRF-Token']"));
    assert.ok(ADMIN_API_SOURCE.includes("headers['X-Admin-Confirm-Password']"));
  });

  test('server reads step-up password from a request header, not the query string', () => {
    assert.strictEqual(ADMIN_ROUTES_SOURCE.includes("searchParams.get('confirmPassword')"), false);
    assert.ok(ADMIN_ROUTES_SOURCE.includes("req.headers['x-admin-confirm-password']"));
  });

  test('server log statements never reference the step-up password', () => {
    const logStatements = ADMIN_ROUTES_SOURCE.match(/console\.(?:log|error|warn|info)\([^\n]*\)/g) ?? [];
    assert.ok(logStatements.every((statement) => !statement.includes('confirmPassword')));
  });
});

describe('Dashboard metric labels (source-level regression)', () => {
  test('AdminDashboard describes registration counts as new users, not active users', () => {
    assert.strictEqual(/title="Active \((?:24h|7d)\)"/.test(DASHBOARD_SOURCE), false);
    assert.ok(DASHBOARD_SOURCE.includes('title="New Users (24h)"'));
    assert.ok(DASHBOARD_SOURCE.includes('title="New Users (7d)"'));
  });

  test('PlatformAnalytics describes registration counts as new users, not active users', () => {
    assert.strictEqual(/title="Active \((?:24h|7d)\)"/.test(PLATFORM_ANALYTICS_SOURCE), false);
    assert.ok(PLATFORM_ANALYTICS_SOURCE.includes('title="New Users (24h)"'));
    assert.ok(PLATFORM_ANALYTICS_SOURCE.includes('title="New Users (7d)"'));
    assert.ok(PLATFORM_ANALYTICS_SOURCE.includes('New users in last 24h'));
    assert.ok(PLATFORM_ANALYTICS_SOURCE.includes('New users in last 7d'));
  });
});

describe('Audit Log export UI wiring (source-level regression)', () => {
  test('Export action calls the existing admin API with current filters and CSV format', () => {
    assert.strictEqual(AUDIT_LOG_VIEW_SOURCE.includes('onClick={() => {}}'), false);
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('onClick={openExportDialog}'));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('adminApi.exportAuditLog'));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes("format: 'csv'"));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('...buildAuditFilterParams(filters)'));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('sortOrder,'));
  });

  test('CSRF and step-up password stay in headers through the existing API client', () => {
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('csrfToken: adminApi.getCsrfToken()'));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('confirmPassword: exportPassword'));
    assert.strictEqual(AUDIT_LOG_VIEW_SOURCE.includes('confirmPassword='), false);
    assert.strictEqual(AUDIT_LOG_VIEW_SOURCE.includes('csrfToken='), false);
  });

  test('Export handles loading, errors, and browser download without duplicating API logic', () => {
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('setExporting(true)'));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('setExportError'));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('URL.createObjectURL(blob)'));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('link.download = result.filename'));
    assert.ok(AUDIT_LOG_VIEW_SOURCE.includes('URL.revokeObjectURL(downloadUrl)'));
    assert.strictEqual(AUDIT_LOG_VIEW_SOURCE.includes('fetch('), false);
  });
});

describe('Admin login client IP resolution (source-level regression)', () => {
  test('uses the trusted-hop helper instead of the raw socket address', () => {
    assert.ok(ADMIN_ROUTES_SOURCE.includes('getClientIp(req, config.trustProxyHops)'));
    assert.strictEqual(ADMIN_ROUTES_SOURCE.includes('req.socket.remoteAddress'), false);
  });

  test('preserves the five-attempt, fifteen-minute admin login limit', () => {
    assert.ok(ADMIN_ROUTES_SOURCE.includes("name: 'admin-login-ip'"));
    assert.ok(ADMIN_ROUTES_SOURCE.includes('limit: 5'));
    assert.ok(ADMIN_ROUTES_SOURCE.includes('15 * 60 * 1000'));
  });
});

describe('Admin static security headers', () => {
  test('applies the existing CSP, nosniff, and referrer policy', () => {
    const headers = captureHeaders({
      headers: {},
      socket: { encrypted: false },
    } as unknown as IncomingMessage);

    assert.ok(headers['content-security-policy'].includes("default-src 'self' data: blob: https:"));
    assert.ok(headers['content-security-policy'].includes('frame-ancestors *'));
    assert.strictEqual(headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.strictEqual(headers['strict-transport-security'], undefined);
  });

  test('preserves encrypted-socket HSTS behavior', () => {
    const headers = captureHeaders({
      headers: {},
      socket: { encrypted: true },
    } as unknown as IncomingMessage);

    assert.strictEqual(
      headers['strict-transport-security'],
      'max-age=31536000; includeSubDomains',
    );
  });

  test('admin header middleware is mounted before admin static and SPA handling', () => {
    const middlewareIndex = SERVER_SOURCE.indexOf("app.use('/admin', (req, res, next)");
    const adminRouteIndex = SERVER_SOURCE.indexOf("app.get('/admin'");
    const staticIndex = SERVER_SOURCE.indexOf("app.use('/admin', express.static");
    const adminSpaIndex = SERVER_SOURCE.indexOf("app.get('/admin/*'");

    assert.ok(middlewareIndex >= 0);
    assert.ok(middlewareIndex < adminRouteIndex);
    assert.ok(middlewareIndex < staticIndex);
    assert.ok(middlewareIndex < adminSpaIndex);
    assert.ok(SERVER_SOURCE.includes('applySecurityHeaders(req, res);'));
  });
});
