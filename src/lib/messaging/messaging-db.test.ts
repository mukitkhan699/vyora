import assert from 'node:assert/strict';
import { describe, test, before, after, beforeEach } from 'node:test';
import {
  getDB,
  clearAllData,
  isIndexedDBAvailable,
  DB_NAME,
  type StoredMessage,
  type StoredConversation,
  type StoredOutboxMessage,
} from './database.ts';
import {
  upsertConversation,
  getAllConversations,
  getConversationById,
  deleteConversation,
  updateConversationSyncCursor,
} from './conversation-store.ts';
import {
  upsertMessage,
  getMessages,
  getMessageById,
  updateMessageStatus,
  deleteMessage,
  getMessagesByClientId,
} from './message-store.ts';
import {
  addToOutbox,
  getOutboxMessages,
  updateOutboxMessage,
  removeFromOutbox,
  getPendingOutboxMessages,
} from './outbox-store.ts';
import {
  upsertSyncState,
  getSyncState,
  updateSyncCursor,
  updateLastSuccessfulSync,
} from './sync-state-store.ts';

const TEST_ACCOUNT_ID = 'test-account-1';

async function setupDB(): Promise<void> {
  await clearAllData();
}

describe('IndexedDB Messaging Layer', () => {
  before(async () => {
    const available = await isIndexedDBAvailable();
    if (!available) {
      console.warn('IndexedDB not available, skipping tests');
      return;
    }
    await setupDB();
  });

  after(async () => {
    await clearAllData();
  });

  describe('Conversation Store', () => {
    test('upserts and retrieves conversations', async () => {
      const conv: StoredConversation = {
        id: 'conv_test_1',
        type: 'direct',
        title: 'Test Conversation',
        avatarUrl: null,
        lastMessageAt: Date.now(),
        lastMessage: null,
        unreadCount: 0,
        participants: [],
        syncCursor: null,
        cacheTimestamp: Date.now(),
        accountId: TEST_ACCOUNT_ID,
      };

      await upsertConversation(conv);
      const retrieved = await getConversationById(TEST_ACCOUNT_ID, 'conv_test_1');
      
      assert.ok(retrieved);
      assert.equal(retrieved?.id, 'conv_test_1');
      assert.equal(retrieved?.title, 'Test Conversation');
      assert.equal(retrieved?.accountId, TEST_ACCOUNT_ID);
    });

    test('filters conversations by accountId', async () => {
      const conv1: StoredConversation = {
        id: 'conv_account1',
        type: 'direct',
        title: 'Account 1 Conv',
        avatarUrl: null,
        lastMessageAt: Date.now(),
        lastMessage: null,
        unreadCount: 0,
        participants: [],
        syncCursor: null,
        cacheTimestamp: Date.now(),
        accountId: 'account-1',
      };

      const conv2: StoredConversation = {
        id: 'conv_account2',
        type: 'direct',
        title: 'Account 2 Conv',
        avatarUrl: null,
        lastMessageAt: Date.now(),
        lastMessage: null,
        unreadCount: 0,
        participants: [],
        syncCursor: null,
        cacheTimestamp: Date.now(),
        accountId: 'account-2',
      };

      await upsertConversation(conv1);
      await upsertConversation(conv2);

      const account1Convs = await getAllConversations('account-1');
      const account2Convs = await getAllConversations('account-2');

      assert.equal(account1Convs.length, 1);
      assert.equal(account1Convs[0].id, 'conv_account1');
      assert.equal(account2Convs.length, 1);
      assert.equal(account2Convs[0].id, 'conv_account2');
    });

    test('updates sync cursor', async () => {
      const conv: StoredConversation = {
        id: 'conv_cursor_test',
        type: 'group',
        title: 'Cursor Test',
        avatarUrl: null,
        lastMessageAt: Date.now(),
        lastMessage: null,
        unreadCount: 0,
        participants: [],
        syncCursor: 'old_cursor',
        cacheTimestamp: Date.now(),
        accountId: TEST_ACCOUNT_ID,
      };

      await upsertConversation(conv);
      await updateConversationSyncCursor(TEST_ACCOUNT_ID, 'conv_cursor_test', 'new_cursor');
      
      const retrieved = await getConversationById(TEST_ACCOUNT_ID, 'conv_cursor_test');
      assert.equal(retrieved?.syncCursor, 'new_cursor');
    });
  });

  describe('Message Store', () => {
    test('upserts and retrieves messages with cursor pagination', async () => {
      const baseTime = Date.now();
      const messages: StoredMessage[] = [
        {
          id: 'msg_1',
          conversationId: 'conv_test',
          senderId: 'user_1',
          clientId: 'client_1',
          text: 'First message',
          replyToMessageId: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: baseTime,
          localStatus: 'sent',
          localError: undefined,
          attachments: [],
          reactions: [],
          receipts: [],
          accountId: TEST_ACCOUNT_ID,
        },
        {
          id: 'msg_2',
          conversationId: 'conv_test',
          senderId: 'user_2',
          clientId: 'client_2',
          text: 'Second message',
          replyToMessageId: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: baseTime + 1000,
          localStatus: 'sent',
          localError: undefined,
          attachments: [],
          reactions: [],
          receipts: [],
          accountId: TEST_ACCOUNT_ID,
        },
      ];

      await upsertMessages(messages);
      
      const retrieved = await getMessages(TEST_ACCOUNT_ID, 'conv_test', { limit: 10 });
      assert.equal(retrieved.length, 2);
      assert.equal(retrieved[0].id, 'msg_1');
      assert.equal(retrieved[1].id, 'msg_2');
    });

    test('paginates with before cursor', async () => {
      const retrieved = await getMessages(TEST_ACCOUNT_ID, 'conv_test', { before: 'msg_2', limit: 1 });
      assert.equal(retrieved.length, 1);
      assert.equal(retrieved[0].id, 'msg_1');
    });

    test('looks up messages by clientId', async () => {
      const found = await getMessagesByClientId(TEST_ACCOUNT_ID, 'client_1');
      assert.equal(found.length, 1);
      assert.equal(found[0].id, 'msg_1');
    });

    test('updates message local status', async () => {
      await updateMessageStatus(TEST_ACCOUNT_ID, 'msg_1', 'failed', 'Network error');
      const retrieved = await getMessageById(TEST_ACCOUNT_ID, 'msg_1');
      assert.equal(retrieved?.localStatus, 'failed');
      assert.equal(retrieved?.localError, 'Network error');
    });

    test('deletes message', async () => {
      await deleteMessage(TEST_ACCOUNT_ID, 'msg_1');
      const retrieved = await getMessageById(TEST_ACCOUNT_ID, 'msg_1');
      assert.equal(retrieved, null);
    });
  });

  describe('Outbox Store', () => {
    test('adds and retrieves outbox messages', async () => {
      const outboxMsg: StoredOutboxMessage = {
        clientId: 'outbox_client_1',
        conversationId: 'conv_test',
        text: 'Outbox message',
        replyToMessageId: undefined,
        attachmentAssetIds: undefined,
        createdAt: Date.now(),
        retryCount: 0,
        nextRetryAt: 0,
        status: 'pending',
        accountId: TEST_ACCOUNT_ID,
      };

      await addToOutbox(outboxMsg);
      const retrieved = await getOutboxMessages(TEST_ACCOUNT_ID);
      
      assert.ok(retrieved.length >= 1);
      const msg = retrieved.find(m => m.clientId === 'outbox_client_1');
      assert.ok(msg);
      assert.equal(msg.text, 'Outbox message');
      assert.equal(msg.status, 'pending');
    });

    test('updates outbox message status with retry', async () => {
      await updateOutboxMessage('outbox_client_1', { 
        status: 'failed', 
        retryCount: 1, 
        nextRetryAt: Date.now() + 2000,
        lastError: 'Timeout' 
      });
      
      const retrieved = await getOutboxMessages(TEST_ACCOUNT_ID);
      const msg = retrieved.find(m => m.clientId === 'outbox_client_1');
      assert.equal(msg?.status, 'failed');
      assert.equal(msg?.retryCount, 1);
      assert.ok(msg?.nextRetryAt);
    });

    test('gets pending outbox messages', async () => {
      const pending = await getPendingOutboxMessages(TEST_ACCOUNT_ID);
      const msg = pending.find(m => m.clientId === 'outbox_client_1');
      assert.ok(msg);
      assert.equal(msg.status, 'failed'); // Should be pending/failed with nextRetryAt <= now
    });
  });

  describe('Sync State Store', () => {
    test('upserts and retrieves sync state', async () => {
      await upsertSyncState({
        conversationId: 'conv_sync_test',
        lastSyncedCursor: 'cursor_123',
        lastSuccessfulSync: Date.now(),
        accountId: TEST_ACCOUNT_ID,
      });

      const state = await getSyncState(TEST_ACCOUNT_ID, 'conv_sync_test');
      assert.ok(state);
      assert.equal(state?.lastSyncedCursor, 'cursor_123');
    });

    test('updates sync cursor', async () => {
      await updateSyncCursor(TEST_ACCOUNT_ID, 'conv_sync_test', 'cursor_456');
      const state = await getSyncState(TEST_ACCOUNT_ID, 'conv_sync_test');
      assert.equal(state?.lastSyncedCursor, 'cursor_456');
    });

    test('updates last successful sync timestamp', async () => {
      const before = Date.now();
      await updateLastSuccessfulSync(TEST_ACCOUNT_ID, 'conv_sync_test');
      const state = await getSyncState(TEST_ACCOUNT_ID, 'conv_sync_test');
      assert.ok(state!.lastSuccessfulSync >= before);
    });
  });
});

async function upsertMessages(messages: StoredMessage[]): Promise<void> {
  const { upsertMessages } = await import('./message-store.ts');
  await upsertMessages(messages);
}