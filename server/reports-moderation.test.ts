import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

function readRepositoryFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const migration004 = readRepositoryFile('./db/migrations/004_reports_and_verification_gold.sql');
const migration005 = readRepositoryFile('./db/migrations/005_report_rate_limits.sql');
const adminDbSource = readRepositoryFile('./db/admin.ts');
const apiRouteSource = readRepositoryFile('./routes/api.ts');

describe('report snapshot schema (static migration verification)', () => {
  test('004 defines immutable reporter and target snapshot columns', () => {
    assert.match(migration004, /reporter_username_snapshot TEXT/);
    assert.match(migration004, /reported_username_snapshot TEXT/);
    assert.match(migration004, /reporter_username_snapshot TEXT/);
    assert.match(migration004, /post_preview_snapshot TEXT/);
  });

  test('report foreign keys preserve history with ON DELETE SET NULL', () => {
    assert.match(
      migration004,
      /reporter_id TEXT REFERENCES zunari_users\(public_id\) ON DELETE SET NULL/,
    );
    assert.match(
      migration004,
      /reported_user_id TEXT REFERENCES zunari_users\(public_id\) ON DELETE SET NULL/,
    );
    assert.match(
      migration004,
      /post_id TEXT REFERENCES zunari_posts\(id\) ON DELETE SET NULL/,
    );
    assert.match(migration004, /reviewed_by TEXT REFERENCES zunari_users\(public_id\) ON DELETE SET NULL/);
  });

  test('005 refuses to run before 004 and documents its transaction boundary', () => {
    assert.match(
      migration005,
      /Migration 005 requires migration 004: zunari_user_reports and zunari_post_reports must already exist/,
    );
    assert.match(migration005, /to_regclass\('public\.zunari_user_reports'\) IS NULL/);
    assert.match(migration005, /single transaction/);
  });

  test('005 backfills legacy snapshots without overwriting existing values', () => {
    assert.match(
      migration005,
      /UPDATE zunari_user_reports\s+SET reporter_id_snapshot = reporter_id\s+WHERE reporter_id_snapshot IS NULL/,
    );
    assert.match(
      migration005,
      /UPDATE zunari_user_reports ur\s+SET reporter_username_snapshot = rp\.username\s+FROM zunari_users rp\s+WHERE rp\.public_id = ur\.reporter_id\s+AND ur\.reporter_username_snapshot IS NULL/,
    );
    assert.match(
      migration005,
      /UPDATE zunari_post_reports pr\s+SET post_preview_snapshot = left\(p\.content, 100\)\s+FROM zunari_posts p\s+WHERE p\.id = pr\.post_id\s+AND pr\.post_preview_snapshot IS NULL/,
    );
  });

  test('005 validates actual index and foreign-key definitions', () => {
    assert.match(migration005, /FROM pg_index i/);
    assert.match(migration005, /i\.indisunique/);
    assert.match(migration005, /i\.indnkeyatts = 2/);
    assert.match(migration005, /pg_get_indexdef\(named_index_oid\)/);
    assert.match(migration005, /equivalent index % already exists/);
    assert.match(migration005, /FROM pg_constraint c/);
    assert.match(migration005, /c\.confrelid = users_rel/);
    assert.match(migration005, /c\.confkey = ARRAY\[public_id_attnum\]/);
    assert.match(migration005, /c\.confdeltype = 'n'/);
    assert.match(migration005, /foreign keys reference zunari_admin_audit_log\.admin_id/);
  });

  test('005 includes actionable duplicate and orphan preflight diagnostics', () => {
    assert.match(migration005, /duplicate active user report group/);
    assert.match(migration005, /duplicate active post report group/);
    assert.match(migration005, /audit row\(s\) reference a missing admin_id/);
    assert.match(migration005, /Resolve duplicate active (user|post) reports without deleting history/);
  });

  test('004 and 005 never delete report or audit data', () => {
    assert.doesNotMatch(migration004, /DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN/i);
    assert.doesNotMatch(migration005, /DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN/i);
  });

  test('005 defensively restores any missing snapshot columns', () => {
    assert.match(
      migration005,
      /ADD COLUMN IF NOT EXISTS reporter_username_snapshot TEXT/,
    );
    assert.match(
      migration005,
      /ADD COLUMN IF NOT EXISTS reported_username_snapshot TEXT/,
    );
    assert.match(migration005, /ADD COLUMN IF NOT EXISTS post_preview_snapshot TEXT/);
    assert.match(migration005, /ADD COLUMN IF NOT EXISTS reporter_id_snapshot TEXT/);
    assert.match(migration005, /ADD COLUMN IF NOT EXISTS reported_user_id_snapshot TEXT/);
    assert.match(migration005, /ADD COLUMN IF NOT EXISTS post_id_snapshot TEXT/);
    assert.match(
      migration005,
      /ALTER TABLE zunari_admin_audit_log ALTER COLUMN admin_id DROP NOT NULL/,
    );
    assert.match(
      migration005,
      /FOREIGN KEY \(admin_id\) REFERENCES zunari_users\(public_id\) ON DELETE SET NULL/,
    );
  });
});

