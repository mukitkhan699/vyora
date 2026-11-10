import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useNetworkStatus } from './useNetworkStatus';
import { useMessagingDB } from './useMessagingDB';
import { recordSendInitiated, recordTiming } from '../lib/messaging/performance';

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

const BASE_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const MAX_RETRIES = 10;

export function useOutbox() {
  const { currentUser } = useAuth();
  const { connected, socket } = useRealtime();
  const { online } = useNetworkStatus();
  const { getOutbox, queueMessage, retryOutboxMessage, removeFromOutboxQueue } = useMessagingDB();
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const processingRef = useRef(false);
  const retryTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!currentUser?.id) return;
    const loadOutbox = async () => {
      const messages = await getOutbox();
      setOutbox(messages);
    };
    loadOutbox();
  }, [currentUser?.id, getOutbox]);

  const calculateNextRetry = useCallback((retryCount: number): number => {
    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, retryCount), MAX_RETRY_DELAY);
    const jitter = delay * 0.1 * Math.random();
    return Date.now() + delay + jitter;
  }, []);

  const addToOutbox = useCallback(
    (message: Omit<OutboxMessage, 'createdAt' | 'retryCount' | 'nextRetryAt' | 'status'>) => {
      const newMessage: OutboxMessage = {
        ...message,
        createdAt: Date.now(),
        retryCount: 0,
        nextRetryAt: 0,
        status: 'pending',
      };
      queueMessage(newMessage);
      setOutbox((prev) => [...prev, newMessage]);
      return newMessage.clientId;
    },
    [queueMessage]
  );

  const updateOutboxMessage = useCallback(
    (clientId: string, updates: Partial<OutboxMessage>) => {
      setOutbox((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, ...updates } : m)));
    },
    []
  );

  const removeFromOutbox = useCallback((clientId: string) => {
    setOutbox((prev) => prev.filter((m) => m.clientId !== clientId));
    removeFromOutboxQueue(clientId);
    const timer = retryTimersRef.current.get(clientId);
    if (timer) {
      window.clearTimeout(timer);
      retryTimersRef.current.delete(clientId);
    }
  }, [removeFromOutboxQueue]);

  const processOutbox = useCallback(async () => {
    if (processingRef.current || !connected || !currentUser?.id) return;
    if (!socket?.connected) return;

    const pendingMessages = outbox.filter(
      (m) => m.status === 'pending' || (m.status === 'failed' && m.nextRetryAt <= Date.now())
    );

    if (pendingMessages.length === 0) return;

    processingRef.current = true;

    for (const msg of pendingMessages) {
      if (!connected) break;

      updateOutboxMessage(msg.clientId, { status: 'sending', lastError: undefined });

      try {
        recordSendInitiated(msg.clientId, msg.conversationId);
        const response = await api.sendConversationMessage(msg.conversationId, {
          text: msg.text,
          clientId: msg.clientId,
          replyToMessageId: msg.replyToMessageId,
          attachmentAssetIds: msg.attachmentAssetIds,
        });
        recordTiming(msg.clientId, 'serverReceived');
        recordTiming(msg.clientId, 'databaseCommitted');

        updateOutboxMessage(msg.clientId, { status: 'sent' });
        removeFromOutbox(msg.clientId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send message';
        const nextRetryCount = msg.retryCount + 1;
        const nextRetryAt = nextRetryCount < MAX_RETRIES ? calculateNextRetry(nextRetryCount) : 0;

        updateOutboxMessage(msg.clientId, {
          status: nextRetryCount < MAX_RETRIES ? 'failed' : 'failed',
          retryCount: nextRetryCount,
          nextRetryAt,
          lastError: message,
        });

        if (nextRetryCount >= MAX_RETRIES) {
          removeFromOutbox(msg.clientId);
        }
      }
    }

    processingRef.current = false;
  }, [connected, currentUser?.id, outbox, socket?.connected, updateOutboxMessage, removeFromOutbox, calculateNextRetry]);

  useEffect(() => {
    if (!connected) return;
    processOutbox();

    const interval = window.setInterval(() => {
      processOutbox();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [connected, processOutbox]);

  useEffect(() => {
    const handleOnline = () => {
      processOutbox();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [processOutbox]);

  const retryMessage = useCallback(
    (clientId: string) => {
      updateOutboxMessage(clientId, { status: 'pending', nextRetryAt: 0, retryCount: 0, lastError: undefined });
      retryOutboxMessage(clientId);
      processOutbox();
    },
    [updateOutboxMessage, retryOutboxMessage, processOutbox]
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