import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useMessagingDB } from './useMessagingDB';

interface CachedMediaResult {
  getCachedBlob: (assetId: string) => Promise<Blob | null>;
  cacheMedia: (assetId: string, conversationId: string, blob: Blob, contentType: string) => Promise<void>;
  pinMedia: (assetId: string) => Promise<void>;
  unpinMedia: (assetId: string) => Promise<void>;
  evictMedia: (assetId: string) => Promise<void>;
  getCacheStats: () => Promise<{ totalSize: number; itemCount: number; maxSize: number }>;
  requestPersistentStorage: () => Promise<boolean>;
  estimateStorage: () => Promise<{ usage: number; quota: number } | null>;
}

export function useMediaCache(): CachedMediaResult {
  const { currentUser } = useAuth();
  const { cacheManager, dbReady } = useMessagingDB();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!currentUser?.id || !dbReady) {
      setReady(false);
      return;
    }
    cacheManager.setAccountId(currentUser.id);
    setReady(true);
    return () => {
      cacheManager.setAccountId(null);
    };
  }, [currentUser?.id, dbReady, cacheManager]);

  const getCachedBlob = useCallback(async (assetId: string): Promise<Blob | null> => {
    if (!ready) return null;
    try {
      return await cacheManager.getCachedMedia(assetId);
    } catch {
      return null;
    }
  }, [ready, cacheManager]);

  const cacheMedia = useCallback(
    async (assetId: string, conversationId: string, blob: Blob, contentType: string): Promise<void> => {
      if (!ready) return;
      try {
        await cacheManager.cacheMedia(assetId, conversationId, blob, contentType);
      } catch (error) {
        console.warn('Failed to cache media:', error);
      }
    },
    [ready, cacheManager]
  );

  const pinMedia = useCallback(async (assetId: string): Promise<void> => {
    if (!ready) return;
    await cacheManager.pinMedia(assetId);
  }, [ready, cacheManager]);

  const unpinMedia = useCallback(async (assetId: string): Promise<void> => {
    if (!ready) return;
    await cacheManager.unpinMedia(assetId);
  }, [ready, cacheManager]);

  const evictMedia = useCallback(async (assetId: string): Promise<void> => {
    if (!ready) return;
    await cacheManager.evictMedia(assetId);
  }, [ready, cacheManager]);

  const getCacheStats = useCallback(async () => {
    if (!ready) return { totalSize: 0, itemCount: 0, maxSize: 0 };
    return cacheManager.getCacheStats();
  }, [ready, cacheManager]);

  const requestPersistentStorage = useCallback(async () => {
    if (!ready) return false;
    return cacheManager.requestPersistentStorage();
  }, [ready, cacheManager]);

  const estimateStorage = useCallback(async () => {
    if (!ready) return null;
    return cacheManager.estimateStorage();
  }, [ready, cacheManager]);

  return {
    getCachedBlob,
    cacheMedia,
    pinMedia,
    unpinMedia,
    evictMedia,
    getCacheStats,
    requestPersistentStorage,
    estimateStorage,
  };
}

export interface UseCachedImageResult {
  src: string | null;
  isLoading: boolean;
  hasFailed: boolean;
}

export function useCachedImage(
  assetId: string,
  conversationId: string,
  originalUrl: string,
  contentType: string
): UseCachedImageResult {
  const { getCachedBlob, cacheMedia } = useMediaCache();
  const [src, setSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasFailed, setHasFailed] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setHasFailed(false);

    const loadImage = async () => {
      try {
        const cachedBlob = await getCachedBlob(assetId);
        if (cancelled) return;

        if (cachedBlob) {
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
          }
          const objectUrl = URL.createObjectURL(cachedBlob);
          objectUrlRef.current = objectUrl;
          setSrc(objectUrl);
          setIsLoading(false);
          return;
        }

        const response = await fetch(originalUrl, {
          credentials: 'include',
          headers: { Accept: contentType },
        });

        if (!response.ok) throw new Error('Failed to fetch');

        const blob = await response.blob();
        if (cancelled) {
          URL.revokeObjectURL(URL.createObjectURL(blob));
          return;
        }

        await cacheMedia(assetId, conversationId, blob, contentType);

        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setSrc(objectUrl);
        setIsLoading(false);
      } catch (error) {
        if (!cancelled) {
          setHasFailed(true);
          setIsLoading(false);
        }
      }
    };

    if (assetId && originalUrl) {
      loadImage();
    } else {
      setIsLoading(false);
      setHasFailed(true);
    }

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [assetId, conversationId, originalUrl, contentType, getCachedBlob, cacheMedia]);

  return { src, isLoading, hasFailed };
}