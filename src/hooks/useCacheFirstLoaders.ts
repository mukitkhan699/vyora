import { useCallback, useEffect, useState } from 'react';
import { useMessagingDB } from '../hooks/useMessagingDB';
import type { Conversation, Message } from '../types/index';
import { sortConversations, mergeMessages, toMillis } from '../utils/messaging';

export interface CacheFirstMessagesLoader {
  loadMessages: (conversationId: string, options?: { before?: string; limit?: number }) => Promise<Message[]>;
  saveMessage: (message: Message) => Promise<void>;
  loadOlder: (conversationId: string, oldestMessageId: string, limit?: number) => Promise<Message[]>;
}

export function useCacheFirstMessagesLoader(currentUserId: string | undefined): CacheFirstMessagesLoader {
  const { loadMessages, saveMessage, dbReady } = useMessagingDB();

  const loadMessagesWrapper = useCallback(async (
    conversationId: string,
    options: { before?: string; limit?: number } = {}
  ): Promise<Message[]> => {
    if (!currentUserId || !dbReady) return [];
    return loadMessages(conversationId, options);
  }, [currentUserId, dbReady, loadMessages]);

  const saveMessageWrapper = useCallback(async (message: Message): Promise<void> => {
    if (!currentUserId || !dbReady) return;
    await saveMessage(message);
  }, [currentUserId, dbReady, saveMessage]);

  const loadOlder = useCallback(async (
    conversationId: string,
    oldestMessageId: string,
    limit = 50
  ): Promise<Message[]> => {
    if (!currentUserId || !dbReady) return [];
    return loadMessages(conversationId, { before: oldestMessageId, limit });
  }, [currentUserId, dbReady, loadMessages]);

  return {
    loadMessages: loadMessagesWrapper,
    saveMessage: saveMessageWrapper,
    loadOlder,
  };
}

export interface CacheFirstConversationsLoader {
  loadConversations: () => Promise<Conversation[]>;
  saveConversation: (conversation: Conversation) => Promise<void>;
}

export function useCacheFirstConversationsLoader(currentUserId: string | undefined): CacheFirstConversationsLoader {
  const { loadConversations, saveConversation, dbReady } = useMessagingDB();

  const loadConversationsWrapper = useCallback(async (): Promise<Conversation[]> => {
    if (!currentUserId || !dbReady) return [];
    return loadConversations();
  }, [currentUserId, dbReady, loadConversations]);

  const saveConversationWrapper = useCallback(async (conversation: Conversation): Promise<void> => {
    if (!currentUserId || !dbReady) return;
    await saveConversation(conversation);
  }, [currentUserId, dbReady, saveConversation]);

  return {
    loadConversations: loadConversationsWrapper,
    saveConversation: saveConversationWrapper,
  };
}