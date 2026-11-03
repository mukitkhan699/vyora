import { Post, User, Notification, Message, TrendItem } from '../../src/types/index.ts';
import { inMemoryStore, INITIAL_USERS } from './store.ts';

export class DatabaseAdapter {
  public getStatus() {
    return {
      connected: true,
      type: 'SQLite (auth) + memory (social)',
      details: 'Authentication is persisted in node:sqlite; social state lives in the dependency-free memory store.',
    };
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

  // --- AUTHENTICATION BRIDGE ---
  // Credentials, sessions and CSRF live in server/auth.ts (node:sqlite + scrypt).
  // This adapter only maps an authenticated account to its social profile.
  public ensureUserFromAuth(authUser: {
    id: number | string;
    username: string;
    email?: string | null;
    createdAt?: number;
  }): User {
    const username = String(authUser.username || '').trim().toLowerCase();
    const existing = Array.from(inMemoryStore.users.values()).find(
      (candidate) => candidate.username.toLowerCase() === username,
    );
    if (existing) return existing;

    const id = `user_auth_${authUser.id}`;
    const existingById = inMemoryStore.users.get(id);
    if (existingById) return existingById;

    const joined = authUser.createdAt
      ? new Date(authUser.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Joined Just Now';

    const newUser: User = {
      id,
      name: username ? username.charAt(0).toUpperCase() + username.slice(1) : 'VYORA Operator',
      username,
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      bannerUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80',
      bio: 'New VYORA Network Operator · Initialized relay channel',
      verified: false,
      followersCount: 0,
      followingCount: 1,
      joinedDate: `Joined ${joined}`,
    };

    inMemoryStore.users.set(id, newUser);
    inMemoryStore.follows.add(`${id}:user_mukit`);
    return newUser;
  }

  public syncAuthProfile(authUser: {
    id: number | string;
    username: string;
    email?: string | null;
    createdAt?: number;
  }): User {
    const user = this.ensureUserFromAuth(authUser);
    const authKey = `user_auth_${authUser.id}`;
    if (user.id === authKey && user.username !== authUser.username.toLowerCase()) {
      const updated = { ...user, username: authUser.username.toLowerCase() };
      inMemoryStore.users.set(user.id, updated);
      return updated;
    }
    return user;
  }

  public getDemoAccounts(): Array<{ user: User; defaultPassword: string }> {
    return Array.from(inMemoryStore.users.values())
      .filter((user) => Boolean(inMemoryStore.userCredentials.get(user.id)))
      .map((user) => ({
        user,
        defaultPassword: 'vyora123',
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
