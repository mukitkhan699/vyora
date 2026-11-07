-- 002_admin_roles_and_audit.sql
-- Admin roles, permissions, and audit logging infrastructure

-- 1. Admin role enum type
CREATE TYPE zunari_admin_role AS ENUM (
  'super_admin',
  'admin',
  'moderator',
  'verification_manager',
  'analyst'
);

-- 2. Extend users with admin fields
ALTER TABLE zunari_users ADD COLUMN IF NOT EXISTS admin_role zunari_admin_role;
ALTER TABLE zunari_users ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE zunari_users ADD COLUMN IF NOT EXISTS suspended_at BIGINT;
ALTER TABLE zunari_users ADD COLUMN IF NOT EXISTS suspended_by TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL;
ALTER TABLE zunari_users ADD COLUMN IF NOT EXISTS last_admin_action_at BIGINT;

-- Index for admin user queries
CREATE INDEX IF NOT EXISTS zunari_users_admin_role_idx ON zunari_users(admin_role) WHERE admin_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS zunari_users_suspended_idx ON zunari_users(suspended_at) WHERE suspended_at IS NOT NULL;

-- 3. Admin audit log
CREATE TABLE IF NOT EXISTS zunari_admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES zunari_users(public_id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS zunari_admin_audit_admin_idx ON zunari_admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zunari_admin_audit_target_idx ON zunari_admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS zunari_admin_audit_action_idx ON zunari_admin_audit_log(action, created_at DESC);

-- 4. Admin permissions mapping (role -> permissions)
CREATE TABLE IF NOT EXISTS zunari_admin_role_permissions (
  role zunari_admin_role PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '{}',
  description TEXT
);

-- Insert default permissions for each role (using proper JSON object structure)
INSERT INTO zunari_admin_role_permissions (role, permissions, description) VALUES
  ('super_admin', '{"users": {"read": true, "write": true, "suspend": true}, "posts": {"read": true, "delete": true}, "reports": {"read": true, "write": true}, "audit": {"read": true}, "badges": {"read": true, "write": true}, "stats": {"read": true}, "admin_users": {"read": true, "write": true}}', 'Full system access including admin management'),
  ('admin', '{"users": {"read": true, "write": true, "suspend": true}, "posts": {"read": true, "delete": true}, "reports": {"read": true, "write": true}, "audit": {"read": true}, "badges": {"read": true, "write": true}, "stats": {"read": true}, "admin_users": {"read": false, "write": false}}', 'Full admin access except admin user management'),
  ('moderator', '{"users": {"read": true, "write": false, "suspend": false}, "posts": {"read": true, "delete": true}, "reports": {"read": true, "write": true}, "audit": {"read": true}, "badges": {"read": false, "write": false}, "stats": {"read": false}, "admin_users": {"read": false, "write": false}}', 'Content moderation and user reports'),
  ('verification_manager', '{"users": {"read": true, "write": false, "suspend": false}, "posts": {"read": false, "delete": false}, "reports": {"read": false, "write": false}, "audit": {"read": true}, "badges": {"read": true, "write": true}, "stats": {"read": false}, "admin_users": {"read": false, "write": false}}', 'Verification badge management'),
  ('analyst', '{"users": {"read": true, "write": false, "suspend": false}, "posts": {"read": true, "delete": false}, "reports": {"read": false, "write": false}, "audit": {"read": true}, "badges": {"read": false, "write": false}, "stats": {"read": true}, "admin_users": {"read": false, "write": false}}', 'Read-only analytics and audit access')
ON CONFLICT (role) DO UPDATE SET
  permissions = EXCLUDED.permissions,
  description = EXCLUDED.description;

-- 5. Admin sessions tracking (for active admin session monitoring)
CREATE TABLE IF NOT EXISTS zunari_admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES zunari_users(public_id),
  session_token_hash TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_activity_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS zunari_admin_sessions_admin_idx ON zunari_admin_sessions(admin_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS zunari_admin_sessions_token_idx ON zunari_admin_sessions(session_token_hash);