import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';

/**
 * Real PostgreSQL integration coverage. It is skipped unless a dedicated test
 * database is explicitly supplied. It never reads or writes DATABASE_URL.
 *
 * Required environment:
 *   TEST_DATABASE_URL=postgres://...   (non-production database)
 *   RUN_POSTGRES_INTEGRATION=1
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
const skipReason =
  !testDatabaseUrl || process.env.RUN_POSTGRES_INTEGRATION !== '1'
    ? 'Set TEST_DATABASE_URL and RUN_POSTGRES_INTEGRATION=1 to run PostgreSQL integration tests.'
    : databaseUrl === testDatabaseUrl
      ? 'Refusing to write integration fixtures to DATABASE_URL.'
      : undefined;

if (!skipReason && testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DATABASE_URL_DIRECT = testDatabaseUrl;
}

describe('report snapshots and dedupe (real PostgreSQL)', { skip: skipReason, concurrency: 1 }, () => {
  test('snapshots survive renames and deletion, and duplicate active reports are blocked', async () => {
    const { query, closeDatabase } = await import('./db/pool.ts');
    const { createUserReport, createPostReport, getAdminReports } = await import('./db/admin.ts');
    const suffix = randomUUID().slice(0, 8);
    const reporterId = `user_test_reporter_${suffix}`;
    const reportedId = `user_test_reported_${suffix}`;
    const postId = `post_test_${suffix}`;
    const reportIds: string[] = [];

    try {
      const schema = await query<{ ready: boolean }>(
        `SELECT
           to_regclass('public.zunari_user_reports') IS NOT NULL
           AND to_regclass('public.zunari_post_reports') IS NOT NULL
           AND to_regclass('public.zunari_rate_limits') IS NOT NULL AS ready`,
      );
      assert.equal(schema.rows[0]?.ready, true, 'Run approved migrations before integration tests.');

      await query(
        `INSERT INTO zunari_users (public_id, username, name, email, created_at)
         VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $5)`,
        [
          reporterId,
          `reporter_${suffix}`,
          'Reporter',
          `reporter_${suffix}@example.test`,
          Date.now(),
          reportedId,
          `reported_${suffix}`,
          'Reported',
          `reported_${suffix}@example.test`,
        ],
      );

      await query(
        `INSERT INTO zunari_posts (id, author_id, content, created_at)
         VALUES ($1, $2, $3, $4)`,
        [postId, reportedId, `Integration report target ${suffix}`, Date.now()],
      );

      const userReport = await createUserReport(
        reporterId,
        reportedId,
        'spam',
        'integration fixture',
      );
      reportIds.push(userReport.id);
      assert.equal(userReport.reporter_id, reporterId);
      assert.equal(userReport.reporter_username, `reporter_${suffix}`);
      assert.equal(userReport.reported_user_id, reportedId);
      assert.equal(userReport.reported_username, `reported_${suffix}`);

      const postReport = await createPostReport(
        reporterId,
        postId,
        'hate',
        'integration fixture',
      );
      reportIds.push(postReport.id);
      assert.equal(postReport.reporter_id, reporterId);
      assert.equal(postReport.post_id, postId);
      assert.equal(postReport.post_preview, `Integration report target ${suffix}`);

      await assert.rejects(
        createUserReport(reporterId, reportedId, 'spam', 'duplicate'),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          (error as { status?: number }).status === 409,
      );
      await assert.rejects(
        createPostReport(reporterId, postId, 'hate', 'duplicate'),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          (error as { status?: number }).status === 409,
      );

      await query(
        "UPDATE zunari_user_reports SET status = 'dismissed' WHERE id = $1",
        [userReport.id],
      );
      const secondUserReport = await createUserReport(reporterId, reportedId, 'other', null);
      reportIds.push(secondUserReport.id);

      await query(
        "UPDATE zunari_post_reports SET status = 'dismissed' WHERE id = $1",
        [postReport.id],
      );
      const secondPostReport = await createPostReport(reporterId, postId, 'other', null);
      reportIds.push(secondPostReport.id);

      await query('UPDATE zunari_users SET username = $1 WHERE public_id = $2', [
        `renamed_reporter_${suffix}`,
        reporterId,
      ]);
      await query('UPDATE zunari_users SET username = $1 WHERE public_id = $2', [
        `renamed_reported_${suffix}`,
        reportedId,
      ]);
      await query('UPDATE zunari_posts SET content = $1 WHERE id = $2', [
        'edited post content',
        postId,
      ]);

      const snapshotRows = await query<{
        reporter_username_snapshot: string;
        reported_username_snapshot: string;
      }>(
        `SELECT reporter_username_snapshot, reported_username_snapshot
         FROM zunari_user_reports WHERE id = $1`,
        [userReport.id],
      );
      assert.equal(snapshotRows.rows[0]?.reporter_username_snapshot, `reporter_${suffix}`);
      assert.equal(snapshotRows.rows[0]?.reported_username_snapshot, `reported_${suffix}`);

      const postSnapshotRows = await query<{ post_preview_snapshot: string }>(
        'SELECT post_preview_snapshot FROM zunari_post_reports WHERE id = $1',
        [postReport.id],
      );
      assert.equal(
        postSnapshotRows.rows[0]?.post_preview_snapshot,
        `Integration report target ${suffix}`,
      );

      await query('DELETE FROM zunari_posts WHERE id = $1', [postId]);
      await query('DELETE FROM zunari_users WHERE public_id = ANY($1::text[])', [
        [reporterId, reportedId],
      ]);

      const reports = await getAdminReports({ limit: 10, offset: 0 });
      const preservedUserReport = reports.reports.find((report) => report.id === userReport.id);
      const preservedPostReport = reports.reports.find((report) => report.id === postReport.id);

      assert.ok(preservedUserReport);
      assert.equal(preservedUserReport.reporter_id, reporterId);
      assert.equal(preservedUserReport.reporter_username, `reporter_${suffix}`);
      assert.equal(preservedUserReport.reported_user_id, reportedId);
      assert.equal(preservedUserReport.reported_username, `reported_${suffix}`);

      assert.ok(preservedPostReport);
      assert.equal(preservedPostReport.reporter_id, reporterId);
      assert.equal(preservedPostReport.post_id, postId);
      assert.equal(preservedPostReport.post_preview, `Integration report target ${suffix}`);

    } finally {
      if (reportIds.length) {
        await query('DELETE FROM zunari_admin_audit_log WHERE target_id = ANY($1::text[])', [
          reportIds,
        ]).catch(() => undefined);
        await query('DELETE FROM zunari_user_reports WHERE id = ANY($1::text[])', [
          reportIds,
        ]).catch(() => undefined);
        await query('DELETE FROM zunari_post_reports WHERE id = ANY($1::text[])', [
          reportIds,
        ]).catch(() => undefined);
      }
      await query('DELETE FROM zunari_posts WHERE id = $1', [postId]).catch(() => undefined);
      await query('DELETE FROM zunari_users WHERE public_id = ANY($1::text[])', [
        [reporterId, reportedId],
      ]).catch(() => undefined);
      await closeDatabase();
    }
  });

  test('audit CSV and JSON export preserve history after admin deletion', async () => {
    const { query, closeDatabase } = await import('./db/pool.ts');
    const { exportAuditLog, streamAuditLogExport } = await import('./db/admin.ts');
    const suffix = randomUUID().slice(0, 8);
    const adminId = `user_export_admin_${suffix}`;
    const auditId = `audit_export_${suffix}`;
    const targetId = `audit_target_${suffix}`;

    try {
      await query(
        `INSERT INTO zunari_users (public_id, username, name, email, created_at, admin_role)
         VALUES ($1, $2, $3, $4, $5, 'admin')`,
        [adminId, `export_admin_${suffix}`, 'Export Admin', `export_${suffix}@example.test`, Date.now()],
      );
      await query(
        `INSERT INTO zunari_admin_audit_log
           (id, admin_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
         VALUES ($1, $2, 'test.export', 'user', $3, $4::jsonb, '127.0.0.1', 'integration-test', $5)`,
        [
          auditId,
          adminId,
          targetId,
          JSON.stringify({ previous_verified: false, new_verified: true }),
          Date.now(),
        ],
      );

      const jsonExport = await exportAuditLog({
        format: 'json',
        targetId,
        limit: 10,
        offset: 0,
      });
      const jsonRows = JSON.parse(jsonExport.data) as Array<Record<string, unknown>>;
      assert.equal(jsonRows.length, 1);
      assert.equal(jsonRows[0]?.id, auditId);
      assert.equal(jsonRows[0]?.admin_id, adminId);
      assert.equal(jsonRows[0]?.admin_username, `export_admin_${suffix}`);
      assert.equal(jsonRows[0]?.action, 'test.export');
      assert.equal('password_hash' in (jsonRows[0] || {}), false);
      assert.equal('session_token_hash' in (jsonRows[0] || {}), false);

      const csvExport = await exportAuditLog({
        format: 'csv',
        targetId,
        limit: 10,
        offset: 0,
      });
      assert.ok(csvExport.data.startsWith('id,admin_id,admin_username,action,'));
      assert.ok(csvExport.data.includes(auditId));
      assert.ok(csvExport.data.includes(targetId));

      const streamedJson: string[] = [];
      for await (const chunk of streamAuditLogExport({
        format: 'json',
        targetId,
        limit: 10,
        offset: 0,
      })) {
        streamedJson.push(chunk);
      }
      const streamedRows = JSON.parse(streamedJson.join('')) as Array<Record<string, unknown>>;
      assert.equal(streamedRows.length, 1);
      assert.equal(streamedRows[0]?.id, auditId);

      await query('DELETE FROM zunari_users WHERE public_id = $1', [adminId]);

      const preserved = await query<{ admin_id: string | null; action: string }>(
        'SELECT admin_id, action FROM zunari_admin_audit_log WHERE id = $1',
        [auditId],
      );
      assert.equal(preserved.rows[0]?.admin_id, null);
      assert.equal(preserved.rows[0]?.action, 'test.export');

      const afterDeletion = await exportAuditLog({
        format: 'json',
        targetId,
        limit: 10,
        offset: 0,
      });
      const afterRows = JSON.parse(afterDeletion.data) as Array<Record<string, unknown>>;
      assert.equal(afterRows.length, 1);
      assert.equal(afterRows[0]?.id, auditId);
      assert.equal(afterRows[0]?.admin_id, null);
      assert.equal(afterRows[0]?.admin_username, null);
      assert.equal(afterRows[0]?.action, 'test.export');
    } finally {
      await query('DELETE FROM zunari_admin_audit_log WHERE id = $1', [auditId]).catch(
        () => undefined,
      );
      await query('DELETE FROM zunari_users WHERE public_id = $1', [adminId]).catch(
        () => undefined,
      );
      await closeDatabase();
    }
  });
});
