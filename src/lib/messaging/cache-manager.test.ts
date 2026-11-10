import assert from 'node:assert/strict';
import { describe, test, before, after, beforeEach } from 'node:test';
import {
  getDB,
  clearAllData,
  isIndexedDBAvailable,
} from './database.ts';
import {
  CacheManager,
  cacheManager,
} from './cache-manager.ts';
import {
  MediaType,
  getMediaType,
  getCachePolicy,
  shouldCacheFullResolution,
  getMaxCacheAge,
  sortEvictionCandidates,
} from './media-cache-policy.ts';

const TEST_ACCOUNT_ID = 'test-cache-account';

async function setupDB(): Promise<void> {
  await clearAllData();
}

describe('Cache Manager & Media Policies', () => {
  before(async () => {
    const available = await isIndexedDBAvailable();
    if (!available) {
      console.warn('IndexedDB not available, skipping tests');
      return;
    }
    await setupDB();
    cacheManager.setAccountId(TEST_ACCOUNT_ID);
    await cacheManager.initialize();
  });

  after(async () => {
    cacheManager.setAccountId(null);
    await clearAllData();
  });

  describe('Media Type Detection', () => {
    test('identifies image types', () => {
      assert.equal(getMediaType('image/jpeg'), MediaType.IMAGE);
      assert.equal(getMediaType('image/png'), MediaType.IMAGE);
      assert.equal(getMediaType('image/webp'), MediaType.IMAGE);
      assert.equal(getMediaType('image/gif'), MediaType.IMAGE);
    });

    test('identifies video types', () => {
      assert.equal(getMediaType('video/mp4'), MediaType.VIDEO);
      assert.equal(getMediaType('video/webm'), MediaType.VIDEO);
    });

    test('identifies audio types', () => {
      assert.equal(getMediaType('audio/mpeg'), MediaType.AUDIO);
      assert.equal(getMediaType('audio/ogg'), MediaType.AUDIO);
    });

    test('identifies document types', () => {
      assert.equal(getMediaType('application/pdf'), MediaType.DOCUMENT);
      assert.equal(getMediaType('text/plain'), MediaType.DOCUMENT);
      assert.equal(getMediaType('application/msword'), MediaType.DOCUMENT);
    });

    test('defaults to OTHER for unknown types', () => {
      assert.equal(getMediaType('application/octet-stream'), MediaType.OTHER);
      assert.equal(getMediaType('model/gltf-binary'), MediaType.OTHER);
    });
  });

  describe('Cache Policies', () => {
    test('images have high priority and cache full resolution', () => {
      const policy = getCachePolicy('image/jpeg');
      assert.equal(policy.priority, 'high');
      assert.equal(policy.cacheFullResolution, true);
      assert.equal(policy.cacheThumbnails, true);
    });

    test('videos cache thumbnails only', () => {
      const policy = getCachePolicy('video/mp4');
      assert.equal(policy.priority, 'medium');
      assert.equal(policy.cacheFullResolution, false);
      assert.equal(policy.cacheThumbnails, true);
    });

    test('documents cache full resolution', () => {
      const policy = getCachePolicy('application/pdf');
      assert.equal(policy.priority, 'low');
      assert.equal(policy.cacheFullResolution, true);
    });
  });

  describe('Eviction Sorting', () => {
    test('sorts by priority then last accessed', () => {
      const candidates = [
        {
          assetId: 'low_priority_recent',
          conversationId: 'conv_1',
          lastAccessed: Date.now() - 1000,
          fileSize: 1000,
          contentType: 'application/pdf',
          isPinned: false,
          priority: 'low' as const,
        },
        {
          assetId: 'high_priority_old',
          conversationId: 'conv_1',
          lastAccessed: Date.now() - 10000,
          fileSize: 1000,
          contentType: 'image/jpeg',
          isPinned: false,
          priority: 'high' as const,
        },
        {
          assetId: 'pinned_low',
          conversationId: 'conv_1',
          lastAccessed: Date.now() - 20000,
          fileSize: 1000,
          contentType: 'application/pdf',
          isPinned: true,
          priority: 'low' as const,
        },
      ];

      const sorted = sortEvictionCandidates(candidates);
      
      // Pinned items should be last (not evicted first)
      assert.equal(sorted[0].assetId, 'low_priority_recent');
      assert.equal(sorted[1].assetId, 'high_priority_old');
      assert.equal(sorted[2].assetId, 'pinned_low');
    });
  });
});