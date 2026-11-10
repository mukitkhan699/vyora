import { Post, User, Notification, Message, Conversation, TrendItem, AppConfig, CallSession } from '../types/index.ts';
import { getBackendApiUrl } from '../config/backendUrl.ts';

export interface AuthUser extends User {
  email?: string | null;
  emailVerified?: boolean;
  createdAt?: number;
}

export interface AuthResponse {
  authenticated: boolean;
  user: AuthUser | null;
  csrfToken?: string;
  expiresAt?: number;
  requireEmailVerification?: boolean;
  emailVerificationRequired?: boolean;
  email?: string;
  message?: string;
}

class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const UPLOAD_ERROR_DETAIL_LIMIT = 200;

function sanitizeUploadErrorDetail(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, UPLOAD_ERROR_DETAIL_LIMIT);
}

function describeUploadFailure(status: number, body: string): string {
  const trimmed = body.trim();
  let code = '';
  let message = '';

  if (trimmed) {
    try {
      const payload = JSON.parse(trimmed) as {
        Code?: unknown;
        code?: unknown;
        Message?: unknown;
        message?: unknown;
        error?: unknown;
      };
      const rawCode = payload.Code ?? payload.code;
      const rawMessage = payload.Message ?? payload.message ?? payload.error;
      if (typeof rawCode === 'string') code = sanitizeUploadErrorDetail(rawCode);
      if (typeof rawMessage === 'string') message = sanitizeUploadErrorDetail(rawMessage);
    } catch {
      const codeMatch = /<Code>([^<]{1,200})<\/Code>/i.exec(trimmed);
      const messageMatch = /<Message>([^<]{1,200})<\/Message>/i.exec(trimmed);
      if (codeMatch) code = sanitizeUploadErrorDetail(codeMatch[1]);
      if (messageMatch) message = sanitizeUploadErrorDetail(messageMatch[1]);
    }
  }

  const detail = [code, message].filter(Boolean).join(': ');
  return detail
    ? `Media upload failed (${status}): ${detail}`
    : `Media upload failed (${status}).`;
}

class ApiService {
  private csrfToken: string | null = null;
  private refreshing: Promise<AuthResponse> | null = null;

  public setCsrfToken(token: string | null) {
    this.csrfToken = token;
  }

  public getCsrfToken(): string | null {
    return this.csrfToken;
  }

