import type { QueryResultRow } from 'pg';
import { query } from '../db/pool.ts';

export interface PublicProfile {
  id: string;
  username: string;
  name: string;
  avatarUrl: string;
  bannerUrl: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  verified: boolean;
  isGold: boolean;
  followersCount: number;
  followingCount: number;
  joinedDate: string;
  createdAt: number;
  suspendedAt: number | null;
}

export interface PublicPost {
  id: string;
  content: string;
  mediaUrls: string[];
  replyToId: string | null;
  replyToAuthor: string | null;
  createdAt: number;
  likesCount: number;
  repostsCount: number;
  repliesCount: number;
  viewsCount: number;
  author: PublicProfile;
}

export interface SitemapCounts {
  profiles: number;
  posts: number;
  latestPostAt: number | null;
}

export interface SitemapProfileRow {
  username: string;
  suspendedAt: number | null;
}

export interface SitemapPostRow {
  id: string;
  createdAt: number;
  authorSuspendedAt: number | null;
}

const profileColumns = `
  public_id, username, name, created_at, joined_date, avatar_url, banner_url,
  bio, location, website, verified, is_gold, followers_count, following_count,
  suspended_at
`;

export const PUBLIC_PROFILE_SQL = `
  SELECT ${profileColumns}
  FROM zunari_users
  WHERE lower(username) = lower($1)
    AND suspended_at IS NULL
  LIMIT 1
`;

export const PUBLIC_POST_SELECT = `
  SELECT
    post.id,
    post.content,
    post.media_urls,
    post.reply_to_post_id,
    post.created_at,
    post.likes_count,
    post.reposts_count,
    post.replies_count,
    post.views_count,
    parent_user.username AS reply_to_author,
    author.public_id AS author_public_id,
    author.username AS author_username,
    author.name AS author_name,
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
    author.suspended_at AS author_suspended_at
  FROM zunari_posts post
  JOIN zunari_users author ON author.public_id = post.author_id
  LEFT JOIN zunari_posts parent ON parent.id = post.reply_to_post_id
  LEFT JOIN zunari_users parent_user ON parent_user.public_id = parent.author_id
`;

export const PUBLIC_POST_BY_ID_SQL = `${PUBLIC_POST_SELECT}
  WHERE post.id = $1
    AND author.suspended_at IS NULL
  LIMIT 1
`;

export const PUBLIC_RECENT_POSTS_SQL = `${PUBLIC_POST_SELECT}
  WHERE author.suspended_at IS NULL
  ORDER BY post.created_at DESC, post.id ASC
  LIMIT $1
`;

export const PUBLIC_AUTHOR_POSTS_SQL = `${PUBLIC_POST_SELECT}
  WHERE post.author_id = $1
    AND author.suspended_at IS NULL
  ORDER BY post.created_at DESC, post.id ASC
  LIMIT $2
`;

export const PUBLIC_POST_REPLIES_SQL = `${PUBLIC_POST_SELECT}
  WHERE post.reply_to_post_id = $1
    AND author.suspended_at IS NULL
  ORDER BY post.created_at ASC, post.id ASC
  LIMIT $2
`;

export const SITEMAP_COUNTS_SQL = `
  SELECT
    (SELECT COUNT(*)::bigint FROM zunari_users WHERE suspended_at IS NULL) AS profiles,
    (
      SELECT COUNT(*)::bigint
      FROM zunari_posts post
      JOIN zunari_users author ON author.public_id = post.author_id
      WHERE author.suspended_at IS NULL
    ) AS posts,
    (
      SELECT MAX(post.created_at)
      FROM zunari_posts post
      JOIN zunari_users author ON author.public_id = post.author_id
      WHERE author.suspended_at IS NULL
    ) AS latest_post_at
`;

export const SITEMAP_PROFILES_SQL = `
  SELECT username, suspended_at
  FROM zunari_users
  WHERE suspended_at IS NULL
  ORDER BY created_at DESC, public_id ASC
  LIMIT $1 OFFSET $2
`;

export const SITEMAP_POSTS_SQL = `
  SELECT post.id, post.created_at, author.suspended_at AS author_suspended_at
  FROM zunari_posts post
  JOIN zunari_users author ON author.public_id = post.author_id
  WHERE author.suspended_at IS NULL
  ORDER BY post.created_at DESC, post.id ASC
  LIMIT $1 OFFSET $2
`;

interface ProfileRow extends QueryResultRow {
  public_id: string;
  username: string;
  name: string;
  created_at: number | string;
  joined_date: string | null;
  avatar_url: string;
  banner_url: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  verified: boolean;
  is_gold: boolean;
  followers_count: number | string;
  following_count: number | string;
  suspended_at: number | string | null;
}

interface PostRow extends QueryResultRow {
  id: string;
  content: string;
  media_urls: string[] | null;
  reply_to_post_id: string | null;
  created_at: number | string;
  likes_count: number | string;
  reposts_count: number | string;
  replies_count: number | string;
  views_count: number | string;
  reply_to_author: string | null;
  author_public_id: string;
  author_username: string;
  author_name: string;
  author_created_at: number | string;
  author_joined_date: string | null;
  author_avatar_url: string;
  author_banner_url: string | null;
  author_bio: string | null;
  author_location: string | null;
  author_website: string | null;
  author_verified: boolean;
  author_is_gold: boolean;
  author_followers_count: number | string;
  author_following_count: number | string;
  author_suspended_at: number | string | null;
}

