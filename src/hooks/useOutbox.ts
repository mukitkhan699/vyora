import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNetworkStatus } from './useNetworkStatus';
import { useMessagingDB } from './useMessagingDB';
import { recordSendInitiated, recordTiming } from '../lib/messaging/performance';
import type { Message } from '../types/index';
import { toMillis } from '../utils/messaging';

export interface OutboxMessage {
  clientId: string;
  conversationId: string;
  text: string;
  replyToMessageId?: string;
  attachmentAssetIds?: string[];
  createdAt: number;
  retryCount: number;
  nextRetryAt: number;
  status: 'pending' | 'sending' | 'failed' | 'sent';
  lastError?: string;
}

export interface OutboxCallbacks {
  onMessageSent?: (message: Message, clientId: string) => void;
  onMessageFailed?: (clientId: string, error: string) => void;
}

const BASE_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const MAX_RETRIES = 10;
// Keep failed messages for manual retry instead of discarding them. This is a
// far-future retry time, not a deletion.
const PARKED_RETRY_AT = Number.MAX_SAFE_INTEGER;

export function useOutbox(callbacks: OutboxCallbacks = {}) {
  const { currentUser } = useAuth();
  const { online } = useNetworkStatus();
  const {
    getOutbox,
    queueMessage,
    retryOutboxMessage,
    removeFromOutboxQueue,
    saveMessage,
    removeMessage,
    updateMessageLocalStatus,
    loadConversation,
    saveConversation,
  } = useMessagingDB();
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const outboxRef = useRef<OutboxMessage[]>([]);
  const processingRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  const retryTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const publishOutbox = useCallback((next: OutboxMessage[]) => {
    outboxRef.current = next;
    setOutbox(next);
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    let cancelled = false;
    const loadOutbox = async () => {
      const messages = await getOutbox();
      if (cancelled) return;
      // An interrupted process may have left rows in 'sending'. Recover them.
      const recovered = messages.map((message) =>
        message.status === 'sending'
          ? { ...message, status: 'pending' as const, nextRetryAt: 0 }
          : (message as OutboxMessage),
      );
      for (const message of messages) {
        if (message.status === 'sending') {
          void retryOutboxMessage(message.clientId);
        }
      }
      publishOutbox(recovered);
    };
    void loadOutbox();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, getOutbox, retryOutboxMessage, publishOutbox]);

  const calculateNextRetry = useCallback((retryCount: number): number => {
    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, retryCount), MAX_RETRY_DELAY);
    const jitter = delay * 0.1 * Math.random();
    return Date.now() + delay + jitter;
  }, []);

  const updateOutboxMessage = useCallback(
    (clientId: string, updates: Partial<OutboxMessage>) => {
      publishOutbox(
        outboxRef.current.map((message) =>
          message.clientId === clientId ? { ...message, ...updates } : message,
        ),
      );
    },
    [publishOutbox],
  );

  const addToOutbox = useCallback(
    (message: Omit<OutboxMessage, 'createdAt' | 'retryCount' | 'nextRetryAt' | 'status'>) => {
      const newMessage: OutboxMessage = {
        ...message,
        createdAt: Date.now(),
        retryCount: 0,
        nextRetryAt: 0,
        status: 'pending',
      };
      void queueMessage(newMessage);
      publishOutbox([...outboxRef.current.filter((item) => item.clientId !== newMessage.clientId), newMessage]);
      return newMessage.clientId;
    },
    [queueMessage, publishOutbox],
  );

  const removeFromOutbox = useCallback(
    (clientId: string) => {
      publishOutbox(outboxRef.current.filter((message) => message.clientId !== clientId));
      void removeFromOutboxQueue(clientId);
      const timer = retryTimersRef.current.get(clientId);
      if (timer) {
        window.clearTimeout(timer);
        retryTimersRef.current.delete(clientId);
      }
    },
    [removeFromOutboxQueue, publishOutbox],
  );

  const persistSentMessage = useCallback(
    async (message: Message, clientId: string) => {
      await saveMessage(message);
      // Remove the optimistic placeholder now that the server row exists.
      await removeMessage(`local-${clientId}`);
      const conversation = await loadConversation(message.conversationId || '');
      if (conversation) {
        await saveConversation({
          ...conversation,
          lastMessage: message,
          lastMessageAt: toMillis(message.createdAt),
        });
      }
      callbacksRef.current.onMessageSent?.(message, clientId);
    },
    [saveMessage, removeMessage, loadConversation, saveConversation],
  );

  const processOutbox = useCallback(async () => {
    if (processingRef.current || !online || !currentUser?.id) return;

    const now = Date.now();
    const pendingMessages = outboxRef.current.filter(
      (message) =>
        message.status === 'pending' ||
        (message.status === 'failed' && message.nextRetryAt <= now),
    );
    if (pendingMessages.length === 0) return;

    processingRef.current = true;

    try {
      for (const message of pendingMessages) {
        if (!online) break;

        updateOutboxMessage(message.clientId, { status: 'sending', lastError: undefined });

        try {
          recordSendInitiated(message.clientId, message.conversationId);
          const response = await api.sendConversationMessage(message.conversationId, {
            text: message.text,
            clientId: message.clientId,
            replyToMessageId: message.replyToMessageId,
            attachmentAssetIds: message.attachmentAssetIds,
          });
          recordTiming(message.clientId, 'serverReceived');
          recordTiming(message.clientId, 'databaseCommitted');

          await persistSentMessage(response.message, message.clientId);
          removeFromOutbox(message.clientId);
        } catch (error) {
          const failure = error instanceof Error ? error.message : 'Failed to send message';
          const nextRetryCount = message.retryCount + 1;
          const exhausted = nextRetryCount >= MAX_RETRIES;
          const nextRetryAt = exhausted
            ? PARKED_RETRY_AT
            : calculateNextRetry(nextRetryCount);

          updateOutboxMessage(message.clientId, {
            status: 'failed',
            retryCount: nextRetryCount,
            nextRetryAt,
            lastError: failure,
          });

          await updateMessageLocalStatus(`local-${message.clientId}`, 'failed', failure);
          callbacksRef.current.onMessageFailed?.(message.clientId, failure);
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [
    online,
    currentUser?.id,
    updateOutboxMessage,
    removeFromOutbox,
    calculateNextRetry,
    persistSentMessage,
    updateMessageLocalStatus,
  ]);

  useEffect(() => {
    if (!online) return;
    void processOutbox();

    const interval = window.setInterval(() => {
      void processOutbox();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [online, processOutbox]);

  useEffect(() => {
    const handleOnline = () => {
      void processOutbox();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [processOutbox]);

  const retryMessage = useCallback(
    (clientId: string) => {
      updateOutboxMessage(clientId, {
        status: 'pending',
        nextRetryAt: 0,
        retryCount: 0,
        lastError: undefined,
      });
      void updateMessageLocalStatus(`local-${clientId}`, 'pending', '');
      void retryOutboxMessage(clientId);
      void processOutbox();
    },
    [updateOutboxMessage, updateMessageLocalStatus, retryOutboxMessage, processOutbox],
  );

  return {
    outbox,
    addToOutbox,
    retryMessage,
    removeFromOutbox,
    processOutbox,
    isOnline: online,
  };
}
