import { User } from '../types/index.ts';

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

export interface AdminUser {
  userId: number;
  username: string;
  email: string | null;
  adminRole: AdminRole;
  permissions: AdminPermissions;
  csrfToken: string;
  expiresAt: number;
}

export interface AdminSessionResponse {
  authenticated: boolean;
  userId?: number;
  username?: string;
  email?: string | null;
  adminRole?: AdminRole;
  permissions?: AdminPermissions;
  csrfToken?: string;
  expiresAt?: number;
}

export interface AdminLoginResponse {
  authenticated: boolean;
  adminRole: AdminRole;
  permissions: AdminPermissions;
  csrfToken: string;
  expiresAt: number;
  message: string;
}

export interface AdminStats {
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

export interface AdminPost {
  id: string;
  author_id: string;
  content: string;
  media_urls: string[];
  reply_to_post_id: string | null;
  quote_post_id: string | null;
  created_at: number;
  likes_count: number;
  reposts_count: number;
  replies_count: number;
  views_count: number;
  author_public_id: string;
  author_username: string;
  author_name: string;
  author_avatar_url: string;
  author_verified: boolean;
  author_is_gold: boolean;
}

export interface PaginatedPostsResponse {
  posts: AdminPost[];
  total: number;
}

export interface AdminReport {
  id: string;
  type: 'user' | 'post';
  reporter_id: string;
  reporter_username: string;
  reported_user_id?: string;
  reported_username?: string;
  post_id?: string;
  post_preview?: string;
  reason: string;
  details?: string;
  status: 'pending' | 'reviewed' | 'dismissed' | 'action_taken';
  reviewed_by?: string;
  reviewed_at?: number;
  created_at: number;
}

export interface PaginatedReportsResponse {
  reports: AdminReport[];
  total: number;
}

export interface ReportResolution {
  reportId: string;
  status: 'pending' | 'reviewed' | 'dismissed' | 'action_taken';
  note?: string;
}

export interface SecurityEvent {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  admin_username: string | null;
  created_at: number;
  metadata: Record<string, unknown>;
}

export interface PaginatedSecurityEventsResponse {
  events: SecurityEvent[];
  total: number;
}

export interface AdminUserListItem {
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

export interface AdminUserDetail {
  user: AdminUserListItem;
  sessionCount: number;
  postCount: number;
  reportCount: number;
  recentAuditLog: AdminAuditLogEntry[];
}

export interface AdminAuditLogEntry {
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

export interface PaginatedResponse<T> {
  users?: T[];
  logs?: T[];
  total: number;
}

export interface RolePermissions {
  role: AdminRole;
  permissions: Record<string, unknown>;
  description: string;
}

export interface AdminSessionInfo {
  id: string;
  admin_id: string;
  admin_username: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
  expires_at: number;
  last_activity_at: number;
}

class AdminApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

class AdminApiService {
  private csrfToken: string | null = null;
  private baseUrl: string;

  constructor() {
    this.baseUrl = this.getBackendApiUrl();
  }

  private getBackendApiUrl(): string {
    // Use VITE_ADMIN_API_URL if provided (for separate admin frontend deployment)
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_API_URL) {
      return import.meta.env.VITE_ADMIN_API_URL.replace(/\/$/, '');
    }
    // Fallback to same-origin for integrated deployment
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol;
      const host = window.location.host;
      console.warn('[AdminApi] VITE_ADMIN_API_URL not set, falling back to same-origin. This will fail for separate admin frontend deployment.');
      return `${protocol}//${host}`;
    }
    return 'http://localhost:3000';
  }

  public setCsrfToken(token: string | null) {
    this.csrfToken = token;
  }

  public getCsrfToken(): string | null {
    return this.csrfToken;
  }

