-- 006_complete_messaging_and_calling.sql
-- Comprehensive Messaging (1:1 and Groups), Receipts, Reactions, Attachments, and Calling.
--
-- IMPORTANT: The application migration runner executes this entire file inside a single transaction.

-- 0. Prerequisite guard: Migration 001 must have already run.
DO $$
BEGIN
  IF to_regclass('public.zunari_users') IS NULL
     OR to_regclass('public.zunari_messages') IS NULL
     OR to_regclass('public.zunari_conversations') IS NULL
     OR to_regclass('public.zunari_media_assets') IS NULL THEN
    RAISE EXCEPTION
      'Migration 006 requires migration 001: zunari_users, zunari_conversations, zunari_messages and zunari_media_assets must exist.';
  END IF;
END $$;

-- 1. Conversation v2 table (supports both 'direct' and 'group')
CREATE TABLE IF NOT EXISTS zunari_conversations_v2 (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  title TEXT,
  avatar_url TEXT,
  created_by TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL,
  direct_key TEXT UNIQUE, -- for direct: least(p1,p2)||':'||greatest(p1,p2)
  last_message_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS zunari_conversations_v2_last_msg_idx
  ON zunari_conversations_v2(last_message_at DESC);

-- 2. Conversation participants
CREATE TABLE IF NOT EXISTS zunari_conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES zunari_conversations_v2(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zunari_users(public_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at BIGINT NOT NULL,
  left_at BIGINT, -- non-null indicates left or removed
  last_read_message_id TEXT,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS zunari_conv_part_user_idx
  ON zunari_conversation_participants(user_id, left_at);

-- 3. Messages v2 table
CREATE TABLE IF NOT EXISTS zunari_messages_v2 (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES zunari_conversations_v2(id) ON DELETE CASCADE,
  sender_id TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL,
  client_id TEXT, -- idempotency token from client
  text TEXT NOT NULL DEFAULT '',
  reply_to_message_id TEXT REFERENCES zunari_messages_v2(id) ON DELETE SET NULL,
  is_edited BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at BIGINT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS zunari_messages_v2_conv_created_idx
  ON zunari_messages_v2(conversation_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS zunari_messages_v2_client_id_idx
  ON zunari_messages_v2(conversation_id, sender_id, client_id)
  WHERE client_id IS NOT NULL;

-- 4. Message receipts (delivery and read per user)
CREATE TABLE IF NOT EXISTS zunari_message_receipts (
  message_id TEXT NOT NULL REFERENCES zunari_messages_v2(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zunari_users(public_id) ON DELETE CASCADE,
  delivered_at BIGINT,
  read_at BIGINT,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS zunari_message_receipts_user_idx
  ON zunari_message_receipts(user_id, read_at);

-- 5. Message reactions
CREATE TABLE IF NOT EXISTS zunari_message_reactions (
  message_id TEXT NOT NULL REFERENCES zunari_messages_v2(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zunari_users(public_id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (length(emoji) <= 16),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

-- 6. Message attachments
-- Note: ON DELETE RESTRICT on media_asset_id guarantees zunari_media_assets records
-- and their B2 deletion tracking can never be deleted out from under active attachments.
CREATE TABLE IF NOT EXISTS zunari_message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES zunari_messages_v2(id) ON DELETE CASCADE,
  media_asset_id TEXT NOT NULL REFERENCES zunari_media_assets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cleaned')),
  expires_at BIGINT NOT NULL, -- 7 days from creation
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS zunari_msg_att_cleanup_idx
  ON zunari_message_attachments(status, expires_at);

-- 7. Attachment deliveries (per recipient delivery and read tracking)
CREATE TABLE IF NOT EXISTS zunari_attachment_deliveries (
  attachment_id TEXT NOT NULL REFERENCES zunari_message_attachments(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES zunari_users(public_id) ON DELETE CASCADE,
  delivered_at BIGINT,
  read_at BIGINT,
  downloaded_at BIGINT,
  PRIMARY KEY (attachment_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS zunari_att_deliv_recipient_idx
  ON zunari_attachment_deliveries(recipient_id, delivered_at);

-- 8. Calling sessions
CREATE TABLE IF NOT EXISTS zunari_call_sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES zunari_conversations_v2(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('voice', 'video')),
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'rejected')),
  caller_id TEXT REFERENCES zunari_users(public_id) ON DELETE SET NULL,
  started_at BIGINT NOT NULL,
  answered_at BIGINT,
  ended_at BIGINT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS zunari_call_sessions_conv_idx
  ON zunari_call_sessions(conversation_id, started_at DESC);

-- 9. Calling participants
CREATE TABLE IF NOT EXISTS zunari_call_participants (
  call_id TEXT NOT NULL REFERENCES zunari_call_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zunari_users(public_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'joined', 'left', 'declined', 'missed')),
  joined_at BIGINT,
  left_at BIGINT,
  PRIMARY KEY (call_id, user_id)
);

-- 10. Update zunari_media_assets purpose check constraint to permit 'message-attachment'
DO $$
DECLARE
  purpose_constraint RECORD;
BEGIN
  FOR purpose_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.zunari_media_assets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%purpose%'
  LOOP
    EXECUTE format('ALTER TABLE public.zunari_media_assets DROP CONSTRAINT %I', purpose_constraint.conname);
  END LOOP;
  ALTER TABLE public.zunari_media_assets
    ADD CONSTRAINT zunari_media_assets_purpose_check
    CHECK (purpose IN ('profile-avatar', 'profile-cover', 'post-image', 'message-attachment'));
END $$;

-- 11. Idempotent Data Backfill from legacy zunari_conversations and zunari_messages
-- Converts 1:1 legacy conversations to zunari_conversations_v2 and participants
INSERT INTO zunari_conversations_v2 (
  id, type, title, avatar_url, created_by, direct_key, last_message_at, created_at, updated_at
)
SELECT
  c.id,
  'direct',
  NULL,
  NULL,
  c.participant_a_id,
  least(c.participant_a_id, c.participant_b_id) || ':' || greatest(c.participant_a_id, c.participant_b_id),
  COALESCE((SELECT max(m.created_at) FROM zunari_messages m WHERE m.conversation_id = c.id), c.created_at),
  c.created_at,
  c.created_at
FROM zunari_conversations c
ON CONFLICT (id) DO NOTHING;

-- Backfill participants
INSERT INTO zunari_conversation_participants (conversation_id, user_id, role, joined_at)
SELECT c.id, c.participant_a_id, 'member', c.created_at
FROM zunari_conversations c
ON CONFLICT (conversation_id, user_id) DO NOTHING;

INSERT INTO zunari_conversation_participants (conversation_id, user_id, role, joined_at)
SELECT c.id, c.participant_b_id, 'member', c.created_at
FROM zunari_conversations c
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- Backfill legacy messages
INSERT INTO zunari_messages_v2 (
  id, conversation_id, sender_id, client_id, text, reply_to_message_id, is_edited, is_deleted, created_at
)
SELECT
  m.id,
  m.conversation_id,
  m.sender_id,
  'legacy_' || m.id,
  m.text,
  NULL,
  FALSE,
  FALSE,
  m.created_at
FROM zunari_messages m
ON CONFLICT (id) DO NOTHING;
