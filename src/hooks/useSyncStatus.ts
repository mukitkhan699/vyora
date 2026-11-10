import { useEffect, useState, useCallback, useRef } from 'react';
import { useRealtime } from '../context/RealtimeContext';
import { useMessagingDB } from '../hooks/useMessagingDB';
import { useAuth } from '../context/AuthContext';

export type SyncState = 'offline' | 'reconnecting' | 'syncing' | 'connected' | 'sync-error';

export interface SyncStatus {
  state: SyncState;
  error: string | null;
  lastSyncedAt: number | null;
}

export function useSyncStatus(): SyncStatus {
  const { connected, reconnectNonce, socket } = useRealtime();
  const { currentUser } = useAuth();
  const { sync, syncConversation, dbReady } = useMessagingDB();
  const [state, setState] = useState<SyncState>('connected');
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  
  const isSyncingRef = useRef(false);
  const lastReconnectNonceRef = useRef(reconnectNonce);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Track connection state changes
  useEffect(() => {
    if (!currentUser?.id || !dbReady) return;

    if (!connected) {
      setState('offline');
      setError(null);
      return;
    }

    // If we were offline and now connected, start reconnecting/syncing
    if (connected && lastReconnectNonceRef.current !== reconnectNonce) {
      lastReconnectNonceRef.current = reconnectNonce;
      setState('reconnecting');
      setError(null);
    }
  }, [connected, reconnectNonce, currentUser?.id, dbReady]);

  // Perform sync when reconnecting
  useEffect(() => {
    if (!currentUser?.id || !dbReady || !connected) return;
    if (state !== 'reconnecting' && state !== 'syncing') return;
    if (isSyncingRef.current) return;

    const performSync = async () => {
      if (!mountedRef.current) return;
      isSyncingRef.current = true;
      setState('syncing');
      setError(null);

      try {
        const result = await sync();
        if (!mountedRef.current) return;
        
        if (result.errors.length > 0) {
          setState('sync-error');
          setError(result.errors.join('; '));
        } else {
          setState('connected');
          setLastSyncedAt(Date.now());
          setError(null);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setState('sync-error');
        setError(err instanceof Error ? err.message : 'Sync failed');
      } finally {
        if (mountedRef.current) {
          isSyncingRef.current = false;
        }
      }
    };

    performSync();
  }, [state, currentUser?.id, dbReady, connected, sync]);

  // Reset sync error when going offline
  useEffect(() => {
    if (!connected) {
      setError(null);
    }
  }, [connected]);

  return { state, error, lastSyncedAt };
}