  private async rawRequest<T>(endpoint: string, options: RequestInit = {}): Promise<{ data: T; response: Response }> {
    const targetUrl = `${this.baseUrl}/api${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const hasContentType = Object.keys(headers).some(k => k.toLowerCase() === 'content-type');
    const isFormData = options.body instanceof FormData;

    if (options.body !== undefined && !hasContentType && !isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    if (method !== 'GET' && method !== 'HEAD' && this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    const response = await fetch(targetUrl, {
      ...options,
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
    });

    // Detect HTML responses (indicates wrong base URL - serving SPA index.html instead of API)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new AdminApiError(
        'API request returned HTML instead of JSON. Check VITE_ADMIN_API_URL configuration - the admin frontend may be pointing to the wrong backend URL.',
        response.status,
        'HTML_RESPONSE'
      );
    }

    const data = await response.json().catch(() => ({} as T));
    return { data: data as T, response };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    let result = await this.rawRequest<T>(endpoint, options);
    const errorCode = (result.data as { code?: string } | null)?.code;

    if (
      result.response.status === 403 &&
      (errorCode === 'ADMIN_SESSION_REQUIRED' || errorCode === 'CSRF_INVALID' || errorCode === 'SESSION_REQUIRED')
    ) {
      await this.refreshSession();
      result = await this.rawRequest<T>(endpoint, options);
    }

    if (!result.response.ok) {
      const payload = result.data as { error?: string; code?: string } | null;
      throw new AdminApiError(
        payload?.error || `Request failed with status ${result.response.status}`,
        result.response.status,
        payload?.code,
      );
    }

    return result.data;
  }

  private rememberSession<T extends { csrfToken?: string }>(payload: T): T {
    if (payload.csrfToken) this.csrfToken = payload.csrfToken;
    return payload;
  }

  public async refreshSession(): Promise<AdminSessionResponse> {
    const result = await this.rawRequest<AdminSessionResponse>('/admin/me');
    if (!result.response.ok) {
      throw new AdminApiError('Unable to restore admin session.', result.response.status);
    }
    return this.rememberSession(result.data);
  }

  public async login(username: string, password: string): Promise<AdminLoginResponse> {
    const data = await this.request<AdminLoginResponse>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    // Validate required fields
    if (!data.authenticated || !data.adminRole || !data.permissions || !data.csrfToken) {
      throw new AdminApiError('Invalid login response from server - missing required fields.', 500, 'INVALID_LOGIN_RESPONSE');
    }
    return this.rememberSession(data);
  }

  public async logout(): Promise<{ success: boolean; message: string }> {
    const data = await this.request<{ success: boolean; message: string }>('/admin/logout', {
      method: 'POST',
      body: '{}',
    });
    this.csrfToken = null;
    return data;
  }

  public async getSession(): Promise<AdminSessionResponse> {
    try {
      const data = await this.request<AdminSessionResponse>('/admin/me');
      return this.rememberSession(data);
    } catch (err) {
      if (err instanceof AdminApiError) throw err;
      throw new AdminApiError('Unable to connect to admin service.', 0, 'ADMIN_CONNECTION_FAILED');
    }
  }

  public async getStats(): Promise<AdminStats> {
    return this.request<AdminStats>('/admin/stats');
  }

  public async getAdminPosts(params: {
    limit?: number;
    offset?: number;
    search?: string;
    sortBy?: 'created_at' | 'likes_count' | 'replies_count';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<PaginatedPostsResponse> {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    if (params.search) searchParams.set('search', params.search);
    if (params.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    const query = searchParams.toString();
    return this.request<PaginatedPostsResponse>(`/admin/posts${query ? `?${query}` : ''}`);
  }

  public async getSecurityEvents(params: {
    limit?: number;
    offset?: number;
    search?: string;
    adminId?: string;
    startDate?: number;
    endDate?: number;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<PaginatedSecurityEventsResponse> {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    if (params.search) searchParams.set('search', params.search);
    if (params.adminId) searchParams.set('adminId', params.adminId);
    if (params.startDate !== undefined) searchParams.set('startDate', String(params.startDate));
    if (params.endDate !== undefined) searchParams.set('endDate', String(params.endDate));
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    const query = searchParams.toString();
    return this.request<PaginatedSecurityEventsResponse>(`/admin/security-events${query ? `?${query}` : ''}`);
  }

  public async getUsers(params: {
    limit?: number;
    offset?: number;
    search?: string;
    role?: AdminRole;
    suspended?: boolean;
    sortBy?: 'created_at' | 'username' | 'last_admin_action_at';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ users: AdminUserListItem[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    if (params.search) searchParams.set('search', params.search);
    if (params.role) searchParams.set('role', params.role);
    if (params.suspended) searchParams.set('suspended', 'true');
    if (params.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    const query = searchParams.toString();
    return this.request<{ users: AdminUserListItem[]; total: number }>(`/admin/users${query ? `?${query}` : ''}`);
  }

  public async getUserDetail(publicId: string): Promise<AdminUserDetail> {
    return this.request<AdminUserDetail>(`/admin/users/${encodeURIComponent(publicId)}`);
  }

  public async updateUserRole(publicId: string, adminRole: AdminRole | null, confirmPassword?: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/admin/users/${encodeURIComponent(publicId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ adminRole, confirmPassword }),
    });
  }

  public async suspendUser(publicId: string, reason: string, confirmPassword?: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/admin/users/${encodeURIComponent(publicId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'suspend', reason, confirmPassword }),
    });
  }

  public async unsuspendUser(publicId: string, confirmPassword?: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/admin/users/${encodeURIComponent(publicId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'unsuspend', confirmPassword }),
    });
  }

  public async getAuditLog(params: {
    limit?: number;
    offset?: number;
    adminId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    startDate?: number;
    endDate?: number;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ logs: AdminAuditLogEntry[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    if (params.adminId) searchParams.set('adminId', params.adminId);
    if (params.action) searchParams.set('action', params.action);
    if (params.targetType) searchParams.set('targetType', params.targetType);
    if (params.targetId) searchParams.set('targetId', params.targetId);
    if (params.startDate) searchParams.set('startDate', String(params.startDate));
    if (params.endDate) searchParams.set('endDate', String(params.endDate));
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    const query = searchParams.toString();
    return this.request<{ logs: AdminAuditLogEntry[]; total: number }>(`/admin/audit-log${query ? `?${query}` : ''}`);
  }

  public async getRolePermissions(): Promise<RolePermissions[]> {
    const data = await this.request<{ permissions: RolePermissions[] }>('/admin/roles/permissions');
    return data.permissions;
  }

  public async updateRolePermissions(role: AdminRole, permissions: Record<string, unknown>, description: string, confirmPassword?: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>('/admin/roles/permissions', {
      method: 'PATCH',
      body: JSON.stringify({ role, permissions, description, confirmPassword }),
    });
  }

  public async getActiveSessions(): Promise<{ sessions: AdminSessionInfo[] }> {
    return this.request<{ sessions: AdminSessionInfo[] }>('/admin/sessions');
  }

  public async revokeSession(sessionId: string, confirmPassword?: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/admin/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmPassword }),
    });
  }

  public async revokeAllUserSessions(userId: string, confirmPassword?: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>('/admin/sessions/user', {
      method: 'DELETE',
      body: JSON.stringify({ userId, confirmPassword }),
    });
  }

  public async getReports(params: {
    limit?: number;
    offset?: number;
    type?: 'user' | 'post';
    status?: 'pending' | 'reviewed' | 'dismissed' | 'action_taken';
    search?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<PaginatedReportsResponse> {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    if (params.type) searchParams.set('type', params.type);
    if (params.status) searchParams.set('status', params.status);
    if (params.search) searchParams.set('search', params.search);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    const query = searchParams.toString();
    return this.request<PaginatedReportsResponse>(`/admin/reports${query ? `?${query}` : ''}`);
  }

  public async resolveReport(reportId: string, status: 'pending' | 'reviewed' | 'dismissed' | 'action_taken', note?: string): Promise<{ success: boolean; report: AdminReport }> {
    return this.request<{ success: boolean; report: AdminReport }>('/admin/reports', {
      method: 'PATCH',
      body: JSON.stringify({ reportId, status, note }),
    });
  }

  public async verifyUser(publicId: string, verified: boolean, confirmPassword?: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/admin/users/${encodeURIComponent(publicId)}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ verified, confirmPassword }),
    });
  }

  public async updateUserGold(publicId: string, isGold: boolean, confirmPassword?: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/admin/users/${encodeURIComponent(publicId)}/gold`, {
      method: 'PATCH',
      body: JSON.stringify({ isGold, confirmPassword }),
    });
  }

