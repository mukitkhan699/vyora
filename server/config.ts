import dotenv from 'dotenv';
dotenv.config();

export interface ServerConfig {
  port: number;
  appName: string;
  appTagline: string;
  appDescription: string;
  brandIcon: string;
  defaultTheme: 'dark' | 'dim' | 'light';
  defaultAccentColor: 'cyan' | 'violet' | 'amber' | 'emerald' | 'coral' | 'blue';
  maxPostLength: number;
  enablePolls: boolean;
  enableBookmarks: boolean;
  enableDirectMessages: boolean;
  allowMediaUploads: boolean;
  enableTelemetryPulse: boolean;
  cdnUrls: string[];
  fileConfig: {
    uploadLimitBytes: number;
    filesBaseUrl: string;
    allowedMimeTypes: string[];
  };
  mediaCatalog: {
    avatars: string[];
    attachments: string[];
  };
  database: {
    type: 'postgres' | 'memory' | 'auto';
    url?: string;
    host: string;
    port: number;
    user: string;
    password?: string;
    database: string;
    ssl: boolean;
  };
  endpoints: {
    config: string;
    cdnHealth: string;
    posts: string;
    users: string;
    bookmarks: string;
    notifications: string;
    messages: string;
    trends: string;
    backendCode: string;
    upload: string;
    files: string;
    mediaCatalog: string;
  };
}

// Parse comma-separated CDN links from environment
const rawCdns = process.env.CDN_URLS || process.env.VITE_CDN_URLS || 'https://images.unsplash.com,https://picsum.photos,https://avatars.githubusercontent.com';
const parsedCdns = rawCdns
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const config: ServerConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  appName: process.env.APP_NAME || 'VYORA',
  appTagline: process.env.APP_TAGLINE || 'Decoupled Global Social Intelligence Network',
  appDescription: process.env.APP_DESCRIPTION || 'High-frequency social transmission platform powered by an autonomous Node.js API, multi-CDN edge relay, and PostgreSQL.',
  brandIcon: 'VYORA',
  defaultTheme: (process.env.DEFAULT_THEME as 'dark' | 'dim' | 'light') || 'dark',
  defaultAccentColor: (process.env.DEFAULT_ACCENT_COLOR as any) || 'cyan',
  maxPostLength: parseInt(process.env.MAX_POST_LENGTH || '280', 10),
  enablePolls: process.env.ENABLE_POLLS !== 'false',
  enableBookmarks: process.env.ENABLE_BOOKMARKS !== 'false',
  enableDirectMessages: process.env.ENABLE_DIRECT_MESSAGES !== 'false',
  allowMediaUploads: process.env.ALLOW_MEDIA_UPLOADS !== 'false',
  enableTelemetryPulse: true,
  cdnUrls: parsedCdns.length > 0 ? parsedCdns : [
    'https://images.unsplash.com',
    'https://picsum.photos',
    'https://avatars.githubusercontent.com'
  ],
  fileConfig: {
    uploadLimitBytes: 10 * 1024 * 1024, // 10MB
    filesBaseUrl: '/api/files',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  },
  mediaCatalog: {
    avatars: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=300&auto=format&fit=crop&q=80',
    ],
    attachments: [
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1000&auto=format&fit=crop&q=80',
    ],
  },
  database: {
    type: (process.env.DATABASE_TYPE as 'postgres' | 'memory' | 'auto') || 'auto',
    url: process.env.DATABASE_URL,
    host: process.env.SQL_HOST || 'localhost',
    port: parseInt(process.env.SQL_PORT || '5432', 10),
    user: process.env.SQL_USER || 'postgres',
    password: process.env.SQL_PASSWORD || '',
    database: process.env.SQL_DB_NAME || 'vyora_social',
    ssl: process.env.SQL_SSL === 'true',
  },
  endpoints: {
    config: '/api/config',
    cdnHealth: '/api/cdn/health',
    posts: '/api/posts',
    users: '/api/users',
    bookmarks: '/api/bookmarks',
    notifications: '/api/notifications',
    messages: '/api/messages',
    trends: '/api/trends',
    backendCode: '/api/backend-code',
    upload: '/api/upload',
    files: '/api/files',
    mediaCatalog: '/api/media/catalog',
  },
};

