import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { MessageRecord } from './db/messaging.ts';
import { MessagingRepository } from './db/messaging.ts';
import { withTransaction } from './db/pool.ts';

interface MessageTransactionState {
  messages: string[];
  editedText: string | null;
  conversationUpdated: boolean;
  attachments: string[];
  attachmentDeliveries: string[];
  receipts: string[];
  outbox: Array<{
    eventType: string;
    entityId: string;
    conversationId: string;
    payload: Record<string, unknown>;
  }>;
  statements: string[];
}

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: 'INSERT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function queryResultFor<Row extends QueryResultRow>(rows: QueryResultRow[]): QueryResult<Row> {
  return queryResult(rows as Row[]);
}

function createMessagingFixture(options: {
  failMessageAfterInsert?: boolean;
  failOutboxInsert?: boolean;
  senderActive?: boolean;
} = {}) {
  const state: MessageTransactionState = {
    messages: [],
    editedText: null,
    conversationUpdated: false,
    attachments: [],
    attachmentDeliveries: [],
    receipts: [],
    outbox: [],
    statements: [],
  };

  const fakeTransaction = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
    const snapshot = structuredClone(state);
    const client = {
      query: async <Row extends QueryResultRow = QueryResultRow>(
        sql: string,
        values: unknown[] = [],
      ): Promise<QueryResult<Row>> => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        state.statements.push(normalized);
        if (normalized.startsWith('SELECT id FROM zunari_conversations_v2 WHERE id = $1 FOR UPDATE')) {
          return queryResultFor<Row>([{ id: String(values[0]) }]);
        }
        if (normalized.startsWith('SELECT id FROM zunari_conversations_v2 WHERE id = $1 FOR KEY SHARE')) {
          return queryResultFor<Row>([{ id: String(values[0]) }]);
        }
        if (normalized.startsWith('SELECT membership_epoch FROM zunari_conversation_participants')) {
          return options.senderActive === false
            ? queryResultFor<Row>([])
            : queryResultFor<Row>([{ membership_epoch: '00000000-0000-4000-8000-000000000001' }]);
        }
        if (normalized.startsWith('SELECT sender_id, is_deleted FROM zunari_messages_v2')) {
          return queryResultFor<Row>([{ sender_id: 'user-a', is_deleted: false }]);
        }
        if (normalized.startsWith('UPDATE zunari_messages_v2 SET text =')) {
          state.editedText = String(values[0]);
          return queryResultFor<Row>([]);
        }
        if (normalized.startsWith('SELECT user_id, membership_epoch FROM zunari_conversation_participants') &&
            normalized.includes('AND left_at IS NULL') &&
            !normalized.includes('user_id <>')) {
          return queryResultFor<Row>([
            { user_id: 'user-a', membership_epoch: '00000000-0000-4000-8000-000000000001' },
            { user_id: 'user-b', membership_epoch: '00000000-0000-4000-8000-000000000002' },
          ]);
        }
        if (normalized.startsWith('SELECT left_at, membership_epoch FROM zunari_conversation_participants')) {
          return queryResultFor<Row>([{
            left_at: options.senderActive === false ? 123 : null,
            membership_epoch: '00000000-0000-4000-8000-000000000001',
          }]);
        }
        if (normalized.startsWith('SELECT id FROM zunari_messages_v2 WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3')) {
          return queryResultFor<Row>([]);
        }
        if (normalized.startsWith('INSERT INTO zunari_messages_v2')) {
          state.messages.push(String(values[0]));
          return queryResultFor<Row>([{ id: String(values[0]) }]);
        }
        if (normalized.startsWith('UPDATE zunari_conversations_v2')) {
          state.conversationUpdated = true;
          if (options.failMessageAfterInsert) throw new Error('injected message transaction failure');
          return queryResultFor<Row>([]);
        }
        if (normalized.startsWith('SELECT user_id, membership_epoch FROM zunari_conversation_participants')) {
          return queryResultFor<Row>([{
            user_id: 'user-b',
            membership_epoch: '00000000-0000-4000-8000-000000000001',
          }]);
        }
        if (normalized.startsWith("SELECT owner_id FROM zunari_media_assets")) {
          return queryResultFor<Row>([{ owner_id: 'user-a' }]);
        }
        if (normalized.startsWith('INSERT INTO zunari_message_attachments')) {
          state.attachments.push(String(values[0]));
          return queryResultFor<Row>([]);
        }
        if (normalized.startsWith('INSERT INTO zunari_attachment_deliveries')) {
          state.attachmentDeliveries.push(String(values[0]));
          return queryResultFor<Row>([]);
        }
        if (normalized.startsWith('INSERT INTO zunari_message_receipts')) {
          state.receipts.push(String(values[0]));
          return queryResultFor<Row>([]);
        }
        if (normalized.startsWith('INSERT INTO zunari_realtime_event_outbox')) {
          if (options.failOutboxInsert) throw new Error('injected outbox insert failure');
          state.outbox.push({
            eventType: String(values[1]),
            entityId: String(values[2]),
            conversationId: String(values[3]),
            payload: values[4] as Record<string, unknown>,
          });
          return queryResult([]) as QueryResult<Row>;
        }
        throw new Error(`Unexpected messaging SQL: ${normalized}`);
      },
    };

    try {
      return await work(client as unknown as PoolClient);
    } catch (error) {
      const statements = state.statements;
      Object.assign(state, snapshot);
      state.statements = statements;
      throw error;
    }
  };

  const sentMessage = (id: string): MessageRecord => ({
    id,
    conversationId: 'conversation-1',
    senderId: 'user-a',
    clientId: 'client-1',
    text: 'hello',
    replyToMessageId: null,
    replyToMessage: null,
    isEdited: false,
    editedAt: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: 123,
    attachments: [],
    reactions: [],
    receipts: [],
  });

  const repository = new MessagingRepository({
    withTransaction: fakeTransaction as typeof withTransaction,
    loadSentMessage: async (id) => sentMessage(id),
    loadEditedMessage: async (id) => ({
      ...sentMessage(id),
      text: state.editedText ?? 'hello',
      isEdited: true,
      editedAt: 123,
    }),
  });

  return { repository, state };
}