  public async createAdminUser(data: {
    username: string;
    email: string;
    password: string;
    name?: string;
    adminRole: AdminRole;
    confirmPassword: string;
  }): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async exportAuditLog(params: {
    format?: 'csv' | 'json';
    adminId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
    offset?: number;
    sortOrder?: 'asc' | 'desc';
    csrfToken: string;
    confirmPassword?: string;
  }): Promise<{ contentType: string; filename: string; data: string }> {
    const searchParams = new URLSearchParams();
    if (params.format) searchParams.set('format', params.format);
    if (params.adminId) searchParams.set('adminId', params.adminId);
    if (params.action) searchParams.set('action', params.action);
    if (params.targetType) searchParams.set('targetType', params.targetType);
    if (params.targetId) searchParams.set('targetId', params.targetId);
    if (params.startDate !== undefined) searchParams.set('startDate', String(params.startDate));
    if (params.endDate !== undefined) searchParams.set('endDate', String(params.endDate));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    const headers: Record<string, string> = {};
    const csrfToken = params.csrfToken || this.csrfToken;
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (params.confirmPassword) headers['X-Admin-Confirm-Password'] = params.confirmPassword;

    const query = searchParams.toString();
    return this.request<{ contentType: string; filename: string; data: string }>(
      `/admin/audit-log/export${query ? `?${query}` : ''}`,
      { headers },
    );
  }
}

export const adminApi = new AdminApiService();