describe('report creation and retrieval (source-level contract checks)', () => {
  test('reporter identity comes from the authenticated route identity', () => {
    assert.match(
      apiRouteSource,
      /const currentUserId = await requireUserId\(req, res\);/,
    );
    assert.match(
      apiRouteSource,
      /const report = await createUserReport\(currentUserId,/,
    );
    assert.match(
      apiRouteSource,
      /const report = await createPostReport\(currentUserId,/,
    );
    assert.doesNotMatch(apiRouteSource, /body\.reporter(Id|Username)/);
    assert.doesNotMatch(apiRouteSource, /body\.reportedUsername/);
  });

  test('both report routes apply authenticated rate limiting after validation but before report creation', () => {
    const matches = apiRouteSource.match(/await enforceReportRateLimit\(req, currentUserId\);/g) || [];
    assert.equal(matches.length, 2);

    for (const endpoint of ["pathname === '/api/reports/user'", "pathname === '/api/reports/post'"]) {
      const start = apiRouteSource.indexOf(endpoint);
      assert.ok(start >= 0);
      const block = apiRouteSource.slice(start, start + 1500);
      const rateLimitIndex = block.indexOf('await enforceReportRateLimit(req, currentUserId);');
      const bodyIndex = block.indexOf('const body = await readJson(req);');
      const createReportIndex = block.indexOf('const report = await create');
      assert.ok(rateLimitIndex >= 0, `${endpoint} must enforce the report rate limit`);
      assert.ok(rateLimitIndex > bodyIndex, `${endpoint} must rate limit after reading/validating the payload`);
      assert.ok(createReportIndex > rateLimitIndex, `${endpoint} must rate limit before creating the report`);
    }
  });

  test('snapshots are populated from database records, not request payloads', () => {
    assert.match(
      adminDbSource,
      /SELECT username FROM zunari_users WHERE public_id = \$1 FOR SHARE/,
    );
    assert.match(adminDbSource, /postPreview = post\.rows\[0\]\.content\.slice\(0, 100\);/);
    assert.match(
      adminDbSource,
      /reporter_id_snapshot, reported_user_id_snapshot,\s*reporter_username_snapshot, reported_username_snapshot/,
    );
    assert.match(
      adminDbSource,
      /reporter_id_snapshot, post_id_snapshot,\s*reporter_username_snapshot, post_preview_snapshot/,
    );
  });

  test('retrieval falls back to snapshots when live joins are NULL', () => {
    assert.match(
      adminDbSource,
      /COALESCE\(ur\.reporter_username_snapshot, rp\.username\) as reporter_username/,
    );
    assert.match(
      adminDbSource,
      /COALESCE\(ur\.reported_username_snapshot, rpu\.username\) as reported_username/,
    );
    assert.match(adminDbSource, /pr\.post_preview_snapshot as post_preview/);
    assert.match(
      adminDbSource,
      /COALESCE\(ur\.reporter_id, ur\.reporter_id_snapshot\) as reporter_id/,
    );
    assert.match(
      adminDbSource,
      /COALESCE\(ur\.reported_user_id, ur\.reported_user_id_snapshot\) as reported_user_id/,
    );
    assert.match(
      adminDbSource,
      /COALESCE\(pr\.post_id, pr\.post_id_snapshot\) as post_id/,
    );
  });

  test('snapshot columns are never overwritten by update paths', () => {
    assert.doesNotMatch(
      adminDbSource,
      /UPDATE zunari_user_reports[\s\S]{0,200}SET[\s\S]{0,200}(reporter|reported)_username_snapshot/,
    );
    assert.doesNotMatch(
      adminDbSource,
      /UPDATE zunari_post_reports[\s\S]{0,200}SET[\s\S]{0,200}(reporter_username|post_preview)_snapshot/,
    );
  });
});

describe('duplicate active report prevention (schema contract)', () => {
  test('partial unique indexes block only active statuses', () => {
    assert.match(
      migration004,
      /CREATE UNIQUE INDEX IF NOT EXISTS zunari_user_reports_unique_active\s+ON zunari_user_reports\(reporter_id, reported_user_id\)\s+WHERE status IN \('pending', 'reviewed'\)/,
    );
    assert.match(
      migration004,
      /CREATE UNIQUE INDEX IF NOT EXISTS zunari_post_reports_unique_active\s+ON zunari_post_reports\(reporter_id, post_id\)\s+WHERE status IN \('pending', 'reviewed'\)/,
    );
  });

  test('terminal statuses are excluded so a new report is permitted later', () => {
    assert.match(migration004, /status TEXT NOT NULL DEFAULT 'pending' CHECK \(status IN \('pending', 'reviewed', 'dismissed', 'action_taken'\)\)/);
    assert.doesNotMatch(
      migration004,
      /WHERE status IN \([^)]*'dismissed'/,
    );
    assert.doesNotMatch(
      migration004,
      /WHERE status IN \([^)]*'action_taken'/,
    );
  });

  test('database constraint errors map to a stable 409 response', () => {
    assert.match(adminDbSource, /isUniqueViolation\(error, 'zunari_user_reports_unique_active'\)/);
    assert.match(adminDbSource, /isUniqueViolation\(error, 'zunari_post_reports_unique_active'\)/);
    assert.match(adminDbSource, /'DUPLICATE_REPORT'/);
  });

  test('report inserts are transactional with their audit records', () => {
    const userReportBlock = adminDbSource.slice(
      adminDbSource.indexOf('export async function createUserReport('),
      adminDbSource.indexOf('export async function createPostReport('),
    );
    assert.match(userReportBlock, /await withTransaction\(async \(connection\) => \{/);
    assert.match(userReportBlock, /connection\.query\(\s*`INSERT INTO zunari_user_reports/);
    assert.match(userReportBlock, /connection\.query\(\s*`INSERT INTO zunari_admin_audit_log/);
  });
});
