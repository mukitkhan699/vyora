import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { Message, Notification, Post, TrendItem, User } from '../../src/types/index.ts';
import { HttpError } from '../errors.ts';
import { normalizeWebsiteUrl } from '../profile-validation.ts';
import { publishMessage, publishNotification } from '../realtime-events.ts';
import { INITIAL_MESSAGES, INITIAL_NOTIFICATIONS, INITIAL_POSTS, INITIAL_TRENDS, INITIAL_USERS } from './store.ts';
import { query, withTransaction } from './pool.ts';
import { makeAssetPublicIfOwned } from '../storage/b2.ts';

interface UserRow extends QueryResultRow {
  id: number;
  public_id: string;
  username: string;
  name: string;
  email: string | null;
  email_verified: boolean;
  created_at: number | string;
  joined_date: string | null;
  avatar_url: string;
  banner_url: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  verified: boolean;
  is_gold: boolean;
  followers_count: number;
  following_count: number;
}

interface PostRow extends QueryResultRow {
  id: string;
  author_id: string;
  content: string;
  media_urls: string[];
  reply_to_post_id: string | null;
  quote_post_id: string | null;
  reply_to_author: string | null;
  created_at: number | string;
  likes_count: number;
  reposts_count: number;
  replies_count: number;
  views_count: number;
  author_public_id: string;
  author_username: string;
  author_name: string;
  author_email: string | null;
  author_email_verified: boolean;
  author_created_at: number | string;
  author_joined_date: string | null;
  author_avatar_url: string;
  author_banner_url: string | null;
  author_bio: string | null;
  author_location: string | null;
  author_website: string | null;
  author_verified: boolean;
  author_is_gold: boolean;
  author_followers_count: number;
  author_following_count: number;
  is_liked: boolean;
  is_reposted: boolean;
  is_bookmarked: boolean;
  poll_id: string | null;
  poll_expires_at: number | string | null;
  poll_options: Array<{ id: number; text: string; votes: number | string }> | null;
  user_voted_index: number | null;
}

const userColumns = `
  id, public_id, username, name, email, email_verified, created_at, joined_date,
  avatar_url, banner_url, bio, location, website, verified, is_gold,
  followers_count, following_count
`;

const postSelect = `
  SELECT
    post.*,
    parent_user.username AS reply_to_author,
    author.public_id AS author_public_id,
    author.username AS author_username,
    author.name AS author_name,
    author.email AS author_email,
    author.email_verified AS author_email_verified,
    author.created_at AS author_created_at,
    author.joined_date AS author_joined_date,
    author.avatar_url AS author_avatar_url,
    author.banner_url AS author_banner_url,
    author.bio AS author_bio,
    author.location AS author_location,
    author.website AS author_website,
    author.verified AS author_verified,
    author.is_gold AS author_is_gold,
    author.followers_count AS author_followers_count,
    author.following_count AS author_following_count,
    EXISTS (SELECT 1 FROM zunari_likes l WHERE l.user_id = $1 AND l.post_id = post.id) AS is_liked,
    EXISTS (SELECT 1 FROM zunari_reposts r WHERE r.user_id = $1 AND r.post_id = post.id) AS is_reposted,
    EXISTS (SELECT 1 FROM zunari_bookmarks b WHERE b.user_id = $1 AND b.post_id = post.id) AS is_bookmarked,
    (SELECT poll.id FROM zunari_polls poll WHERE poll.post_id = post.id) AS poll_id,
    (SELECT poll.expires_at FROM zunari_polls poll WHERE poll.post_id = post.id) AS poll_expires_at,
    (
      SELECT COALESCE(
        json_agg(json_build_object(
          'id', option.option_index + 1,
          'text', option.text,
          'votes', option.seed_vote_count + (
            SELECT COUNT(*) FROM zunari_poll_votes vote
            WHERE vote.poll_id = option.poll_id AND vote.option_index = option.option_index
          )
        ) ORDER BY option.option_index),
        '[]'::json
      )
      FROM zunari_poll_options option
      JOIN zunari_polls poll ON poll.id = option.poll_id
      WHERE poll.post_id = post.id
    ) AS poll_options,
    (
      SELECT vote.option_index
      FROM zunari_poll_votes vote
      JOIN zunari_polls poll ON poll.id = vote.poll_id
      WHERE poll.post_id = post.id AND vote.user_id = $1
      LIMIT 1
    ) AS user_voted_index
  FROM zunari_posts post
  JOIN zunari_users author ON author.public_id = post.author_id
  LEFT JOIN zunari_posts parent ON parent.id = post.reply_to_post_id
  LEFT JOIN zunari_users parent_user ON parent_user.public_id = parent.author_id
`;

