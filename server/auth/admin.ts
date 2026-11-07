import { randomBytes, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { query, withTransaction } from '../db/pool.ts';
import { HttpError } from '../errors.ts';
import { getAuthUser, requireSessionWithCsrf, safeEqual } from '../auth.ts';

export type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'moderator'
  | 'verification_manager'
  | 'analyst';

export interface AdminPermissions {
  users: { read: boolean; write: boolean; suspend: boolean };
  posts: { read: boolean; delete: boolean };
  reports: { read: boolean; write: boolean };
  audit: { read: boolean };
  badges: { read: boolean; write: boolean };
  stats: { read: boolean };
  admin_users: { read: boolean; write: boolean };
}

export interface AdminSession {
  token: string;
  tokenHash: string;
  userId: number;
  username: string;
  email: string | null;
  adminRole: AdminRole;
  permissions: AdminPermissions;
  csrfToken: string;
  expiresAt: number;
}

const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const ADMIN_COOKIE_NAME = 'admin_sid';
const ADMIN_SECURE_COOKIE_NAME = '__Host-admin_sid';

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermissions> = {
  super_admin: {
    users: { read: true, write: true, suspend: true },
    posts: { read: true, delete: true },
    reports: { read: true, write: true },
    audit: { read: true },
    badges: { read: true, write: true },
    stats: { read: true },
    admin_users: { read: true, write: true },
  },
  admin: {
    users: { read: true, write: true, suspend: true },
    posts: { read: true, delete: true },
    reports: { read: true, write: true },
    audit: { read: true },
    badges: { read: true, write: true },
    stats: { read: true },
    admin_users: { read: false, write: false },
  },
  moderator: {
    users: { read: true, write: false, suspend: false },
    posts: { read: true, delete: true },
    reports: { read: true, write: true },
    audit: { read: true },
    badges: { read: false, write: false },
    stats: { read: false },
    admin_users: { read: false, write: false },
  },
  verification_manager: {
    users: { read: true, write: false, suspend: false },
    posts: { read: false, delete: false },
    reports: { read: false, write: false },
    audit: { read: true },
    badges: { read: true, write: true },
    stats: { read: false },
    admin_users: { read: false, write: false },
  },
  analyst: {
    users: { read: true, write: false, suspend: false },
    posts: { read: true, delete: false },
    reports: { read: false, write: false },
    audit: { read: true },
    badges: { read: false, write: false },
    stats: { read: true },
    admin_users: { read: false, write: false },
  },
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isSecureRequest(req: IncomingMessage): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }
  const socketWithEncrypted = req.socket as { encrypted?: boolean };
  return Boolean(socketWithEncrypted.encrypted);
}

export function getAdminCookie(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const secure = isSecureRequest(req);
  const cookieName = secure ? ADMIN_SECURE_COOKIE_NAME : ADMIN_COOKIE_NAME;
  const cookies = header.split(';');
  for (const cookie of cookies) {
    const [rawKey, ...parts] = cookie.trim().split('=');
    if (rawKey === cookieName) {
      return decodeURIComponent(parts.join('='));
    }
  }
  return null;
}

export function setAdminSessionCookie(req: IncomingMessage, res: ServerResponse, session: AdminSession): void {
  const secure = isSecureRequest(req);
  const cookieName = secure ? ADMIN_SECURE_COOKIE_NAME : ADMIN_COOKIE_NAME;
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

export function clearAdminSessionCookie(req: IncomingMessage, res: ServerResponse): void {
  const secure = isSecureRequest(req);
  const cookieName = secure ? ADMIN_SECURE_COOKIE_NAME : ADMIN_COOKIE_NAME;
  res.setHeader(
    'Set-Cookie',
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
  );
}

export async function getAdminSession(req: IncomingMessage): Promise<AdminSession | null> {
  const token = getAdminCookie(req);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const result = await query<{
    id: string;
    admin_id: string;
    session_token_hash: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: number;
    expires_at: number;
    last_activity_at: number;
    csrf_token_hash: string;
  }>(
    `SELECT id, admin_id, session_token_hash, ip_address, user_agent, created_at, expires_at, last_activity_at, csrf_token_hash
     FROM zunari_admin_sessions
     WHERE session_token_hash = $1`,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await query('DELETE FROM zunari_admin_sessions WHERE session_token_hash = $1', [tokenHash]);
    return null;
  }

  const userResult = await query<{
    id: number;
    username: string;
    email: string | null;
    admin_role: AdminRole | null;
  }>(
    `SELECT id, username, email, admin_role FROM zunari_users WHERE public_id = $1`,
    [row.admin_id],
  );

  const user = userResult.rows[0];
  if (!user || !user.admin_role) {
    await query('DELETE FROM zunari_admin_sessions WHERE session_token_hash = $1', [tokenHash]);
    return null;
  }

  const adminRole = user.admin_role as AdminRole;
  const permissions = ROLE_PERMISSIONS[adminRole];

  await query(
    'UPDATE zunari_admin_sessions SET last_activity_at = $1 WHERE session_token_hash = $2',
    [Date.now(), tokenHash],
  );

  return {
    token,
    tokenHash,
    userId: user.id,
    username: user.username,
    email: user.email,
    adminRole: user.admin_role,
    permissions,
    csrfToken: row.csrf_token_hash,
    expiresAt: row.expires_at,
  };
}

export async function createAdminSession(
  userId: number,
  adminRole: AdminRole,
  req: IncomingMessage,
): Promise<AdminSession> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const csrfTokenHash = hashToken(csrfToken);
  const createdAt = Date.now();
  const expiresAt = createdAt + ADMIN_SESSION_TTL_MS;
  const tokenHash = hashToken(token);
  const ipAddress = req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  await withTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO zunari_admin_sessions (id, admin_id, session_token_hash, csrf_token_hash, ip_address, user_agent, created_at, expires_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `adm_sess_${randomBytes(16).toString('hex')}`,
        `user_auth_${userId}`,
        tokenHash,
        csrfTokenHash,
        ipAddress,
        userAgent,
        createdAt,
        expiresAt,
        createdAt,
      ],
    );
  });

  return {
    token,
    tokenHash,
    userId,
    username: '',
    email: null,
    adminRole,
    permissions: ROLE_PERMISSIONS[adminRole],
    csrfToken,
    expiresAt,
  };
}

