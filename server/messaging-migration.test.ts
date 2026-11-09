import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const migration006 = await readFile(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'db/migrations/006_complete_messaging_and_calling.sql'),
  'utf8',
);

describe('migration 006 complete messaging and calling schema contract', () => {
  test('prerequisite guard ensures migration 001 exists', () => {
    assert.match(migration006, /to_regclass\('public\.zunari_conversations'\) IS NULL/);
    assert.match(migration006, /to_regclass\('public\.zunari_messages'\) IS NULL/);
    assert.match(migration006, /to_regclass\('public\.zunari_media_assets'\) IS NULL/);
  });

  test('creates zunari_conversations_v2 with direct and group support', () => {
    assert.match(migration006, /CREATE TABLE IF NOT EXISTS zunari_conversations_v2/);
    assert.match(migration006, /type TEXT NOT NULL CHECK \(type IN \('direct', 'group'\)\)/);
    assert.match(migration006, /direct_key TEXT UNIQUE/);
  });

  test('creates zunari_conversation_participants with roles and soft-leave column', () => {
    assert.match(migration006, /CREATE TABLE IF NOT EXISTS zunari_conversation_participants/);
    assert.match(migration006, /role TEXT NOT NULL DEFAULT 'member' CHECK \(role IN \('owner', 'admin', 'member'\)\)/);
    assert.match(migration006, /left_at BIGINT/);
  });

  test('creates zunari_messages_v2 with client idempotency and edit/delete support', () => {
    assert.match(migration006, /CREATE TABLE IF NOT EXISTS zunari_messages_v2/);
    assert.match(migration006, /is_edited BOOLEAN NOT NULL DEFAULT FALSE/);
    assert.match(migration006, /is_deleted BOOLEAN NOT NULL DEFAULT FALSE/);
    assert.match(migration006, /client_id TEXT/);
    assert.match(migration006, /zunari_messages_v2_client_id_idx/);
  });

  test('attachment media_asset_id uses ON DELETE RESTRICT to prevent destructive cascades', () => {
    assert.match(
      migration006,
      /media_asset_id TEXT NOT NULL REFERENCES zunari_media_assets\(id\) ON DELETE RESTRICT/,
    );
  });

  test('creates per-recipient attachment delivery tracking table', () => {
    assert.match(migration006, /CREATE TABLE IF NOT EXISTS zunari_attachment_deliveries/);
    assert.match(migration006, /delivered_at BIGINT/);
    assert.match(migration006, /read_at BIGINT/);
    assert.match(migration006, /downloaded_at BIGINT/);
  });

  test('creates calling session and participants tables', () => {
    assert.match(migration006, /CREATE TABLE IF NOT EXISTS zunari_call_sessions/);
    assert.match(migration006, /room_name TEXT NOT NULL UNIQUE/);
    assert.match(migration006, /CREATE TABLE IF NOT EXISTS zunari_call_participants/);
  });

  test('updates zunari_media_assets to allow message-attachment purpose', () => {
    assert.match(migration006, /'message-attachment'/);
    assert.match(migration006, /zunari_media_assets_purpose_check/);
  });

  test('idempotently backfills legacy conversations and messages into v2', () => {
    assert.match(migration006, /INSERT INTO zunari_conversations_v2/);
    assert.match(migration006, /INSERT INTO zunari_conversation_participants/);
    assert.match(migration006, /INSERT INTO zunari_messages_v2/);
    assert.match(migration006, /ON CONFLICT \(id\) DO NOTHING/);
  });
});
