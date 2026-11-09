import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateServerConfiguration, validateMigrationConfiguration } from '../config.ts';
import { verifyDatabase } from './pool.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Server configuration and migration connection separation', () => {
  test('validateServerConfiguration succeeds with DATABASE_URL alone and without DATABASE_URL_DIRECT', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.DATABASE_URL = 'postgresql://user:pass@pooler.neon.tech/neondb?sslmode=require';
      delete process.env.DATABASE_URL_DIRECT;
      process.env.RATE_LIMIT_HMAC_SECRET = '012345678901234567890123456789012';
      process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
      process.env.B2_REGION = 'us-west-004';
      process.env.B2_BUCKET = 'test-bucket';
      process.env.B2_KEY_ID = 'test-key-id';
      process.env.B2_APPLICATION_KEY = 'test-app-key';

      assert.doesNotThrow(() => {
        validateServerConfiguration();
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('validateServerConfiguration reports missing runtime configuration variables accurately', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.DATABASE_URL = 'postgresql://user:pass@pooler.neon.tech/neondb?sslmode=require';
      process.env.RATE_LIMIT_HMAC_SECRET = '012345678901234567890123456789012';
      process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
      process.env.B2_REGION = 'us-west-004';
      process.env.B2_BUCKET = 'test-bucket';
      process.env.B2_KEY_ID = 'test-key-id';
      process.env.B2_APPLICATION_KEY = 'test-app-key';

      // 1. Missing DATABASE_URL
      delete process.env.DATABASE_URL;
      assert.throws(() => validateServerConfiguration(), { message: 'DATABASE_URL is required.' });

      // 2. Malformed DATABASE_URL
      process.env.DATABASE_URL = 'not_a_valid_url';
      assert.throws(() => validateServerConfiguration(), { message: 'DATABASE_URL must be a valid PostgreSQL connection URL.' });

      process.env.DATABASE_URL = 'http://localhost:5432/db';
      assert.throws(() => validateServerConfiguration(), { message: 'DATABASE_URL must use the PostgreSQL protocol.' });

      process.env.DATABASE_URL = 'postgresql://user:pass@pooler.neon.tech/neondb?sslmode=require';

      // 3. Missing or short RATE_LIMIT_HMAC_SECRET
      delete process.env.RATE_LIMIT_HMAC_SECRET;
      assert.throws(() => validateServerConfiguration(), { message: 'RATE_LIMIT_HMAC_SECRET is required for secure IP hashing in rate limits.' });

      process.env.RATE_LIMIT_HMAC_SECRET = 'short';
      assert.throws(() => validateServerConfiguration(), { message: 'RATE_LIMIT_HMAC_SECRET must be at least 32 characters.' });

      process.env.RATE_LIMIT_HMAC_SECRET = '012345678901234567890123456789012';

      // 4. Missing Backblaze configuration
      delete process.env.B2_BUCKET;
      delete process.env.B2_KEY_ID;
      assert.throws(() => validateServerConfiguration(), (err: unknown) => {
        return err instanceof Error && err.message.includes('Missing required Backblaze configuration: B2_BUCKET, B2_KEY_ID.');
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('validateMigrationConfiguration throws clear error if DATABASE_URL_DIRECT is missing', () => {
    const originalEnv = { ...process.env };
    try {
      delete process.env.DATABASE_URL_DIRECT;
      assert.throws(
        () => {
          validateMigrationConfiguration();
        },
        {
          name: 'Error',
          message: 'DATABASE_URL_DIRECT is required for migrations.',
        },
      );
    } finally {
      process.env = originalEnv;
    }
  });

  test('validateMigrationConfiguration throws clear error if DATABASE_URL_DIRECT is not a valid PostgreSQL URL', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.DATABASE_URL_DIRECT = 'not-a-valid-url';
      assert.throws(
        () => {
          validateMigrationConfiguration();
        },
        {
          name: 'Error',
          message: 'DATABASE_URL_DIRECT must be a valid PostgreSQL connection URL.',
        },
      );

      process.env.DATABASE_URL_DIRECT = 'http://localhost:5432/db';
      assert.throws(
        () => {
          validateMigrationConfiguration();
        },
        {
          name: 'Error',
          message: 'DATABASE_URL_DIRECT must use the PostgreSQL protocol.',
        },
      );
    } finally {
      process.env = originalEnv;
    }
  });

  test('validateMigrationConfiguration succeeds with a valid PostgreSQL URL', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.DATABASE_URL_DIRECT = 'postgresql://user:pass@ep-direct.neon.tech/neondb?sslmode=require';
      assert.doesNotThrow(() => {
        validateMigrationConfiguration();
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('initializeBackend does not import or invoke applyMigrations or getMigrationPool', async () => {
    const bootstrapContent = await readFile(path.join(rootDir, 'server', 'bootstrap.ts'), 'utf8');
    assert.doesNotMatch(bootstrapContent, /applyMigrations/);
    assert.doesNotMatch(bootstrapContent, /getMigrationPool/);
  });

  test('initAuth in server/auth.ts does not call verifyDatabase', async () => {
    const authContent = await readFile(path.join(rootDir, 'server', 'auth.ts'), 'utf8');
    const initAuthMatch = /export async function initAuth\(\): Promise<void> \{([\s\S]*?)\}/.exec(authContent);
    assert.ok(initAuthMatch, 'initAuth function should be defined');
    assert.doesNotMatch(initAuthMatch[1], /await\s+verifyDatabase\(\)/);
  });

  test('server startup path does not contain migration runner invocations', async () => {
    const serverContent = await readFile(path.join(rootDir, 'server.ts'), 'utf8');
    assert.doesNotMatch(serverContent, /applyMigrations/);
    assert.doesNotMatch(serverContent, /run-migrations/);
  });

  test('missing required schema triggers clear readiness failure', async () => {
    const originalEnv = { ...process.env };
    try {
      process.env.DATABASE_URL = 'postgresql://invalid:invalid@127.0.0.1:59999/invalid?sslmode=disable';
      await assert.rejects(async () => {
        await verifyDatabase();
      });
    } finally {
      process.env = originalEnv;
    }
  });
});