function userFromRow(row: UserRow): User {
  return {
    id: row.public_id,
    username: row.username,
    name: row.name,
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url || undefined,
    bio: row.bio || undefined,
    location: row.location || undefined,
    website: row.website || undefined,
    verified: row.verified,
    isGold: row.is_gold,
    followersCount: Number(row.followers_count),
    followingCount: Number(row.following_count),
    joinedDate:
      row.joined_date ||
      `Joined ${new Date(Number(row.created_at)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })}`,
  };
}

function normalizeAppMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (/^\/api\/files\/file_[a-f0-9-]{36}$/i.test(parsed.pathname)) return parsed.pathname;
  } catch {
    // Relative media references are already in the API's stable format.
  }
  return url;
}

function postAuthor(row: PostRow): User {
  return userFromRow({
    id: 0,
    public_id: row.author_public_id,
    username: row.author_username,
    name: row.author_name,
    email: row.author_email,
    email_verified: row.author_email_verified,
    created_at: row.author_created_at,
    joined_date: row.author_joined_date,
    avatar_url: row.author_avatar_url,
    banner_url: row.author_banner_url,
    bio: row.author_bio,
    location: row.author_location,
    website: row.author_website,
    verified: row.author_verified,
    is_gold: row.author_is_gold,
    followers_count: row.author_followers_count,
    following_count: row.author_following_count,
  });
}

