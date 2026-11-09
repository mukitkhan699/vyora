import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { applyMigrations, describeMigrationFailure, splitSqlStatements } from './migrate.ts';

/**
 * Destructive, opt-in migration-runner tests.
 *
 * These tests DROP and recreate the public schema. They must only ever run
 * against a dedicated disposable database explicitly supplied as
 * TEST_DATABASE_URL. They never read DATABASE_URL.
 *
 * Required environment:
 *   TEST_DATABASE_URL=postgres://...   (disposable non-production database)
 *   RUN_POSTGRES_INTEGRATION=1
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

function isDisposableDatabase(connectionString: string | undefined): boolean {
  if (!connectionString) return false;
  try {
    const parsed = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase();
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(host);
    return localHost || /(^|[-_])(test|testing|staging|ci)([-_]|$)/.test(databaseName);
  } catch {
    return false;
  }
}

const skipReason =
  !testDatabaseUrl || process.env.RUN_POSTGRES_INTEGRATION !== '1'
    ? 'Set TEST_DATABASE_URL and RUN_POSTGRES_INTEGRATION=1 to run destructive migration integration tests.'
    : applicationDatabaseUrl === testDatabaseUrl
      ? 'Refusing to run destructive migration tests against DATABASE_URL.'
      : process.env.NODE_ENV === 'production'
        ? 'Refusing to run destructive migration tests with NODE_ENV=production.'
        : !isDisposableDatabase(testDatabaseUrl)
          ? 'TEST_DATABASE_URL must be local or contain a test/staging/ci database name.'
          : undefined;

const MIGRATION_001 = '001_initial_schema.sql';
const MIGRATION_002 = '002_admin_roles_and_audit.sql';
const MIGRATION_003 = '003_fix_admin_permissions_and_sessions.sql';
const MIGRATION_004 = '004_reports_and_verification_gold.sql';
const MIGRATION_005 = '005_report_rate_limits.sql';

function createTestPool(): Pool {
  const isLocal = /(?:localhost|127\.0\.0\.1|\[::1\])/.test(testDatabaseUrl || '');
  return new Pool({
    connectionString: testDatabaseUrl,
    max: 2,
    ssl: isLocal ? false : { rejectUnauthorized: true },
  });
}

async function resetPublicSchema(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

async function withMigrationSubset<T>(
  filenames: string[],
  work: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), 'zunari-migrations-'));
  try {
    for (const filename of filenames) {
      await cp(path.join(migrationsDir, filename), path.join(directory, filename));
    }
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executeSqlFile(pool: Pool, filePath: string): Promise<void> {
  const statements = splitSqlStatements(await readFile(filePath, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ledgerVersions(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ version: string }>(
    'SELECT version FROM zunari_schema_migrations ORDER BY version',
  );
  return result.rows.map((row) => row.version);
}

async function insertUser(
  pool: Pool,
  publicId: string,
  username: string,
  adminRole: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO zunari_users (public_id, username, name, email, created_at, admin_role)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [publicId, username, username, `${username}@example.test`, Date.now(), adminRole],
  );
}

describe('migration runner (real disposable PostgreSQL)', { skip: skipReason, concurrency: 1 }, () => {
  let pool: Pool;
  let lockCounter = 9_100_000;

  beforeEach(async () => {
    pool = createTestPool();
    await resetPublicSchema(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  const nextLockId = (): number => {
    lockCounter += 1;
    return lockCounter;
  };

  test('fresh installation applies 001 through 005 and records checksums', async () => {
    await applyMigrations({
      pool,
      migrationsDir,
      lockId: nextLockId(),
      logger: () => undefined,
    });

    assert.deepEqual(await ledgerVersions(pool), [
      MIGRATION_001.slice(0, -4),
      MIGRATION_002.slice(0, -4),
      MIGRATION_003.slice(0, -4),
      MIGRATION_004.slice(0, -4),
      MIGRATION_005.slice(0, -4),
    ]);

    const schema = await pool.query<{
      reports_ready: boolean;
      rate_limits_ready: boolean;
      audit_nullable: boolean;
    }>(
      `SELECT
         to_regclass('public.zunari_user_reports') IS NOT NULL
           AND to_regclass('public.zunari_post_reports') IS NOT NULL AS reports_ready,
         to_regclass('public.zunari_rate_limits') IS NOT NULL AS rate_limits_ready,
         (SELECT NOT attnotnull
          FROM pg_attribute
          WHERE attrelid = 'public.zunari_admin_audit_log'::regclass
            AND attname = 'admin_id') AS audit_nullable`,
    );
    assert.equal(schema.rows[0]?.reports_ready, true);
    assert.equal(schema.rows[0]?.rate_limits_ready, true);
    assert.equal(schema.rows[0]?.audit_nullable, true);

    const checksumCount = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM zunari_schema_migrations
       WHERE checksum ~ '^[0-9a-f]{64}$'`,
    );
    assert.equal(checksumCount.rows[0]?.count, 5);
  });

  test('existing 001-003 installation upgrades through 004 and 005', async () => {
    await withMigrationSubset([MIGRATION_001, MIGRATION_002, MIGRATION_003], async (directory) => {
      await applyMigrations({
        pool,
        migrationsDir: directory,
        lockId: nextLockId(),
        logger: () => undefined,
      });
    });
    assert.deepEqual(await ledgerVersions(pool), [
      MIGRATION_001.slice(0, -4),
      MIGRATION_002.slice(0, -4),
      MIGRATION_003.slice(0, -4),
    ]);

    await applyMigrations({
      pool,
      migrationsDir,
      lockId: nextLockId(),
      logger: () => undefined,
    });
    assert.deepEqual(await ledgerVersions(pool), [
      MIGRATION_001.slice(0, -4),
      MIGRATION_002.slice(0, -4),
      MIGRATION_003.slice(0, -4),
      MIGRATION_004.slice(0, -4),
      MIGRATION_005.slice(0, -4),
    ]);
  });

  test('004 followed by 005 works and 005 is safe to execute repeatedly', async () => {
    await withMigrationSubset(
      [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004],
      async (directory) => {
        await applyMigrations({
          pool,
          migrationsDir: directory,
          lockId: nextLockId(),
          logger: () => undefined,
        });
      },
    );

    await executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005));
    await executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005));

    // The runner should also accept the already-correct idempotent SQL and
    // record it only once.
    await applyMigrations({
      pool,
      migrationsDir,
      lockId: nextLockId(),
      logger: () => undefined,
    });
    assert.deepEqual(await ledgerVersions(pool), [
      MIGRATION_001.slice(0, -4),
      MIGRATION_002.slice(0, -4),
      MIGRATION_003.slice(0, -4),
      MIGRATION_004.slice(0, -4),
      MIGRATION_005.slice(0, -4),
    ]);
  });

  test('duplicate active reports fail preflight, roll back, and recover after resolution', async () => {
    await withMigrationSubset(
      [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004],
      async (directory) => {
        await applyMigrations({
          pool,
          migrationsDir: directory,
          lockId: nextLockId(),
          logger: () => undefined,
        });
      },
    );
    await pool.query('DROP INDEX zunari_user_reports_unique_active');
    const reporterId = `reporter_${randomUUID()}`;
    const reportedId = `reported_${randomUUID()}`;
    await insertUser(pool, reporterId, `reporter_${randomUUID().slice(0, 8)}`);
    await insertUser(pool, reportedId, `reported_${randomUUID().slice(0, 8)}`);
    for (let index = 0; index < 2; index += 1) {
      await pool.query(
        `INSERT INTO zunari_user_reports
           (id, reporter_id, reported_user_id, reason, status, created_at)
         VALUES ($1, $2, $3, 'spam', 'pending', $4)`,
        [`report_dup_${index}_${randomUUID()}`, reporterId, reportedId, Date.now()],
      );
    }

    await assert.rejects(
      executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005)),
      /duplicate active user report group/i,
    );

    const rolledBack = await pool.query<{ rate_limits: boolean; snapshot_column: boolean }>(
      `SELECT
         to_regclass('public.zunari_rate_limits') IS NOT NULL AS rate_limits,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'zunari_user_reports'
             AND column_name = 'reporter_id_snapshot'
         ) AS snapshot_column`,
    );
    assert.equal(rolledBack.rows[0]?.rate_limits, false);
    assert.equal(rolledBack.rows[0]?.snapshot_column, false);

    await pool.query(
      `UPDATE zunari_user_reports
       SET status = 'dismissed'
       WHERE reporter_id = $1 AND reported_user_id = $2`,
      [reporterId, reportedId],
    );
    await executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005));

    const recovered = await pool.query<{ rate_limits: boolean; report_count: number }>(
      `SELECT
         to_regclass('public.zunari_rate_limits') IS NOT NULL AS rate_limits,
         (SELECT count(*)::integer FROM zunari_user_reports
          WHERE reporter_id = $1 AND reported_user_id = $2) AS report_count`,
      [reporterId, reportedId],
    );
    assert.equal(recovered.rows[0]?.rate_limits, true);
    assert.equal(recovered.rows[0]?.report_count, 2);
  });

  test('orphaned audit actors fail preflight and preserve the audit row', async () => {
    await withMigrationSubset(
      [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004],
      async (directory) => {
        await applyMigrations({
          pool,
          migrationsDir: directory,
          lockId: nextLockId(),
          logger: () => undefined,
        });
      },
    );
    await pool.query(
      'ALTER TABLE zunari_admin_audit_log DROP CONSTRAINT zunari_admin_audit_log_admin_id_fkey',
    );
    const orphanAdminId = `missing_admin_${randomUUID()}`;
    const auditId = `audit_orphan_${randomUUID()}`;
    await pool.query(
      `INSERT INTO zunari_admin_audit_log
         (id, admin_id, action, target_type, target_id, metadata, created_at)
       VALUES ($1, $2, 'test.orphan', 'user', 'target', '{}'::jsonb, $3)`,
      [auditId, orphanAdminId, Date.now()],
    );

    await assert.rejects(
      executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005)),
      /audit row\(s\) reference a missing admin_id/i,
    );

    const preserved = await pool.query<{ admin_id: string; not_null: boolean }>(
      `SELECT a.admin_id,
              (SELECT attnotnull
               FROM pg_attribute
               WHERE attrelid = 'public.zunari_admin_audit_log'::regclass
                 AND attname = 'admin_id') AS not_null
       FROM zunari_admin_audit_log a
       WHERE a.id = $1`,
      [auditId],
    );
    assert.equal(preserved.rows[0]?.admin_id, orphanAdminId);
    assert.equal(preserved.rows[0]?.not_null, true);

    await insertUser(pool, orphanAdminId, `restored_${randomUUID().slice(0, 8)}`);
    await executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005));
    const repaired = await pool.query<{ admin_id: string }>(
      'SELECT admin_id FROM zunari_admin_audit_log WHERE id = $1',
      [auditId],
    );
    assert.equal(repaired.rows[0]?.admin_id, orphanAdminId);
  });

  test('005 fails clearly when migration 004 has not been applied', async () => {
    await withMigrationSubset([MIGRATION_001, MIGRATION_002, MIGRATION_003], async (directory) => {
      await applyMigrations({
        pool,
        migrationsDir: directory,
        lockId: nextLockId(),
        logger: () => undefined,
      });
    });

    await assert.rejects(
      executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005)),
      /requires migration 004/i,
    );
    const rateLimits = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.zunari_rate_limits') IS NOT NULL AS exists`,
    );
    assert.equal(rateLimits.rows[0]?.exists, false);
  });

  test('005 detects a conflicting same-named index by its actual definition', async () => {
    await withMigrationSubset(
      [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004],
      async (directory) => {
        await applyMigrations({
          pool,
          migrationsDir: directory,
          lockId: nextLockId(),
          logger: () => undefined,
        });
      },
    );
    await pool.query('DROP INDEX zunari_user_reports_unique_active');
    await pool.query(
      'CREATE INDEX zunari_user_reports_unique_active ON zunari_user_reports(reporter_id)',
    );

    await assert.rejects(
      executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005)),
      /index conflict: zunari_user_reports_unique_active/i,
    );

    await pool.query('DROP INDEX zunari_user_reports_unique_active');
    await executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005));
  });

  test('005 detects a conflicting audit foreign key by its actual target', async () => {
    await withMigrationSubset(
      [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004],
      async (directory) => {
        await applyMigrations({
          pool,
          migrationsDir: directory,
          lockId: nextLockId(),
          logger: () => undefined,
        });
      },
    );
    await pool.query(
      'ALTER TABLE zunari_admin_audit_log DROP CONSTRAINT zunari_admin_audit_log_admin_id_fkey',
    );
    await pool.query(
      `ALTER TABLE zunari_admin_audit_log
       ADD CONSTRAINT zunari_admin_audit_log_admin_id_fkey
       FOREIGN KEY (admin_id) REFERENCES zunari_posts(id) ON DELETE RESTRICT`,
    );

    await assert.rejects(
      executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005)),
      /FK conflict: constraint zunari_admin_audit_log_admin_id_fkey/i,
    );

    await pool.query(
      'ALTER TABLE zunari_admin_audit_log DROP CONSTRAINT zunari_admin_audit_log_admin_id_fkey',
    );
    await executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005));
  });

  test('legacy report snapshots are backfilled safely and unchanged rows are preserved', async () => {
    await withMigrationSubset(
      [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004],
      async (directory) => {
        await applyMigrations({
          pool,
          migrationsDir: directory,
          lockId: nextLockId(),
          logger: () => undefined,
        });
      },
    );

    const reporterId = `legacy_reporter_${randomUUID()}`;
    const reportedId = `legacy_reported_${randomUUID()}`;
    const postId = `legacy_post_${randomUUID()}`;
    const reporterUsername = `legacy_reporter_${randomUUID().slice(0, 8)}`;
    const reportedUsername = `legacy_reported_${randomUUID().slice(0, 8)}`;
    const postContent = `legacy post ${randomUUID()}`;
    await insertUser(pool, reporterId, reporterUsername);
    await insertUser(pool, reportedId, reportedUsername);
    await pool.query(
      `INSERT INTO zunari_posts (id, author_id, content, created_at)
       VALUES ($1, $2, $3, $4)`,
      [postId, reportedId, postContent, Date.now()],
    );
    const userReportId = `legacy_user_report_${randomUUID()}`;
    const postReportId = `legacy_post_report_${randomUUID()}`;
    await pool.query(
      `INSERT INTO zunari_user_reports
         (id, reporter_id, reported_user_id, reason, status, created_at)
       VALUES ($1, $2, $3, 'spam', 'pending', $4)`,
      [userReportId, reporterId, reportedId, Date.now()],
    );
    await pool.query(
      `INSERT INTO zunari_post_reports
         (id, reporter_id, post_id, reason, status, created_at)
       VALUES ($1, $2, $3, 'hate', 'pending', $4)`,
      [postReportId, reporterId, postId, Date.now()],
    );

    const preservedSnapshotReportId = `legacy_preserved_snapshot_${randomUUID()}`;
    await pool.query(
      `INSERT INTO zunari_user_reports
         (id, reporter_id, reported_user_id, reason, status, created_at,
          reporter_username_snapshot, reported_username_snapshot)
       VALUES ($1, $2, $3, 'spam', 'dismissed', $4, 'sentinel_reporter', 'sentinel_reported')`,
      [preservedSnapshotReportId, reporterId, reportedId, Date.now()],
    );

    const unrecoverableReportId = `legacy_unrecoverable_${randomUUID()}`;
    const deletedTargetId = `legacy_deleted_target_${randomUUID()}`;
    await insertUser(pool, deletedTargetId, `legacy_deleted_${randomUUID().slice(0, 8)}`);
    await pool.query(
      `INSERT INTO zunari_user_reports
         (id, reporter_id, reported_user_id, reason, status, created_at)
       VALUES ($1, $2, $3, 'spam', 'dismissed', $4)`,
      [unrecoverableReportId, reporterId, deletedTargetId, Date.now()],
    );
    await pool.query('DELETE FROM zunari_users WHERE public_id = $1', [deletedTargetId]);
    await pool.query(
      'UPDATE zunari_user_reports SET status = $1 WHERE id = $2',
      ['dismissed', userReportId],
    );

    await executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005));
    await executeSqlFile(pool, path.join(migrationsDir, MIGRATION_005));

    const userSnapshots = await pool.query<{
      reporter_id_snapshot: string | null;
      reported_user_id_snapshot: string | null;
      reporter_username_snapshot: string | null;
      reported_username_snapshot: string | null;
    }>(
      `SELECT reporter_id_snapshot, reported_user_id_snapshot,
              reporter_username_snapshot, reported_username_snapshot
       FROM zunari_user_reports WHERE id = $1`,
      [userReportId],
    );
    assert.equal(userSnapshots.rows[0]?.reporter_id_snapshot, reporterId);
    assert.equal(userSnapshots.rows[0]?.reporter_username_snapshot, reporterUsername);
    assert.equal(userSnapshots.rows[0]?.reported_user_id_snapshot, null);
    assert.equal(userSnapshots.rows[0]?.reported_username_snapshot, null);

    const postSnapshots = await pool.query<{
      reporter_id_snapshot: string | null;
      post_id_snapshot: string | null;
      reporter_username_snapshot: string | null;
      post_preview_snapshot: string | null;
    }>(
      `SELECT reporter_id_snapshot, post_id_snapshot,
              reporter_username_snapshot, post_preview_snapshot
       FROM zunari_post_reports WHERE id = $1`,
      [postReportId],
    );
    assert.equal(postSnapshots.rows[0]?.reporter_id_snapshot, reporterId);
    assert.equal(postSnapshots.rows[0]?.post_id_snapshot, postId);
    assert.equal(postSnapshots.rows[0]?.reporter_username_snapshot, reporterUsername);
    assert.equal(postSnapshots.rows[0]?.post_preview_snapshot, postContent);

    const preserved = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM zunari_user_reports WHERE id = $1',
      [unrecoverableReportId],
    );
    assert.equal(preserved.rows[0]?.count, 1);

    const preservedSnapshot = await pool.query<{
      reporter_username_snapshot: string;
      reported_username_snapshot: string;
    }>(
      `SELECT reporter_username_snapshot, reported_username_snapshot
       FROM zunari_user_reports WHERE id = $1`,
      [preservedSnapshotReportId],
    );
    assert.equal(preservedSnapshot.rows[0]?.reporter_username_snapshot, 'sentinel_reporter');
    assert.equal(preservedSnapshot.rows[0]?.reported_username_snapshot, 'sentinel_reported');
  });

  test('deleting an admin preserves audit history and sets admin_id to NULL', async () => {
    await applyMigrations({
      pool,
      migrationsDir,
      lockId: nextLockId(),
      logger: () => undefined,
    });
    const adminId = `admin_${randomUUID()}`;
    await insertUser(pool, adminId, `admin_${randomUUID().slice(0, 8)}`, 'admin');
    const auditId = `audit_preserved_${randomUUID()}`;
    await pool.query(
      `INSERT INTO zunari_admin_audit_log
         (id, admin_id, action, target_type, target_id, metadata, created_at)
       VALUES ($1, $2, 'user.verify', 'user', 'target', $3::jsonb, $4)`,
      [auditId, adminId, JSON.stringify({ previous_verified: false, new_verified: true }), Date.now()],
    );

    await pool.query('DELETE FROM zunari_users WHERE public_id = $1', [adminId]);

    const preserved = await pool.query<{ admin_id: string | null; action: string }>(
      'SELECT admin_id, action FROM zunari_admin_audit_log WHERE id = $1',
      [auditId],
    );
    assert.equal(preserved.rows[0]?.admin_id, null);
    assert.equal(preserved.rows[0]?.action, 'user.verify');
  });

  test('checksum mismatch blocks re-application without changing the ledger', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'zunari-checksum-'));
    try {
      const filename = '001_checksum_test.sql';
      const filePath = path.join(directory, filename);
      await writeFile(filePath, 'CREATE TABLE checksum_test (id TEXT PRIMARY KEY);\n', 'utf8');
      await applyMigrations({
        pool,
        migrationsDir: directory,
        lockId: nextLockId(),
        logger: () => undefined,
      });
      const before = await pool.query<{ checksum: string }>(
        'SELECT checksum FROM zunari_schema_migrations WHERE version = $1',
        ['001_checksum_test'],
      );

      await writeFile(filePath, 'CREATE TABLE checksum_test (id TEXT PRIMARY KEY);\n-- changed\n', 'utf8');
      await assert.rejects(
        applyMigrations({
          pool,
          migrationsDir: directory,
          lockId: nextLockId(),
          logger: () => undefined,
        }),
        (error: unknown) => /checksum mismatch/i.test(describeMigrationFailure(error)),
      );
      const after = await pool.query<{ checksum: string }>(
        'SELECT checksum FROM zunari_schema_migrations WHERE version = $1',
        ['001_checksum_test'],
      );
      assert.equal(after.rows[0]?.checksum, before.rows[0]?.checksum);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('partial migration failure rolls back the failed file and recovers after a fix', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'zunari-partial-'));
    try {
      await writeFile(
        path.join(directory, '001_first.sql'),
        'CREATE TABLE first_table (id TEXT PRIMARY KEY);\n',
        'utf8',
      );
      await writeFile(
        path.join(directory, '002_second.sql'),
        'CREATE TABLE second_table (id TEXT PRIMARY KEY);\nTHIS IS NOT VALID SQL;\n',
        'utf8',
      );

      await assert.rejects(
        applyMigrations({
          pool,
          migrationsDir: directory,
          lockId: nextLockId(),
          logger: () => undefined,
        }),
        /Migration failed during executing migration SQL/i,
      );

      assert.deepEqual(await ledgerVersions(pool), ['001_first']);
      const failedTable = await pool.query<{ second_table: boolean }>(
        `SELECT to_regclass('public.second_table') IS NOT NULL AS second_table`,
      );
      assert.equal(failedTable.rows[0]?.second_table, false);

      await writeFile(
        path.join(directory, '002_second.sql'),
        'CREATE TABLE second_table (id TEXT PRIMARY KEY);\n',
        'utf8',
      );
      await applyMigrations({
        pool,
        migrationsDir: directory,
        lockId: nextLockId(),
        logger: () => undefined,
      });
      assert.deepEqual(await ledgerVersions(pool), ['001_first', '002_second']);
      const recoveredTable = await pool.query<{ second_table: boolean }>(
        `SELECT to_regclass('public.second_table') IS NOT NULL AS second_table`,
      );
      assert.equal(recoveredTable.rows[0]?.second_table, true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
