-- 005_report_rate_limits.sql
-- Shared, database-backed rate-limit counters and corrective report-schema hardening.
--
-- IMPORTANT: The application migration runner executes this entire file inside a
-- single transaction. Run it through the runner (or one explicit transaction) so
-- that any failure rolls back every change in this file.

-- 0. Prerequisite guard. Migration 005 must never run before 001, 002 and 004.
DO $$
BEGIN
  IF to_regclass('public.zunari_user_reports') IS NULL
     OR to_regclass('public.zunari_post_reports') IS NULL THEN
    RAISE EXCEPTION
      'Migration 005 requires migration 004: zunari_user_reports and zunari_post_reports must already exist.';
  END IF;
  IF to_regclass('public.zunari_admin_audit_log') IS NULL
     OR to_regclass('public.zunari_users') IS NULL THEN
    RAISE EXCEPTION
      'Migration 005 requires migrations 001 and 002: zunari_users and zunari_admin_audit_log must already exist.';
  END IF;
END $$;

-- 1. Preflight diagnostics for duplicate active reports.
-- These rows would make the partial unique indexes fail. Fail with an actionable
-- message before touching indexes; do not delete report history to force the
-- migration through.
DO $$
DECLARE
  duplicate_groups BIGINT;
BEGIN
  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT 1
    FROM zunari_user_reports
    WHERE status IN ('pending', 'reviewed')
      AND reporter_id IS NOT NULL
      AND reported_user_id IS NOT NULL
    GROUP BY reporter_id, reported_user_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Migration 005 preflight failed: % duplicate active user report group(s) exist.',
      duplicate_groups
      USING HINT = 'Resolve duplicate active user reports without deleting history, then rerun migration 005.';
  END IF;

  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT 1
    FROM zunari_post_reports
    WHERE status IN ('pending', 'reviewed')
      AND reporter_id IS NOT NULL
      AND post_id IS NOT NULL
    GROUP BY reporter_id, post_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Migration 005 preflight failed: % duplicate active post report group(s) exist.',
      duplicate_groups
      USING HINT = 'Resolve duplicate active post reports without deleting history, then rerun migration 005.';
  END IF;
END $$;

-- 2. Preflight: validate existing index definitions before (re)creating them.
-- Index existence alone is insufficient: a same-named index could be non-unique,
-- use different columns, or use a different predicate. It is also unsafe to add a
-- second equivalent index under a different name. Both cases fail clearly instead
-- of being silently accepted.
DO $$
DECLARE
  spec RECORD;
  named_index_oid OID;
  named_structure_ok BOOLEAN;
  named_predicate TEXT;
  equivalent_index TEXT;
