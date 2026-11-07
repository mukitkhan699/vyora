import type { QueryResultRow } from 'pg';
import { query, withTransaction } from './pool.ts';
import { HttpError } from '../errors.ts';
import type { AdminRole } from '../auth/admin.ts';

interface AdminUserRow extends QueryResultRow {
  id: number;
  public_id: string;
  username: string;
  name: string;
  email: string | null;
  admin_role: AdminRole | null;
  verified: boolean;
  is_gold: boolean;
  suspended_at: number | null;
  suspended_by: string | null;
  created_at: number | string;
  followers_count: number;
  following_count: number;
  last_admin_action_at: number | null;
}

interface AuditLogRow extends QueryResultRow {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
  admin_username: string | null;
}

interface AdminStatsRow extends QueryResultRow {
  total_users: number;
  active_users_24h: number;
  active_users_7d: number;
  total_posts: number;
  posts_24h: number;
  posts_7d: number;
  pending_user_reports: number;
  pending_post_reports: number;
  admin_users_count: number;
  suspended_users_count: number;
}

export async function getAdminUsers(
  options: {
    limit?: number;
    offset?: number;
    search?: string;
    role?: AdminRole | null;
    suspended?: boolean;
    sortBy?: 'created_at' | 'username' | 'last_admin_action_at';
    sortOrder?: 'asc' | 'desc';
  } = {},
): Promise<{ users: AdminUserRow[]; total: number }> {
  const {
    limit = 50,
    offset = 0,
    search = '',
    role = null,
    suspended = false,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = options;

  const conditions: string[] = ['admin_role IS NOT NULL'];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(`(username ILIKE $${paramIndex} OR name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (role) {
    conditions.push(`admin_role = $${paramIndex}`);
    params.push(role);
    paramIndex++;
  }

  if (suspended) {
    conditions.push('suspended_at IS NOT NULL');
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const allowedSortColumns = ['created_at', 'username', 'last_admin_action_at'];
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
  const sortDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const countResult = await query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM zunari_users ${whereClause}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const usersResult = await query<AdminUserRow>(
    `SELECT
       id, public_id, username, name, email, admin_role, verified, is_gold,
       suspended_at, suspended_by, created_at, followers_count, following_count, last_admin_action_at
     FROM zunari_users
     ${whereClause}
     ORDER BY ${sortColumn} ${sortDirection}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset],
  );

  return { users: usersResult.rows, total };
}

