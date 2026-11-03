import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(): void {
  const candidates = [path.join(rootDir, '.env'), path.join(process.cwd(), '.env')];
  for (const candidate of candidates) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // No .env file, or this Node version cannot load it: environment variables win.
    }
  }
}

readEnvFile();

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value !== 'false' && value !== '0';
}

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

const rawCdns =
  process.env.CDN_URLS ||
  process.env.VITE_CDN_URLS ||
  'https://images.unsplash.com,https://picsum.photos,https://avatars.githubusercontent.com';
const parsedCdns = rawCdns
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

export const config: ServerConfig = {
  port: Number.parseInt(process.env.PORT || '3000', 10),
  appName: process.env.APP_NAME || 'VYORA',
  appTagline: process.env.APP_TAGLINE || 'Decoupled Global Social Intelligence Network',
  appDescription:
    process.env.APP_DESCRIPTION ||
    'High-frequency social transmission platform powered by an autonomous dependency-free Node.js API, multi-CDN edge relay, and SQLite-backed authentication.',
  brandIcon: 'VYORA',
  defaultTheme: (process.env.DEFAULT_THEME as ServerConfig['defaultTheme']) || 'dark',
  defaultAccentColor: (process.env.DEFAULT_ACCENT_COLOR as ServerConfig['defaultAccentColor']) || 'cyan',
  maxPostLength: Number.parseInt(process.env.MAX_POST_LENGTH || '280', 10),
  enablePolls: bool(process.env.ENABLE_POLLS, true),
  enableBookmarks: bool(process.env.ENABLE_BOOKMARKS, true),
  enableDirectMessages: bool(process.env.ENABLE_DIRECT_MESSAGES, true),
  allowMediaUploads: bool(process.env.ALLOW_MEDIA_UPLOADS, true),
  enableTelemetryPulse: true,
  cdnUrls: parsedCdns.length > 0
    ? parsedCdns
    : ['https://images.unsplash.com', 'https://picsum.photos', 'https://avatars.githubusercontent.com'],
  fileConfig: {
    uploadLimitBytes: 10 * 1024 * 1024,
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