BEGIN
  FOR spec IN
    SELECT *
    FROM (VALUES
      ('zunari_user_reports_unique_active'::TEXT, 'zunari_user_reports'::TEXT, 'reporter_id'::TEXT, 'reported_user_id'::TEXT),
      ('zunari_post_reports_unique_active'::TEXT, 'zunari_post_reports'::TEXT, 'reporter_id'::TEXT, 'post_id'::TEXT)
    ) AS expected(index_name, table_name, left_column, right_column)
  LOOP
    SELECT c.oid INTO named_index_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = spec.index_name
      AND c.relkind = 'i';

    IF named_index_oid IS NOT NULL THEN
      SELECT
        i.indisunique
        AND i.indnkeyatts = 2
        AND i.indpred IS NOT NULL
        AND (
          SELECT array_agg(a.attname::TEXT ORDER BY k.ord)
          FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = i.indrelid
           AND a.attnum = k.attnum
          WHERE k.ord <= i.indnkeyatts
        ) = ARRAY[spec.left_column, spec.right_column]::TEXT[]
      INTO named_structure_ok
      FROM pg_index i
      WHERE i.indexrelid = named_index_oid;

      SELECT lower(coalesce(pg_get_expr(i.indpred, i.indrelid), ''))
      INTO named_predicate
      FROM pg_index i
      WHERE i.indexrelid = named_index_oid;

      IF coalesce(named_structure_ok, FALSE) IS NOT TRUE
         OR named_predicate NOT LIKE '%status%'
         OR named_predicate NOT LIKE '%pending%'
         OR named_predicate NOT LIKE '%reviewed%'
         OR named_predicate LIKE '%dismissed%'
         OR named_predicate LIKE '%action_taken%' THEN
        RAISE EXCEPTION
          'Migration 005 index conflict: % exists but does not match the expected unique (%, %) predicate on % (pending, reviewed). Actual definition: %',
          spec.index_name,
          spec.left_column,
          spec.right_column,
          spec.table_name,
          pg_get_indexdef(named_index_oid)
          USING HINT = 'Rename or remove the conflicting index manually, then rerun migration 005.';
      END IF;
    ELSE
      SELECT c.relname INTO equivalent_index
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE i.indrelid = format('public.%I', spec.table_name)::regclass
        AND n.nspname = 'public'
        AND i.indisunique
        AND i.indnkeyatts = 2
        AND i.indpred IS NOT NULL
        AND (
          SELECT array_agg(a.attname::TEXT ORDER BY k.ord)
          FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = i.indrelid
           AND a.attnum = k.attnum
          WHERE k.ord <= i.indnkeyatts
        ) = ARRAY[spec.left_column, spec.right_column]::TEXT[]
        AND lower(pg_get_expr(i.indpred, i.indrelid)) LIKE '%status%'
        AND lower(pg_get_expr(i.indpred, i.indrelid)) LIKE '%pending%'
        AND lower(pg_get_expr(i.indpred, i.indrelid)) LIKE '%reviewed%'
        AND lower(pg_get_expr(i.indpred, i.indrelid)) NOT LIKE '%dismissed%'
        AND lower(pg_get_expr(i.indpred, i.indrelid)) NOT LIKE '%action_taken%'
      LIMIT 1;

      IF equivalent_index IS NOT NULL THEN
        RAISE EXCEPTION
          'Migration 005 index conflict: equivalent index % already exists on % with different name; expected %.',
          equivalent_index,
          spec.table_name,
          spec.index_name
          USING HINT = 'Rename the equivalent index to the expected name, then rerun migration 005.';
      END IF;
    END IF;
  END LOOP;
END $$;

-- 3. Preflight: audit-actor foreign-key validation.
-- Validate FK state before attempting to modify it.
DO $$
DECLARE
  audit_rel OID := 'public.zunari_admin_audit_log'::regclass;
  users_rel OID := 'public.zunari_users'::regclass;
  admin_attnum SMALLINT;
  public_id_attnum SMALLINT;
  orphan_count BIGINT;
  fk RECORD;
  fk_count INTEGER := 0;
  matching_count INTEGER := 0;
  single_fk_name TEXT;
  conflicting_fk_name TEXT;
BEGIN
  SELECT attnum INTO admin_attnum
  FROM pg_attribute
  WHERE attrelid = audit_rel
    AND attname = 'admin_id'
    AND NOT attisdropped;

  IF admin_attnum IS NULL THEN
    RAISE EXCEPTION
      'Migration 005 requires zunari_admin_audit_log.admin_id, but the column is missing.';
  END IF;

  SELECT attnum INTO public_id_attnum
  FROM pg_attribute
  WHERE attrelid = users_rel
    AND attname = 'public_id'
    AND NOT attisdropped;

  IF public_id_attnum IS NULL THEN
    RAISE EXCEPTION
      'Migration 005 requires zunari_users.public_id, but the column is missing.';
  END IF;

  SELECT count(*) INTO orphan_count
  FROM zunari_admin_audit_log a
  LEFT JOIN zunari_users u ON u.public_id = a.admin_id
  WHERE a.admin_id IS NOT NULL
    AND u.public_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Migration 005 preflight failed: % audit row(s) reference a missing admin_id.',
      orphan_count
      USING HINT = 'Restore the missing users or archive/reconcile those audit rows; do not delete audit history casually.';
  END IF;

  FOR fk IN
    SELECT c.conname, c.confrelid, c.confkey, c.confdeltype
    FROM pg_constraint c
    WHERE c.conrelid = audit_rel
      AND c.contype = 'f'
      AND c.conkey = ARRAY[admin_attnum]
  LOOP
    fk_count := fk_count + 1;
    single_fk_name := fk.conname::TEXT;

    IF fk.confrelid = users_rel
       AND fk.confkey = ARRAY[public_id_attnum] THEN
      IF fk.confdeltype = 'n' THEN
        matching_count := matching_count + 1;
      END IF;
    ELSE
      conflicting_fk_name := fk.conname::TEXT;
    END IF;
  END LOOP;

  IF conflicting_fk_name IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 005 FK conflict: constraint % on zunari_admin_audit_log.admin_id references an unexpected target.',
      conflicting_fk_name
      USING HINT = 'Inspect the foreign key manually and rerun migration 005 after correcting it.';
  END IF;

  IF fk_count > 1 THEN
    RAISE EXCEPTION
      'Migration 005 FK conflict: % foreign keys reference zunari_admin_audit_log.admin_id.',
      fk_count
      USING HINT = 'Keep exactly one admin_id FK to zunari_users(public_id), then rerun migration 005.';
  END IF;
