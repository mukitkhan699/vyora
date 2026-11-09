import type { QueryResultRow } from 'pg';
import { query, withTransaction } from './pool.ts';
import { HttpError } from '../errors.ts';
import type { AdminRole } from '../auth/admin.ts';
import { randomUUID } from 'node:crypto';
import {
  AUDIT_EXPORT_BATCH_SIZE,
  AUDIT_EXPORT_CSV_HEADERS,
  MAX_AUDIT_EXPORT_ROWS,
  formatAuditCsvRow,
  normalizeAuditExportLimit,
  normalizeAuditExportOffset,
} from './audit-export.ts';

function validateSortOrder(sortOrder: string): 'asc' | 'desc' {
  return sortOrder === 'asc' ? 'asc' : 'desc';
}

function validateSortColumn(sortBy: string, allowed: readonly string[]): string {
  return allowed.includes(sortBy) ? sortBy : allowed[0];
}

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
  admin_id: string | null;
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

  const allowedSortColumns = ['created_at', 'username', 'last_admin_action_at'] as const;
  const sortColumn = validateSortColumn(sortBy, allowedSortColumns);
  const sortDirection = validateSortOrder(sortOrder) === 'asc' ? 'ASC' : 'DESC';

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
  const sortDirection = validateSortOrder(sortOrder) === 'asc' ? 'ASC' : 'DESC';

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
     ORDER BY a.created_at ${sortDirection}, a.id ${sortDirection}
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
  validateAdminPermissions(permissions);
  await query(
    'UPDATE zunari_admin_role_permissions SET permissions = $1, description = $2 WHERE role = $3',
    [JSON.stringify(permissions), description, role],
  );
}

function validateAdminPermissions(permissions: Record<string, unknown>): void {
  const expectedKeys = [
    'users',
    'posts',
    'reports',
    'audit',
    'badges',
    'stats',
    'admin_users',
  ] as const;

  for (const key of expectedKeys) {
    if (!(key in permissions)) {
      throw new HttpError(400, `Missing permissions key: ${key}`, 'INVALID_PERMISSIONS');
    }
    const value = permissions[key];
    if (typeof value !== 'object' || value === null) {
      throw new HttpError(400, `Permissions key ${key} must be an object`, 'INVALID_PERMISSIONS');
    }
    const obj = value as Record<string, unknown>;
    if (key === 'users') {
      validatePermissionObject(obj, ['read', 'write', 'suspend']);
    } else if (key === 'posts') {
      validatePermissionObject(obj, ['read', 'delete']);
    } else if (key === 'reports') {
      validatePermissionObject(obj, ['read', 'write']);
    } else if (key === 'audit') {
      validatePermissionObject(obj, ['read']);
    } else if (key === 'badges') {
      validatePermissionObject(obj, ['read', 'write']);
    } else if (key === 'stats') {
      validatePermissionObject(obj, ['read']);
    } else if (key === 'admin_users') {
      validatePermissionObject(obj, ['read', 'write']);
    }
  }

  // Reject unknown keys
  for (const key of Object.keys(permissions)) {
    if (!expectedKeys.includes(key as typeof expectedKeys[number])) {
      throw new HttpError(400, `Unknown permissions key: ${key}`, 'INVALID_PERMISSIONS');
    }
  }
}

function validatePermissionObject(obj: Record<string, unknown>, expectedSubKeys: string[]): void {
  for (const subKey of expectedSubKeys) {
    if (!(subKey in obj)) {
      throw new HttpError(400, `Missing sub-permission: ${subKey}`, 'INVALID_PERMISSIONS');
    }
    if (typeof obj[subKey] !== 'boolean') {
      throw new HttpError(400, `Sub-permission ${subKey} must be a boolean`, 'INVALID_PERMISSIONS');
    }
  }
  // Reject unknown sub-keys
  for (const subKey of Object.keys(obj)) {
    if (!expectedSubKeys.includes(subKey)) {
      throw new HttpError(400, `Unknown sub-permission: ${subKey}`, 'INVALID_PERMISSIONS');
    }
  }
}

export async function getActiveAdminSessions(): Promise<
  {
    id: string;
    admin_id: string;
    admin_username: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: number;
    expires_at: number;
    last_activity_at: number;
  }[]
