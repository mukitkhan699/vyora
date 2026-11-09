import type { IncomingMessage, ServerResponse } from 'node:http';
import { query } from '../db/pool.ts';
import {
  getAuthUser,
  requireSessionWithCsrf,
  setAuthError,
  readJsonBody,
  validateStateChangingRequest,
  safeEqual,
} from '../auth.ts';
import {
  requireAdminSession,
  requireAdminSessionReadOnly,
  requirePermission,
  logAdminAction,
  setUserAdminRole,
  suspendUser,
  unsuspendUser,
  verifyAdminPassword,
  type AdminRole,
  type AdminSession,
} from '../auth/admin.ts';
import {
  getAdminUsers,
  getAdminUserDetail,
  getAdminStats,
  getAuditLog,
  getAdminRolePermissions,
  updateAdminRolePermissions,
  getActiveAdminSessions,
  revokeAdminSession,
  revokeAllAdminSessionsForUser,
  getAdminReports,
  updateReportStatus,
  updateUserVerification,
  updateUserGold,
  createAdminUser,
  exportAuditLog,
  streamAuditLogExport,
  createUserReport,
  createPostReport,
} from '../db/admin.ts';
import { normalizeAuditExportLimit } from '../db/audit-export.ts';
import { enforceRateLimits, hashRateLimitSubject, buildReportRateLimitRules } from '../rate-limit.ts';
import { HttpError } from '../errors.ts';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string, code?: string): void {
  sendJson(res, status, { error: message, code: code || 'ERROR' });
}

async function parseAdminRequest(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json.', 'UNSUPPORTED_MEDIA_TYPE');
  }
  return readJsonBody(req);
}

function getAdminIdFromSession(session: AdminSession): string {
  return `user_auth_${session.userId}`;
}

function getClientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress || 'unknown';
}

function isValidAdminRole(role: string): role is AdminRole {
  return ['super_admin', 'admin', 'moderator', 'verification_manager', 'analyst'].includes(role);
}