function joinedLabel(createdAt: number, joinedDate: string | null): string {
  if (joinedDate) return joinedDate;
  return `Joined ${new Date(createdAt).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

function profileFromRow(row: ProfileRow): PublicProfile {
  const createdAt = Number(row.created_at);
  return {
    id: row.public_id,
    username: row.username,
    name: row.name,
    avatarUrl: row.avatar_url || '',
    bannerUrl: row.banner_url || null,
    bio: row.bio || null,
    location: row.location || null,
    website: row.website || null,
    verified: Boolean(row.verified),
    isGold: Boolean(row.is_gold),
    followersCount: Number(row.followers_count),
    followingCount: Number(row.following_count),
    joinedDate: joinedLabel(createdAt, row.joined_date),
    createdAt,
    suspendedAt: row.suspended_at === null ? null : Number(row.suspended_at),
  };
}

function authorFromPostRow(row: PostRow): PublicProfile {
  const createdAt = Number(row.author_created_at);
  return {
    id: row.author_public_id,
    username: row.author_username,
    name: row.author_name,
    avatarUrl: row.author_avatar_url || '',
    bannerUrl: row.author_banner_url || null,
    bio: row.author_bio || null,
    location: row.author_location || null,
    website: row.author_website || null,
    verified: Boolean(row.author_verified),
    isGold: Boolean(row.author_is_gold),
    followersCount: Number(row.author_followers_count),
    followingCount: Number(row.author_following_count),
    joinedDate: joinedLabel(createdAt, row.author_joined_date),
    createdAt,
    suspendedAt: row.author_suspended_at === null ? null : Number(row.author_suspended_at),
  };
}

function postFromRow(row: PostRow): PublicPost {
  return {
    id: row.id,
    content: row.content,
    mediaUrls: Array.isArray(row.media_urls) ? row.media_urls.filter(Boolean) : [],
    replyToId: row.reply_to_post_id || null,
    replyToAuthor: row.reply_to_author || null,
    createdAt: Number(row.created_at),
    likesCount: Number(row.likes_count),
    repostsCount: Number(row.reposts_count),
    repliesCount: Number(row.replies_count),
    viewsCount: Number(row.views_count),
    author: authorFromPostRow(row),
  };
}

function boundedLimit(value: number, maximum = 50): number {
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, maximum);
}

function boundedOffset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const clean = username.replace(/^@/, '').trim();
  if (!clean) return null;
  const result = await query<ProfileRow>(PUBLIC_PROFILE_SQL, [clean]);
  return result.rows[0] ? profileFromRow(result.rows[0]) : null;
}

export async function getPublicPost(postId: string): Promise<PublicPost | null> {
  const clean = postId.trim();
  if (!clean) return null;
  const result = await query<PostRow>(PUBLIC_POST_BY_ID_SQL, [clean]);
  return result.rows[0] ? postFromRow(result.rows[0]) : null;
}

export async function getRecentPublicPosts(limit = 20): Promise<PublicPost[]> {
  const result = await query<PostRow>(PUBLIC_RECENT_POSTS_SQL, [boundedLimit(limit)]);
  return result.rows.map(postFromRow);
}

export async function getPublicPostsByAuthor(
  authorId: string,
  limit = 20,
): Promise<PublicPost[]> {
  if (!authorId) return [];
  const result = await query<PostRow>(PUBLIC_AUTHOR_POSTS_SQL, [
    authorId,
    boundedLimit(limit),
  ]);
  return result.rows.map(postFromRow);
}

export async function getPublicPostReplies(
  postId: string,
  limit = 20,
): Promise<PublicPost[]> {
  if (!postId) return [];
  const result = await query<PostRow>(PUBLIC_POST_REPLIES_SQL, [
    postId,
    boundedLimit(limit),
  ]);
  return result.rows.map(postFromRow);
}

export async function getSitemapCounts(): Promise<SitemapCounts> {
  const result = await query<{
    profiles: string | number;
    posts: string | number;
    latest_post_at: string | number | null;
  }>(SITEMAP_COUNTS_SQL);
  const row = result.rows[0];
  return {
    profiles: Number(row?.profiles || 0),
    posts: Number(row?.posts || 0),
    latestPostAt: row?.latest_post_at === null || row?.latest_post_at === undefined
      ? null
      : Number(row.latest_post_at),
  };
}

export async function getSitemapProfiles(
  limit: number,
  offset: number,
): Promise<SitemapProfileRow[]> {
  const result = await query<{
    username: string;
    suspended_at: number | string | null;
  }>(SITEMAP_PROFILES_SQL, [boundedLimit(limit, 20_000), boundedOffset(offset)]);
  return result.rows.map((row) => ({
    username: row.username,
    suspendedAt: row.suspended_at === null ? null : Number(row.suspended_at),
  }));
}

export async function getSitemapPosts(
  limit: number,
  offset: number,
): Promise<SitemapPostRow[]> {
  const result = await query<{
    id: string;
    created_at: number | string;
    author_suspended_at: number | string | null;
  }>(SITEMAP_POSTS_SQL, [boundedLimit(limit, 20_000), boundedOffset(offset)]);
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: Number(row.created_at),
    authorSuspendedAt:
      row.author_suspended_at === null ? null : Number(row.author_suspended_at),
  }));
}

export const seoDataSource = {
  getRecentPosts: getRecentPublicPosts,
  getProfileByUsername: getPublicProfile,
  getProfilePosts: getPublicPostsByAuthor,
  getPostById: getPublicPost,
  getPostReplies: getPublicPostReplies,
  getSitemapCounts,
  getSitemapProfiles,
  getSitemapPosts,
};
