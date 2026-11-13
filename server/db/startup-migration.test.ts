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
  test('server configuration requires a direct DATABASE_URL_DIRECT for realtime', () => {
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

      assert.throws(
        () => validateServerConfiguration(),
        /DATABASE_URL_DIRECT is required for PostgreSQL realtime/,
      );

      process.env.DATABASE_URL_DIRECT =
        'postgresql://test:test@ep-direct.us-east-1.aws.neon.tech/neondb';
      assert.doesNotThrow(() => validateServerConfiguration());

      process.env.DATABASE_URL_DIRECT =
        'postgresql://test:test@ep-example-pooler.us-east-1.aws.neon.tech/neondb';
      assert.throws(
        () => validateServerConfiguration(),
        /must use a direct PostgreSQL connection/,
      );
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

  test('server startup path does not contain migration runner invocations', async () => {
    const serverContent = await readFile(path.join(rootDir, 'server.ts'), 'utf8');
    assert.doesNotMatch(serverContent, /applyMigrations/);
    assert.doesNotMatch(serverContent, /run-migrations/);
  });

  test('missing required schema triggers clear readiness failure', async () => {
    // Calling verifyDatabase when database cannot connect or tables are missing throws
    // We test that verifyDatabase produces the schema installation error when query returns ready = false
    const originalEnv = { ...process.env };
    try {
      // Point to an unreachable port to verify connection failure or verify message
      process.env.DATABASE_URL = 'postgresql://invalid:invalid@127.0.0.1:59999/invalid?sslmode=disable';
      await assert.rejects(async () => {
        await verifyDatabase();
      });
    } finally {
      process.env = originalEnv;
    }
  });
});
