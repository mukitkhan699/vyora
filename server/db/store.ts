import { User, Post, Notification, Message, TrendItem } from '../../src/types/index.ts';

export const INITIAL_USERS: User[] = [
  {
    id: 'user_mukit',
    name: 'Mukit',
    username: 'mukitk',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80',
    bio: 'Software engineer & builder. Loving fast systems, clean code, and scalable architecture. 🚀',
    location: 'Tokyo, Japan',
    website: 'https://github.com/mukit',
    verified: true,
    followersCount: 1420,
    followingCount: 380,
    joinedDate: 'Joined March 2021',
  },
  {
    id: 'user_elon',
    name: 'Elon Musk',
    username: 'elonmusk',
    avatarUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&auto=format&fit=crop&q=80',
    bio: 'Occupy Mars. The future will be exciting.',
    location: 'Starbase, Texas',
    website: 'https://x.com',
    verified: true,
    isGold: false,
    followersCount: 184500000,
    followingCount: 680,
    joinedDate: 'Joined June 2009',
  },
  {
    id: 'user_tech',
    name: 'Tech Frontier',
    username: 'techfrontier',
    avatarUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&auto=format&fit=crop&q=80',
    bio: 'Breaking news in AI, software engineering, cloud systems, and open source. Updates 24/7.',
    location: 'Silicon Valley, CA',
    website: 'https://techfrontier.dev',
    verified: true,
    isGold: true,
    followersCount: 894000,
    followingCount: 142,
    joinedDate: 'Joined January 2018',
  },
  {
    id: 'user_design',
    name: 'Design Digest',
    username: 'designdigest',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=1200&auto=format&fit=crop&q=80',
    bio: 'Curating the world’s most beautiful interfaces, typography, micro-interactions, and design systems.',
    location: 'San Francisco, CA',
    website: 'https://designdigest.io',
    verified: true,
    followersCount: 312000,
    followingCount: 220,
    joinedDate: 'Joined August 2019',
  },
];

export const INITIAL_POSTS: Post[] = [
  {
    id: 'post_1',
    authorId: 'user_mukit',
    author: INITIAL_USERS[0],
    content: 'Welcome to VYORA ⚡️ The decoupled global transmission platform. Built with modular components, dynamic multi-CDN failover, and PostgreSQL. All configuration is centrally orchestrated in the standalone Node.js backend! #VYORA #DecoupledArchitecture',
    mediaUrls: [
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1000&auto=format&fit=crop&q=80',
    ],
    likesCount: 312,
    repostsCount: 68,
    repliesCount: 22,
    viewsCount: 6420,
    isLiked: false,
    isReposted: false,
    isBookmarked: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: 'post_2',
    authorId: 'user_elon',
    author: INITIAL_USERS[1],
    content: 'Which transmission capability should VYORA deploy next on the global relay?',
    poll: {
      id: 'poll_1',
      options: [
        { id: 1, text: 'Sub-millisecond multi-CDN caching', votes: 6890 },
        { id: 2, text: 'Encrypted Tele-Direct channels', votes: 4410 },
        { id: 3, text: 'Decentralized telemetry streams', votes: 2750 },
        { id: 4, text: 'Live VYORA Space transmissions', votes: 1930 },
      ],
      totalVotes: 15980,
      userVotedIndex: undefined,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    },
    likesCount: 18400,
    repostsCount: 5210,
    repliesCount: 1180,
    viewsCount: 395000,
    isLiked: false,
    isReposted: false,
    isBookmarked: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    id: 'post_3',
    authorId: 'user_design',
    author: INITIAL_USERS[3],
    content: 'The beauty of clean typography and true black #000000 "Lights out" theme. No clutter, just pure content and seamless transitions. How is your reading experience on this UI? @mukitk',
    mediaUrls: [
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=1000&auto=format&fit=crop&q=80'
    ],
    likesCount: 654,
    repostsCount: 88,
    repliesCount: 31,
    viewsCount: 14200,
    isLiked: true,
    isReposted: false,
    isBookmarked: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
  },
  {
    id: 'post_4',
    authorId: 'user_tech',
    author: INITIAL_USERS[2],
    content: 'Why multi-CDN architecture is essential in 2025: when one edge network encounters latency spikes or DNS failures, your web app seamlessly fetches assets from secondary CDNs without showing broken images or failed scripts. #Engineering #Cloud',
    likesCount: 920,
    repostsCount: 210,
    repliesCount: 45,
    viewsCount: 24500,
    isLiked: false,
    isReposted: true,
    isBookmarked: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 720).toISOString(),
  },
];

