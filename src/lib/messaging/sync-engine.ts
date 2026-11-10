import { api } from '../../services/api.ts';
import {
  getDB,
  clearAccountData,
  type StoredConversation,
  type StoredMessage,
  type StoredOutboxMessage,
} from './database.ts';
import {
  getAllConversations,
  upsertConversations,
  updateConversationSyncCursor,
} from './conversation-store.ts';
import {
  getMessages,
  upsertMessages,
  getMessagesForSync,
  updateMessageStatus,
  getMessageById,
} from './message-store.ts';
import {
  getOutboxMessages,
  getPendingOutboxMessages,
  updateOutboxMessage,
  removeFromOutbox,
  clearSentOutboxMessages,
} from './outbox-store.ts';
import {
  getSyncState,
  upsertSyncState,
  updateSyncCursor,
  updateLastSuccessfulSync,
} from './sync-state-store.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useRealtime } from '../../context/RealtimeContext.tsx';

export interface SyncResult {
  conversationsSynced: number;
  messagesSynced: number;
  outboxProcessed: number;
  errors: string[];
}

export interface SyncEngine {
  syncAll: () => Promise<SyncResult>;
  syncConversation: (conversationId: string) => Promise<SyncResult>;
  processOutbox: () => Promise<number>;
}

function convertServerMessage(serverMsg: any, accountId: string): StoredMessage {
  return {
    id: serverMsg.id,
    conversationId: serverMsg.conversationId,
    senderId: serverMsg.senderId,
    clientId: serverMsg.clientId,
    text: serverMsg.text,
    replyToMessageId: serverMsg.replyToMessageId,
    isEdited: serverMsg.isEdited ?? false,
    editedAt: serverMsg.editedAt ?? null,
    isDeleted: serverMsg.isDeleted ?? false,
    deletedAt: serverMsg.deletedAt ?? null,
    createdAt: typeof serverMsg.createdAt === 'string' ? new Date(serverMsg.createdAt).getTime() : serverMsg.createdAt,
    localStatus: undefined,
    localError: undefined,
    attachments: (serverMsg.attachments || []).map((a: any) => ({
      id: a.id,
      messageId: a.messageId,
      mediaAssetId: a.mediaAssetId,
      filename: a.filename,
      mimeType: a.mimeType,
      byteSize: a.byteSize,
      status: a.status,
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
      url: a.url,
    })),
    reactions: (serverMsg.reactions || []).map((r: any) => ({
      emoji: r.emoji,
      userId: r.userId,
      username: r.username,
      createdAt: r.createdAt,
    })),
    receipts: (serverMsg.receipts || []).map((r: any) => ({
      userId: r.userId,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
    })),
    accountId,
  };
}

function convertServerConversation(serverConv: any, accountId: string): StoredConversation {
  return {
    id: serverConv.id,
    type: serverConv.type,
    title: serverConv.title,
    avatarUrl: serverConv.avatarUrl,
    lastMessageAt: serverConv.lastMessageAt,
    lastMessage: serverConv.lastMessage ? convertServerMessage(serverConv.lastMessage, accountId) : undefined,
    unreadCount: serverConv.unreadCount ?? 0,
    participants: (serverConv.participants || []).map((p: any) => ({
      userId: p.userId,
      role: p.role,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
      lastReadMessageId: p.lastReadMessageId,
      user: p.user ? {
        id: p.user.id,
        username: p.user.username,
        name: p.user.name,
        avatarUrl: p.user.avatarUrl,
        verified: p.user.verified,
        isGold: p.user.isGold,
      } : undefined,
    })),
    syncCursor: serverConv.lastMessageAt ? String(serverConv.lastMessageAt) : null,
    cacheTimestamp: Date.now(),
    accountId,
  };
}

async function fetchConversations(accountId: string): Promise<StoredConversation[]> {
  const response = await api.getConversations();
  return (response.conversations || []).map((c) => convertServerConversation(c, accountId));
}

async function fetchMessages(
  accountId: string,
  conversationId: string,
  before?: string,
  limit = 50
): Promise<StoredMessage[]> {
  const response = await api.getConversationMessages(conversationId, before, limit);
  return (response.messages || []).map((m) => convertServerMessage(m, accountId));
}

async function sendOutboxMessage(
  accountId: string,
  outboxMsg: StoredOutboxMessage
): Promise<{ message: StoredMessage } | null> {
  try {
    const response = await api.sendConversationMessage(outboxMsg.conversationId, {
      text: outboxMsg.text,
      clientId: outboxMsg.clientId,
      replyToMessageId: outboxMsg.replyToMessageId,
      attachmentAssetIds: outboxMsg.attachmentAssetIds,
    });
    return { message: convertServerMessage(response.message, accountId) };
  } catch (error) {
    return null;
  }
}

