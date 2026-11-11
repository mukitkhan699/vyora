import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const messagingDb = readFileSync(new URL('./db/messaging.ts', import.meta.url), 'utf8');
const messagingRoutes = readFileSync(new URL('./routes/messaging.ts', import.meta.url), 'utf8');
const realtime = readFileSync(new URL('./realtime.ts', import.meta.url), 'utf8');
const b2 = readFileSync(new URL('./storage/b2.ts', import.meta.url), 'utf8');

describe('messaging authorization contracts', () => {
  test('reactions require the message to belong to the conversation', () => {
    assert.match(
      messagingDb,
      /SELECT 1 FROM zunari_messages_v2 WHERE id = \$1 AND conversation_id = \$2/,
    );
  });

  test('receipts only accept message ids from the conversation and active members', () => {
    assert.match(messagingDb, /AND id = ANY\(\$2::text\[\]\)/);
    assert.match(
      messagingDb,
      /AND user_id = \$2 AND left_at IS NULL[\s\S]{0,400}SELECT id FROM zunari_messages_v2/,
    );
    assert.match(messagingDb, /INVALID_MESSAGE_ID/);
  });

  test('historical reads are cut off at the participant left_at timestamp', () => {
    assert.match(messagingDb, /m\.created_at <= p\.left_at[\s\S]{0,120}ORDER BY m\.created_at DESC/);
  });

  test('group deletion waits for every active recipient to receive the message', () => {
    assert.match(messagingDb, /type === 'group'/);
    assert.match(messagingDb, /DELETE_TOO_EARLY/);
    assert.match(
      messagingDb,
      /COUNT\(\*\)::int AS count FROM zunari_message_receipts[\s\S]{0,200}delivered_at IS NOT NULL/,
    );
  });

  test('duplicate clientId retries are acknowledged without a second fan-out', () => {
    assert.match(messagingDb, /isDuplicate: boolean/);
    assert.match(messagingRoutes, /if \(!isDuplicate\)/);
    assert.match(messagingRoutes, /duplicate: isDuplicate/);
  });

  test('departed members cannot fetch attachments sent after they left', () => {
    assert.match(
      b2,
      /p\.user_id = \$2[\s\S]{0,200}p\.left_at IS NULL OR m\.created_at <= p\.left_at/,
    );
  });

  test('live sockets are evicted when a member is removed and typing is gated', () => {
    assert.match(realtime, /evictUserFromConversation/);
    assert.match(realtime, /joinedConversations\.has\(data\.conversationId\)/);
  });
});