> {
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

interface UserReportRow extends QueryResultRow {
  id: string;
  reporter_id: string | null;
  reporter_id_snapshot: string | null;
  reporter_username_snapshot: string | null;
  reported_user_id: string | null;
  reported_user_id_snapshot: string | null;
  reported_username_snapshot: string | null;
  resolved_reporter_id?: string | null;
  resolved_reported_user_id?: string | null;
  reason: string;
  details: string | null;
  status: 'pending' | 'reviewed' | 'dismissed' | 'action_taken';
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
}

interface PostReportRow extends QueryResultRow {
  id: string;
  reporter_id: string | null;
  reporter_id_snapshot: string | null;
  reporter_username_snapshot: string | null;
  post_id: string | null;
  post_id_snapshot: string | null;
  post_preview_snapshot: string | null;
  resolved_reporter_id?: string | null;
  resolved_post_id?: string | null;
  reason: string;
  details: string | null;
  status: 'pending' | 'reviewed' | 'dismissed' | 'action_taken';
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
}

type ReportType = 'user' | 'post';
type ReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'action_taken';

interface AdminReportRow extends QueryResultRow {
  id: string;
  type: ReportType;
  reporter_id: string | null;
  reporter_username: string | null;
  reported_user_id: string | null;
  reported_username: string | null;
  post_id: string | null;
  post_preview: string | null;
  reason: string;
  details: string | null;
  status: ReportStatus;
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
}

export async function getAdminReports(
  options: {
    limit?: number;
    offset?: number;
    type?: ReportType | null;
    status?: ReportStatus | null;
    search?: string;
    sortOrder?: 'asc' | 'desc';
  } = {},
): Promise<{ reports: AdminReportRow[]; total: number }> {
  const {
    limit = 50,
    offset = 0,
    type = null,
    status = null,
    search = '',
    sortOrder = 'desc',
  } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (type) {
    conditions.push(`r.type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }

  if (status) {
    conditions.push(`r.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (search) {
    conditions.push(`(
      r.reporter_username ILIKE $${paramIndex} OR
      r.reported_username ILIKE $${paramIndex} OR
      r.post_preview ILIKE $${paramIndex} OR
      r.details ILIKE $${paramIndex}
    )`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortDirection = validateSortOrder(sortOrder) === 'asc' ? 'ASC' : 'DESC';

  const countResult = await query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM (
      SELECT 'user' as type, ur.id, COALESCE(ur.reporter_id, ur.reporter_id_snapshot) as reporter_id,
             COALESCE(ur.reporter_username_snapshot, rp.username) as reporter_username,
             COALESCE(ur.reported_user_id, ur.reported_user_id_snapshot) as reported_user_id,
             COALESCE(ur.reported_username_snapshot, rpu.username) as reported_username,
             NULL as post_id, NULL as post_preview,
             ur.reason, ur.details, ur.status, ur.reviewed_by, ur.reviewed_at, ur.created_at
      FROM zunari_user_reports ur
      LEFT JOIN zunari_users rp ON rp.public_id = ur.reporter_id
      LEFT JOIN zunari_users rpu ON rpu.public_id = ur.reported_user_id
      UNION ALL
      SELECT 'post' as type, pr.id, COALESCE(pr.reporter_id, pr.reporter_id_snapshot) as reporter_id,
             COALESCE(pr.reporter_username_snapshot, rp.username) as reporter_username,
             NULL as reported_user_id, NULL as reported_username,
             COALESCE(pr.post_id, pr.post_id_snapshot) as post_id, pr.post_preview_snapshot as post_preview,
             pr.reason, pr.details, pr.status, pr.reviewed_by, pr.reviewed_at, pr.created_at
      FROM zunari_post_reports pr
      LEFT JOIN zunari_users rp ON rp.public_id = pr.reporter_id
      LEFT JOIN zunari_posts p ON p.id = pr.post_id
    ) r ${whereClause}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const reportsResult = await query<AdminReportRow>(
    `SELECT * FROM (
      SELECT 'user' as type, ur.id, COALESCE(ur.reporter_id, ur.reporter_id_snapshot) as reporter_id,
             COALESCE(ur.reporter_username_snapshot, rp.username) as reporter_username,
             COALESCE(ur.reported_user_id, ur.reported_user_id_snapshot) as reported_user_id,
             COALESCE(ur.reported_username_snapshot, rpu.username) as reported_username,
             NULL as post_id, NULL as post_preview,
             ur.reason, ur.details, ur.status, ur.reviewed_by, ur.reviewed_at, ur.created_at
      FROM zunari_user_reports ur
      LEFT JOIN zunari_users rp ON rp.public_id = ur.reporter_id
      LEFT JOIN zunari_users rpu ON rpu.public_id = ur.reported_user_id
      UNION ALL
      SELECT 'post' as type, pr.id, COALESCE(pr.reporter_id, pr.reporter_id_snapshot) as reporter_id,
             COALESCE(pr.reporter_username_snapshot, rp.username) as reporter_username,
             NULL as reported_user_id, NULL as reported_username,
             COALESCE(pr.post_id, pr.post_id_snapshot) as post_id, pr.post_preview_snapshot as post_preview,
             pr.reason, pr.details, pr.status, pr.reviewed_by, pr.reviewed_at, pr.created_at
      FROM zunari_post_reports pr
      LEFT JOIN zunari_users rp ON rp.public_id = pr.reporter_id
      LEFT JOIN zunari_posts p ON p.id = pr.post_id
    ) r ${whereClause}
    ORDER BY r.created_at ${sortDirection}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset],
  );

  return { reports: reportsResult.rows, total };
}

export async function updateReportStatus(
  adminId: string,
  reportId: string,
  newStatus: ReportStatus,
  adminUsername: string,
  adminRole: AdminRole,
  req?: { socket?: { remoteAddress?: string }; headers?: { 'user-agent'?: string } },
): Promise<AdminReportRow> {
  const now = Date.now();

  // Try user report first
  let userReport = await query<UserReportRow>(
    `SELECT * FROM zunari_user_reports WHERE id = $1`,
    [reportId],
  );

  if (userReport.rows[0]) {
    const report = userReport.rows[0];
    if (report.status === newStatus) {
      throw new HttpError(409, 'Report already has this status.', 'STATUS_UNCHANGED');
    }

    await withTransaction(async (connection) => {
      await connection.query(
        `UPDATE zunari_user_reports
         SET status = $1, reviewed_by = $2, reviewed_at = $3
         WHERE id = $4`,
        [newStatus, adminId, now, reportId],
      );

      await connection.query(
        `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          `audit_${randomUUID()}`,
          adminId,
          `report.user.${newStatus}`,
          'user_report',
          reportId,
          JSON.stringify({ previous_status: report.status, new_status: newStatus, reported_user_id: report.reported_user_id }),
          req?.socket?.remoteAddress || null,
          req?.headers?.['user-agent'] || null,
          now,
        ],
      );
    });

    const updated = await query<UserReportRow>(
      `SELECT ur.*,
              COALESCE(ur.reporter_id, ur.reporter_id_snapshot) as resolved_reporter_id,
              COALESCE(ur.reported_user_id, ur.reported_user_id_snapshot) as resolved_reported_user_id,
              COALESCE(rp.username, ur.reporter_username_snapshot) as reporter_username,
              COALESCE(rpu.username, ur.reported_username_snapshot) as reported_username
       FROM zunari_user_reports ur
       LEFT JOIN zunari_users rp ON rp.public_id = ur.reporter_id
       LEFT JOIN zunari_users rpu ON rpu.public_id = ur.reported_user_id
       WHERE ur.id = $1`,
      [reportId],
    );
    const u = updated.rows[0];
    return {
      id: u.id,
      type: 'user',
      reporter_id: u.resolved_reporter_id ?? u.reporter_id,
      reporter_username: u.reporter_username,
      reported_user_id: u.resolved_reported_user_id ?? u.reported_user_id,
      reported_username: u.reported_username,
      post_id: null,
      post_preview: null,
      reason: u.reason,
      details: u.details,
      status: u.status,
      reviewed_by: u.reviewed_by,
      reviewed_at: u.reviewed_at,
      created_at: u.created_at,
    };
  }

  // Try post report
  let postReport = await query<PostReportRow>(
    `SELECT pr.*,
            COALESCE(pr.reporter_id, pr.reporter_id_snapshot) as resolved_reporter_id,
            COALESCE(pr.post_id, pr.post_id_snapshot) as resolved_post_id,
            COALESCE(rp.username, pr.reporter_username_snapshot) as reporter_username,
            pr.post_preview_snapshot as post_preview
     FROM zunari_post_reports pr
     LEFT JOIN zunari_users rp ON rp.public_id = pr.reporter_id
     LEFT JOIN zunari_posts p ON p.id = pr.post_id
     WHERE pr.id = $1`,
    [reportId],
  );

  if (postReport.rows[0]) {
    const report = postReport.rows[0];
    if (report.status === newStatus) {
      throw new HttpError(409, 'Report already has this status.', 'STATUS_UNCHANGED');
    }

    await withTransaction(async (connection) => {
      await connection.query(
        `UPDATE zunari_post_reports
         SET status = $1, reviewed_by = $2, reviewed_at = $3
         WHERE id = $4`,
        [newStatus, adminId, now, reportId],
      );

      await connection.query(
        `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          `audit_${randomUUID()}`,
          adminId,
          `report.post.${newStatus}`,
          'post_report',
          reportId,
          JSON.stringify({ previous_status: report.status, new_status: newStatus, post_id: report.resolved_post_id ?? report.post_id }),
          req?.socket?.remoteAddress || null,
          req?.headers?.['user-agent'] || null,
          now,
        ],
      );
    });

    const updated = await query<PostReportRow>(
      `SELECT pr.*,
              COALESCE(pr.reporter_id, pr.reporter_id_snapshot) as resolved_reporter_id,
              COALESCE(pr.post_id, pr.post_id_snapshot) as resolved_post_id,
              COALESCE(rp.username, pr.reporter_username_snapshot) as reporter_username,
              pr.post_preview_snapshot as post_preview
       FROM zunari_post_reports pr
       LEFT JOIN zunari_users rp ON rp.public_id = pr.reporter_id
       LEFT JOIN zunari_posts p ON p.id = pr.post_id
       WHERE pr.id = $1`,
      [reportId],
    );
    const p = updated.rows[0];
    return {
      id: p.id,
      type: 'post',
      reporter_id: p.resolved_reporter_id ?? p.reporter_id,
      reporter_username: p.reporter_username,
      reported_user_id: null,
      reported_username: null,
      post_id: p.resolved_post_id ?? p.post_id,
      post_preview: p.post_preview,
      reason: p.reason,
      details: p.details,
      status: p.status,
      reviewed_by: p.reviewed_by,
      reviewed_at: p.reviewed_at,
      created_at: p.created_at,
    };
  }

  throw new HttpError(404, 'Report not found.', 'REPORT_NOT_FOUND');
}

export async function updateUserVerification(
  adminId: string,
  targetPublicId: string,
  verified: boolean,
  adminRole: AdminRole,
  req?: { socket?: { remoteAddress?: string }; headers?: { 'user-agent'?: string } },
): Promise<{ public_id: string; verified: boolean }> {
  if (!['super_admin', 'admin', 'verification_manager'].includes(adminRole)) {
    throw new HttpError(403, 'Insufficient permissions to manage verification.', 'INSUFFICIENT_PERMISSIONS');
  }

  const target = await query<{ public_id: string; verified: boolean; admin_role: AdminRole | null }>(
    `SELECT public_id, verified, admin_role FROM zunari_users WHERE public_id = $1`,
    [targetPublicId],
  );
  if (!target.rows[0]) {
    throw new HttpError(404, 'Target user not found.', 'USER_NOT_FOUND');
  }

  if (target.rows[0].verified === verified) {
    throw new HttpError(409, `User is already ${verified ? 'verified' : 'unverified'}.`, 'STATUS_UNCHANGED');
  }

  // Prevent modifying super_admin verification (optional safeguard)
  if (target.rows[0].admin_role === 'super_admin' && adminRole !== 'super_admin') {
    throw new HttpError(403, 'Cannot modify super admin verification.', 'SUPER_ADMIN_PROTECTED');
  }

  const now = Date.now();
  await withTransaction(async (connection) => {
    await connection.query(
      `UPDATE zunari_users SET verified = $1, last_admin_action_at = $2 WHERE public_id = $3`,
      [verified, now, targetPublicId],
    );

    await connection.query(
      `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `audit_${randomUUID()}`,
        adminId,
        verified ? 'user.verify' : 'user.unverify',
        'user',
        targetPublicId,
        JSON.stringify({ previous_verified: target.rows[0].verified, new_verified: verified }),
        req?.socket?.remoteAddress || null,
        req?.headers?.['user-agent'] || null,
        now,
      ],
    );
  });

  return { public_id: targetPublicId, verified };
}

export async function updateUserGold(
  adminId: string,
  targetPublicId: string,
  isGold: boolean,
  adminRole: AdminRole,
  req?: { socket?: { remoteAddress?: string }; headers?: { 'user-agent'?: string } },
): Promise<{ public_id: string; is_gold: boolean }> {
  if (!['super_admin', 'admin'].includes(adminRole)) {
    throw new HttpError(403, 'Insufficient permissions to manage Gold membership.', 'INSUFFICIENT_PERMISSIONS');
  }

  const target = await query<{ public_id: string; is_gold: boolean; admin_role: AdminRole | null }>(
    `SELECT public_id, is_gold, admin_role FROM zunari_users WHERE public_id = $1`,
    [targetPublicId],
  );
  if (!target.rows[0]) {
    throw new HttpError(404, 'Target user not found.', 'USER_NOT_FOUND');
  }

  if (target.rows[0].is_gold === isGold) {
    throw new HttpError(409, `User already ${isGold ? 'has' : 'does not have'} Gold membership.`, 'STATUS_UNCHANGED');
  }

  // Prevent modifying super_admin Gold status (optional safeguard)
  if (target.rows[0].admin_role === 'super_admin' && adminRole !== 'super_admin') {
    throw new HttpError(403, 'Cannot modify super admin Gold status.', 'SUPER_ADMIN_PROTECTED');
  }

  const now = Date.now();
  await withTransaction(async (connection) => {
    await connection.query(
      `UPDATE zunari_users SET is_gold = $1, last_admin_action_at = $2 WHERE public_id = $3`,
      [isGold, now, targetPublicId],
    );

    await connection.query(
      `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `audit_${randomUUID()}`,
        adminId,
        isGold ? 'user.gold_grant' : 'user.gold_revoke',
        'user',
        targetPublicId,
        JSON.stringify({ previous_is_gold: target.rows[0].is_gold, new_is_gold: isGold }),
        req?.socket?.remoteAddress || null,
        req?.headers?.['user-agent'] || null,
        now,
      ],
    );
  });

  return { public_id: targetPublicId, is_gold: isGold };
}

export async function createAdminUser(
  actingAdminId: string,
  actingAdminRole: AdminRole,
  username: string,
  email: string,
  password: string,
  name: string,
  adminRole: AdminRole,
  req?: { socket?: { remoteAddress?: string }; headers?: { 'user-agent'?: string } },
): Promise<{ public_id: string; username: string; admin_role: AdminRole }> {
  // Only super_admin can create admin accounts
  if (actingAdminRole !== 'super_admin') {
    throw new HttpError(403, 'Only super admins can create admin accounts.', 'SUPER_ADMIN_REQUIRED');
  }

  // Only super_admin can create super_admin accounts
  if (adminRole === 'super_admin' && actingAdminRole !== 'super_admin') {
    throw new HttpError(403, 'Only super admins can create super admin accounts.', 'SUPER_ADMIN_REQUIRED');
  }

  // Validate role
  const validRoles: AdminRole[] = ['super_admin', 'admin', 'moderator', 'verification_manager', 'analyst'];
  if (!validRoles.includes(adminRole)) {
    throw new HttpError(400, 'Invalid admin role.', 'INVALID_ROLE');
  }

  // Check if user already exists
  const existing = await query<{ public_id: string }>(
    `SELECT public_id FROM zunari_users WHERE lower(username) = lower($1) OR lower(email) = lower($2) LIMIT 1`,
    [username, email],
  );
  if (existing.rows[0]) {
    throw new HttpError(409, 'Username or email already exists.', 'ACCOUNT_CONFLICT');
  }

  // Hash password
  const { hashPassword } = await import('../auth.ts');
  const passwordHash = await hashPassword(password);

  const createdAt = Date.now();
  const publicId = `user_auth_${randomUUID().slice(0, 8)}`;

  const result = await withTransaction(async (connection) => {
    const insertResult = await connection.query<{
      id: number;
      public_id: string;
      username: string;
      email: string;
      admin_role: AdminRole;
    }>(
      `INSERT INTO zunari_users
         (public_id, username, name, email, password_hash, email_verified, created_at,
          joined_date, avatar_url, banner_url, bio, admin_role, followers_count, following_count)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9, $10, $11, 0, 0)
       RETURNING id, public_id, username, email, admin_role`,
      [
        publicId,
        username,
        name,
        email,
        passwordHash,
        createdAt,
        `Joined ${new Date(createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
        null,
        'New Zunari member',
        adminRole,
      ],
    );

    const user = insertResult.rows[0];

    await connection.query(
      `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `audit_${randomUUID()}`,
        actingAdminId,
        'admin.user.create',
        'user',
        user.public_id,
        JSON.stringify({ username: user.username, email: user.email, admin_role: user.admin_role }),
        req?.socket?.remoteAddress || null,
        req?.headers?.['user-agent'] || null,
        createdAt,
      ],
    );

    return user;
  });

  return { public_id: result.public_id, username: result.username, admin_role: result.admin_role };
}

export async function exportAuditLog(
  options: {
    format: 'csv' | 'json';
    adminId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
    offset?: number;
    sortOrder?: 'asc' | 'desc';
  },
): Promise<{ data: string; contentType: string; filename: string }> {
  const {
    format,
    adminId = null,
    action = null,
    targetType = null,
    targetId = null,
    startDate = null,
    endDate = null,
    limit = 10000,
    offset = 0,
    sortOrder = 'desc',
  } = options;

  const safeLimit = normalizeAuditExportLimit(limit);
  const safeOffset = normalizeAuditExportOffset(offset);

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

  const logsResult = await query<AuditLogRow>(
    `SELECT
       a.id, a.admin_id, a.action, a.target_type, a.target_id, a.metadata,
       a.ip_address, a.user_agent, a.created_at, u.username AS admin_username
     FROM zunari_admin_audit_log a
     LEFT JOIN zunari_users u ON u.public_id = a.admin_id
     ${whereClause}
     ORDER BY a.created_at ${sortDirection}, a.id ${sortDirection}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, safeLimit, safeOffset],
  );

  const logs = logsResult.rows;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (format === 'json') {
    const jsonData = JSON.stringify(logs, null, 2);
    return {
      data: jsonData,
      contentType: 'application/json',
      filename: `audit-log-${timestamp}.json`,
    };
  }

  // CSV format
  const rows = [AUDIT_EXPORT_CSV_HEADERS.join(',')];
  for (const log of logs) {
    rows.push(formatAuditCsvRow(log));
  }

  return {
    data: rows.join('\n'),
    contentType: 'text/csv',
    filename: `audit-log-${timestamp}.csv`,
  };
}

export type AuditLogBatchQuery = <Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: Row[] }>;

/**
 * Streaming export for large datasets - returns an async generator
 * that yields chunks of CSV or JSON data to avoid loading everything into memory.
 */
export async function* streamAuditLogExport(
  options: {
    format: 'csv' | 'json';
    adminId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
    offset?: number;
    sortOrder?: 'asc' | 'desc';
    signal?: AbortSignal;
  },
  dependencies: { query: AuditLogBatchQuery } = { query },
): AsyncGenerator<string, void, unknown> {
  const {
    format,
    adminId = null,
    action = null,
    targetType = null,
    targetId = null,
    startDate = null,
    endDate = null,
    limit = MAX_AUDIT_EXPORT_ROWS,
    offset = 0,
    sortOrder = 'desc',
    signal,
  } = options;

  const safeLimit = normalizeAuditExportLimit(limit);
  const safeOffset = normalizeAuditExportOffset(offset);

  const conditions: string[] = [];
  const baseParams: unknown[] = [];
  let paramIndex = 1;

  if (adminId) {
    conditions.push(`a.admin_id = $${paramIndex}`);
    baseParams.push(adminId);
    paramIndex++;
  }
  if (action) {
    conditions.push(`a.action ILIKE $${paramIndex}`);
    baseParams.push(`%${action}%`);
    paramIndex++;
  }
  if (targetType) {
    conditions.push(`a.target_type = $${paramIndex}`);
    baseParams.push(targetType);
    paramIndex++;
  }
  if (targetId) {
    conditions.push(`a.target_id = $${paramIndex}`);
    baseParams.push(targetId);
    paramIndex++;
  }
  if (startDate) {
    conditions.push(`a.created_at >= $${paramIndex}`);
    baseParams.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    conditions.push(`a.created_at <= $${paramIndex}`);
    baseParams.push(endDate);
    paramIndex++;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortDirection = validateSortOrder(sortOrder) === 'asc' ? 'ASC' : 'DESC';

  if (format === 'json') {
    // Use NDJSON (newline-delimited JSON) for resilience to interruption
    for (let currentOffset = safeOffset; currentOffset < safeOffset + safeLimit; currentOffset += AUDIT_EXPORT_BATCH_SIZE) {
      if (signal?.aborted) break;
      const batchLimit = Math.min(AUDIT_EXPORT_BATCH_SIZE, safeOffset + safeLimit - currentOffset);
      const params = [...baseParams, batchLimit, currentOffset];
      const result = await dependencies.query<AuditLogRow>(
        `SELECT a.id, a.admin_id, a.action, a.target_type, a.target_id, a.metadata,
                a.ip_address, a.user_agent, a.created_at, u.username AS admin_username
         FROM zunari_admin_audit_log a
         LEFT JOIN zunari_users u ON u.public_id = a.admin_id
         ${whereClause}
         ORDER BY a.created_at ${sortDirection}, a.id ${sortDirection}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        params,
      );
      for (const log of result.rows) {
        yield JSON.stringify({
          id: log.id,
          admin_id: log.admin_id,
          admin_username: log.admin_username,
          action: log.action,
          target_type: log.target_type,
          target_id: log.target_id,
          metadata: log.metadata,
          ip_address: log.ip_address,
          user_agent: log.user_agent,
          created_at: new Date(Number(log.created_at)).toISOString(),
        }) + '\n';
      }
      if (result.rows.length < batchLimit) break;
    }
  } else {
    // CSV streaming
    yield AUDIT_EXPORT_CSV_HEADERS.join(',') + '\n';
    for (let currentOffset = safeOffset; currentOffset < safeOffset + safeLimit; currentOffset += AUDIT_EXPORT_BATCH_SIZE) {
      if (signal?.aborted) break;
      const batchLimit = Math.min(AUDIT_EXPORT_BATCH_SIZE, safeOffset + safeLimit - currentOffset);
      const params = [...baseParams, batchLimit, currentOffset];
      const result = await dependencies.query<AuditLogRow>(
        `SELECT a.id, a.admin_id, a.action, a.target_type, a.target_id, a.metadata,
                a.ip_address, a.user_agent, a.created_at, u.username AS admin_username
         FROM zunari_admin_audit_log a
         LEFT JOIN zunari_users u ON u.public_id = a.admin_id
         ${whereClause}
         ORDER BY a.created_at ${sortDirection}, a.id ${sortDirection}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        params,
      );
      for (const log of result.rows) {
        yield formatAuditCsvRow(log) + '\n';
      }
      if (result.rows.length < batchLimit) break;
    }
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const pgError = error as { code?: unknown; constraint?: unknown };
  return pgError.code === '23505' && pgError.constraint === constraint;
}

export async function createUserReport(
  reporterId: string,
  reportedUserId: string,
  reason: string,
  details: string | null,
  req?: { socket?: { remoteAddress?: string }; headers?: { 'user-agent'?: string } },
): Promise<AdminReportRow> {
  const now = Date.now();
  const reportId = `report_${randomUUID().slice(0, 12)}`;

  let reporterUsername = '';
  let reportedUsername = '';

  try {
    await withTransaction(async (connection) => {
      // Fetch usernames inside transaction with FOR SHARE to prevent race conditions
      const [reporter, reportedUser] = await Promise.all([
        connection.query<{ username: string }>(
          'SELECT username FROM zunari_users WHERE public_id = $1 FOR SHARE',
          [reporterId],
        ),
        connection.query<{ username: string }>(
          'SELECT username FROM zunari_users WHERE public_id = $1 FOR SHARE',
          [reportedUserId],
        ),
      ]);

      if (!reporter.rows[0] || !reportedUser.rows[0]) {
        throw new HttpError(404, 'Reporter or reported user not found.', 'USER_NOT_FOUND');
      }

      reporterUsername = reporter.rows[0].username;
      reportedUsername = reportedUser.rows[0].username;

      await connection.query(
        `INSERT INTO zunari_user_reports
           (id, reporter_id, reported_user_id, reason, details, status, created_at,
            reporter_id_snapshot, reported_user_id_snapshot,
            reporter_username_snapshot, reported_username_snapshot)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)`,
        [
          reportId,
          reporterId,
          reportedUserId,
          reason,
          details,
          now,
          reporterId,
          reportedUserId,
          reporterUsername,
          reportedUsername,
        ],
      );

      await connection.query(
        `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          `audit_${randomUUID()}`,
          reporterId,
          'report.user.create',
          'user_report',
          reportId,
          JSON.stringify({ reason, details, reported_user_id: reportedUserId }),
          req?.socket?.remoteAddress || null,
          req?.headers?.['user-agent'] || null,
          now,
        ],
      );
    });
  } catch (error) {
    if (isUniqueViolation(error, 'zunari_user_reports_unique_active')) {
      throw new HttpError(409, 'You have already reported this user.', 'DUPLICATE_REPORT');
    }
    throw error;
  }

  return {
    id: reportId,
    type: 'user',
    reporter_id: reporterId,
    reporter_username: reporterUsername!,
    reported_user_id: reportedUserId,
    reported_username: reportedUsername,
    post_id: null,
    post_preview: null,
    reason,
    details,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    created_at: now,
  };
}

export async function createPostReport(
  reporterId: string,
  postId: string,
  reason: string,
  details: string | null,
  req?: { socket?: { remoteAddress?: string }; headers?: { 'user-agent'?: string } },
): Promise<AdminReportRow> {
  const now = Date.now();
  const reportId = `report_${randomUUID().slice(0, 12)}`;

  let reporterUsername = '';
  let postPreview = '';

  try {
    await withTransaction(async (connection) => {
      // Fetch reporter username and post content inside transaction with FOR SHARE
      const [reporter, post] = await Promise.all([
        connection.query<{ username: string }>(
          'SELECT username FROM zunari_users WHERE public_id = $1 FOR SHARE',
          [reporterId],
        ),
        connection.query<{ content: string; author_id: string }>(
          'SELECT content, author_id FROM zunari_posts WHERE id = $1 FOR SHARE',
          [postId],
        ),
      ]);

      if (!reporter.rows[0] || !post.rows[0]) {
        throw new HttpError(404, 'Reporter or post not found.', 'POST_NOT_FOUND');
      }

      reporterUsername = reporter.rows[0].username;
      postPreview = post.rows[0].content.slice(0, 100);

      await connection.query(
        `INSERT INTO zunari_post_reports
           (id, reporter_id, post_id, reason, details, status, created_at,
            reporter_id_snapshot, post_id_snapshot,
            reporter_username_snapshot, post_preview_snapshot)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)`,
        [
          reportId,
          reporterId,
          postId,
          reason,
          details,
          now,
          reporterId,
          postId,
          reporterUsername,
          postPreview,
        ],
      );

      await connection.query(
        `INSERT INTO zunari_admin_audit_log (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          `audit_${randomUUID()}`,
          reporterId,
          'report.post.create',
          'post_report',
          reportId,
          JSON.stringify({ reason, details, post_id: postId }),
          req?.socket?.remoteAddress || null,
          req?.headers?.['user-agent'] || null,
          now,
        ],
      );
    });
  } catch (error) {
    if (isUniqueViolation(error, 'zunari_post_reports_unique_active')) {
      throw new HttpError(409, 'You have already reported this post.', 'DUPLICATE_REPORT');
    }
    throw error;
  }

  return {
    id: reportId,
    type: 'post',
    reporter_id: reporterId,
    reporter_username: reporterUsername!,
    reported_user_id: null,
    reported_username: null,
    post_id: postId,
    post_preview: postPreview!,
    reason,
    details,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    created_at: now,
  };
}
