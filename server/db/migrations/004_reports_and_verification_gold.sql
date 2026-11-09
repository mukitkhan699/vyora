-- 004_reports_and_verification_gold.sql
-- Report tables. Verification and Gold columns already exist in 001.

-- 1. User reports table
CREATE TABLE IF NOT EXISTS zunari_user_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL,
  reported_user_id TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'violence', 'illegal', 'misinfo', 'fake', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'action_taken')),
  reviewed_by TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL,
  reviewed_at BIGINT,
  created_at BIGINT NOT NULL,
  -- Snapshot columns for moderation history preservation
  reporter_username_snapshot TEXT,
  reported_username_snapshot TEXT
);
CREATE INDEX IF NOT EXISTS zunari_user_reports_reporter_idx ON zunari_user_reports(reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zunari_user_reports_reported_idx ON zunari_user_reports(reported_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zunari_user_reports_status_idx ON zunari_user_reports(status, created_at DESC);

-- Partial unique index to prevent duplicate ACTIVE reports from same reporter against same user
-- Allows new report after previous is closed (reviewed, dismissed, action_taken)
CREATE UNIQUE INDEX IF NOT EXISTS zunari_user_reports_unique_active
  ON zunari_user_reports(reporter_id, reported_user_id)
  WHERE status IN ('pending', 'reviewed');

-- 2. Post reports table
CREATE TABLE IF NOT EXISTS zunari_post_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL,
  post_id TEXT REFERENCES zunari_posts(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'violence', 'illegal', 'misinfo', 'fake', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'action_taken')),
  reviewed_by TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL,
  reviewed_at BIGINT,
  created_at BIGINT NOT NULL,
  -- Snapshot columns for moderation history preservation
  reporter_username_snapshot TEXT,
  post_preview_snapshot TEXT
);
CREATE INDEX IF NOT EXISTS zunari_post_reports_reporter_idx ON zunari_post_reports(reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zunari_post_reports_post_idx ON zunari_post_reports(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zunari_post_reports_status_idx ON zunari_post_reports(status, created_at DESC);

-- Partial unique index to prevent duplicate ACTIVE reports from same reporter against same post
CREATE UNIQUE INDEX IF NOT EXISTS zunari_post_reports_unique_active
  ON zunari_post_reports(reporter_id, post_id)
  WHERE status IN ('pending', 'reviewed');

-- 3. Verified and is_gold columns already exist in zunari_users from 001_initial_schema.sql.
-- No additional ALTER TABLE needed.

-- 4. last_admin_action_at itself is added in 002_admin_roles_and_audit.sql.
-- 002 does not add a dedicated index for it, and this migration does not add one.