export async function requireAdminSession(req: IncomingMessage): Promise<AdminSession> {
  const session = await getAdminSession(req);
  if (!session) {
    throw new HttpError(403, 'Admin session required. Please sign in to the admin dashboard.', 'ADMIN_SESSION_REQUIRED');
  }

  const csrfHeader = req.headers['x-csrf-token'];
  if (!csrfHeader || typeof csrfHeader !== 'string' || !safeEqual(csrfHeader, session.csrfToken)) {
    throw new HttpError(403, 'Invalid CSRF token.', 'CSRF_INVALID');
  }

  return session;
}

export function requirePermission(permission: keyof AdminPermissions, subPermission?: keyof AdminPermissions[keyof AdminPermissions]) {
  return async (req: IncomingMessage): Promise<AdminSession> => {
    const session = await requireAdminSession(req);
    const perm = session.permissions[permission];
    if (!perm || (subPermission && typeof perm === 'object' && !perm[subPermission])) {
      throw new HttpError(403, 'Insufficient permissions for this action.', 'INSUFFICIENT_PERMISSIONS');
    }
    return session;
  };
}

export async function logAdminAction(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
  req?: IncomingMessage,
): Promise<void> {
  await query(
    `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      `audit_${randomBytes(16).toString('hex')}`,
      adminId,
      action,
      targetType,
      targetId,
      JSON.stringify(metadata),
      req?.socket.remoteAddress || null,
      req?.headers['user-agent'] || null,
      Date.now(),
    ],
  );
}

export async function bootstrapSuperAdmin(): Promise<void> {
  const superAdminPublicId = process.env.SUPER_ADMIN_PUBLIC_ID?.trim();
  if (!superAdminPublicId) {
    return;
  }

  const existing = await query<{ public_id: string; admin_role: AdminRole | null }>(
    'SELECT public_id, admin_role FROM zunari_users WHERE public_id = $1',
    [superAdminPublicId],
  );

  if (existing.rowCount === 0) {
    return;
  }

  const user = existing.rows[0];
  if (user.admin_role !== 'super_admin') {
    await query(
      'UPDATE zunari_users SET admin_role = $1, last_admin_action_at = $2 WHERE public_id = $3',
      ['super_admin', Date.now(), superAdminPublicId],
    );
    await logAdminAction(
      'system',
      'bootstrap.super_admin',
      'user',
      superAdminPublicId,
      { reason: 'SUPER_ADMIN_PUBLIC_ID environment variable bootstrap' },
    );
  }
}

export async function getAdminUserByPublicId(publicId: string): Promise<{
  id: number;
  public_id: string;
  username: string;
  email: string | null;
  admin_role: AdminRole | null;
  suspended_at: number | null;
} | null> {
  const result = await query<{
    id: number;
    public_id: string;
    username: string;
    email: string | null;
    admin_role: AdminRole | null;
    suspended_at: number | null;
  }>(
    `SELECT id, public_id, username, email, admin_role, suspended_at
     FROM zunari_users WHERE public_id = $1`,
    [publicId],
  );
  return result.rows[0] || null;
}

export async function setUserAdminRole(
  actingAdminId: string,
  targetPublicId: string,
  newRole: AdminRole | null,
  req?: IncomingMessage,
): Promise<void> {
  if (newRole === 'super_admin') {
    const actingAdmin = await getAdminUserByPublicId(actingAdminId);
    if (!actingAdmin || actingAdmin.admin_role !== 'super_admin') {
      throw new HttpError(403, 'Only super admins can assign super admin role.', 'SUPER_ADMIN_REQUIRED');
    }
  }

  const target = await getAdminUserByPublicId(targetPublicId);
  if (!target) {
    throw new HttpError(404, 'Target user not found.', 'USER_NOT_FOUND');
  }

  if (target.admin_role === 'super_admin' && newRole !== 'super_admin') {
    const superAdmins = await query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM zunari_users WHERE admin_role = $1',
      ['super_admin'],
    );
    if (Number(superAdmins.rows[0].count) <= 1) {
      throw new HttpError(400, 'Cannot demote the last super admin.', 'LAST_SUPER_ADMIN_PROTECTED');
    }
  }

  await withTransaction(async (connection) => {
    await connection.query(
      'UPDATE zunari_users SET admin_role = $1, last_admin_action_at = $2 WHERE public_id = $3',
      [newRole, Date.now(), targetPublicId],
    );

    await connection.query(
      'DELETE FROM zunari_admin_sessions WHERE admin_id = $1',
      [targetPublicId],
    );

    await connection.query(
      `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `audit_${randomBytes(16).toString('hex')}`,
        actingAdminId,
        newRole ? 'admin.role.grant' : 'admin.role.revoke',
        'user',
        targetPublicId,
        JSON.stringify({ previous_role: target.admin_role, new_role: newRole }),
        req?.socket.remoteAddress || null,
        req?.headers['user-agent'] || null,
        Date.now(),
      ],
    );
  });
}

