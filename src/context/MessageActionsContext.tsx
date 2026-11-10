import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface MessageActionsContextValue {
  activeMessageId: string | null;
  setActiveMessageId: (messageId: string | null) => void;
  registerMessage: (messageId: string) => void;
  unregisterMessage: (messageId: string) => void;
}

const MessageActionsContext = createContext<MessageActionsContextValue | null>(null);

interface MessageActionsProviderProps {
  children: ReactNode;
}

export function MessageActionsProvider({ children }: MessageActionsProviderProps) {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [registeredMessages, setRegisteredMessages] = useState<Set<string>>(new Set());

  const registerMessage = useCallback((messageId: string) => {
    setRegisteredMessages((prev) => new Set(prev).add(messageId));
  }, []);

  const unregisterMessage = useCallback((messageId: string) => {
    setRegisteredMessages((prev) => {
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
    if (activeMessageId === messageId) {
      setActiveMessageId(null);
    }
  }, [activeMessageId]);

  const handleSetActiveMessageId = useCallback((messageId: string | null) => {
    setActiveMessageId(messageId);
  }, []);

  return (
    <MessageActionsContext.Provider
      value={{
        activeMessageId,
        setActiveMessageId: handleSetActiveMessageId,
        registerMessage,
        unregisterMessage,
      }}
    >
      {children}
    </MessageActionsContext.Provider>
  );
}

export function useMessageActions() {
  const context = useContext(MessageActionsContext);
  if (!context) {
    throw new Error('useMessageActions must be used within a MessageActionsProvider');
  }
  return context;
}