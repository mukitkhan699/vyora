import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import {
  initializeDatabase,
  clearAllAccountData,
  createSyncEngine,
  type SyncResult,
} from '../lib/messaging/sync-engine';
import {
  getAllConversations,
  upsertConversation,
  getConversationById,
  deleteConversation,
  updateConversationSyncCursor,
} from '../lib/messaging/conversation-store';
import {
  getMessages,
  upsertMessage,
  getMessageById,
  updateMessageStatus,
  deleteMessage,
  getUnsyncedMessages,
  type StoredMessage,
} from '../lib/messaging/message-store';
import {
  getOutboxMessages,
  addToOutbox,
  updateOutboxMessage,
  removeFromOutbox,
  getPendingOutboxMessages,
} from '../lib/messaging/outbox-store';
import {
  getSyncState,
  upsertSyncState,
  updateSyncCursor,
} from '../lib/messaging/sync-state-store';
import { cacheManager } from '../lib/messaging/cache-manager';
import type { Conversation, Message } from '../types/index';

function convertStoredConversation(stored: any): Conversation {
  return {
    id: stored.id,
    type: stored.type,
    title: stored.title,
    avatarUrl: stored.avatarUrl,
    lastMessageAt: stored.lastMessageAt,
    lastMessage: stored.lastMessage ? convertStoredMessage(stored.lastMessage) : null,
    unreadCount: stored.unreadCount ?? 0,
    participants: stored.participants,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function convertStoredMessage(stored: any): Message {
  return {
    id: stored.id,
    conversationId: stored.conversationId,
    senderId: stored.senderId,
    clientId: stored.clientId,
    text: stored.text,
    replyToMessageId: stored.replyToMessageId,
    isEdited: stored.isEdited,
    editedAt: stored.editedAt,
    isDeleted: stored.isDeleted,
    deletedAt: stored.deletedAt,
    createdAt: stored.createdAt,
    localStatus: stored.localStatus,
    localError: stored.localError,
    attachments: stored.attachments?.map((a: any) => ({
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
    })) || [],
    reactions: stored.reactions?.map((r: any) => ({
      emoji: r.emoji,
      userId: r.userId,
      username: r.username,
      createdAt: r.createdAt,
    })) || [],
    receipts: stored.receipts?.map((r: any) => ({
      userId: r.userId,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
    })) || [],
  };
}

export function useMessagingDB() {
  const { currentUser } = useAuth();
  const { connected } = useRealtime();
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const syncEngineRef = useRef<ReturnType<typeof createSyncEngine> | null>(null);
  const syncInProgressRef = useRef(false);

  useEffect(() => {
    if (!currentUser?.id) {
      setDbReady(false);
      syncEngineRef.current = null;
      return;
    }

    const initDB = async () => {
      try {
        await initializeDatabase();
        cacheManager.setAccountId(currentUser.id);
        await cacheManager.initialize();
        syncEngineRef.current = createSyncEngine(() => currentUser.id);
        setDbReady(true);
        setDbError(null);
      } catch (error) {
        setDbError(error instanceof Error ? error.message : 'Failed to initialize database');
        setDbReady(false);
      }
    };

    initDB();

    return () => {
      cacheManager.setAccountId(null);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!connected || !currentUser?.id || !syncEngineRef.current || syncInProgressRef.current) return;

    const processOutbox = async () => {
      syncInProgressRef.current = true;
      try {
        await syncEngineRef.current!.processOutbox();
      } catch (error) {
        console.error('Outbox processing failed:', error);
      } finally {
        syncInProgressRef.current = false;
      }
    };

    processOutbox();
    const interval = window.setInterval(processOutbox, 10000);

    return () => window.clearInterval(interval);
  }, [connected, currentUser?.id]);

  const loadConversations = useCallback(async (): Promise<Conversation[]> => {
    if (!currentUser?.id) return [];
    try {
      const stored = await getAllConversations(currentUser.id);
      return stored.map(convertStoredConversation);
    } catch {
      return [];
    }
  }, [currentUser?.id]);

  const loadConversation = useCallback(async (conversationId: string): Promise<Conversation | null> => {
    if (!currentUser?.id) return null;
    try {
      const stored = await getConversationById(currentUser.id, conversationId);
      return stored ? convertStoredConversation(stored) : null;
    } catch {
      return null;
    }
  }, [currentUser?.id]);

  const saveConversation = useCallback(async (conversation: Conversation): Promise<void> => {
    if (!currentUser?.id) return;
    const { lastMessage, participants, ...rest } = conversation;
    const stored = {
      ...rest,
      type: conversation.type ?? 'direct',
      title: conversation.title ?? null,
      avatarUrl: conversation.avatarUrl ?? null,
      lastMessageAt: conversation.lastMessageAt ?? 0,
      createdBy: conversation.createdBy ?? null,
      participants: (conversation.participants ?? []).map((p) => ({
        userId: p.userId,
        role: p.role,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt ?? null,
        lastReadMessageId: p.lastReadMessageId ?? null,
        user: p.user ? {
          id: p.user.id,
          username: p.user.username,
          name: p.user.name,
          avatarUrl: p.user.avatarUrl,
          verified: p.user.verified,
          isGold: p.user.isGold ?? false,
        } : undefined,
      })),
      syncCursor: conversation.lastMessageAt ? String(conversation.lastMessageAt) : null,
      accountId: currentUser.id,
      cacheTimestamp: Date.now(),
    };
    await upsertConversation(stored);
  }, [currentUser?.id]);

  const removeConversation = useCallback(async (conversationId: string): Promise<void> => {
    if (!currentUser?.id) return;
    await deleteConversation(currentUser.id, conversationId);
  }, [currentUser?.id]);

  const loadMessages = useCallback(async (
    conversationId: string,
    options?: { before?: string; limit?: number }
  ): Promise<Message[]> => {
    if (!currentUser?.id) return [];
    try {
      const stored = await getMessages(currentUser.id, conversationId, options);
      return stored.map(convertStoredMessage);
    } catch {
      return [];
    }
  }, [currentUser?.id]);

  const saveMessage = useCallback(async (message: Message): Promise<void> => {
    if (!currentUser?.id) return;
    if (!message.conversationId) return;
    const stored: StoredMessage = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId ?? null,
      clientId: message.clientId ?? null,
      text: message.text,
      replyToMessageId: message.replyToMessageId ?? null,
      isEdited: message.isEdited ?? false,
      editedAt: message.editedAt ?? null,
      isDeleted: message.isDeleted ?? false,
      deletedAt: message.deletedAt ?? null,
      createdAt: typeof message.createdAt === 'string' ? new Date(message.createdAt).getTime() : message.createdAt,
      localStatus: message.localStatus,
      localError: message.localError,
      attachments: (message.attachments || []).map((a) => ({
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
      reactions: (message.reactions || []).map((r) => ({
        emoji: r.emoji,
        userId: r.userId,
        username: r.username,
        createdAt: r.createdAt,
      })),
      receipts: (message.receipts || []).map((r) => ({
        userId: r.userId,
        deliveredAt: r.deliveredAt,
        readAt: r.readAt,
      })),
      accountId: currentUser.id,
    };
    await upsertMessage(stored);
  }, [currentUser?.id]);

  const getMessage = useCallback(async (messageId: string): Promise<Message | null> => {
    if (!currentUser?.id) return null;
    try {
      const stored = await getMessageById(currentUser.id, messageId);
      return stored ? convertStoredMessage(stored) : null;
    } catch {
      return null;
    }
  }, [currentUser?.id]);

  const updateMessageLocalStatus = useCallback(async (
    messageId: string,
    localStatus: Message['localStatus'],
    localError?: string
  ): Promise<void> => {
    if (!currentUser?.id) return;
    await updateMessageStatus(currentUser.id, messageId, localStatus, localError);
  }, [currentUser?.id]);

  const removeMessage = useCallback(async (messageId: string): Promise<void> => {
    if (!currentUser?.id) return;
    await deleteMessage(currentUser.id, messageId);
  }, [currentUser?.id]);

  const queueMessage = useCallback(async (outboxMessage: {
    clientId: string;
    conversationId: string;
    text: string;
    replyToMessageId?: string;
    attachmentAssetIds?: string[];
  }): Promise<void> => {
    if (!currentUser?.id) return;
    await addToOutbox({
      ...outboxMessage,
      createdAt: Date.now(),
      retryCount: 0,
      nextRetryAt: 0,
      status: 'pending',
      accountId: currentUser.id,
    });
  }, [currentUser?.id]);

  const getOutbox = useCallback(async () => {
    if (!currentUser?.id) return [];
    return getOutboxMessages(currentUser.id);
  }, [currentUser?.id]);

  const retryOutboxMessage = useCallback(async (clientId: string): Promise<void> => {
    if (!currentUser?.id) return;
    await updateOutboxMessage(clientId, { status: 'pending', nextRetryAt: 0, retryCount: 0 });
  }, [currentUser?.id]);

  const removeFromOutboxQueue = useCallback(async (clientId: string): Promise<void> => {
    if (!currentUser?.id) return;
    await removeFromOutbox(clientId);
  }, [currentUser?.id]);

  const sync = useCallback(async (): Promise<SyncResult> => {
    if (!syncEngineRef.current) return { conversationsSynced: 0, messagesSynced: 0, outboxProcessed: 0, errors: ['Sync engine not initialized'] };
    if (syncInProgressRef.current) return { conversationsSynced: 0, messagesSynced: 0, outboxProcessed: 0, errors: ['Sync already in progress'] };

    syncInProgressRef.current = true;
    try {
      return await syncEngineRef.current.syncAll();
    } finally {
      syncInProgressRef.current = false;
    }
  }, []);

  const syncConversation = useCallback(async (conversationId: string): Promise<SyncResult> => {
    if (!syncEngineRef.current) return { conversationsSynced: 0, messagesSynced: 0, outboxProcessed: 0, errors: ['Sync engine not initialized'] };
    return syncEngineRef.current.syncConversation(conversationId);
  }, []);

  const clearData = useCallback(async (): Promise<void> => {
    if (!currentUser?.id) return;
    await clearAllAccountData(currentUser.id);
  }, [currentUser?.id]);

  return {
    dbReady,
    dbError,
    loadConversations,
    loadConversation,
    saveConversation,
    removeConversation,
    loadMessages,
    saveMessage,
    getMessage,
    updateMessageLocalStatus,
    removeMessage,
    queueMessage,
    getOutbox,
    retryOutboxMessage,
    removeFromOutboxQueue,
    sync,
    syncConversation,
    clearData,
    cacheManager,
  };
}