export function createSyncEngine(getAccountId: () => string | null): SyncEngine {
  return {
    async syncAll(): Promise<SyncResult> {
      const accountId = getAccountId();
      if (!accountId) return { conversationsSynced: 0, messagesSynced: 0, outboxProcessed: 0, errors: ['No account ID'] };

      const errors: string[] = [];
      let conversationsSynced = 0;
      let messagesSynced = 0;
      let outboxProcessed = 0;

      try {
        const conversations = await fetchConversations(accountId);
        await upsertConversations(conversations);
        conversationsSynced = conversations.length;

        for (const conv of conversations) {
          try {
            const result = await this.syncConversation(conv.id);
            messagesSynced += result.messagesSynced;
            outboxProcessed += result.outboxProcessed;
            errors.push(...result.errors);
          } catch (e) {
            errors.push(`Failed to sync conversation ${conv.id}: ${e}`);
          }
        }
      } catch (e) {
        errors.push(`Failed to fetch conversations: ${e}`);
      }

      return { conversationsSynced, messagesSynced, outboxProcessed, errors };
    },

    async syncConversation(conversationId: string): Promise<SyncResult> {
      const accountId = getAccountId();
      if (!accountId) return { conversationsSynced: 0, messagesSynced: 0, outboxProcessed: 0, errors: ['No account ID'] };

      const errors: string[] = [];
      let messagesSynced = 0;
      let outboxProcessed = 0;

      try {
        const syncState = await getSyncState(accountId, conversationId);
        const cursor = syncState?.lastSyncedCursor ?? null;

        const newMessages = await getMessagesForSync(accountId, conversationId, cursor);
        const serverMessages = await fetchMessages(accountId, conversationId, cursor ?? undefined, 100);

        const allMessages = [...newMessages];
        for (const msg of serverMessages) {
          if (!allMessages.find((m) => m.id === msg.id)) {
            allMessages.push(msg);
          }
        }

        if (allMessages.length > 0) {
          await upsertMessages(allMessages);
          messagesSynced = allMessages.length;

          const latestMessage = allMessages.reduce((latest, m) =>
            m.createdAt > latest.createdAt ? m : latest
          );
          await updateSyncCursor(accountId, conversationId, String(latestMessage.createdAt));
          await updateLastSuccessfulSync(accountId, conversationId);
        }

        const pendingOutbox = await getPendingOutboxMessages(accountId);
        for (const outboxMsg of pendingOutbox) {
          if (outboxMsg.conversationId !== conversationId) continue;

          await updateOutboxMessage(outboxMsg.clientId, { status: 'sending' });
          const result = await sendOutboxMessage(accountId, outboxMsg);

          if (result) {
            await upsertMessages([result.message]);
            await removeFromOutbox(outboxMsg.clientId);
            outboxProcessed++;
          } else {
            await updateOutboxMessage(outboxMsg.clientId, {
              status: 'failed',
              retryCount: outboxMsg.retryCount + 1,
              nextRetryAt: Date.now() + Math.min(1000 * Math.pow(2, outboxMsg.retryCount), 30000),
            });
          }
        }

        await clearSentOutboxMessages(accountId);
      } catch (e) {
        errors.push(`Sync error: ${e}`);
      }

      return { conversationsSynced: 0, messagesSynced, outboxProcessed, errors };
    },

    async processOutbox(): Promise<number> {
      const accountId = getAccountId();
      if (!accountId) return 0;

      let processed = 0;
      const pendingOutbox = await getPendingOutboxMessages(accountId);

      for (const outboxMsg of pendingOutbox) {
        await updateOutboxMessage(outboxMsg.clientId, { status: 'sending' });
        const result = await sendOutboxMessage(accountId, outboxMsg);

        if (result) {
          await upsertMessages([result.message]);
          await removeFromOutbox(outboxMsg.clientId);
          processed++;
        } else {
          await updateOutboxMessage(outboxMsg.clientId, {
            status: 'failed',
            retryCount: outboxMsg.retryCount + 1,
            nextRetryAt: Date.now() + Math.min(1000 * Math.pow(2, outboxMsg.retryCount), 30000),
          });
        }
      }

      await clearSentOutboxMessages(accountId);
      return processed;
    },
  };
}

export async function clearAllAccountData(accountId: string): Promise<void> {
  await clearAccountData(accountId);
}

export async function initializeDatabase(): Promise<void> {
  await getDB();
}