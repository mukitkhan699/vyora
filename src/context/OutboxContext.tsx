import React, { createContext, useContext } from 'react';
import { useOutbox } from '../hooks/useOutbox.ts';
import type { Message } from '../types/index.ts';

export const OUTBOX_MESSAGE_SENT_EVENT = 'zunari:outbox-message-sent';
export const OUTBOX_MESSAGE_FAILED_EVENT = 'zunari:outbox-message-failed';

type OutboxApi = ReturnType<typeof useOutbox>;

const OutboxContext = createContext<OutboxApi | null>(null);

export function OutboxProvider({ children }: { children: React.ReactNode }) {
  const outbox = useOutbox({
    onMessageSent: (message: Message, clientId: string) => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(
        new CustomEvent(OUTBOX_MESSAGE_SENT_EVENT, { detail: { message, clientId } }),
      );
    },
    onMessageFailed: (clientId: string, error: string) => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(
        new CustomEvent(OUTBOX_MESSAGE_FAILED_EVENT, { detail: { clientId, error } }),
      );
    },
  });

  return <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>;
}

export function useOutboxContext(): OutboxApi {
  const context = useContext(OutboxContext);
  if (!context) {
    throw new Error('useOutboxContext must be used within an OutboxProvider.');
  }
  return context;
}
