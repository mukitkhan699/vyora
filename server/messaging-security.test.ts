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
    assert.match(messagingDb, /AND user_id = \$2 AND left_at IS NULL/);
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

  test('duplicate clientId retries are acknowledged without creating another outbox event', () => {
    assert.match(messagingDb, /isDuplicate: boolean/);
    assert.match(
      messagingDb,
      /if \(existing\.rows\[0\]\) \{\s+return \{ messageId: existing\.rows\[0\]\.id, isDuplicate: true \};/,
    );
    assert.match(
      messagingDb,
      /return \{ messageId: winner\.rows\[0\]\.id, isDuplicate: true \};[\s\S]*?await enqueueOutboxEvent/,
    );
    assert.doesNotMatch(messagingRoutes, /publishConversationMessage\s*\(/);
    assert.match(messagingRoutes, /duplicate: isDuplicate/);
  });

  test('message edits serialize authorization and enqueue delivery under the conversation lock', () => {
    assert.match(
      messagingDb,
      /lockConversationForMembershipChange\(client, conversationId\);[\s\S]{0,250}SELECT membership_epoch FROM zunari_conversation_participants/,
    );
    assert.match(messagingDb, /eventType: 'conversation\.message\.edit'/);
    assert.doesNotMatch(messagingRoutes, /publishConversationMessageEdit/);
    assert.doesNotMatch(
      realtime,
      /io\.to\(`conv:\$\{conversationId\}`\)\.emit\('conversation:message-edit'/,
    );
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