describe('Transactional message event outbox', () => {
  test('message, conversation state, attachment metadata, receipts, and event commit together', async () => {
    const { repository, state } = createMessagingFixture();

    const result = await repository.sendMessage('user-a', 'conversation-1', {
      text: 'hello',
      clientId: 'client-1',
      attachmentAssetIds: ['asset-1'],
    });

    assert.equal(result.isDuplicate, false);
    assert.deepEqual(state.messages, [result.message.id]);
    assert.equal(state.conversationUpdated, true);
    assert.equal(state.attachments.length, 1);
    assert.equal(state.attachmentDeliveries.length, 1);
    assert.deepEqual(state.receipts, [result.message.id]);
    assert.equal(state.outbox.length, 1);
    assert.equal(state.outbox[0].eventType, 'conversation.message');
    assert.equal(state.outbox[0].entityId, result.message.id);
    assert.equal(state.outbox[0].conversationId, 'conversation-1');
    assert.ok(
      state.statements.findIndex((statement) =>
        statement.startsWith('SELECT id FROM zunari_conversations_v2 WHERE id = $1 FOR KEY SHARE'),
      ) <
        state.statements.findIndex((statement) =>
          statement.startsWith('SELECT left_at, membership_epoch FROM zunari_conversation_participants'),
        ),
      'The conversation lock must be acquired before sender membership is checked.',
    );
    assert.deepEqual(state.outbox[0].payload, {
      messageId: result.message.id,
      senderId: 'user-a',
      recipientIds: ['user-a', 'user-b'],
      recipientMemberships: [
        { userId: 'user-a', epoch: '00000000-0000-4000-8000-000000000001' },
        { userId: 'user-b', epoch: '00000000-0000-4000-8000-000000000001' },
      ],
    });
    assert.ok(
      state.statements.indexOf('INSERT INTO zunari_realtime_event_outbox (id, event_type, entity_id, conversation_id, payload, created_at, next_attempt_at) VALUES ($1, $2, $3, $4, $5, $6, $6)')
      > state.statements.findIndex((statement) => statement.startsWith('INSERT INTO zunari_message_attachments')),
    );
  });

  test('a failed message transaction rolls back without an outbox event', async () => {
    const { repository, state } = createMessagingFixture({ failMessageAfterInsert: true });

    await assert.rejects(
      repository.sendMessage('user-a', 'conversation-1', { text: 'hello', clientId: 'client-1' }),
      /injected message transaction failure/,
    );

    assert.deepEqual(state.messages, []);
    assert.equal(state.conversationUpdated, false);
    assert.deepEqual(state.outbox, []);
  });

  test('a removed sender is rejected before creating any message or associated records', async () => {
    const { repository, state } = createMessagingFixture({ senderActive: false });

    await assert.rejects(
      repository.sendMessage('user-a', 'conversation-1', {
        text: 'hello',
        clientId: 'client-removed',
        attachmentAssetIds: ['asset-1'],
      }),
      (error: unknown) =>
        error instanceof Error &&
        'status' in error &&
        error.status === 403,
    );

    assert.deepEqual(state.messages, []);
    assert.equal(state.conversationUpdated, false);
    assert.deepEqual(state.attachments, []);
    assert.deepEqual(state.attachmentDeliveries, []);
    assert.deepEqual(state.receipts, []);
    assert.deepEqual(state.outbox, []);
    assert.ok(
      state.statements.findIndex((statement) =>
        statement.startsWith('SELECT id FROM zunari_conversations_v2 WHERE id = $1 FOR KEY SHARE'),
      ) <
        state.statements.findIndex((statement) =>
          statement.startsWith('SELECT left_at, membership_epoch FROM zunari_conversation_participants'),
        ),
    );
  });

  test('message edits lock before checking active membership and enqueue recipient epochs atomically', async () => {
    const { repository, state } = createMessagingFixture();

    const updated = await repository.editMessage('conversation-1', 'message-1', 'user-a', ' edited ');

    assert.equal(updated.text, 'edited');
    assert.equal(state.editedText, 'edited');
    assert.equal(state.outbox.length, 1);
    assert.equal(state.outbox[0].eventType, 'conversation.message.edit');
    assert.equal(state.outbox[0].entityId, 'message-1');
    assert.deepEqual(state.outbox[0].payload, {
      messageId: 'message-1',
      senderId: 'user-a',
      recipientIds: ['user-a', 'user-b'],
      recipientMemberships: [
        { userId: 'user-a', epoch: '00000000-0000-4000-8000-000000000001' },
        { userId: 'user-b', epoch: '00000000-0000-4000-8000-000000000002' },
      ],
    });
    assert.ok(
      state.statements.findIndex((statement) =>
        statement.startsWith('SELECT id FROM zunari_conversations_v2 WHERE id = $1 FOR UPDATE'),
      ) <
        state.statements.findIndex((statement) =>
          statement.startsWith('SELECT membership_epoch FROM zunari_conversation_participants'),
        ),
      'The conversation lock must be acquired before edit authorization.',
    );
  });

  test('a removed sender cannot edit or enqueue a realtime event', async () => {
    const { repository, state } = createMessagingFixture({ senderActive: false });

    await assert.rejects(
      repository.editMessage('conversation-1', 'message-1', 'user-a', 'unauthorized'),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'FORBIDDEN',
    );

    assert.equal(state.editedText, null);
    assert.deepEqual(state.outbox, []);
  });

  test('an outbox insertion failure rolls back the edit', async () => {
    const { repository, state } = createMessagingFixture({ failOutboxInsert: true });

    await assert.rejects(
      repository.editMessage('conversation-1', 'message-1', 'user-a', 'must roll back'),
      /injected outbox insert failure/,
    );

    assert.equal(state.editedText, null);
    assert.deepEqual(state.outbox, []);
  });

  test('a failed outbox insert rolls back the message and all transaction state', async () => {
    const { repository, state } = createMessagingFixture({ failOutboxInsert: true });

    await assert.rejects(
      repository.sendMessage('user-a', 'conversation-1', {
        text: 'hello',
        clientId: 'client-1',
        attachmentAssetIds: ['asset-1'],
      }),
      /injected outbox insert failure/,
    );

    assert.deepEqual(state.messages, []);
    assert.equal(state.conversationUpdated, false);
    assert.deepEqual(state.attachments, []);
    assert.deepEqual(state.attachmentDeliveries, []);
    assert.deepEqual(state.receipts, []);
    assert.deepEqual(state.outbox, []);
  });
});
