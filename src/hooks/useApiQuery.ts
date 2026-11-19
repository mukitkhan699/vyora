import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from '../services/api.ts';
import type { QuerySnapshot } from '../services/queryCache.ts';

export interface UseApiQueryResult<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => void;
}

export function useApiQuery<T>(
  endpoint: string,
  loader: () => Promise<T>,
  enabled = true,
): UseApiQueryResult<T> {
  const key = api.getCacheKey(endpoint);
  const subscribe = useCallback(
    (listener: () => void) => api.subscribeToCache(endpoint, listener),
    [endpoint, key],
  );
  const getSnapshot = useCallback(
    () => api.getCacheSnapshot<T>(endpoint),
    [endpoint, key],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT as QuerySnapshot<T>);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) return;
    void loaderRef.current().catch(() => undefined);
  }, [enabled, key, snapshot.invalidationVersion]);

  useEffect(() => {
    if (snapshot.error !== undefined) {
      console.warn(`Failed to load API resource ${endpoint}:`, snapshot.error);
    }
  }, [endpoint, snapshot.error]);

  const refresh = useCallback(() => {
    api.invalidateCache(endpoint);
  }, [endpoint, key]);

  return {
    data: snapshot.data,
    error: snapshot.error,
    isLoading: enabled && snapshot.data === undefined && snapshot.error === undefined,
    isRefreshing: snapshot.isFetching && snapshot.data !== undefined,
    refresh,
  };
}

const EMPTY_SNAPSHOT: QuerySnapshot = Object.freeze({
  invalidationVersion: 0,
  isFetching: false,
});
