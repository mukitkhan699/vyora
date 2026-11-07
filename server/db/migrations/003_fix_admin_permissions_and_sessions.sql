-- 003_fix_admin_permissions_and_sessions.sql
-- Corrective migration for databases where 002_admin_roles_and_audit.sql was already applied
-- Fixes: permission defaults format, adds csrf_token_hash column, adds ON DELETE SET NULL for suspended_by

-- 1. Add csrf_token_hash column to admin_sessions if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'zunari_admin_sessions' AND column_name = 'csrf_token_hash'
  ) THEN
    ALTER TABLE zunari_admin_sessions ADD COLUMN csrf_token_hash TEXT NOT NULL DEFAULT '';
    -- Backfill with hash of empty string for existing sessions (they'll be invalidated on next use)
    UPDATE zunari_admin_sessions SET csrf_token_hash = '' WHERE csrf_token_hash = '';
  END IF;
END $$;

-- 2. Fix suspended_by FK to have ON DELETE SET NULL if not already set
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'zunari_users'
    AND constraint_name = 'zunari_users_suspended_by_fkey'
    AND table_schema = 'public'
  ) THEN
    -- Check if ON DELETE SET NULL is already set
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.referential_constraints
      WHERE constraint_name = 'zunari_users_suspended_by_fkey'
      AND delete_rule = 'SET NULL'
    ) THEN
      ALTER TABLE zunari_users DROP CONSTRAINT zunari_users_suspended_by_fkey;
      ALTER TABLE zunari_users ADD CONSTRAINT zunari_users_suspended_by_fkey
        FOREIGN KEY (suspended_by) REFERENCES zunari_users(public_id) ON DELETE SET NULL;
    END IF;
  ELSE
    -- Constraint doesn't exist, add it with ON DELETE SET NULL
    ALTER TABLE zunari_users ADD CONSTRAINT zunari_users_suspended_by_fkey
      FOREIGN KEY (suspended_by) REFERENCES zunari_users(public_id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Fix permission defaults to proper JSON object format
UPDATE zunari_admin_role_permissions SET permissions = '{"users": {"read": true, "write": true, "suspend": true}, "posts": {"read": true, "delete": true}, "reports": {"read": true, "write": true}, "audit": {"read": true}, "badges": {"read": true, "write": true}, "stats": {"read": true}, "admin_users": {"read": true, "write": true}}'
WHERE role = 'super_admin';

UPDATE zunari_admin_role_permissions SET permissions = '{"users": {"read": true, "write": true, "suspend": true}, "posts": {"read": true, "delete": true}, "reports": {"read": true, "write": true}, "audit": {"read": true}, "badges": {"read": true, "write": true}, "stats": {"read": true}, "admin_users": {"read": false, "write": false}}'
WHERE role = 'admin';

UPDATE zunari_admin_role_permissions SET permissions = '{"users": {"read": true, "write": false, "suspend": false}, "posts": {"read": true, "delete": true}, "reports": {"read": true, "write": true}, "audit": {"read": true}, "badges": {"read": false, "write": false}, "stats": {"read": false}, "admin_users": {"read": false, "write": false}}'
WHERE role = 'moderator';

UPDATE zunari_admin_role_permissions SET permissions = '{"users": {"read": true, "write": false, "suspend": false}, "posts": {"read": false, "delete": false}, "reports": {"read": false, "write": false}, "audit": {"read": true}, "badges": {"read": true, "write": true}, "stats": {"read": false}, "admin_users": {"read": false, "write": false}}'
WHERE role = 'verification_manager';

UPDATE zunari_admin_role_permissions SET permissions = '{"users": {"read": true, "write": false, "suspend": false}, "posts": {"read": true, "delete": false}, "reports": {"read": false, "write": false}, "audit": {"read": true}, "badges": {"read": false, "write": false}, "stats": {"read": true}, "admin_users": {"read": false, "write": false}}'
WHERE role = 'analyst';