function validateRoleParam(role: string | null | undefined): AdminRole | null {
  if (!role) return null;
  if (!isValidAdminRole(role)) {
    throw new HttpError(400, `Invalid admin role: ${role}.`, 'INVALID_ROLE');
  }
  return role;
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  if (!pathname.startsWith('/api/admin/')) {
    return false;
  }

  try {
    if (method !== 'GET' && method !== 'HEAD') {
      await validateStateChangingRequest(req);
    }

    if (pathname === '/api/admin/login' && method === 'POST') {
      const body = await parseAdminRequest(req);
      const identifier = String(body.username || '').trim();
      const password = String(body.password || '');

      if (!identifier || !password) {
        sendError(res, 400, 'Username or email and password are required.', 'MISSING_CREDENTIALS');
        return true;
      }

      // Rate limit admin login attempts by IP
      const clientIp = req.socket.remoteAddress || 'unknown';
      const ipSubject = hashRateLimitSubject(clientIp);
      await enforceRateLimits([
        {
          name: 'admin-login-ip',
          scope: 'admin:login:ip',
          subject: ipSubject,
          limit: 5,
          windowMs: 15 * 60 * 1000,
        },
      ], { context: { identifier, path: '/api/admin/login' } });

      const userResult = await query<{
        id: number;
        username: string;
        email: string | null;
        password_hash: string;
        admin_role: AdminRole | null;
        suspended_at: number | null;
      }>(
        `SELECT id, username, email, password_hash, admin_role, suspended_at
         FROM zunari_users
         WHERE (lower(username) = lower($1) OR lower(email) = lower($1))
         AND admin_role IS NOT NULL
         LIMIT 1`,
        [identifier],
      );

      const user = userResult.rows[0];
      if (!user) {
        sendError(res, 401, 'Invalid admin credentials.', 'INVALID_ADMIN_CREDENTIALS');
        return true;
      }

      if (user.suspended_at) {
        sendError(res, 403, 'This admin account is suspended.', 'ADMIN_SUSPENDED');
        return true;
      }

      const { verifyPassword } = await import('../auth.ts');
      const passwordOk = await verifyPassword(password, user.password_hash);
      if (!passwordOk) {
        sendError(res, 401, 'Invalid admin credentials.', 'INVALID_ADMIN_CREDENTIALS');
        return true;
      }

      const adminSession = await import('../auth/admin.ts').then(m => m.createAdminSession(user.id, user.admin_role!, req));
      adminSession.username = user.username;
      adminSession.email = user.email;
      const { setAdminSessionCookie } = await import('../auth/admin.ts');
      setAdminSessionCookie(req, res, adminSession);

      sendJson(res, 200, {
        authenticated: true,
        adminRole: user.admin_role,
        permissions: adminSession.permissions,
        expiresAt: adminSession.expiresAt,
        message: 'Admin login successful.',
      });
      return true;
    }

    if (pathname === '/api/admin/logout' && method === 'POST') {
      const { getAdminSession, clearAdminSessionCookie } = await import('../auth/admin.ts');
      const session = await getAdminSession(req);
      if (session) {
        await query('DELETE FROM zunari_admin_sessions WHERE session_token_hash = $1', [session.tokenHash]);
      }
      clearAdminSessionCookie(req, res);
      sendJson(res, 200, { success: true, message: 'Logged out.' });
      return true;
    }

    if (pathname === '/api/admin/me' && method === 'GET') {
      const { getAdminSession } = await import('../auth/admin.ts');
      const session = await getAdminSession(req);
      if (!session) {
        sendError(res, 401, 'No active admin session.', 'NO_ADMIN_SESSION');
        return true;
      }
      sendJson(res, 200, {
        authenticated: true,
        userId: session.userId,
        username: session.username,
        email: session.email,
        adminRole: session.adminRole,
        permissions: session.permissions,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      });
      return true;
    }

    const isReadOnlyMethod = method === 'GET' || method === 'HEAD';
    const adminSession = isReadOnlyMethod
      ? await requireAdminSessionReadOnly(req)
      : await requireAdminSession(req);
    const adminId = getAdminIdFromSession(adminSession);

    if (pathname === '/api/admin/stats' && method === 'GET') {
      if (!adminSession.permissions.stats.read) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const stats = await getAdminStats();
      sendJson(res, 200, stats);
      return true;
    }

    if (pathname === '/api/admin/users' && method === 'GET') {
      if (!adminSession.permissions.users.read) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const searchParams = url.searchParams;
      const roleParam = searchParams.get('role');
      let role: AdminRole | undefined;
      if (roleParam) {
        if (!isValidAdminRole(roleParam)) {
          sendError(res, 400, `Invalid admin role: ${roleParam}.`, 'INVALID_ROLE');
          return true;
        }
        role = roleParam;
      }
      const result = await getAdminUsers({
        limit: Math.min(Number(searchParams.get('limit') || 50), 200),
        offset: Number(searchParams.get('offset') || 0),
        search: searchParams.get('search') || undefined,
        role,
        suspended: searchParams.get('suspended') === 'true',
        sortBy: (searchParams.get('sortBy') as 'created_at' | 'username' | 'last_admin_action_at') || 'created_at',
        sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
      });
      sendJson(res, 200, result);
      return true;
    }

    const userDetailMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(pathname);
    if (userDetailMatch && method === 'GET') {
      if (!adminSession.permissions.users.read) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const detail = await getAdminUserDetail(decodeURIComponent(userDetailMatch[1]));
      if (!detail) {
        sendError(res, 404, 'User not found.', 'USER_NOT_FOUND');
        return true;
      }
      sendJson(res, 200, detail);
      return true;
    }

    if (userDetailMatch && method === 'PATCH') {
      if (!adminSession.permissions.users.write) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const body = await parseAdminRequest(req);
      const targetPublicId = decodeURIComponent(userDetailMatch[1]);
      const newRole = body.adminRole as AdminRole | null | undefined;
      const action = body.action as string | undefined;
      const confirmPassword = body.confirmPassword as string | undefined;

      // Step-up auth for sensitive user modifications
      const stepUp = await verifyAdminPassword(adminId, confirmPassword);
      if (!stepUp) {
        sendError(res, 403, 'Step-up authentication required. Please provide your current password.', 'STEP_UP_REQUIRED');
        return true;
      }

      if (newRole !== undefined && newRole !== null) {
        await setUserAdminRole(adminId, targetPublicId, newRole, req);
        sendJson(res, 200, { success: true, message: `Role updated to ${newRole}.` });
        return true;
      }

      if (action === 'suspend') {
        const reason = String(body.reason || '').trim();
        if (!reason) {
          sendError(res, 400, 'Suspension reason is required.', 'MISSING_REASON');
          return true;
        }
        await suspendUser(adminId, targetPublicId, reason, req);
        sendJson(res, 200, { success: true, message: 'User suspended.' });
        return true;
      }

      if (action === 'unsuspend') {
        await unsuspendUser(adminId, targetPublicId, req);
        sendJson(res, 200, { success: true, message: 'User unsuspended.' });
        return true;
      }

      sendError(res, 400, 'Invalid action. Use adminRole, or action: suspend|unsuspend.', 'INVALID_ACTION');
      return true;
    }

    if (pathname === '/api/admin/audit-log' && method === 'GET') {
      if (!adminSession.permissions.audit.read) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const searchParams = url.searchParams;
      const result = await getAuditLog({
        limit: Math.min(Number(searchParams.get('limit') || 100), 500),
        offset: Number(searchParams.get('offset') || 0),
        adminId: searchParams.get('adminId') || undefined,
        action: searchParams.get('action') || undefined,
        targetType: searchParams.get('targetType') || undefined,
        targetId: searchParams.get('targetId') || undefined,
        startDate: searchParams.get('startDate') ? Number(searchParams.get('startDate')) : undefined,
        endDate: searchParams.get('endDate') ? Number(searchParams.get('endDate')) : undefined,
        sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
      });
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/admin/roles/permissions' && method === 'GET') {
      if (!adminSession.permissions.admin_users.read) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const permissions = await getAdminRolePermissions();
      sendJson(res, 200, { permissions });
      return true;
    }

    if (pathname === '/api/admin/roles/permissions' && method === 'PATCH') {
      if (!adminSession.permissions.admin_users.write) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const body = await parseAdminRequest(req);
      const role = body.role as AdminRole;
      const permissions = body.permissions as Record<string, unknown>;
      const description = String(body.description || '');
      const confirmPassword = body.confirmPassword as string | undefined;

      if (!role || !permissions) {
        sendError(res, 400, 'Role and permissions are required.', 'MISSING_FIELDS');
        return true;
      }

      const stepUp = await verifyAdminPassword(adminId, confirmPassword);
      if (!stepUp) {
        sendError(res, 403, 'Step-up authentication required. Please provide your current password.', 'STEP_UP_REQUIRED');
        return true;
      }

      await updateAdminRolePermissions(role, permissions, description);
      sendJson(res, 200, { success: true, message: 'Permissions updated.' });
      return true;
    }

    if (pathname === '/api/admin/sessions' && method === 'GET') {
      if (!adminSession.permissions.admin_users.read) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const sessions = await getActiveAdminSessions();
      sendJson(res, 200, { sessions });
      return true;
    }

    const sessionMatch = /^\/api\/admin\/sessions\/([^/]+)$/.exec(pathname);
    if (sessionMatch && method === 'DELETE') {
      if (!adminSession.permissions.admin_users.write) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const body = await parseAdminRequest(req);
      const confirmPassword = body.confirmPassword as string | undefined;
      const stepUp = await verifyAdminPassword(adminId, confirmPassword);
      if (!stepUp) {
        sendError(res, 403, 'Step-up authentication required. Please provide your current password.', 'STEP_UP_REQUIRED');
        return true;
      }
      await revokeAdminSession(sessionMatch[1]);
      await logAdminAction(adminId, 'admin.session.revoke', 'admin_session', sessionMatch[1], {}, req);
      sendJson(res, 200, { success: true, message: 'Session revoked.' });
      return true;
    }

    if (pathname === '/api/admin/sessions/user' && method === 'DELETE') {
      if (!adminSession.permissions.admin_users.write) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const body = await parseAdminRequest(req);
      const targetUserId = String(body.userId || '');
      const confirmPassword = body.confirmPassword as string | undefined;
      if (!targetUserId) {
        sendError(res, 400, 'userId is required.', 'MISSING_USER_ID');
        return true;
      }
      const stepUp = await verifyAdminPassword(adminId, confirmPassword);
      if (!stepUp) {
        sendError(res, 403, 'Step-up authentication required. Please provide your current password.', 'STEP_UP_REQUIRED');
        return true;
      }
      await revokeAllAdminSessionsForUser(targetUserId);
      await logAdminAction(adminId, 'admin.session.revoke_all', 'user', targetUserId, {}, req);
      sendJson(res, 200, { success: true, message: 'All admin sessions revoked for user.' });
      return true;
    }

    // Reports endpoints
    if (pathname === '/api/admin/reports' && method === 'GET') {
      if (!adminSession.permissions.reports.read) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const searchParams = url.searchParams;
      const result = await getAdminReports({
        limit: Math.min(Number(searchParams.get('limit') || 50), 200),
        offset: Number(searchParams.get('offset') || 0),
        type: (searchParams.get('type') as 'user' | 'post') || undefined,
        status: (searchParams.get('status') as 'pending' | 'reviewed' | 'dismissed' | 'action_taken') || undefined,
        search: searchParams.get('search') || undefined,
        sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
      });
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/admin/reports' && method === 'PATCH') {
      if (!adminSession.permissions.reports.write) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const body = await parseAdminRequest(req);
      const reportId = String(body.reportId || '');
      const status = String(body.status || '');
      const validStatuses = ['pending', 'reviewed', 'dismissed', 'action_taken'];
      if (!reportId || !status || !validStatuses.includes(status)) {
        sendError(res, 400, 'reportId and valid status (pending|reviewed|dismissed|action_taken) are required.', 'INVALID_FIELDS');
        return true;
      }
      const updatedReport = await updateReportStatus(
        adminId,
        reportId,
        status as 'pending' | 'reviewed' | 'dismissed' | 'action_taken',
        adminSession.username,
        adminSession.adminRole,
        req,
      );
      sendJson(res, 200, { success: true, report: updatedReport });
      return true;
    }

    // Verification toggle endpoint
    const userVerifyMatch = /^\/api\/admin\/users\/([^/]+)\/verify$/.exec(pathname);
    if (userVerifyMatch && method === 'PATCH') {
      if (!adminSession.permissions.badges.write) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const body = await parseAdminRequest(req);
      const targetPublicId = decodeURIComponent(userVerifyMatch[1]);
      const verified = body.verified === true;
      const confirmPassword = body.confirmPassword as string | undefined;

      if (typeof body.verified !== 'boolean') {
        sendError(res, 400, 'verified (boolean) is required.', 'MISSING_FIELDS');
        return true;
      }

      const stepUp = await verifyAdminPassword(adminId, confirmPassword);
      if (!stepUp) {
        sendError(res, 403, 'Step-up authentication required. Please provide your current password.', 'STEP_UP_REQUIRED');
        return true;
      }

      const result = await updateUserVerification(
        adminId,
        targetPublicId,
        verified,
        adminSession.adminRole,
        req,
      );
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    // Gold membership toggle endpoint
    const userGoldMatch = /^\/api\/admin\/users\/([^/]+)\/gold$/.exec(pathname);
    if (userGoldMatch && method === 'PATCH') {
      // Gold grant/revoke restricted to super_admin and admin only
      // (verification_manager has badges.write for verification but not Gold)
      if (!['super_admin', 'admin'].includes(adminSession.adminRole)) {
        sendError(res, 403, 'Insufficient permissions to manage Gold membership.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const body = await parseAdminRequest(req);
      const targetPublicId = decodeURIComponent(userGoldMatch[1]);
      const isGold = body.isGold === true;
      const confirmPassword = body.confirmPassword as string | undefined;

      if (typeof body.isGold !== 'boolean') {
        sendError(res, 400, 'isGold (boolean) is required.', 'MISSING_FIELDS');
        return true;
      }

      const stepUp = await verifyAdminPassword(adminId, confirmPassword);
      if (!stepUp) {
        sendError(res, 403, 'Step-up authentication required. Please provide your current password.', 'STEP_UP_REQUIRED');
        return true;
      }

      const result = await updateUserGold(
        adminId,
        targetPublicId,
        isGold,
        adminSession.adminRole,
        req,
      );
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    // Admin user creation endpoint
    if (pathname === '/api/admin/users' && method === 'POST') {
      if (!adminSession.permissions.admin_users.write) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const body = await parseAdminRequest(req);
      const username = String(body.username || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || '').trim() || username;
      const adminRole = body.adminRole as AdminRole | undefined;
      const confirmPassword = body.confirmPassword as string | undefined;

      if (!username || !email || !password || !adminRole) {
        sendError(res, 400, 'username, email, password, and adminRole are required.', 'MISSING_FIELDS');
        return true;
      }

      const validRoles: AdminRole[] = ['super_admin', 'admin', 'moderator', 'verification_manager', 'analyst'];
      if (!validRoles.includes(adminRole)) {
        sendError(res, 400, `Invalid admin role. Must be one of: ${validRoles.join(', ')}.`, 'INVALID_ROLE');
        return true;
      }

      if (password.length < 8) {
        sendError(res, 400, 'Password must be at least 8 characters.', 'INVALID_PASSWORD');
        return true;
      }

      // Password complexity requirements
      if (!/[A-Z]/.test(password)) {
        sendError(res, 400, 'Password must contain at least one uppercase letter.', 'INVALID_PASSWORD');
        return true;
      }
      if (!/[a-z]/.test(password)) {
        sendError(res, 400, 'Password must contain at least one lowercase letter.', 'INVALID_PASSWORD');
        return true;
      }
      if (!/[0-9]/.test(password)) {
        sendError(res, 400, 'Password must contain at least one number.', 'INVALID_PASSWORD');
        return true;
      }
      if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        sendError(res, 400, 'Password must contain at least one special character.', 'INVALID_PASSWORD');
        return true;
      }

      // Reject common weak passwords
      const commonPasswords = new Set([
        'password123',
        'password123!',
        'admin123!',
        'admin1234!',
        'changeme1!',
        'changeme123!',
        'welcome1!',
        'welcome123!',
        'qwerty123!',
        'qwerty1234!',
      ]);
      if (commonPasswords.has(password.toLowerCase())) {
        sendError(res, 400, 'Password is too common. Please choose a stronger password.', 'INVALID_PASSWORD');
        return true;
      }

      const emailPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
      if (!emailPattern.test(email)) {
        sendError(res, 400, 'A valid email address is required.', 'INVALID_EMAIL');
        return true;
      }

      const stepUp = await verifyAdminPassword(adminId, confirmPassword);
      if (!stepUp) {
        sendError(res, 403, 'Step-up authentication required. Please provide your current password.', 'STEP_UP_REQUIRED');
        return true;
      }

      const result = await createAdminUser(
        adminId,
        adminSession.adminRole,
        username,
        email,
        password,
        name,
        adminRole,
        req,
      );
      sendJson(res, 201, { success: true, ...result });
      return true;
    }

    // Audit log export endpoint
    if (pathname === '/api/admin/audit-log/export' && method === 'GET') {
      if (!adminSession.permissions.audit.read) {
        sendError(res, 403, 'Insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
        return true;
      }
      const searchParams = url.searchParams;
      const format = (searchParams.get('format') as 'csv' | 'json') || 'json';
      if (!['csv', 'json'].includes(format)) {
        sendError(res, 400, 'Format must be csv or json.', 'INVALID_FORMAT');
        return true;
      }

      // CSRF protection for audit export (GET endpoint with sensitive data)
      const csrfToken = searchParams.get('csrfToken') || req.headers['x-csrf-token'];
      if (!csrfToken || typeof csrfToken !== 'string' || !safeEqual(csrfToken, adminSession.csrfToken)) {
        sendError(res, 403, 'Invalid CSRF token.', 'CSRF_INVALID');
        return true;
      }

      // Step-up auth for audit export (password via query param for GET)
      const confirmPassword = searchParams.get('confirmPassword') || undefined;
      const stepUp = await verifyAdminPassword(adminId, confirmPassword);
      if (!stepUp) {
        sendError(res, 403, 'Step-up authentication required. Please provide your current password.', 'STEP_UP_REQUIRED');
        return true;
      }

      const limit = normalizeAuditExportLimit(searchParams.get('limit'), 10000);
      const useStreaming = limit > 10000;

      if (useStreaming) {
        // Streaming export for large datasets
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `audit-log-${timestamp}.${format === 'csv' ? 'csv' : 'json'}`;
        res.statusCode = 200;
        res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/x-ndjson');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Transfer-Encoding', 'chunked');

        // Create abort signal from response close event
        const controller = new AbortController();
        res.on('close', () => controller.abort());

        try {
          for await (const chunk of streamAuditLogExport({
            format,
            adminId: searchParams.get('adminId') || undefined,
            action: searchParams.get('action') || undefined,
            targetType: searchParams.get('targetType') || undefined,
            targetId: searchParams.get('targetId') || undefined,
            startDate: searchParams.get('startDate') ? Number(searchParams.get('startDate')) : undefined,
            endDate: searchParams.get('endDate') ? Number(searchParams.get('endDate')) : undefined,
            limit,
            offset: Number(searchParams.get('offset') || 0),
            sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
            signal: controller.signal,
          })) {
            if (!res.writableEnded) {
              res.write(chunk);
            }
          }
          if (!res.writableEnded) {
            res.end();
          }
        } catch (streamError) {
          console.error('Audit log streaming export failed:', streamError);
          if (!res.writableEnded) {
            res.destroy();
          }
        }
        return true;
      }

      // Non-streaming export for smaller datasets
      const result = await exportAuditLog({
        format,
        adminId: searchParams.get('adminId') || undefined,
        action: searchParams.get('action') || undefined,
        targetType: searchParams.get('targetType') || undefined,
        targetId: searchParams.get('targetId') || undefined,
        startDate: searchParams.get('startDate') ? Number(searchParams.get('startDate')) : undefined,
        endDate: searchParams.get('endDate') ? Number(searchParams.get('endDate')) : undefined,
        limit,
        offset: Number(searchParams.get('offset') || 0),
        sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(result.data);
      return true;
    }

    sendError(res, 404, 'Admin endpoint not found.', 'NOT_FOUND');
    return true;
  } catch (error) {
    if (error instanceof HttpError) {
      sendError(res, error.status, error.message, error.code);
      return true;
    }
    if (error instanceof SyntaxError) {
      sendError(res, 400, 'Invalid JSON request body.', 'INVALID_JSON');
      return true;
    }
    console.error('Admin API error:', error);
    setAuthError(res, error);
    return true;
  }
}

export async function initAdmin(): Promise<void> {
  // bootstrapSuperAdmin is called from bootstrap.ts during server initialization
  // to ensure it runs after database migrations are applied
}