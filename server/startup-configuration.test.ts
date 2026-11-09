import test from 'node:test';
import assert from 'node:assert/strict';
import { validateServerConfiguration, validateMigrationConfiguration, validateDatabaseUrl } from './config.ts';

test('Separated Server Startup and Migration Architecture', async (t) => {
  const origEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...origEnv };
  });

  await t.test('validateServerConfiguration succeeds with DATABASE_URL alone', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/neondb';
    delete process.env.DATABASE_URL_DIRECT;
    process.env.RATE_LIMIT_HMAC_SECRET = '012345678901234567890123456789012';
    process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
    process.env.B2_REGION = 'us-west-004';
    process.env.B2_BUCKET = 'bucket';
    process.env.B2_KEY_ID = 'key';
    process.env.B2_APPLICATION_KEY = 'appkey';

    // Must not throw even though DATABASE_URL_DIRECT is missing
    assert.doesNotThrow(() => {
      validateServerConfiguration();
    });
  });

  await t.test('validateServerConfiguration fails if DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    assert.throws(
      () => validateServerConfiguration(),
      /DATABASE_URL is required/,
    );
  });

  await t.test('validateMigrationConfiguration fails if DATABASE_URL_DIRECT is missing', () => {
    delete process.env.DATABASE_URL_DIRECT;
    assert.throws(
      () => validateMigrationConfiguration(),
      /DATABASE_URL_DIRECT is required for migrations/,
    );
  });

  await t.test('validateMigrationConfiguration fails if DATABASE_URL_DIRECT is not postgres protocol', () => {
    process.env.DATABASE_URL_DIRECT = 'http://localhost:5432/neondb';
    assert.throws(
      () => validateMigrationConfiguration(),
      /DATABASE_URL_DIRECT must use the PostgreSQL protocol/,
    );
  });

  await t.test('validateMigrationConfiguration succeeds with valid direct postgres url', () => {
    process.env.DATABASE_URL_DIRECT = 'postgresql://user:pass@localhost:5432/neondb';
    assert.doesNotThrow(() => {
      validateMigrationConfiguration();
    });
  });
});
