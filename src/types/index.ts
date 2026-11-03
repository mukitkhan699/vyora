export interface User {
  id: string;
  name: string;
  username: string;
  avatarUrl: string;
  bannerUrl?: string;
  bio?: string;
  location?: string;
  website?: string;
  verified: boolean;
  isGold?: boolean;
  followersCount: number;
  followingCount: number;
  joinedDate: string;
}

export interface PollOption {
  id: number;
  text: string;
  votes: number;
}

export interface Poll {
  id: string;
  question?: string;
  options: PollOption[];
  totalVotes: number;
  userVotedIndex?: number;
  expiresAt: string;
}

export interface Post {
  id: string;
  authorId: string;
  author: User;
  content: string;
  mediaUrls?: string[];
  poll?: Poll;
  replyToId?: string;
  replyToAuthor?: string;
  quotePostId?: string;
  quotePost?: Post;
  likesCount: number;
  repostsCount: number;
  repliesCount: number;
  viewsCount: number;
  isLiked?: boolean;
  isReposted?: boolean;
  isBookmarked?: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: 'like' | 'repost' | 'reply' | 'follow' | 'mention';
  sender: User;
  postId?: string;
  postContent?: string;
  createdAt: string;
  read: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string;
  isSender: boolean;
}

export interface Conversation {
  id: string;
  participant: User;
  lastMessage: Message;
  unreadCount: number;
}

export interface TrendItem {
  id: string;
  category: string;
  topic: string;
  postsCount: string;
  trendingRank: number;
}

export interface CDNInfo {
  url: string;
  name: string;
  status: 'active' | 'testing' | 'offline' | 'fallback';
  latencyMs?: number;
}

export interface BackendCodeFile {
  name: string;
  path: string;
  description: string;
  code: string;
}

export interface AppConfig {
  appName: string;
  appTagline?: string;
  appDescription: string;
  brandIcon?: string;
  defaultTheme: 'dark' | 'dim' | 'light';
  defaultAccentColor: string;
  maxPostLength: number;
  enablePolls: boolean;
  enableBookmarks: boolean;
  enableDirectMessages: boolean;
  allowMediaUploads: boolean;
  enableTelemetryPulse?: boolean;
  cdnUrls: string[];
  databaseType: string;
  databaseStatus: {
    connected: boolean;
    type: string;
    details: string;
  };
  endpoints?: Record<string, string>;
  fileEndpoints?: {
    upload: string;
    filesBase: string;
    mediaCatalog: string;
  };
  nodeVersion?: string;
  serverUptime?: number;
  isConfigManagedByBackend?: boolean;
}

