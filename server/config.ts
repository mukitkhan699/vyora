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
};