function postFromRow(row: PostRow, currentUserId: string): Post {
  const options = row.poll_options || [];
  const poll =
    row.poll_id && row.poll_expires_at !== null
      ? {
          id: row.poll_id,
          options: options.map((option) => ({
            id: Number(option.id),
            text: option.text,
            votes: Number(option.votes),
          })),
          totalVotes: options.reduce((total, option) => total + Number(option.votes), 0),
          userVotedIndex:
            row.user_voted_index === null ? undefined : Number(row.user_voted_index),
          expiresAt: new Date(Number(row.poll_expires_at)).toISOString(),
        }
      : undefined;

  return {
    id: row.id,
    authorId: row.author_id,
    author: postAuthor(row),
    content: row.content,
    mediaUrls: row.media_urls.length ? row.media_urls : undefined,
    poll,
    replyToId: row.reply_to_post_id || undefined,
    replyToAuthor: row.reply_to_author || undefined,
    quotePostId: row.quote_post_id || undefined,
    likesCount: Number(row.likes_count),
    repostsCount: Number(row.reposts_count),
    repliesCount: Number(row.replies_count),
    viewsCount: Number(row.views_count),
    isLiked: Boolean(row.is_liked),
    isReposted: Boolean(row.is_reposted),
    isBookmarked: Boolean(row.is_bookmarked),
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

function makeNotification(
  row: {
    id: string;
    type: Notification['type'];
    post_id: string | null;
    post_content: string | null;
    is_read: boolean;
    created_at: number | string;
    sender_public_id: string;
    sender_username: string;
    sender_name: string;
    sender_avatar_url: string;
    sender_verified: boolean;
    sender_is_gold: boolean;
    sender_followers_count: number;
    sender_following_count: number;
    sender_created_at: number | string;
    sender_joined_date: string | null;
    sender_banner_url: string | null;
    sender_bio: string | null;
    sender_location: string | null;
    sender_website: string | null;
  },
): Notification {
  return {
    id: row.id,
    type: row.type,
    sender: userFromRow({
      id: 0,
      public_id: row.sender_public_id,
      username: row.sender_username,
      name: row.sender_name,
      email: null,
      email_verified: true,
      created_at: row.sender_created_at,
      joined_date: row.sender_joined_date,
      avatar_url: row.sender_avatar_url,
      banner_url: row.sender_banner_url,
      bio: row.sender_bio,
      location: row.sender_location,
      website: row.sender_website,
      verified: row.sender_verified,
      is_gold: row.sender_is_gold,
      followers_count: row.sender_followers_count,
      following_count: row.sender_following_count,
    }),
    postId: row.post_id || undefined,
    postContent: row.post_content || undefined,
    read: row.is_read,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

export class DatabaseAdapter {
  public async getStatus() {
    await query('SELECT 1');
    return {
      connected: true,
      type: 'Application data service',
      details: 'Application services are available.',
    };
  }

  public async seedDemoData(): Promise<void> {
    const seedProfiles = await query(
      'SELECT COUNT(*)::integer AS count FROM zunari_users WHERE public_id = ANY($1::text[])',
      [INITIAL_USERS.map((user) => user.id)],
    );
    if (Number(seedProfiles.rows[0].count) !== INITIAL_USERS.length) return;

    await withTransaction(async (connection) => {
      for (const post of INITIAL_POSTS) {
        await connection.query(
          `INSERT INTO zunari_posts
             (id, author_id, content, media_urls, reply_to_post_id, quote_post_id,
              created_at, likes_count, reposts_count, replies_count, views_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO NOTHING`,
          [
            post.id,
            post.authorId,
            post.content,
            post.mediaUrls || [],
            post.replyToId || null,
            post.quotePostId || null,
            Date.parse(post.createdAt),
            post.likesCount,
            post.repostsCount,
            post.repliesCount,
            post.viewsCount,
          ],
        );
        if (post.poll) {
          await connection.query(
            `INSERT INTO zunari_polls (id, post_id, expires_at)
             VALUES ($1, $2, $3) ON CONFLICT (post_id) DO NOTHING`,
            [post.poll.id, post.id, Date.parse(post.poll.expiresAt)],
          );
          for (const option of post.poll.options) {
            await connection.query(
              `INSERT INTO zunari_poll_options (poll_id, option_index, text, seed_vote_count)
               VALUES ($1, $2, $3, $4) ON CONFLICT (poll_id, option_index) DO NOTHING`,
              [post.poll.id, option.id - 1, option.text, option.votes],
            );
          }
        }
      }

      const demoFollows = [
        ['user_mukit', 'user_elon'],
        ['user_mukit', 'user_tech'],
        ['user_mukit', 'user_design'],
      ];
      for (const [followerId, followingId] of demoFollows) {
        await connection.query(
          `INSERT INTO zunari_follows (follower_id, following_id, created_at)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [followerId, followingId, Date.now()],
        );
      }

      await connection.query(
        `INSERT INTO zunari_likes (user_id, post_id, created_at)
         VALUES ('user_mukit', 'post_3', $1) ON CONFLICT DO NOTHING`,
        [Date.now()],
      );
      await connection.query(
        `INSERT INTO zunari_bookmarks (user_id, post_id, created_at)
         VALUES ('user_mukit', 'post_3', $1) ON CONFLICT DO NOTHING`,
        [Date.now()],
      );
      await connection.query(
        `INSERT INTO zunari_reposts (user_id, post_id, created_at)
         VALUES ('user_mukit', 'post_4', $1) ON CONFLICT DO NOTHING`,
        [Date.now()],
      );

      for (const notification of INITIAL_NOTIFICATIONS) {
        await connection.query(
          `INSERT INTO zunari_notifications
             (id, recipient_id, sender_id, type, post_id, post_content, is_read, created_at)
           VALUES ($1, 'user_mukit', $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING`,
          [
            notification.id,
            notification.sender.id,
            notification.type,
            notification.postId || null,
            notification.postContent || null,
            notification.read,
            Date.parse(notification.createdAt),
          ],
        );
      }

      for (const message of INITIAL_MESSAGES) {
        const [participantA, participantB] = [message.senderId, message.recipientId].sort();
        const conversationId = `conversation_${participantA}_${participantB}`;
        await connection.query(
          `INSERT INTO zunari_conversations (id, participant_a_id, participant_b_id, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (participant_a_id, participant_b_id) DO NOTHING`,
          [conversationId, participantA, participantB, Date.parse(message.createdAt)],
        );
        await connection.query(
          `INSERT INTO zunari_messages (id, conversation_id, sender_id, recipient_id, text, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [
            message.id,
            conversationId,
            message.senderId,
            message.recipientId,
            message.text,
            Date.parse(message.createdAt),
          ],
        );
      }
    });
  }

  public async syncAuthProfile(authUser: {
    id: number | string;
    username: string;
    email?: string | null;
    createdAt?: number;
  }): Promise<User> {
    return this.ensureUserFromAuth(authUser);
  }

  public async ensureUserFromAuth(authUser: {
    id: number | string;
    username: string;
    email?: string | null;
    createdAt?: number;
  }): Promise<User> {
    const result = await query<UserRow>(
      `SELECT ${userColumns} FROM zunari_users WHERE id = $1`,
      [Number(authUser.id)],
    );
    const row = result.rows[0];
    if (!row) throw new HttpError(404, 'User profile not found.', 'PROFILE_NOT_FOUND');
    return userFromRow(row);
  }

  public async getDemoAccounts(): Promise<Array<{ user: User; defaultPassword: string }>> {
    const result = await query<UserRow>(
      `SELECT ${userColumns} FROM zunari_users
       WHERE public_id = ANY($1::text[]) ORDER BY id`,
      [INITIAL_USERS.map((user) => user.id)],
    );
    return result.rows.map((row) => ({ user: userFromRow(row), defaultPassword: 'vyora123' }));
  }

  public async getUsers(): Promise<User[]> {
    const result = await query<UserRow>(
      `SELECT ${userColumns} FROM zunari_users ORDER BY created_at DESC`,
    );
    return result.rows.map(userFromRow);
  }

  public async getUserByUsername(username: string): Promise<User | null> {
    const cleanHandle = username.replace(/^@/, '').toLowerCase();
    const result = await query<UserRow>(
      `SELECT ${userColumns} FROM zunari_users WHERE lower(username) = $1 LIMIT 1`,
      [cleanHandle],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  public async getUserById(userId: string): Promise<User | null> {
    const result = await query<UserRow>(
      `SELECT ${userColumns} FROM zunari_users WHERE public_id = $1`,
      [userId],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  public async updateProfile(userId: string, data: Partial<User>): Promise<User> {
    const patch: Array<[keyof User, string]> = [
      ['name', 'name'],
      ['avatarUrl', 'avatar_url'],
      ['bannerUrl', 'banner_url'],
      ['bio', 'bio'],
      ['location', 'location'],
      ['website', 'website'],
    ];
    const updates: Array<[string, string | null]> = [];
    for (const [property, column] of patch) {
      const rawValue = data[property];
      if (rawValue === undefined) continue;
      if (typeof rawValue !== 'string') {
        throw new HttpError(400, `Invalid ${property} value.`, 'INVALID_PROFILE');
      }
      const value =
        property === 'avatarUrl' || property === 'bannerUrl'
          ? normalizeAppMediaUrl(rawValue)
          : property === 'website'
            ? normalizeWebsiteUrl(rawValue) || ''
            : rawValue;
      const max = property === 'bio' ? 500 : property === 'website' ? 2048 : 120;
      if (value.length > max) {
        throw new HttpError(400, `${property} is too long.`, 'INVALID_PROFILE');
      }
      updates.push([column, column === 'avatar_url' ? value : value || null]);
    }

    if (updates.length) {
      const result = await withTransaction(async (connection) => {
        const normalizedAvatarUrl = updates.find(([column]) => column === 'avatar_url')?.[1];
        const normalizedBannerUrl = updates.find(([column]) => column === 'banner_url')?.[1];
        if (normalizedAvatarUrl) {
          await makeAssetPublicIfOwned(
            connection,
            userId,
            normalizedAvatarUrl,
            'profile-avatar',
          );
        }
        if (normalizedBannerUrl) {
          await makeAssetPublicIfOwned(
            connection,
            userId,
            normalizedBannerUrl,
            'profile-cover',
          );
        }
        const setClause = updates.map(([column], index) => `${column} = $${index + 1}`).join(', ');
        return connection.query<UserRow>(
          `UPDATE zunari_users SET ${setClause} WHERE public_id = $${updates.length + 1}
           RETURNING ${userColumns}`,
          [...updates.map(([, value]) => value), userId],
        );
      });
      if (!result.rows[0]) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
      return userFromRow(result.rows[0]);
    }
    const user = await this.getUserById(userId);
    if (!user) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
    return user;
  }

  public async getPosts(
    currentUserId: string,
    feedType: 'for-you' | 'following' = 'for-you',
    authorId?: string,
  ): Promise<Post[]> {
    const result = await query<PostRow>(
      `${postSelect}
       WHERE ($2::text IS NULL OR post.author_id = $2)
         AND ($3::boolean = FALSE OR post.author_id = $1 OR EXISTS (
           SELECT 1 FROM zunari_follows follow
           WHERE follow.follower_id = $1 AND follow.following_id = post.author_id
         ))
       ORDER BY post.created_at DESC`,
      [currentUserId, authorId || null, feedType === 'following'],
    );
    return Promise.all(
      result.rows.map(async (row) => {
        const post = postFromRow(row, currentUserId);
        if (row.quote_post_id) {
          const quoted = await this.getPostRow(row.quote_post_id, currentUserId);
          if (quoted) post.quotePost = postFromRow(quoted, currentUserId);
        }
        return post;
      }),
    );
  }

  public async getPostById(
    postId: string,
    currentUserId: string,
  ): Promise<{ post: Post | null; replies: Post[] }> {
    const postRow = await this.getPostRow(postId, currentUserId);
    if (!postRow) return { post: null, replies: [] };
    const post = postFromRow(postRow, currentUserId);
    if (postRow.quote_post_id) {
      const quoted = await this.getPostRow(postRow.quote_post_id, currentUserId);
      if (quoted) post.quotePost = postFromRow(quoted, currentUserId);
    }
    const replies = await query<PostRow>(
      `${postSelect} WHERE post.reply_to_post_id = $2 ORDER BY post.created_at ASC`,
      [currentUserId, postId],
    );
    return { post, replies: replies.rows.map((row) => postFromRow(row, currentUserId)) };
  }

  private async getPostRow(postId: string, currentUserId: string): Promise<PostRow | null> {
    const result = await query<PostRow>(
      `${postSelect} WHERE post.id = $2 LIMIT 1`,
      [currentUserId, postId],
    );
    return result.rows[0] || null;
  }

  public async createPost(
    authorId: string,
    content: string,
    mediaUrls?: string[],
    pollOptions?: string[],
    replyToId?: string,
    quotePostId?: string,
  ): Promise<Post> {
    const normalizedMediaUrls = (mediaUrls || []).map(normalizeAppMediaUrl);
    const postId = `post_${randomUUID()}`;
    const createdAt = Date.now();
    const pollId = pollOptions && pollOptions.length >= 2 ? `poll_${randomUUID()}` : null;
    let notification: Notification | null = null;
    let notificationRecipientId: string | null = null;

    await withTransaction(async (connection) => {
      for (const url of normalizedMediaUrls) {
        await makeAssetPublicIfOwned(connection, authorId, url, 'post-image');
      }
      const parentResult = replyToId
        ? await connection.query<{ author_id: string }>(
            'SELECT author_id FROM zunari_posts WHERE id = $1',
            [replyToId],
          )
        : null;
      if (replyToId && !parentResult?.rowCount) {
        throw new HttpError(404, 'Reply target not found.', 'POST_NOT_FOUND');
      }
      if (quotePostId) {
        const quote = await connection.query(
          'SELECT 1 FROM zunari_posts WHERE id = $1',
          [quotePostId],
        );
        if (!quote.rowCount) throw new HttpError(404, 'Quoted post not found.', 'POST_NOT_FOUND');
        await connection.query(
          'UPDATE zunari_posts SET reposts_count = reposts_count + 1 WHERE id = $1',
          [quotePostId],
        );
      }

      await connection.query(
        `INSERT INTO zunari_posts
           (id, author_id, content, media_urls, reply_to_post_id, quote_post_id,
            created_at, views_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [postId, authorId, content, normalizedMediaUrls, replyToId || null, quotePostId || null, createdAt],
      );

      if (parentResult?.rows[0]) {
        await connection.query(
          'UPDATE zunari_posts SET replies_count = replies_count + 1 WHERE id = $1',
          [replyToId],
        );
        const parentAuthorId = parentResult.rows[0].author_id;
        if (parentAuthorId !== authorId) {
          notificationRecipientId = parentAuthorId;
          notification = await this.createNotification(connection, {
            recipientId: parentAuthorId,
            senderId: authorId,
            type: 'reply',
            postId,
            postContent: content.slice(0, 60),
            createdAt,
          });
        }
      }
    });

    if (notification && notificationRecipientId) {
      publishNotification(notificationRecipientId, notification);
    }
    const result = await this.getPostById(postId, authorId);
    if (!result.post) throw new Error('Created post could not be loaded.');
    return result.post;
  }

  public async toggleLike(
    userId: string,
    postId: string,
  ): Promise<{ isLiked: boolean; likesCount: number }> {
    let notification: Notification | null = null;
    let recipientId: string | null = null;
    const result = await withTransaction(async (connection) => {
      const post = await connection.query<{ author_id: string; content: string }>(
        'SELECT author_id, content FROM zunari_posts WHERE id = $1 FOR UPDATE',
        [postId],
      );
      if (!post.rowCount) throw new HttpError(404, 'Post not found.', 'POST_NOT_FOUND');
      recipientId = post.rows[0].author_id;
      const existing = await connection.query(
        'DELETE FROM zunari_likes WHERE user_id = $1 AND post_id = $2 RETURNING 1',
        [userId, postId],
      );
      const isLiked = !existing.rowCount;
      if (isLiked) {
        await connection.query(
          `INSERT INTO zunari_likes (user_id, post_id, created_at) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [userId, postId, Date.now()],
        );
        await connection.query(
          'UPDATE zunari_posts SET likes_count = likes_count + 1 WHERE id = $1',
          [postId],
        );
        if (recipientId !== userId) {
          notification = await this.createNotification(connection, {
            recipientId: recipientId!,
            senderId: userId,
            type: 'like',
            postId,
            postContent: post.rows[0].content.slice(0, 60),
            createdAt: Date.now(),
          });
        }
      } else {
        await connection.query(
          'UPDATE zunari_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = $1',
          [postId],
        );
      }
      const count = await connection.query<{ likes_count: number }>(
        'SELECT likes_count FROM zunari_posts WHERE id = $1',
        [postId],
      );
      return { isLiked, likesCount: Number(count.rows[0].likes_count) };
    });
    if (notification && recipientId) publishNotification(recipientId, notification);
    return result;
  }

  public async toggleRepost(
    userId: string,
    postId: string,
  ): Promise<{ isReposted: boolean; repostsCount: number }> {
    let notification: Notification | null = null;
    let recipientId: string | null = null;
    const result = await withTransaction(async (connection) => {
      const post = await connection.query<{ author_id: string; content: string }>(
        'SELECT author_id, content FROM zunari_posts WHERE id = $1 FOR UPDATE',
        [postId],
      );
      if (!post.rowCount) throw new HttpError(404, 'Post not found.', 'POST_NOT_FOUND');
      recipientId = post.rows[0].author_id;
      const existing = await connection.query(
        'DELETE FROM zunari_reposts WHERE user_id = $1 AND post_id = $2 RETURNING 1',
        [userId, postId],
      );
      const isReposted = !existing.rowCount;
      if (isReposted) {
        await connection.query(
          `INSERT INTO zunari_reposts (user_id, post_id, created_at) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [userId, postId, Date.now()],
        );
        await connection.query(
          'UPDATE zunari_posts SET reposts_count = reposts_count + 1 WHERE id = $1',
          [postId],
        );
        if (recipientId !== userId) {
          notification = await this.createNotification(connection, {
            recipientId: recipientId!,
            senderId: userId,
            type: 'repost',
            postId,
            postContent: post.rows[0].content.slice(0, 60),
            createdAt: Date.now(),
          });
        }
      } else {
        await connection.query(
          'UPDATE zunari_posts SET reposts_count = GREATEST(0, reposts_count - 1) WHERE id = $1',
          [postId],
        );
      }
      const count = await connection.query<{ reposts_count: number }>(
        'SELECT reposts_count FROM zunari_posts WHERE id = $1',
        [postId],
      );
      return { isReposted, repostsCount: Number(count.rows[0].reposts_count) };
    });
    if (notification && recipientId) publishNotification(recipientId, notification);
    return result;
  }

  public async toggleBookmark(userId: string, postId: string): Promise<{ isBookmarked: boolean }> {
    return withTransaction(async (connection) => {
      const post = await connection.query(
        'SELECT 1 FROM zunari_posts WHERE id = $1 FOR UPDATE',
        [postId],
      );
      if (!post.rowCount) throw new HttpError(404, 'Post not found.', 'POST_NOT_FOUND');
      const removed = await connection.query(
        'DELETE FROM zunari_bookmarks WHERE user_id = $1 AND post_id = $2 RETURNING 1',
        [userId, postId],
      );
      if (removed.rowCount) return { isBookmarked: false };
      await connection.query(
        `INSERT INTO zunari_bookmarks (user_id, post_id, created_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, postId, Date.now()],
      );
      return { isBookmarked: true };
    });
  }

  public async votePoll(userId: string, postId: string, optionIndex: number): Promise<Post> {
    await withTransaction(async (connection) => {
      const poll = await connection.query<{ id: string; expires_at: number | string }>(
        'SELECT id, expires_at FROM zunari_polls WHERE post_id = $1',
        [postId],
      );
      if (!poll.rowCount) throw new HttpError(404, 'Poll not found.', 'POLL_NOT_FOUND');
      if (Number(poll.rows[0].expires_at) <= Date.now()) {
        throw new HttpError(409, 'This poll has ended.', 'POLL_CLOSED');
      }
      const inserted = await connection.query(
        `INSERT INTO zunari_poll_votes (poll_id, option_index, user_id, created_at)
         SELECT poll.id, option.option_index, $3, $4
         FROM zunari_polls poll
         JOIN zunari_poll_options option ON option.poll_id = poll.id
         WHERE poll.id = $1 AND poll.post_id = $2 AND option.option_index = $5
         ON CONFLICT (poll_id, user_id) DO NOTHING
         RETURNING 1`,
        [poll.rows[0].id, postId, userId, Date.now(), optionIndex],
      );
      if (!inserted.rowCount) {
        const option = await connection.query(
          'SELECT 1 FROM zunari_poll_options WHERE poll_id = $1 AND option_index = $2',
          [poll.rows[0].id, optionIndex],
        );
        if (!option.rowCount) throw new HttpError(400, 'Poll option is invalid.', 'INVALID_POLL_OPTION');
      }
    });
    const result = await this.getPostById(postId, userId);
    if (!result.post) throw new HttpError(404, 'Post not found.', 'POST_NOT_FOUND');
    return result.post;
  }

  public async deletePost(userId: string, postId: string): Promise<boolean> {
    return withTransaction(async (connection) => {
      const existing = await connection.query<{
        author_id: string;
        reply_to_post_id: string | null;
        quote_post_id: string | null;
      }>(
        `SELECT author_id, reply_to_post_id, quote_post_id
         FROM zunari_posts WHERE id = $1 FOR UPDATE`,
        [postId],
      );
      if (!existing.rowCount) return false;
      if (existing.rows[0].author_id !== userId) {
        throw new HttpError(403, 'Unauthorized to delete this post.', 'FORBIDDEN');
      }
      await connection.query('DELETE FROM zunari_posts WHERE id = $1', [postId]);
      if (existing.rows[0].reply_to_post_id) {
        await connection.query(
          `UPDATE zunari_posts SET replies_count = GREATEST(0, replies_count - 1)
           WHERE id = $1`,
          [existing.rows[0].reply_to_post_id],
        );
      }
      if (existing.rows[0].quote_post_id) {
        await connection.query(
          `UPDATE zunari_posts SET reposts_count = GREATEST(0, reposts_count - 1)
           WHERE id = $1`,
          [existing.rows[0].quote_post_id],
        );
      }
      return true;
    });
  }

  public async toggleFollow(
    currentUserId: string,
    targetUserId: string,
  ): Promise<{ isFollowing: boolean; targetUser: User }> {
    if (currentUserId === targetUserId) {
      throw new HttpError(400, 'Cannot follow yourself.', 'CANNOT_FOLLOW_SELF');
    }
    let notification: Notification | null = null;
    const isFollowing = await withTransaction(async (connection) => {
      const target = await connection.query(
        `SELECT public_id FROM zunari_users
         WHERE public_id = ANY($1::text[]) ORDER BY public_id FOR UPDATE`,
        [[currentUserId, targetUserId]],
      );
      if (target.rowCount !== 2) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
      const removed = await connection.query(
        'DELETE FROM zunari_follows WHERE follower_id = $1 AND following_id = $2 RETURNING 1',
        [currentUserId, targetUserId],
      );
      if (removed.rowCount) {
        await connection.query(
          'UPDATE zunari_users SET followers_count = GREATEST(0, followers_count - 1) WHERE public_id = $1',
          [targetUserId],
        );
        await connection.query(
          'UPDATE zunari_users SET following_count = GREATEST(0, following_count - 1) WHERE public_id = $1',
          [currentUserId],
        );
        return false;
      }
      await connection.query(
        `INSERT INTO zunari_follows (follower_id, following_id, created_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [currentUserId, targetUserId, Date.now()],
      );
      await connection.query(
        'UPDATE zunari_users SET followers_count = followers_count + 1 WHERE public_id = $1',
        [targetUserId],
      );
      await connection.query(
        'UPDATE zunari_users SET following_count = following_count + 1 WHERE public_id = $1',
        [currentUserId],
      );
      notification = await this.createNotification(connection, {
        recipientId: targetUserId,
        senderId: currentUserId,
        type: 'follow',
        postId: null,
        postContent: null,
        createdAt: Date.now(),
      });
      return true;
    });
    if (notification) publishNotification(targetUserId, notification);
    const targetUser = await this.getUserById(targetUserId);
    if (!targetUser) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
    return { isFollowing, targetUser };
  }

  public async isFollowing(currentUserId: string, targetUserId: string): Promise<boolean> {
    const result = await query(
      'SELECT 1 FROM zunari_follows WHERE follower_id = $1 AND following_id = $2',
      [currentUserId, targetUserId],
    );
    return Boolean(result.rowCount);
  }

  public async getBookmarks(userId: string): Promise<Post[]> {
    const result = await query<PostRow>(
      `${postSelect}
       JOIN zunari_bookmarks bookmark
         ON bookmark.post_id = post.id AND bookmark.user_id = $1
       ORDER BY bookmark.created_at DESC`,
      [userId],
    );
    return result.rows.map((row) => postFromRow(row, userId));
  }

  public async getNotifications(userId: string): Promise<Notification[]> {
    const result = await query(
      `SELECT
         notification.id, notification.type, notification.post_id, notification.post_content,
         notification.is_read, notification.created_at,
         sender.public_id AS sender_public_id, sender.username AS sender_username,
         sender.name AS sender_name, sender.avatar_url AS sender_avatar_url,
         sender.verified AS sender_verified, sender.is_gold AS sender_is_gold,
         sender.followers_count AS sender_followers_count,
         sender.following_count AS sender_following_count,
         sender.created_at AS sender_created_at, sender.joined_date AS sender_joined_date,
         sender.banner_url AS sender_banner_url, sender.bio AS sender_bio,
         sender.location AS sender_location, sender.website AS sender_website
       FROM zunari_notifications notification
       JOIN zunari_users sender ON sender.public_id = notification.sender_id
       WHERE notification.recipient_id = $1
       ORDER BY notification.created_at DESC`,
      [userId],
    );
    return result.rows.map((row) => makeNotification(row as Parameters<typeof makeNotification>[0]));
  }

  public async markNotificationsRead(userId: string): Promise<boolean> {
    await query(
      'UPDATE zunari_notifications SET is_read = TRUE WHERE recipient_id = $1 AND is_read = FALSE',
      [userId],
    );
    return true;
  }

  public async getMessages(userId: string, otherUserId: string): Promise<Message[]> {
    if (userId === otherUserId) return [];
    const [participantA, participantB] = [userId, otherUserId].sort();
    const result = await query<{
      id: string;
      sender_id: string;
      recipient_id: string;
      text: string;
      created_at: number | string;
    }>(
      `SELECT message.id, message.sender_id, message.recipient_id, message.text, message.created_at
       FROM zunari_messages message
       JOIN zunari_conversations conversation ON conversation.id = message.conversation_id
       WHERE conversation.participant_a_id = $1 AND conversation.participant_b_id = $2
         AND (message.sender_id = $3 OR message.recipient_id = $3)
       ORDER BY message.created_at ASC`,
      [participantA, participantB, userId],
    );
    return result.rows.map((message) => ({
      id: message.id,
      senderId: message.sender_id,
      recipientId: message.recipient_id,
      text: message.text,
      createdAt: new Date(Number(message.created_at)).toISOString(),
      isSender: message.sender_id === userId,
    }));
  }

  public async sendMessage(
    senderId: string,
    recipientId: string,
    text: string,
  ): Promise<Message> {
    if (senderId === recipientId) {
      throw new HttpError(400, 'You cannot message yourself.', 'INVALID_RECIPIENT');
    }
    const [participantA, participantB] = [senderId, recipientId].sort();
    const createdAt = Date.now();
    const message = await withTransaction(async (connection) => {
      const users = await connection.query(
        'SELECT public_id FROM zunari_users WHERE public_id = ANY($1::text[])',
        [[senderId, recipientId]],
      );
      if (users.rowCount !== 2) throw new HttpError(404, 'Recipient not found.', 'USER_NOT_FOUND');
      const conversationId = `conversation_${participantA}_${participantB}`;
      const conversation = await connection.query<{ id: string }>(
        `INSERT INTO zunari_conversations (id, participant_a_id, participant_b_id, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (participant_a_id, participant_b_id)
         DO UPDATE SET participant_a_id = EXCLUDED.participant_a_id
         RETURNING id`,
        [conversationId, participantA, participantB, createdAt],
      );
      const inserted = await connection.query<{
        id: string;
        sender_id: string;
        recipient_id: string;
        text: string;
        created_at: number | string;
      }>(
        `INSERT INTO zunari_messages (id, conversation_id, sender_id, recipient_id, text, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, sender_id, recipient_id, text, created_at`,
        [randomUUID(), conversation.rows[0].id, senderId, recipientId, text, createdAt],
      );
      const row = inserted.rows[0];
      return {
        id: row.id,
        senderId: row.sender_id,
        recipientId: row.recipient_id,
        text: row.text,
        createdAt: new Date(Number(row.created_at)).toISOString(),
        isSender: true,
      };
    });
    publishMessage({ ...message, isSender: false });
    return message;
  }

  public async getTrends(): Promise<TrendItem[]> {
    return INITIAL_TRENDS;
  }

  private async createNotification(
    connection: import('pg').PoolClient,
    notification: {
      recipientId: string;
      senderId: string;
      type: Notification['type'];
      postId: string | null;
      postContent: string | null;
      createdAt: number;
    },
  ): Promise<Notification> {
    const id = `notif_${randomUUID()}`;
    await connection.query(
      `INSERT INTO zunari_notifications
         (id, recipient_id, sender_id, type, post_id, post_content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        notification.recipientId,
        notification.senderId,
        notification.type,
        notification.postId,
        notification.postContent,
        notification.createdAt,
      ],
    );
    const sender = await connection.query<UserRow>(
      `SELECT ${userColumns} FROM zunari_users WHERE public_id = $1`,
      [notification.senderId],
    );
    return {
      id,
      type: notification.type,
      sender: userFromRow(sender.rows[0]),
      postId: notification.postId || undefined,
      postContent: notification.postContent || undefined,
      read: false,
      createdAt: new Date(notification.createdAt).toISOString(),
    };
  }

}

export const dbAdapter = new DatabaseAdapter();
