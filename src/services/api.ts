import { Post, User, Notification, Message, TrendItem, AppConfig, CDNInfo, BackendCodeFile } from '../types/index.ts';
import { getBackendApiUrl } from '../config/backendUrl.ts';

class ApiService {
  private currentUserId = 'user_mukit';
  private authToken: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem('vyora_auth_token') : null;

  public setCurrentUserId(id: string) {
    this.currentUserId = id;
  }

  public setAuthToken(token: string | null) {
    this.authToken = token;
    if (typeof localStorage !== 'undefined') {
      if (token) {
        localStorage.setItem('vyora_auth_token', token);
      } else {
        localStorage.removeItem('vyora_auth_token');
      }
    }
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const backendUrl = getBackendApiUrl();
    const targetUrl = `${backendUrl}/api${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-user-id': this.currentUserId,
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
      headers['x-auth-token'] = this.authToken;
    }

    const res = await fetch(targetUrl, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Request failed with status ${res.status}`);
    }

    return res.json();
  }

  // --- Backend-Controlled Authentication APIs ---
  public async login(username: string, password?: string): Promise<{ success: boolean; token: string; user: User }> {
    const res = await this.request<{ success: boolean; token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (res.token) {
      this.setAuthToken(res.token);
      this.setCurrentUserId(res.user.id);
    }
    return res;
  }

  public async register(data: {
    username: string;
    name: string;
    password?: string;
    avatarUrl?: string;
    bio?: string;
  }): Promise<{ success: boolean; token: string; user: User }> {
    const res = await this.request<{ success: boolean; token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.token) {
      this.setAuthToken(res.token);
      this.setCurrentUserId(res.user.id);
    }
    return res;
  }

  public async getSession(): Promise<{ authenticated: boolean; user?: User; token?: string }> {
    return this.request<{ authenticated: boolean; user?: User; token?: string }>('/auth/session');
  }

  public async logout(): Promise<{ success: boolean }> {
    try {
      await this.request<{ success: boolean }>('/auth/logout', { method: 'POST' });
    } finally {
      this.setAuthToken(null);
    }
    return { success: true };
  }

  public async getDemoAccounts(): Promise<{ accounts: Array<User & { defaultPassword?: string }> }> {
    return this.request<{ accounts: Array<User & { defaultPassword?: string }> }>('/auth/demo-accounts');
  }

  // Config & System
  public getConfig(): Promise<AppConfig> {
    return this.request<AppConfig>('/config');
  }

  public getCdnHealth(): Promise<{ cdns: CDNInfo[] }> {
    return this.request<{ cdns: CDNInfo[] }>('/cdn/health');
  }


  public getBackendCode(): Promise<{ files: BackendCodeFile[] }> {
    return this.request<{ files: BackendCodeFile[] }>('/backend-code');
  }

  // Media & File Storage (Backend manages storage and provides file URLs)
  public async uploadFile(file: File): Promise<{
    success: boolean;
    fileId: string;
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    return this.request<{
      success: boolean;
      fileId: string;
      url: string;
      filename: string;
      mimeType: string;
      size: number;
    }>('/upload', {
      method: 'POST',
      body: JSON.stringify({
        data: dataUrl,
        filename: file.name,
        mimeType: file.type,
      }),
    });
  }

  public getMediaCatalog(): Promise<{
    avatars: string[];
    attachments: string[];
    cdns: string[];
  }> {
    return this.request<{
      avatars: string[];
      attachments: string[];
      cdns: string[];
    }>('/media/catalog');
  }

  public resolveFileUrl(urlOrPath: string): string {
    if (!urlOrPath) return '';
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://') || urlOrPath.startsWith('data:')) {
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

  // Messages
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
