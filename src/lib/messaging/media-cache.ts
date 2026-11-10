import {
  getDB,
  createTransaction,
  type StoredMediaMetadata,
} from './database.ts';

export async function getMediaMetadata(
  accountId: string,
  assetId: string
): Promise<StoredMediaMetadata | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readonly');
    const store = transaction.objectStore('media_metadata');
    const request = store.get(assetId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        resolve(result);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getMediaMetadataByConversation(
  accountId: string,
  conversationId: string
): Promise<StoredMediaMetadata[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readonly');
    const store = transaction.objectStore('media_metadata');
    const index = store.index('conversationId');
    const request = index.getAll(conversationId);

    request.onsuccess = () => {
      const results = request.result.filter((m) => m.accountId === accountId);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function upsertMediaMetadata(metadata: StoredMediaMetadata): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readwrite');
    const store = transaction.objectStore('media_metadata');
    const request = store.put(metadata);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updateMediaAccessTime(
  accountId: string,
  assetId: string
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readwrite');
    const store = transaction.objectStore('media_metadata');
    const request = store.get(assetId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        result.lastAccessed = Date.now();
        const putRequest = store.put(result);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function pinMedia(
  accountId: string,
  assetId: string,
  pinned: boolean = true
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readwrite');
    const store = transaction.objectStore('media_metadata');
    const request = store.get(assetId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        result.isPinned = pinned;
        const putRequest = store.put(result);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteMediaMetadata(
  accountId: string,
  assetId: string
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readwrite');
    const store = transaction.objectStore('media_metadata');
    const request = store.get(assetId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        const deleteRequest = store.delete(assetId);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getEligibleForEviction(
  accountId: string,
  maxSize: number
): Promise<StoredMediaMetadata[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readonly');
    const store = transaction.objectStore('media_metadata');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const allMedia = request.result.filter(
        (m) => !m.isPinned && m.expiresAt > Date.now()
      );
      allMedia.sort((a, b) => a.lastAccessed - b.lastAccessed);
      resolve(allMedia);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getTotalCacheSize(accountId: string): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readonly');
    const store = transaction.objectStore('media_metadata');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const total = request.result.reduce((sum, m) => sum + m.fileSize, 0);
      resolve(total);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function evictExpiredMedia(accountId: string): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['media_metadata'], 'readwrite');
    const store = transaction.objectStore('media_metadata');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const now = Date.now();
      const expired = request.result.filter(
        (m) => m.expiresAt <= now && !m.isPinned
      );
      for (const media of expired) {
        store.delete(media.assetId);
      }
      resolve(expired.length);
    };
    request.onerror = () => reject(request.error);
  });
}