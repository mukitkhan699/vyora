import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [lastSeenByUser, setLastSeenByUser] = useState<Map<string, number>>(new Map());
  const [reconnectNonce, setReconnectNonce] = useState(0);

  useEffect(() => {
    if (!currentUser?.id) {
      setSocket(null);
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

    const handleDisconnect = () => {
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
    instance.on('connect_error', handleDisconnect);
    instance.on('presence:update', handlePresence);

    return () => {
      instance.off('connect', handleConnect);
      instance.off('disconnect', handleDisconnect);
      instance.off('connect_error', handleDisconnect);
      instance.off('presence:update', handlePresence);
      instance.disconnect();
      setSocket((current) => (current === instance ? null : current));
      setConnected(false);
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
