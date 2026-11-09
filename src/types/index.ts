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

export interface MessageAttachment {
  id: string;
  messageId: string;
  mediaAssetId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  status: 'active' | 'expired' | 'cleaned';
  expiresAt: number;
  createdAt: number;
  url: string;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  username?: string;
  createdAt: number;
}

export interface MessageReceipt {
  userId: string;
  deliveredAt: number | null;
  readAt: number | null;
}

export interface Message {
  id: string;
  senderId?: string | null;
  recipientId?: string;
  conversationId?: string;
  text: string;
  clientId?: string | null;
  replyToMessageId?: string | null;
  replyToMessage?: {
    id: string;
    senderId: string | null;
    senderUsername?: string;
    text: string;
  } | null;
  isEdited?: boolean;
  editedAt?: number | null;
  isDeleted?: boolean;
  deletedAt?: number | null;
  createdAt: string | number;
  isSender?: boolean;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  receipts?: MessageReceipt[];
}

export interface ConversationParticipant {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  leftAt: number | null;
  lastReadMessageId: string | null;
  user?: User;
}

export interface Conversation {
  id: string;
  type?: 'direct' | 'group';
  title?: string | null;
  avatarUrl?: string | null;
  createdBy?: string | null;
  lastMessageAt?: number;
  createdAt?: string | number;
  updatedAt?: string | number;
  participants?: ConversationParticipant[];
  participant?: User; // legacy fallback
  lastMessage?: Message | null;
  unreadCount: number;
}

export interface TrendItem {
  id: string;
  category: string;
  topic: string;
  postsCount: string;
  trendingRank: number;
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
}