export const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif_1',
    type: 'like',
    sender: INITIAL_USERS[1],
    postId: 'post_1',
    postContent: 'Welcome to the newly launched X social platform!',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: 'notif_2',
    type: 'repost',
    sender: INITIAL_USERS[2],
    postId: 'post_1',
    postContent: 'Welcome to the newly launched X social platform!',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
  },
  {
    id: 'notif_3',
    type: 'follow',
    sender: INITIAL_USERS[3],
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
];

export const INITIAL_TRENDS: TrendItem[] = [
  { id: '1', category: 'Global Transmissions · Trending', topic: '#VYORA', postsCount: '158.2K transmissions', trendingRank: 1 },
  { id: '2', category: 'Infrastructure · Trending', topic: '#PostgreSQL', postsCount: '45.2K posts', trendingRank: 2 },
  { id: '3', category: 'Edge Relay · Trending', topic: 'Multi-CDN Routing', postsCount: '38.9K posts', trendingRank: 3 },
  { id: '4', category: 'Architecture · Trending', topic: '#DecoupledNodeAPI', postsCount: '52.1K posts', trendingRank: 4 },
  { id: '5', category: 'Relay Protocol · Trending', topic: 'Aurora Core v3', postsCount: '29.3K posts', trendingRank: 5 },
];

export const INITIAL_MESSAGES: Message[] = [
  {
    id: 'msg_1',
    senderId: 'user_elon',
    recipientId: 'user_mukit',
    text: 'Great job launching this clean social platform! Love the zero-lag responsive feel.',
    createdAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
    isSender: false,
  },
  {
    id: 'msg_2',
    senderId: 'user_mukit',
    recipientId: 'user_elon',
    text: 'Thank you! The modular architecture and multi-CDN support makes it super fast.',
    createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    isSender: true,
  },
  {
    id: 'msg_3',
    senderId: 'user_elon',
    recipientId: 'user_mukit',
    text: 'Keep shipping! Let me know if you need any feedback on the database schema.',
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    isSender: false,
  },
];

// In-Memory store instance for ultra-fast, reliable state
class Store {
  public users: Map<string, User> = new Map();
  public userCredentials: Map<string, string> = new Map(); // userId -> password
  public sessions: Map<string, { token: string; userId: string; createdAt: string }> = new Map(); // token -> session
  public posts: Map<string, Post> = new Map();
  public likes: Set<string> = new Set(); // "userId:postId"
  public reposts: Set<string> = new Set(); // "userId:postId"
  public bookmarks: Set<string> = new Set(); // "userId:postId"
  public follows: Set<string> = new Set(); // "followerId:followingId"
  public notifications: Notification[] = [];
  public messages: Message[] = [];
  public trends: TrendItem[] = [...INITIAL_TRENDS];

  constructor() {
    this.reset();
  }

  public reset() {
    this.users.clear();
    this.userCredentials.clear();
    this.sessions.clear();
    this.posts.clear();
    this.likes.clear();
    this.reposts.clear();
    this.bookmarks.clear();
    this.follows.clear();

    INITIAL_USERS.forEach(u => {
      this.users.set(u.id, { ...u });
      // Default initial passwords for seed accounts
      this.userCredentials.set(u.id, 'vyora123');
    });

    INITIAL_POSTS.forEach(p => this.posts.set(p.id, { ...p }));
    this.notifications = [...INITIAL_NOTIFICATIONS];
    this.messages = [...INITIAL_MESSAGES];

    // Seed sample follows
    this.follows.add('user_mukit:user_elon');
    this.follows.add('user_mukit:user_tech');
    this.follows.add('user_mukit:user_design');

    // Seed sample likes & bookmarks for current user
    this.likes.add('user_mukit:post_3');
    this.bookmarks.add('user_mukit:post_3');
    this.reposts.add('user_mukit:post_4');

    // Seed a default session for instant access if needed
    const defaultToken = 'vyora_token_mukit_primary';
    this.sessions.set(defaultToken, {
      token: defaultToken,
      userId: 'user_mukit',
      createdAt: new Date().toISOString(),
    });
  }
}

export const inMemoryStore = new Store();