END $$;

-- 4. Shared rate-limit counters.
-- Report abuse protection must work across every application instance. In-memory
-- counters are process-local, so counters live in PostgreSQL where the atomic
-- UPSERT in the application makes concurrent increments safe.
CREATE TABLE IF NOT EXISTS zunari_rate_limits (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (scope, subject, window_start)
);

CREATE INDEX IF NOT EXISTS zunari_rate_limits_cleanup_idx
  ON zunari_rate_limits(window_start);

-- 5. Defensive, additive snapshot columns.
-- 004 remains the canonical definition. These statements only fill columns that
-- are missing in environments where 004 was applied from an earlier revision.
-- They never drop or rewrite existing report data.
ALTER TABLE zunari_user_reports
  ADD COLUMN IF NOT EXISTS reporter_username_snapshot TEXT;
ALTER TABLE zunari_user_reports
  ADD COLUMN IF NOT EXISTS reported_username_snapshot TEXT;
ALTER TABLE zunari_user_reports
  ADD COLUMN IF NOT EXISTS reporter_id_snapshot TEXT;
ALTER TABLE zunari_user_reports
  ADD COLUMN IF NOT EXISTS reported_user_id_snapshot TEXT;
ALTER TABLE zunari_post_reports
  ADD COLUMN IF NOT EXISTS reporter_username_snapshot TEXT;
ALTER TABLE zunari_post_reports
  ADD COLUMN IF NOT EXISTS post_preview_snapshot TEXT;
ALTER TABLE zunari_post_reports
  ADD COLUMN IF NOT EXISTS reporter_id_snapshot TEXT;
ALTER TABLE zunari_post_reports
  ADD COLUMN IF NOT EXISTS post_id_snapshot TEXT;

-- 6. Best-effort legacy snapshot backfill.
-- Only NULL snapshot fields are filled, so this block is idempotent and never
-- overwrites an existing point-in-time snapshot. ID snapshots can be recovered
-- only while the referenced live row still exists. Username/preview snapshots
-- use the current live values because the historical values were never stored;
-- they are the best available data and may reflect later edits. Rows whose live
-- target was already deleted cannot be reconstructed and remain NULL.
UPDATE zunari_user_reports
SET reporter_id_snapshot = reporter_id
WHERE reporter_id_snapshot IS NULL
  AND reporter_id IS NOT NULL;

UPDATE zunari_user_reports
SET reported_user_id_snapshot = reported_user_id
WHERE reported_user_id_snapshot IS NULL
  AND reported_user_id IS NOT NULL;

UPDATE zunari_user_reports ur
SET reporter_username_snapshot = rp.username
FROM zunari_users rp
WHERE rp.public_id = ur.reporter_id
  AND ur.reporter_username_snapshot IS NULL;

UPDATE zunari_user_reports ur
SET reported_username_snapshot = rp.username
FROM zunari_users rp
WHERE rp.public_id = ur.reported_user_id
  AND ur.reported_username_snapshot IS NULL;

UPDATE zunari_post_reports
SET reporter_id_snapshot = reporter_id
WHERE reporter_id_snapshot IS NULL
  AND reporter_id IS NOT NULL;

UPDATE zunari_post_reports
SET post_id_snapshot = post_id
WHERE post_id_snapshot IS NULL
  AND post_id IS NOT NULL;

UPDATE zunari_post_reports pr
SET reporter_username_snapshot = rp.username
FROM zunari_users rp
WHERE rp.public_id = pr.reporter_id
  AND pr.reporter_username_snapshot IS NULL;

UPDATE zunari_post_reports pr
SET post_preview_snapshot = left(p.content, 100)
FROM zunari_posts p
WHERE p.id = pr.post_id
  AND pr.post_preview_snapshot IS NULL;

