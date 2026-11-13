CREATE TABLE IF NOT EXISTS socket_io_attachments (
  id BIGSERIAL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload BYTEA
);
