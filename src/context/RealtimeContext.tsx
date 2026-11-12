import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getBackendApiUrl } from '../config/backendUrl.ts';
import { useAuth } from './AuthContext.tsx';

interface PresenceUpdate {
  userId: string;
  isOnline: boolean;
  lastSeen?: number;
}

interface RealtimeContextType {
  socket: Socket | null;
  connected: boolean;
  onlineUserIds: Set<string>;
  lastSeenByUser: Map<string, number>;
  reconnectNonce: number;
}

interface AuthSessionResponse {
  authenticated: boolean;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [lastSeenByUser, setLastSeenByUser] = useState<Map<string, number>>(new Map());
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!currentUser?.id) {
      const currentSocket = socketRef.current;
      if (currentSocket) {
        currentSocket.disconnect();
        if (socketRef.current === currentSocket) {
          socketRef.current = null;
        }
      }
      setSocket((current) => (current === currentSocket ? null : current));
      setConnected(false);
      setOnlineUserIds(new Set());
      setLastSeenByUser(new Map());
      return;
    }

    const instance = io(getBackendApiUrl(), {
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 6000,
    });
    socketRef.current = instance;

    setSocket(instance);

    const handleConnect = () => {
      setConnected(true);
      setReconnectNonce((value) => value + 1);
      instance.emit('presence:query', {}, (res: { onlineUserIds?: string[] }) => {
        if (Array.isArray(res?.onlineUserIds)) {
          setOnlineUserIds(new Set(res.onlineUserIds));
        }
      });
    };

    const getSession = async (): Promise<AuthSessionResponse | null> => {
      try {
        const backendUrl = getBackendApiUrl();
        const backendOrigin = new URL(backendUrl, window.location.origin).origin;
        const credentials: RequestCredentials =
          backendOrigin === window.location.origin ? 'same-origin' : 'include';
        const response = await fetch(`${backendUrl}/api/auth/session`, {
          method: 'GET',
          credentials,
        });
        if (!response.ok) {
          return null;
        }
        const session: unknown = await response.json();
        if (
          typeof session !== 'object' ||
          session === null ||
          !('authenticated' in session) ||
          typeof session.authenticated !== 'boolean'
        ) {
          return null;
        }
        return { authenticated: session.authenticated };
      } catch {
        return null;
      }
    };

    let disconnectValidationInProgress = false;
    let serverDisconnectReconnectAttempts = 0;
    const maxServerDisconnectReconnectAttempts = 3;
    let isActive = true;

    const handleDisconnect = (reason: string) => {
      setConnected(false);

      if (reason === 'io server disconnect' || reason === 'server disconnect') {
        if (
          disconnectValidationInProgress ||
          serverDisconnectReconnectAttempts >= maxServerDisconnectReconnectAttempts ||
          !isActive ||
          socketRef.current !== instance
        ) {
          return;
        }
        disconnectValidationInProgress = true;

        void (async () => {
          try {
            const session = await getSession();
            if (
              session?.authenticated === true &&
              isActive &&
              socketRef.current === instance &&
              !instance.connected
            ) {
              serverDisconnectReconnectAttempts += 1;
              instance.connect();
            }
          } catch (error) {
            console.error('Unable to recover the realtime connection.', error);
          } finally {
            disconnectValidationInProgress = false;
          }
        })();
      }
    };

    const handleConnectError = () => {
      setConnected(false);
    };

    const handlePresence = (data: PresenceUpdate) => {
      if (!data?.userId) return;
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (data.isOnline) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
      if (!data.isOnline && typeof data.lastSeen === 'number') {
        setLastSeenByUser((prev) => {
          const next = new Map(prev);
          next.set(data.userId, data.lastSeen as number);
          return next;
        });
      }
    };

    instance.on('connect', handleConnect);
    instance.on('disconnect', handleDisconnect);
    instance.on('connect_error', handleConnectError);
    instance.on('presence:update', handlePresence);

    return () => {
      isActive = false;

      instance.off('connect', handleConnect);
      instance.off('disconnect', handleDisconnect);
      instance.off('connect_error', handleConnectError);
      instance.off('presence:update', handlePresence);

      instance.disconnect();

      setSocket((current) => (current === instance ? null : current));
      setConnected(false);
      if (socketRef.current === instance) {
        socketRef.current = null;
      }
    };
  }, [currentUser?.id]);

  const value = useMemo(
    () => ({ socket, connected, onlineUserIds, lastSeenByUser, reconnectNonce }),
    [socket, connected, onlineUserIds, lastSeenByUser, reconnectNonce],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
};

export const useRealtime = (): RealtimeContextType => {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used within RealtimeProvider');
  return context;
};
