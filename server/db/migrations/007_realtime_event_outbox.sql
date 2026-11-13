CREATE TABLE IF NOT EXISTS zunari_realtime_event_outbox (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  entity_id TEXT,
  conversation_id TEXT,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at BIGINT NOT NULL,
  published_at BIGINT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at BIGINT NOT NULL,
  claimed_at BIGINT,
  lease_expires_at BIGINT,
  lease_token UUID,
  last_error TEXT,
  dead_lettered_at BIGINT,
  CHECK (octet_length(payload::text) <= 1048576),
  CHECK (
    (claimed_at IS NULL AND lease_expires_at IS NULL AND lease_token IS NULL)
    OR (claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_token IS NOT NULL)
  ),
  CHECK (published_at IS NULL OR dead_lettered_at IS NULL),
  CHECK (published_at IS NULL OR claimed_at IS NULL),
  CHECK (dead_lettered_at IS NULL OR claimed_at IS NULL)
);

CREATE INDEX IF NOT EXISTS zunari_realtime_outbox_pending_idx
  ON zunari_realtime_event_outbox(next_attempt_at, created_at)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE INDEX IF NOT EXISTS zunari_realtime_outbox_lease_idx
  ON zunari_realtime_event_outbox(lease_expires_at)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL AND lease_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS zunari_realtime_outbox_published_idx
  ON zunari_realtime_event_outbox(published_at)
  WHERE published_at IS NOT NULL;