export async function suspendUser(
  actingAdminId: string,
  targetPublicId: string,
  reason: string,
  req?: IncomingMessage,
): Promise<void> {
  const actingAdmin = await getAdminUserByPublicId(actingAdminId);
  if (!actingAdmin || !actingAdmin.admin_role) {
    throw new HttpError(403, 'Admin privileges required.', 'ADMIN_REQUIRED');
  }

  if (!ROLE_PERMISSIONS[actingAdmin.admin_role].users.suspend) {
    throw new HttpError(403, 'Insufficient permissions to suspend users.', 'INSUFFICIENT_PERMISSIONS');
  }

  const target = await getAdminUserByPublicId(targetPublicId);
  if (!target) {
    throw new HttpError(404, 'Target user not found.', 'USER_NOT_FOUND');
  }

  if (target.admin_role === 'super_admin') {
    throw new HttpError(403, 'Cannot suspend a super admin.', 'SUPER_ADMIN_PROTECTED');
  }

  if (target.suspended_at) {
    throw new HttpError(409, 'User is already suspended.', 'ALREADY_SUSPENDED');
  }

  await withTransaction(async (connection) => {
    await connection.query(
      'UPDATE zunari_users SET suspended_at = $1, suspended_by = $2, last_admin_action_at = $3 WHERE public_id = $4',
      [Date.now(), actingAdminId, Date.now(), targetPublicId],
    );

    await connection.query('DELETE FROM zunari_sessions WHERE user_id = $1', [target.id]);

    await connection.query(
      'DELETE FROM zunari_admin_sessions WHERE admin_id = $1',
      [targetPublicId],
    );

    await connection.query(
      `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `audit_${randomBytes(16).toString('hex')}`,
        actingAdminId,
        'user.suspend',
        'user',
        targetPublicId,
        JSON.stringify({ reason }),
        req?.socket.remoteAddress || null,
        req?.headers['user-agent'] || null,
        Date.now(),
      ],
    );
  });
}

export async function unsuspendUser(
  actingAdminId: string,
  targetPublicId: string,
  req?: IncomingMessage,
): Promise<void> {
  const actingAdmin = await getAdminUserByPublicId(actingAdminId);
  if (!actingAdmin || !actingAdmin.admin_role) {
    throw new HttpError(403, 'Admin privileges required.', 'ADMIN_REQUIRED');
  }

  if (!ROLE_PERMISSIONS[actingAdmin.admin_role].users.suspend) {
    throw new HttpError(403, 'Insufficient permissions to unsuspend users.', 'INSUFFICIENT_PERMISSIONS');
  }

  const target = await getAdminUserByPublicId(targetPublicId);
  if (!target) {
    throw new HttpError(404, 'Target user not found.', 'USER_NOT_FOUND');
  }

  if (!target.suspended_at) {
    throw new HttpError(409, 'User is not suspended.', 'NOT_SUSPENDED');
  }

  await withTransaction(async (connection) => {
    await connection.query(
      'UPDATE zunari_users SET suspended_at = NULL, suspended_by = NULL, last_admin_action_at = $1 WHERE public_id = $2',
      [Date.now(), targetPublicId],
    );

    await connection.query(
      `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `audit_${randomBytes(16).toString('hex')}`,
        actingAdminId,
        'user.unsuspend',
        'user',
        targetPublicId,
        JSON.stringify({}),
        req?.socket.remoteAddress || null,
        req?.headers['user-agent'] || null,
        Date.now(),
      ],
    );
  });
}