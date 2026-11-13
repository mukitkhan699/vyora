import { useCallback } from 'react';
import { useMessagingDB } from '../hooks/useMessagingDB';
import { api } from '../services/api.ts';
import {
  convertServerConversation,
  convertServerMessage,
} from '../lib/messaging/sync-engine.ts';
import {
  deleteMessage as deleteStoredMessage,
  upsertMessages,
} from '../lib/messaging/message-store.ts';
import { upsertConversations } from '../lib/messaging/conversation-store.ts';
import type { Conversation, Message } from '../types/index.ts';
import { toMillis } from '../utils/messaging.ts';

export interface CacheFirstMessagesLoader {
  /** Read the local cache immediately (works offline). */
  loadMessages: (
    conversationId: string,
    options?: { before?: string; limit?: number },
  ) => Promise<Message[]>;
  /** Fetch a page from the server, persist it, and return it. Throws on network errors. */
  fetchMessages: (
    conversationId: string,
    options?: { before?: string; limit?: number },
  ) => Promise<Message[]>;
  saveMessage: (message: Message) => Promise<void>;
  removeMessage: (messageId: string) => Promise<void>;
  loadOlder: (conversationId: string, oldestMessageId: string, limit?: number) => Promise<Message[]>;
}

export function useCacheFirstMessagesLoader(
  currentUserId: string | undefined,
): CacheFirstMessagesLoader {
  const { loadMessages, saveMessage, removeMessage, dbReady } = useMessagingDB();

  const loadMessagesWrapper = useCallback(
    async (
      conversationId: string,
      options: { before?: string; limit?: number } = {},
    ): Promise<Message[]> => {
      if (!currentUserId || !dbReady) return [];
      return loadMessages(conversationId, options);
    },
    [currentUserId, dbReady, loadMessages],
  );

  const fetchMessagesWrapper = useCallback(
    async (
      conversationId: string,
      options: { before?: string; limit?: number } = {},
    ): Promise<Message[]> => {
      if (!currentUserId) return [];
      const response = await api.getConversationMessages(
        conversationId,
        options.before,
        options.limit ?? 50,
      );
      const messages = response.messages || [];
      if (dbReady) {
        const stored = messages.map((message) => convertServerMessage(message, currentUserId));
        if (stored.length > 0) await upsertMessages(stored);
        // A server row is authoritative for its clientId; drop the optimistic twin.
        for (const message of messages) {
          if (message.clientId) {
            await deleteStoredMessage(currentUserId, `local-${message.clientId}`);
          }
        }
      }
      return messages.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    },
    [currentUserId, dbReady],
  );

  const saveMessageWrapper = useCallback(
    async (message: Message): Promise<void> => {
      if (!currentUserId || !dbReady) return;
      await saveMessage(message);
    },
    [currentUserId, dbReady, saveMessage],
  );

  const removeMessageWrapper = useCallback(
    async (messageId: string): Promise<void> => {
      if (!currentUserId || !dbReady) return;
      await removeMessage(messageId);
    },
    [currentUserId, dbReady, removeMessage],
  );

  const loadOlder = useCallback(
    async (
      conversationId: string,
      oldestMessageId: string,
      limit = 50,
    ): Promise<Message[]> => {
      if (!currentUserId || !dbReady) return [];
      return loadMessages(conversationId, { before: oldestMessageId, limit });
    },
    [currentUserId, dbReady, loadMessages],
  );

  return {
    loadMessages: loadMessagesWrapper,
    fetchMessages: fetchMessagesWrapper,
    saveMessage: saveMessageWrapper,
    removeMessage: removeMessageWrapper,
    loadOlder,
  };
}

export interface CacheFirstConversationsLoader {
  /** Read the local cache immediately (works offline). */
  loadConversations: () => Promise<Conversation[]>;
  /** Fetch the server inbox, persist it, and return it. Throws on network errors. */
  refreshConversations: () => Promise<Conversation[]>;
  saveConversation: (conversation: Conversation) => Promise<void>;
}

export function useCacheFirstConversationsLoader(
  currentUserId: string | undefined,
): CacheFirstConversationsLoader {
  const { loadConversations, saveConversation, dbReady } = useMessagingDB();

  const loadConversationsWrapper = useCallback(async (): Promise<Conversation[]> => {
    if (!currentUserId || !dbReady) return [];
    return loadConversations();
  }, [currentUserId, dbReady, loadConversations]);

  const refreshConversationsWrapper = useCallback(async (): Promise<Conversation[]> => {
    if (!currentUserId) return [];
    const response = await api.getConversations();
    const conversations = response.conversations || [];
    if (dbReady && conversations.length > 0) {
      await upsertConversations(
        conversations.map((conversation) =>
          convertServerConversation(conversation, currentUserId),
        ),
      );
    }
    return conversations.sort(
      (a, b) =>
        (b.lastMessageAt || toMillis(b.lastMessage?.createdAt)) -
        (a.lastMessageAt || toMillis(a.lastMessage?.createdAt)),
    );
  }, [currentUserId, dbReady]);

  const saveConversationWrapper = useCallback(
    async (conversation: Conversation): Promise<void> => {
      if (!currentUserId || !dbReady) return;
      await saveConversation(conversation);
    },
    [currentUserId, dbReady, saveConversation],
  );

  return {
    loadConversations: loadConversationsWrapper,
    refreshConversations: refreshConversationsWrapper,
    saveConversation: saveConversationWrapper,
  };
}
