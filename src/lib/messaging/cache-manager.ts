import {
  getDB,
  isIndexedDBAvailable,
  type StoredMediaMetadata,
} from './database.ts';
import {
  getMediaMetadata,
  upsertMediaMetadata,
  updateMediaAccessTime,
  pinMedia,
  deleteMediaMetadata,
  getEligibleForEviction,
  getTotalCacheSize,
  evictExpiredMedia,
} from './media-cache.ts';
import {
  MediaType,
  MediaCachePolicy,
  MEDIA_CACHE_POLICIES,
  getMediaType,
  getCachePolicy,
  shouldCacheFullResolution,
  EvictionCandidate,
  sortEvictionCandidates,
} from './media-cache-policy.ts';

const DEFAULT_MAX_CACHE_SIZE = 100 * 1024 * 1024;
const DEFAULT_MAX_MEDIA_AGE = 30 * 24 * 60 * 60 * 1000;

export interface CacheManagerConfig {
  maxCacheSize?: number;
  maxMediaAge?: number;
}

export class CacheManager {
  private config: Required<CacheManagerConfig>;
  private accountId: string | null = null;

  constructor(config: CacheManagerConfig = {}) {
    this.config = {
      maxCacheSize: config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
      maxMediaAge: config.maxMediaAge ?? DEFAULT_MAX_MEDIA_AGE,
    };
  }

  setAccountId(accountId: string | null): void {
    this.accountId = accountId;
  }

  async initialize(): Promise<void> {
    const available = await isIndexedDBAvailable();
    if (!available) {
      console.warn('IndexedDB not available, media caching disabled');
    }
  }

  async cacheMedia(
    assetId: string,
    conversationId: string,
    blob: Blob,
    contentType: string
  ): Promise<void> {
    if (!this.accountId) throw new Error('Account ID not set');

    const existing = await getMediaMetadata(this.accountId, assetId);
    if (existing) {
      await updateMediaAccessTime(this.accountId, assetId);
      return;
    }

    const mediaType = getMediaType(contentType);
    const policy = getCachePolicy(contentType);
    const shouldCacheFull = shouldCacheFullResolution(contentType);

    if (!shouldCacheFull) {
      return;
    }

    const metadata: StoredMediaMetadata = {
      assetId,
      conversationId,
      localBlob: blob,
      fileSize: blob.size,
      contentType,
      lastAccessed: Date.now(),
      expiresAt: Date.now() + policy.maxAge,
      isPinned: false,
      accountId: this.accountId,
    };

    await this.ensureSpaceFor(blob.size, mediaType);
    await upsertMediaMetadata(metadata);
  }

  async getCachedMedia(assetId: string): Promise<Blob | null> {
    if (!this.accountId) return null;

    const metadata = await getMediaMetadata(this.accountId, assetId);
    if (!metadata || !metadata.localBlob) return null;

    const policy = getCachePolicy(metadata.contentType);
    const isExpired = metadata.expiresAt <= Date.now();

    if (isExpired && !metadata.isPinned) {
      await deleteMediaMetadata(this.accountId, assetId);
      return null;
    }

    await updateMediaAccessTime(this.accountId, assetId);
    return metadata.localBlob;
  }

  async pinMedia(assetId: string): Promise<void> {
    if (!this.accountId) return;
    await pinMedia(this.accountId, assetId, true);
  }

  async unpinMedia(assetId: string): Promise<void> {
    if (!this.accountId) return;
    await pinMedia(this.accountId, assetId, false);
  }

  async evictMedia(assetId: string): Promise<void> {
    if (!this.accountId) return;
    await deleteMediaMetadata(this.accountId, assetId);
  }

  async evictConversationMedia(conversationId: string): Promise<void> {
    if (!this.accountId) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['media_metadata'], 'readwrite');
      const store = transaction.objectStore('media_metadata');
      const index = store.index('conversationId');
      const request = index.getAll(conversationId);

      request.onsuccess = () => {
        for (const media of request.result) {
          if (media.accountId === this.accountId && !media.isPinned) {
            store.delete(media.assetId);
          }
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async cleanup(): Promise<void> {
    if (!this.accountId) return;
    await evictExpiredMedia(this.accountId);
    await this.enforceSizeLimit();
  }

  async getCacheStats(): Promise<{
    totalSize: number;
    itemCount: number;
    maxSize: number;
    byType: Record<MediaType, { size: number; count: number }>;
  }> {
    if (!this.accountId) {
      return {
        totalSize: 0,
        itemCount: 0,
        maxSize: this.config.maxCacheSize,
        byType: {
          [MediaType.IMAGE]: { size: 0, count: 0 },
          [MediaType.VIDEO]: { size: 0, count: 0 },
          [MediaType.AUDIO]: { size: 0, count: 0 },
          [MediaType.DOCUMENT]: { size: 0, count: 0 },
          [MediaType.OTHER]: { size: 0, count: 0 },
        },
      };
    }
    const totalSize = await getTotalCacheSize(this.accountId);
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['media_metadata'], 'readonly');
      const store = transaction.objectStore('media_metadata');
      const index = store.index('accountId');
      const request = index.getAll(this.accountId!);

      request.onsuccess = () => {
        const byType: Record<MediaType, { size: number; count: number }> = {
          [MediaType.IMAGE]: { size: 0, count: 0 },
          [MediaType.VIDEO]: { size: 0, count: 0 },
          [MediaType.AUDIO]: { size: 0, count: 0 },
          [MediaType.DOCUMENT]: { size: 0, count: 0 },
          [MediaType.OTHER]: { size: 0, count: 0 },
        };

        for (const media of request.result) {
          const type = getMediaType(media.contentType);
          byType[type].size += media.fileSize;
          byType[type].count += 1;
        }

        resolve({
          totalSize,
          itemCount: request.result.length,
          maxSize: this.config.maxCacheSize,
          byType,
        });
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async ensureSpaceFor(requiredSize: number, mediaType: MediaType): Promise<void> {
    if (!this.accountId) return;
    const totalSize = await getTotalCacheSize(this.accountId);
    const policy = MEDIA_CACHE_POLICIES[mediaType];
    const typeMaxSize = policy.maxSize;

    if (totalSize + requiredSize <= this.config.maxCacheSize) return;

    await this.enforceSizeLimit(requiredSize);
  }

  private async enforceSizeLimit(requiredSize: number = 0): Promise<void> {
    if (!this.accountId) return;
    const eligible = await getEligibleForEviction(this.accountId, this.config.maxCacheSize);
    let currentSize = await getTotalCacheSize(this.accountId);
    const targetSize = this.config.maxCacheSize - requiredSize;

    const candidates: EvictionCandidate[] = eligible.map((media) => ({
      assetId: media.assetId,
      conversationId: media.conversationId,
      lastAccessed: media.lastAccessed,
      fileSize: media.fileSize,
      contentType: media.contentType,
      isPinned: media.isPinned,
      priority: getCachePolicy(media.contentType).priority,
    }));

    const sorted = sortEvictionCandidates(candidates);

    for (const candidate of sorted) {
      if (currentSize <= targetSize) break;
      await deleteMediaMetadata(this.accountId, candidate.assetId);
      currentSize -= candidate.fileSize;
    }
  }

  async requestPersistentStorage(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      return false;
    }
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  async estimateStorage(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return null;
    }
    try {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
      };
    } catch {
      return null;
    }
  }
}

export const cacheManager = new CacheManager();