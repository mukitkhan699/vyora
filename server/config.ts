import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const parentDir = path.resolve(configDir, '..');
const rootDir = path.basename(parentDir) === 'dist' ? path.resolve(parentDir, '..') : parentDir;

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

export function validateServerConfiguration(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }

  const directDatabaseUrl = process.env.DATABASE_URL_DIRECT?.trim();
  if (!directDatabaseUrl) throw new Error('DATABASE_URL_DIRECT is required for migrations.');
  try {
    new URL(directDatabaseUrl);
  } catch {
    throw new Error('DATABASE_URL_DIRECT must be a valid PostgreSQL connection URL.');
  }

  const trustProxyHopsRaw = process.env.TRUST_PROXY_HOPS?.trim();
  if (trustProxyHopsRaw !== undefined) {
    const parsed = Number.parseInt(trustProxyHopsRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) {
      throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 5.');
    }
    if (parsed > 0) {
      console.warn('[config] TRUST_PROXY_HOPS > 0 is set. Ensure all reverse proxies are trusted and overwrite X-Forwarded-For correctly. Misconfiguration enables IP spoofing.');
    }
  }

  const rateLimitHmacSecret = process.env.RATE_LIMIT_HMAC_SECRET?.trim();
  if (!rateLimitHmacSecret) {
    throw new Error('RATE_LIMIT_HMAC_SECRET is required for secure IP hashing in rate limits.');
  }
  if (rateLimitHmacSecret.length < 32) {
    throw new Error('RATE_LIMIT_HMAC_SECRET must be at least 32 characters.');
  }

  const requiredB2Variables = [
    'B2_ENDPOINT',
    'B2_REGION',
    'B2_BUCKET',
    'B2_KEY_ID',
    'B2_APPLICATION_KEY',
  ];
  const missingB2Variables = requiredB2Variables.filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missingB2Variables.length) {
    throw new Error(`Missing required Backblaze configuration: ${missingB2Variables.join(', ')}.`);
  }
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value !== 'false' && value !== '0';
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
  adminOrigin: string | undefined;
  trustProxyHops: number;
  rateLimitHmacSecret: string;
  fileConfig: {
    uploadLimitBytes: number;
    allowedMimeTypes: string[];
  };
  mediaCatalog: {
    avatars: string[];
    attachments: string[];
  };
}

export const config: ServerConfig = {
  port: Number.parseInt(process.env.PORT || '3000', 10),
  appName: process.env.APP_NAME || 'Zunari',
  appTagline: process.env.APP_TAGLINE || 'Global Social Network',
  appDescription:
    process.env.APP_DESCRIPTION ||
    'A real-time social platform to share ideas, follow people, and join conversations.',
  brandIcon: 'Zunari',
  defaultTheme: (process.env.DEFAULT_THEME as ServerConfig['defaultTheme']) || 'dark',
  defaultAccentColor: (process.env.DEFAULT_ACCENT_COLOR as ServerConfig['defaultAccentColor']) || 'cyan',
  maxPostLength: Number.parseInt(process.env.MAX_POST_LENGTH || '280', 10),
  enablePolls: bool(process.env.ENABLE_POLLS, true),
  enableBookmarks: bool(process.env.ENABLE_BOOKMARKS, true),
  enableDirectMessages: bool(process.env.ENABLE_DIRECT_MESSAGES, true),
  allowMediaUploads: bool(process.env.ALLOW_MEDIA_UPLOADS, true),
  enableTelemetryPulse: true,
  adminOrigin: process.env.ADMIN_ORIGIN?.trim() || undefined,
  trustProxyHops: nonNegativeInt(process.env.TRUST_PROXY_HOPS, 0),
  rateLimitHmacSecret: process.env.RATE_LIMIT_HMAC_SECRET || '',
  fileConfig: {
    uploadLimitBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  },
  mediaCatalog: {
    avatars: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=300&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=300&auto=format&fit=crop&q=80',
    ],
    attachments: [
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1000&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1000&auto=format&fit=crop&q=80',
    ],
  },
};
