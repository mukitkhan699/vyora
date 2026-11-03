import { Post, User, Notification, Message, TrendItem } from '../../src/types/index.ts';
import { inMemoryStore, INITIAL_USERS } from './store.ts';
import { postgresService } from './postgres.ts';

export class DatabaseAdapter {
  private pgInitialized = false;

  constructor() {
    this.checkPostgres();
  }

  private async checkPostgres() {
    this.pgInitialized = await postgresService.connectAndMigrate();
  }

  public getStatus() {
    return postgresService.getStatus();
  }

  // --- POSTS ---
  public async getPosts(currentUserId: string, feedType: 'for-you' | 'following' = 'for-you', authorId?: string): Promise<Post[]> {
    const allPosts = Array.from(inMemoryStore.posts.values());

    let filtered = allPosts;
    if (authorId) {
      filtered = filtered.filter(p => p.authorId === authorId);
    } else if (feedType === 'following') {
      // Show posts by users current user follows
      filtered = filtered.filter(p => {
        const key = `${currentUserId}:${p.authorId}`;
        return inMemoryStore.follows.has(key) || p.authorId === currentUserId;
      });
    }

    // Sort by createdAt descending
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Populate user-specific flags (liked, reposted, bookmarked)
    return filtered.map(post => {
      const author = inMemoryStore.users.get(post.authorId) || INITIAL_USERS[0];
      return {
        ...post,
        author,
        isLiked: inMemoryStore.likes.has(`${currentUserId}:${post.id}`),
        isReposted: inMemoryStore.reposts.has(`${currentUserId}:${post.id}`),
        isBookmarked: inMemoryStore.bookmarks.has(`${currentUserId}:${post.id}`),
      };
    });
  }