-- 7. Create partial unique indexes for duplicate active report prevention.
-- The validation block above guarantees an existing same-named index is correct.
CREATE UNIQUE INDEX IF NOT EXISTS zunari_user_reports_unique_active
  ON zunari_user_reports(reporter_id, reported_user_id)
  WHERE status IN ('pending', 'reviewed');

CREATE UNIQUE INDEX IF NOT EXISTS zunari_post_reports_unique_active
  ON zunari_post_reports(reporter_id, post_id)
  WHERE status IN ('pending', 'reviewed');

-- 8. Audit-actor foreign-key migration.
-- Report creation writes an audit row for the reporting user. Without this
-- change, deleting that user would be blocked by the audit-log foreign key and
-- the report snapshot's ON DELETE SET NULL behavior could never be exercised.
-- Existing audit rows are never deleted. The FK is inspected by its actual
-- target and delete action rather than by name alone. Unexpected targets and
-- multiple FKs fail clearly; a single FK with the correct target but wrong
-- delete action is normalized to the canonical constraint name.
DO $$
DECLARE
  audit_rel OID := 'public.zunari_admin_audit_log'::regclass;
  users_rel OID := 'public.zunari_users'::regclass;
  admin_attnum SMALLINT;
  public_id_attnum SMALLINT;
  fk RECORD;
  fk_count INTEGER := 0;
  matching_count INTEGER := 0;
  single_fk_name TEXT;
BEGIN
  SELECT attnum INTO admin_attnum
  FROM pg_attribute
  WHERE attrelid = audit_rel
    AND attname = 'admin_id'
    AND NOT attisdropped;

  SELECT attnum INTO public_id_attnum
  FROM pg_attribute
  WHERE attrelid = users_rel
    AND attname = 'public_id'
    AND NOT attisdropped;

  FOR fk IN
    SELECT c.conname, c.confrelid, c.confkey, c.confdeltype
    FROM pg_constraint c
    WHERE c.conrelid = audit_rel
      AND c.contype = 'f'
      AND c.conkey = ARRAY[admin_attnum]
  LOOP
    fk_count := fk_count + 1;
    single_fk_name := fk.conname::TEXT;

    IF fk.confrelid = users_rel
       AND fk.confkey = ARRAY[public_id_attnum] THEN
      IF fk.confdeltype = 'n' THEN
        matching_count := matching_count + 1;
      END IF;
    END IF;
  END LOOP;

  IF NOT (fk_count = 1 AND matching_count = 1) THEN
    IF fk_count = 1 THEN
      EXECUTE format(
        'ALTER TABLE public.zunari_admin_audit_log DROP CONSTRAINT %I',
        single_fk_name
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = audit_rel
        AND conname = 'zunari_admin_audit_log_admin_id_fkey'
    ) THEN
      RAISE EXCEPTION
        'Migration 005 FK conflict: the canonical name zunari_admin_audit_log_admin_id_fkey is already used by another constraint.'
        USING HINT = 'Rename or remove the conflicting constraint manually, then rerun migration 005.';
    END IF;

    ALTER TABLE zunari_admin_audit_log
      ADD CONSTRAINT zunari_admin_audit_log_admin_id_fkey
      FOREIGN KEY (admin_id) REFERENCES zunari_users(public_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = audit_rel
      AND c.contype = 'f'
      AND c.conkey = ARRAY[admin_attnum]
      AND c.confrelid = users_rel
      AND c.confkey = ARRAY[public_id_attnum]
      AND c.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION
      'Migration 005 FK verification failed: admin_id does not have exactly the expected SET NULL foreign key.';
  END IF;
END $$;

ALTER TABLE zunari_admin_audit_log ALTER COLUMN admin_id DROP NOT NULL;

-- 9. Final postcondition verification.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.zunari_admin_audit_log'::regclass
      AND attname = 'admin_id'
      AND attnotnull
  ) THEN
    RAISE EXCEPTION
      'Migration 005 postcondition failed: zunari_admin_audit_log.admin_id is still NOT NULL.';
  END IF;

  IF to_regclass('public.zunari_rate_limits') IS NULL THEN
    RAISE EXCEPTION
      'Migration 005 postcondition failed: zunari_rate_limits was not created.';
  END IF;
END $$;