  private async rawRequest<T>(endpoint: string, options: RequestInit = {}): Promise<{ data: T; response: Response }> {
    const backendUrl = getBackendApiUrl();
    const targetUrl = `${backendUrl}/api${endpoint}`;
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
      credentials: 'same-origin',
      cache: 'no-store',
    });

    const data = await response.json().catch(() => ({} as T));
    return { data: data as T, response };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    let result = await this.rawRequest<T>(endpoint, options);
    const errorCode = (result.data as { code?: string } | null)?.code;

    if (
      result.response.status === 403 &&
      (errorCode === 'SESSION_REQUIRED' || errorCode === 'CSRF_INVALID')
    ) {
      await this.refreshSession();
      result = await this.rawRequest<T>(endpoint, options);
    }

    if (!result.response.ok) {
      const payload = result.data as { error?: string; code?: string } | null;
      throw new ApiError(
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

  public async refreshSession(): Promise<AuthResponse> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.rawRequest<AuthResponse>('/auth/session')
      .then(({ data, response }) => {
        if (!response.ok) {
          throw new ApiError('Unable to start a secure session.', response.status);
        }
        return this.rememberSession(data);
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  // --- Authentication ---
  public async login(username: string, password: string): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    return this.rememberSession(data);
  }

  public async register(data: {
    username: string;
    name?: string;
    email: string;
    password: string;
    avatarUrl?: string;
    bio?: string;
  }): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: data.username,
        email: data.email,
        password: data.password,
      }),
    });
    return this.rememberSession(res);
  }

  public async getSession(): Promise<AuthResponse> {
    try {
      const data = await this.request<AuthResponse>('/auth/session');
      return this.rememberSession(data);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('Unable to connect to authentication service.', 0, 'AUTH_CONNECTION_FAILED');
    }
  }

  public async logout(): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/logout', { method: 'POST', body: '{}' });
    return this.rememberSession(data);
  }

  public async forgotPassword(email: string): Promise<{ sent: boolean; message: string }> {
    return this.request<{ sent: boolean; message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  public async resetPassword(token: string, password: string): Promise<{
    reset: boolean;
    message: string;
    csrfToken?: string;
    expiresAt?: number;
  }> {
    const data = await this.request<{
      reset: boolean;
      message: string;
      csrfToken?: string;
      expiresAt?: number;
    }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    return this.rememberSession(data);
  }

  public async changePassword(currentPassword: string, newPassword: string): Promise<{
    changed: boolean;
    message: string;
    csrfToken?: string;
    expiresAt?: number;
  }> {
    const data = await this.request<{
      changed: boolean;
      message: string;
      csrfToken?: string;
      expiresAt?: number;
    }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return this.rememberSession(data);
  }

  public async resendVerification(email?: string, username?: string): Promise<{ sent: boolean; message: string }> {
    return this.request<{ sent: boolean; message: string }>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email, username }),
    });
  }

  public async getDemoAccounts(): Promise<{ accounts: Array<User & { defaultPassword?: string }> }> {
    return this.request<{ accounts: Array<User & { defaultPassword?: string }> }>('/auth/demo-accounts');
  }

  // Config & System
  public getConfig(): Promise<AppConfig> {
    return this.request<AppConfig>('/config');
  }

  // Media & File Storage
  public async uploadFile(
    file: File,
    purpose: 'profile-avatar' | 'profile-cover' | 'post-image' | 'message-attachment' = 'post-image',
    options: {
      onProgress?: (percent: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<{
    success: boolean;
    fileId: string;
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    if (options.signal?.aborted) {
      throw new DOMException('Upload cancelled.', 'AbortError');
    }

    const res = await this.request<{
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }>('/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        purpose,
      }),
    });

    const abortUpload = async () => {
      try {
        await this.request(`/uploads/${res.fileId}/abort`, {
          method: 'POST',
          body: '{}',
        });
      } catch {
        // The server reconciliation sweep also removes abandoned uploads.
      }
    };

    let status = 0;
    let errorBody = '';
    try {
      status = await new Promise<number>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let settled = false;
        let abortedBySignal = false;

        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          options.signal?.removeEventListener('abort', onAbort);
          fn();
        };

        const onAbort = () => {
          abortedBySignal = true;
          xhr.abort();
        };

        xhr.open('PUT', res.uploadUrl, true);
        for (const [header, value] of Object.entries(res.headers)) {
          xhr.setRequestHeader(header, value);
        }
        xhr.withCredentials = false;

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            options.onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            options.onProgress?.(100);
            settle(() => resolve(xhr.status));
          } else {
            errorBody = xhr.responseText || '';
            settle(() => resolve(xhr.status));
          }
        };

        xhr.onerror = () => {
          settle(() => reject(new ApiError('Network error uploading media. Check your connection.', 502)));
        };

        xhr.onabort = () => {
          settle(() =>
            reject(
              new DOMException(
                abortedBySignal ? 'Upload cancelled.' : 'Network error uploading media.',
                abortedBySignal ? 'AbortError' : 'NetworkError',
              ),
            ),
          );
        };

        xhr.ontimeout = () => {
          settle(() => reject(new ApiError('The media upload timed out. Please try again.', 504)));
        };

        if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
        xhr.send(file);
      });
    } catch (networkError) {
      await abortUpload();
      if (networkError instanceof DOMException && networkError.name === 'AbortError') {
        throw networkError;
      }
      if (networkError instanceof ApiError) throw networkError;
      throw new ApiError('Network error uploading media. Check your connection.', 502);
    }

    if (status < 200 || status >= 300) {
      await abortUpload();
      throw new ApiError(describeUploadFailure(status, errorBody), status);
    }

    try {
      return await this.request<{
        success: boolean;
        fileId: string;
        url: string;
        filename: string;
        mimeType: string;
        size: number;
      }>(`/uploads/${res.fileId}/complete`, {
        method: 'POST',
        body: '{}',
      });
    } catch (error) {
      await abortUpload();
      throw error;
    }
  }

  public getMediaCatalog(): Promise<{
    avatars: string[];
    attachments: string[];
  }> {
    return this.request<{
      avatars: string[];
      attachments: string[];
    }>('/media/catalog');
  }

  public resolveFileUrl(urlOrPath: string): string {
    if (!urlOrPath) return '';
    if (
      urlOrPath.startsWith('http://') ||
      urlOrPath.startsWith('https://') ||
      urlOrPath.startsWith('data:') ||
      urlOrPath.startsWith('blob:')
    ) {
      return urlOrPath;
    }
    const backendUrl = getBackendApiUrl();
    const clean = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
    return `${backendUrl}${clean}`;
  }

  // Posts
  public getPosts(feedType: 'for-you' | 'following' = 'for-you', authorId?: string): Promise<Post[]> {
    const params = new URLSearchParams({ feed: feedType });
    if (authorId) params.append('authorId', authorId);
    return this.request<Post[]>(`/posts?${params.toString()}`);
  }

  public getPostById(id: string): Promise<{ post: Post; replies: Post[] }> {
    return this.request<{ post: Post; replies: Post[] }>(`/posts/${id}`);
  }

  public createPost(data: {
    content: string;
    mediaUrls?: string[];
    pollOptions?: string[];
    replyToId?: string;
    quotePostId?: string;
  }): Promise<Post> {
    return this.request<Post>('/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public deletePost(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/posts/${id}`, {
      method: 'DELETE',
    });
  }

  public toggleLike(postId: string): Promise<{ isLiked: boolean; likesCount: number }> {
    return this.request<{ isLiked: boolean; likesCount: number }>(`/posts/${postId}/like`, {
      method: 'POST',
    });
  }

  public toggleRepost(postId: string): Promise<{ isReposted: boolean; repostsCount: number }> {
    return this.request<{ isReposted: boolean; repostsCount: number }>(`/posts/${postId}/repost`, {
      method: 'POST',
    });
  }

  public toggleBookmark(postId: string): Promise<{ isBookmarked: boolean }> {
    return this.request<{ isBookmarked: boolean }>(`/posts/${postId}/bookmark`, {
      method: 'POST',
    });
  }

  public votePoll(postId: string, optionIndex: number): Promise<Post> {
    return this.request<Post>(`/posts/${postId}/poll/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIndex }),
    });
  }

  // Users
  public getUsers(): Promise<User[]> {
    return this.request<User[]>('/users');
  }

  public getUserByUsername(username: string): Promise<User & { isFollowing?: boolean }> {
    return this.request<User & { isFollowing?: boolean }>(`/users/${encodeURIComponent(username)}`);
  }

  public updateProfile(data: Partial<User>): Promise<User> {
    return this.request<User>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public toggleFollow(userId: string): Promise<{ isFollowing: boolean; targetUser: User }> {
    return this.request<{ isFollowing: boolean; targetUser: User }>(`/users/${userId}/follow`, {
      method: 'POST',
    });
  }

  // Bookmarks
  public getBookmarks(): Promise<Post[]> {
    return this.request<Post[]>('/bookmarks');
  }

  // Notifications
  public getNotifications(): Promise<Notification[]> {
    return this.request<Notification[]>('/notifications');
  }

  public markNotificationsRead(): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/notifications/read-all', {
      method: 'POST',
    });
  }

  // Messages & Conversations (v2)
  public getConversations(): Promise<{ conversations: Conversation[] }> {
    return this.request<{ conversations: Conversation[] }>('/conversations');
  }

  public createConversation(data: {
    type: 'direct' | 'group';
    recipientId?: string;
    title?: string;
    participantIds?: string[];
    avatarUrl?: string;
  }): Promise<{ conversation: Conversation }> {
    return this.request<{ conversation: Conversation }>('/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public getConversation(id: string): Promise<{ conversation: Conversation }> {
    return this.request<{ conversation: Conversation }>(`/conversations/${id}`);
  }

  public updateConversation(
    id: string,
    data: { title?: string; avatarUrl?: string },
  ): Promise<{ conversation: Conversation }> {
    return this.request<{ conversation: Conversation }>(`/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public addParticipants(id: string, userIds: string[]): Promise<{ participants: any[] }> {
    return this.request<{ participants: any[] }>(`/conversations/${id}/participants`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  }

  public removeParticipant(id: string, userId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/conversations/${id}/participants/${userId}`, {
      method: 'DELETE',
    });
  }

  public getConversationMessages(
    id: string,
    before?: string,
    limit?: number,
  ): Promise<{ messages: Message[] }> {
    const params = new URLSearchParams();
    if (before) params.append('before', before);
    if (limit) params.append('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ messages: Message[] }>(`/conversations/${id}/messages${qs}`);
  }

  public sendConversationMessage(
    id: string,
    data: {
      text?: string;
      clientId?: string;
      replyToMessageId?: string;
      attachmentAssetIds?: string[];
    },
  ): Promise<{ message: Message }> {
    return this.request<{ message: Message }>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public editConversationMessage(
    conversationId: string,
    messageId: string,
    text: string,
  ): Promise<{ message: Message }> {
    return this.request<{ message: Message }>(`/conversations/${conversationId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    });
  }

  public deleteConversationMessage(
    conversationId: string,
    messageId: string,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/conversations/${conversationId}/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  public toggleMessageReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ added: boolean; emoji: string }> {
    return this.request<{ added: boolean; emoji: string }>(
      `/conversations/${conversationId}/messages/${messageId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      },
    );
  }

  public sendReceipts(
    conversationId: string,
    type: 'delivered' | 'read',
    messageIds: string[],
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/conversations/${conversationId}/receipts`, {
      method: 'POST',
      body: JSON.stringify({ type, messageIds }),
    });
  }

  // Calls (existing LiveKit-backed signaling)
  public initiateCall(
    conversationId: string,
    type: 'voice' | 'video',
  ): Promise<{ call: CallSession; token: string; livekitUrl: string }> {
    return this.request<{ call: CallSession; token: string; livekitUrl: string }>('/calls/initiate', {
      method: 'POST',
      body: JSON.stringify({ conversationId, type }),
    });
  }

  public respondToCall(
    callId: string,
    action: 'accept' | 'reject',
  ): Promise<{ call: CallSession; token?: string; livekitUrl?: string }> {
    return this.request<{ call: CallSession; token?: string; livekitUrl?: string }>(
      `/calls/${encodeURIComponent(callId)}/respond`,
      {
        method: 'POST',
        body: JSON.stringify({ action }),
      },
    );
  }

  public endCall(callId: string): Promise<{ call: CallSession }> {
    return this.request<{ call: CallSession }>(`/calls/${encodeURIComponent(callId)}/end`, {
      method: 'POST',
      body: '{}',
    });
  }

  // Legacy Direct Messages fallback
  public getMessages(recipientId: string): Promise<Message[]> {
    return this.request<Message[]>(`/messages/${recipientId}`);
  }

  public sendMessage(recipientId: string, text: string): Promise<Message> {
    return this.request<Message>('/messages', {
      method: 'POST',
      body: JSON.stringify({ recipientId, text }),
    });
  }

  // Trends
  public getTrends(): Promise<TrendItem[]> {
    return this.request<TrendItem[]>('/trends');
  }
}

export const api = new ApiService();