export async function getAdminUserDetail(publicId: string): Promise<{
  user: AdminUserRow | null;
  sessionCount: number;
  postCount: number;
  reportCount: number;
  recentAuditLog: AuditLogRow[];
} | null> {
  const userResult = await query<AdminUserRow>(
    `SELECT
       id, public_id, username, name, email, admin_role, verified, is_gold,
       suspended_at, suspended_by, created_at, followers_count, following_count, last_admin_action_at
     FROM zunari_users WHERE public_id = $1`,
    [publicId],
  );
  const user = userResult.rows[0];
  if (!user) return null;

  const [sessions, posts, reports, auditLog] = await Promise.all([
    query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM zunari_sessions WHERE user_id = $1 AND expires_at > $2', [user.id, Date.now()]),
    query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM zunari_posts WHERE author_id = $1', [publicId]),
    query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM (
         SELECT 1 FROM zunari_user_reports WHERE reported_user_id = $1
         UNION ALL
         SELECT 1 FROM zunari_post_reports pr JOIN zunari_posts p ON p.id = pr.post_id WHERE p.author_id = $1
       ) AS combined`,
      [publicId],
    ),
    query<AuditLogRow>(
      `SELECT
         a.*, u.username AS admin_username
       FROM zunari_admin_audit_log a
       LEFT JOIN zunari_users u ON u.public_id = a.admin_id
       WHERE a.target_type = 'user' AND a.target_id = $1
       ORDER BY a.created_at DESC
       LIMIT 20`,
      [publicId],
    ),
  ]);

  return {
    user,
    sessionCount: Number(sessions.rows[0]?.count || 0),
    postCount: Number(posts.rows[0]?.count || 0),
    reportCount: Number(reports.rows[0]?.count || 0),
    recentAuditLog: auditLog.rows,
  };
}

export async function getAdminStats(): Promise<AdminStatsRow> {
  const now = Date.now();
  const day24h = now - 24 * 60 * 60 * 1000;
  const day7d = now - 7 * 24 * 60 * 60 * 1000;

  const result = await query<AdminStatsRow>(`
    SELECT
      (SELECT COUNT(*)::integer FROM zunari_users) AS total_users,
      (SELECT COUNT(*)::integer FROM zunari_users WHERE created_at > $1) AS active_users_24h,
      (SELECT COUNT(*)::integer FROM zunari_users WHERE created_at > $2) AS active_users_7d,
      (SELECT COUNT(*)::integer FROM zunari_posts) AS total_posts,
      (SELECT COUNT(*)::integer FROM zunari_posts WHERE created_at > $1) AS posts_24h,
      (SELECT COUNT(*)::integer FROM zunari_posts WHERE created_at > $2) AS posts_7d,
      (SELECT COUNT(*)::integer FROM zunari_user_reports WHERE status = 'pending') AS pending_user_reports,
      (SELECT COUNT(*)::integer FROM zunari_post_reports WHERE status = 'pending') AS pending_post_reports,
      (SELECT COUNT(*)::integer FROM zunari_users WHERE admin_role IS NOT NULL) AS admin_users_count,
      (SELECT COUNT(*)::integer FROM zunari_users WHERE suspended_at IS NOT NULL) AS suspended_users_count
  `, [day24h, day7d]);

  return result.rows[0];
}

export async function getAuditLog(
  options: {
    limit?: number;
    offset?: number;
    adminId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    startDate?: number;
    endDate?: number;
    sortOrder?: 'asc' | 'desc';
  } = {},
): Promise<{ logs: AuditLogRow[]; total: number }> {
  const {
    limit = 100,
    offset = 0,
    adminId = null,
    action = null,
    targetType = null,
    targetId = null,
    startDate = null,
    endDate = null,
    sortOrder = 'desc',
  } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (adminId) {
    conditions.push(`a.admin_id = $${paramIndex}`);
    params.push(adminId);
    paramIndex++;
  }

  if (action) {
    conditions.push(`a.action ILIKE $${paramIndex}`);
    params.push(`%${action}%`);
    paramIndex++;
  }

  if (targetType) {
    conditions.push(`a.target_type = $${paramIndex}`);
    params.push(targetType);
    paramIndex++;
  }

  if (targetId) {
    conditions.push(`a.target_id = $${paramIndex}`);
    params.push(targetId);
    paramIndex++;
  }

  if (startDate) {
    conditions.push(`a.created_at >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    conditions.push(`a.created_at <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const countResult = await query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM zunari_admin_audit_log a ${whereClause}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const logsResult = await query<AuditLogRow>(
    `SELECT
       a.*, u.username AS admin_username
     FROM zunari_admin_audit_log a
     LEFT JOIN zunari_users u ON u.public_id = a.admin_id
     ${whereClause}
     ORDER BY a.created_at ${sortDirection}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset],
  );

  return { logs: logsResult.rows, total };
}

export async function getAdminRolePermissions(): Promise<{
  role: AdminRole;
  permissions: Record<string, unknown>;
  description: string;
}[]> {
  const result = await query<{
    role: AdminRole;
    permissions: Record<string, unknown>;
    description: string;
  }>('SELECT role, permissions, description FROM zunari_admin_role_permissions ORDER BY role');
  return result.rows;
}

export async function updateAdminRolePermissions(
  role: AdminRole,
  permissions: Record<string, unknown>,
  description: string,
): Promise<void> {
  if (role === 'super_admin') {
    throw new HttpError(403, 'Cannot modify super_admin permissions.', 'SUPER_ADMIN_IMMUTABLE');
  }
  await query(
    'UPDATE zunari_admin_role_permissions SET permissions = $1, description = $2 WHERE role = $3',
    [JSON.stringify(permissions), description, role],
  );
}

export async function getActiveAdminSessions(): Promise<{
  id: string;
  admin_id: string;
  admin_username: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
  expires_at: number;
  last_activity_at: number;
}>[] {
  const result = await query<{
    id: string;
    admin_id: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: number;
    expires_at: number;
    last_activity_at: number;
    admin_username: string;
  }>(
    `SELECT s.*, u.username AS admin_username
     FROM zunari_admin_sessions s
     JOIN zunari_users u ON u.public_id = s.admin_id
     WHERE s.expires_at > $1
     ORDER BY s.last_activity_at DESC`,
    [Date.now()],
  );
  return result.rows;
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await query('DELETE FROM zunari_admin_sessions WHERE id = $1', [sessionId]);
}

export async function revokeAllAdminSessionsForUser(adminId: string): Promise<void> {
  await query('DELETE FROM zunari_admin_sessions WHERE admin_id = $1', [adminId]);
}

export async function cleanupExpiredAdminSessions(): Promise<void> {
  await query('DELETE FROM zunari_admin_sessions WHERE expires_at <= $1', [Date.now()]);
}