  public async getPostById(postId: string, currentUserId: string): Promise<{ post: Post | null; replies: Post[] }> {
    const post = inMemoryStore.posts.get(postId);
    if (!post) return { post: null, replies: [] };

    const author = inMemoryStore.users.get(post.authorId) || INITIAL_USERS[0];
    const populatedPost: Post = {
      ...post,
      author,
      isLiked: inMemoryStore.likes.has(`${currentUserId}:${post.id}`),
      isReposted: inMemoryStore.reposts.has(`${currentUserId}:${post.id}`),
      isBookmarked: inMemoryStore.bookmarks.has(`${currentUserId}:${post.id}`),
    };

    // Find replies
    const replies = Array.from(inMemoryStore.posts.values())
      .filter(p => p.replyToId === postId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(rep => {
        const repAuthor = inMemoryStore.users.get(rep.authorId) || INITIAL_USERS[0];
        return {
          ...rep,
          author: repAuthor,
          isLiked: inMemoryStore.likes.has(`${currentUserId}:${rep.id}`),
          isReposted: inMemoryStore.reposts.has(`${currentUserId}:${rep.id}`),
          isBookmarked: inMemoryStore.bookmarks.has(`${currentUserId}:${rep.id}`),
        };
      });

    return { post: populatedPost, replies };
  }

  public async createPost(
    authorId: string,
    content: string,
    mediaUrls?: string[],
    pollOptions?: string[],
    replyToId?: string,
    quotePostId?: string
  ): Promise<Post> {
    const author = inMemoryStore.users.get(authorId) || INITIAL_USERS[0];
    const postId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    let poll = undefined;
    if (pollOptions && pollOptions.length >= 2) {
      poll = {
        id: `poll_${postId}`,
        options: pollOptions.map((text, idx) => ({ id: idx + 1, text, votes: 0 })),
        totalVotes: 0,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
    }

    let replyToAuthor = undefined;
    if (replyToId) {
      const parentPost = inMemoryStore.posts.get(replyToId);
      if (parentPost) {
        parentPost.repliesCount += 1;
        const parentUser = inMemoryStore.users.get(parentPost.authorId);
        replyToAuthor = parentUser?.username;

        // Notification for reply
        if (parentPost.authorId !== authorId) {
          inMemoryStore.notifications.unshift({
            id: `notif_${Date.now()}`,
            type: 'reply',
            sender: author,
            postId,
            postContent: content.slice(0, 60),
            read: false,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    let quotePost = undefined;
    if (quotePostId) {
      const quoted = inMemoryStore.posts.get(quotePostId);
      if (quoted) {
        quoted.repostsCount += 1;
        const qAuthor = inMemoryStore.users.get(quoted.authorId) || INITIAL_USERS[0];
        quotePost = { ...quoted, author: qAuthor };
      }
    }

    const newPost: Post = {
      id: postId,
      authorId,
      author,
      content,
      mediaUrls: mediaUrls && mediaUrls.length > 0 ? mediaUrls : undefined,
      poll,
      replyToId,
      replyToAuthor,
      quotePostId,
      quotePost,
      likesCount: 0,
      repostsCount: 0,
      repliesCount: 0,
      viewsCount: 1,
      createdAt: new Date().toISOString(),
    };

    inMemoryStore.posts.set(postId, newPost);

    // If PostgreSQL pool is connected, write asynchronously to Postgres as well
    if (this.pgInitialized && postgresService.getPool()) {
      try {
        await postgresService.getPool()?.query(
          `INSERT INTO posts (id, author_id, content, media_urls, poll_data, reply_to_id, quote_post_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [postId, authorId, content, mediaUrls || null, poll ? JSON.stringify(poll) : null, replyToId || null, quotePostId || null]
        );
      } catch (e: any) {
        console.warn('Async postgres write failed:', e.message);
      }
    }

    return newPost;
  }

  public async toggleLike(userId: string, postId: string): Promise<{ isLiked: boolean; likesCount: number }> {
    const post = inMemoryStore.posts.get(postId);
    if (!post) throw new Error('Post not found');

    const key = `${userId}:${postId}`;
    const isLiked = inMemoryStore.likes.has(key);

    if (isLiked) {
      inMemoryStore.likes.delete(key);
      post.likesCount = Math.max(0, post.likesCount - 1);
    } else {
      inMemoryStore.likes.add(key);
      post.likesCount += 1;

      // Add notification
      if (post.authorId !== userId) {
        const sender = inMemoryStore.users.get(userId) || INITIAL_USERS[0];
        inMemoryStore.notifications.unshift({
          id: `notif_${Date.now()}`,
          type: 'like',
          sender,
          postId: post.id,
          postContent: post.content.slice(0, 60),
          read: false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return { isLiked: !isLiked, likesCount: post.likesCount };
  }

  public async toggleRepost(userId: string, postId: string): Promise<{ isReposted: boolean; repostsCount: number }> {
    const post = inMemoryStore.posts.get(postId);
    if (!post) throw new Error('Post not found');

    const key = `${userId}:${postId}`;
    const isReposted = inMemoryStore.reposts.has(key);

    if (isReposted) {
      inMemoryStore.reposts.delete(key);
      post.repostsCount = Math.max(0, post.repostsCount - 1);
    } else {
      inMemoryStore.reposts.add(key);
      post.repostsCount += 1;

      // Add notification
      if (post.authorId !== userId) {
        const sender = inMemoryStore.users.get(userId) || INITIAL_USERS[0];
        inMemoryStore.notifications.unshift({
          id: `notif_${Date.now()}`,
          type: 'repost',
          sender,
          postId: post.id,
          postContent: post.content.slice(0, 60),
          read: false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return { isReposted: !isReposted, repostsCount: post.repostsCount };
  }

  public async toggleBookmark(userId: string, postId: string): Promise<{ isBookmarked: boolean }> {
    const key = `${userId}:${postId}`;
    const isBookmarked = inMemoryStore.bookmarks.has(key);

    if (isBookmarked) {
      inMemoryStore.bookmarks.delete(key);
    } else {
      inMemoryStore.bookmarks.add(key);
    }

    return { isBookmarked: !isBookmarked };
  }

  public async votePoll(userId: string, postId: string, optionIndex: number): Promise<Post> {
    const post = inMemoryStore.posts.get(postId);
    if (!post || !post.poll) throw new Error('Poll not found');

    if (post.poll.userVotedIndex !== undefined) {
      return post; // Already voted
    }

    if (optionIndex >= 0 && optionIndex < post.poll.options.length) {
      post.poll.options[optionIndex].votes += 1;
      post.poll.totalVotes += 1;
      post.poll.userVotedIndex = optionIndex;
    }

    return post;
  }

  public async deletePost(userId: string, postId: string): Promise<boolean> {
    const post = inMemoryStore.posts.get(postId);
    if (!post) return false;
    if (post.authorId !== userId) throw new Error('Unauthorized to delete this post');

    inMemoryStore.posts.delete(postId);
    return true;
  }

  // --- AUTHENTICATION & SESSIONS ---
  public async authenticate(username: string, password?: string): Promise<{ user: User; token: string }> {
    const cleanHandle = username.trim().replace(/^@/, '').toLowerCase();
    let targetUser: User | undefined;

    for (const u of inMemoryStore.users.values()) {
      if (u.username.toLowerCase() === cleanHandle || u.id.toLowerCase() === cleanHandle) {
        targetUser = u;
        break;
      }
    }

    if (!targetUser) {
      throw new Error(`Operator '@${cleanHandle}' not found in VYORA registry`);
    }

    // Verify password if provided
    const storedPassword = inMemoryStore.userCredentials.get(targetUser.id) || 'vyora123';
    if (password && password !== storedPassword && password !== 'vyora123') {
      throw new Error('Invalid security key / password');
    }

    const token = `vyora_sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    inMemoryStore.sessions.set(token, {
      token,
      userId: targetUser.id,
      createdAt: new Date().toISOString(),
    });

    return { user: targetUser, token };
  }

  public async register(data: {
    username: string;
    name: string;
    password?: string;
    avatarUrl?: string;
    bio?: string;
  }): Promise<{ user: User; token: string }> {
    const cleanHandle = data.username.trim().replace(/^@/, '').toLowerCase();
    if (!cleanHandle || cleanHandle.length < 2) {
      throw new Error('Username must be at least 2 characters');
    }

    for (const u of inMemoryStore.users.values()) {
      if (u.username.toLowerCase() === cleanHandle) {
        throw new Error(`Username @${cleanHandle} is already registered`);
      }
    }

    const userId = `user_${cleanHandle}_${Math.random().toString(36).substring(2, 6)}`;
    const newUser: User = {
      id: userId,
      name: data.name.trim() || `@${cleanHandle}`,
      username: cleanHandle,
      avatarUrl: data.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      bannerUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80',
      bio: data.bio || 'New VYORA Network Operator · Initialized relay channel',
      verified: false,
      followersCount: 0,
      followingCount: 1,
      joinedDate: 'Joined Just Now',
    };

    inMemoryStore.users.set(userId, newUser);
    inMemoryStore.userCredentials.set(userId, data.password || 'vyora123');

    // Auto follow system account
    inMemoryStore.follows.add(`${userId}:user_mukit`);

    const token = `vyora_sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    inMemoryStore.sessions.set(token, {
      token,
      userId,
      createdAt: new Date().toISOString(),
    });

    return { user: newUser, token };
  }

  public async validateSession(tokenOrUserId: string): Promise<User | null> {
    return this.validateSessionSync(tokenOrUserId);
  }

  public validateSessionSync(tokenOrUserId: string): User | null {
    if (!tokenOrUserId) return null;

    // Check if it's an active session token
    const session = inMemoryStore.sessions.get(tokenOrUserId);
    if (session) {
      return inMemoryStore.users.get(session.userId) || null;
    }

    // Direct user ID check fallback for backward-compatible relay
    if (inMemoryStore.users.has(tokenOrUserId)) {
      return inMemoryStore.users.get(tokenOrUserId) || null;
    }

    return null;
  }


  public async logout(token: string): Promise<boolean> {
    if (inMemoryStore.sessions.has(token)) {
      inMemoryStore.sessions.delete(token);
      return true;
    }
    return true;
  }

  public getDemoAccounts(): Array<{ user: User; defaultPassword: string }> {
    return Array.from(inMemoryStore.users.values()).map(u => ({
      user: u,
      defaultPassword: inMemoryStore.userCredentials.get(u.id) || 'vyora123',
    }));
  }

  // --- USERS & PROFILES ---
  public async getUsers(): Promise<User[]> {

    return Array.from(inMemoryStore.users.values());
  }

  public async getUserByUsername(username: string): Promise<User | null> {
    const cleanHandle = username.replace(/^@/, '').toLowerCase();
    for (const u of inMemoryStore.users.values()) {
      if (u.username.toLowerCase() === cleanHandle) return u;
    }
    return null;
  }

  public async getUserById(userId: string): Promise<User | null> {
    return inMemoryStore.users.get(userId) || null;
  }

  public async updateProfile(userId: string, data: Partial<User>): Promise<User> {
    const user = inMemoryStore.users.get(userId);
    if (!user) throw new Error('User not found');

    const updated = {
      ...user,
      ...data,
      id: user.id, // Immutable
    };

    inMemoryStore.users.set(userId, updated);
    return updated;
  }

  public async toggleFollow(currentUserId: string, targetUserId: string): Promise<{ isFollowing: boolean; targetUser: User }> {
    if (currentUserId === targetUserId) throw new Error('Cannot follow yourself');

    const targetUser = inMemoryStore.users.get(targetUserId);
    const currentUser = inMemoryStore.users.get(currentUserId);
    if (!targetUser || !currentUser) throw new Error('User not found');

    const key = `${currentUserId}:${targetUserId}`;
    const isFollowing = inMemoryStore.follows.has(key);

    if (isFollowing) {
      inMemoryStore.follows.delete(key);
      targetUser.followersCount = Math.max(0, targetUser.followersCount - 1);
      currentUser.followingCount = Math.max(0, currentUser.followingCount - 1);
    } else {
      inMemoryStore.follows.add(key);
      targetUser.followersCount += 1;
      currentUser.followingCount += 1;

      // Follow notification
      inMemoryStore.notifications.unshift({
        id: `notif_${Date.now()}`,
        type: 'follow',
        sender: currentUser,
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    return { isFollowing: !isFollowing, targetUser };
  }

  public async isFollowing(currentUserId: string, targetUserId: string): Promise<boolean> {
    return inMemoryStore.follows.has(`${currentUserId}:${targetUserId}`);
  }

  // --- BOOKMARKS ---
  public async getBookmarks(userId: string): Promise<Post[]> {
    const bookmarkedIds = Array.from(inMemoryStore.bookmarks.values())
      .filter(key => key.startsWith(`${userId}:`))
      .map(key => key.split(':')[1]);

    const posts: Post[] = [];
    for (const id of bookmarkedIds) {
      const p = inMemoryStore.posts.get(id);
      if (p) {
        const author = inMemoryStore.users.get(p.authorId) || INITIAL_USERS[0];
        posts.push({
          ...p,
          author,
          isLiked: inMemoryStore.likes.has(`${userId}:${p.id}`),
          isReposted: inMemoryStore.reposts.has(`${userId}:${p.id}`),
          isBookmarked: true,
        });
      }
    }

    return posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // --- NOTIFICATIONS ---
  public async getNotifications(userId: string): Promise<Notification[]> {
    return inMemoryStore.notifications;
  }

  public async markNotificationsRead(): Promise<boolean> {
    inMemoryStore.notifications.forEach(n => { n.read = true; });
    return true;
  }

  // --- MESSAGES ---
  public async getMessages(userId: string, recipientId: string): Promise<Message[]> {
    return inMemoryStore.messages
      .filter(m => (m.senderId === userId && m.recipientId === recipientId) || (m.senderId === recipientId && m.recipientId === userId))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(m => ({
        ...m,
        isSender: m.senderId === userId,
      }));
  }

  public async sendMessage(senderId: string, recipientId: string, text: string): Promise<Message> {
    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      senderId,
      recipientId,
      text,
      createdAt: new Date().toISOString(),
      isSender: true,
    };
    inMemoryStore.messages.push(newMsg);
    return newMsg;
  }

  // --- TRENDS ---
  public async getTrends(): Promise<TrendItem[]> {
    return inMemoryStore.trends;
  }
}

export const dbAdapter = new DatabaseAdapter();
