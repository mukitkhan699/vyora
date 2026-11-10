import {
  getDB,
  createTransaction,
  type StoredSyncState,
} from './database.ts';

export async function getSyncState(
  accountId: string,
  conversationId: string
): Promise<StoredSyncState | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sync_state'], 'readonly');
    const store = transaction.objectStore('sync_state');
    const request = store.get(conversationId);

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

export async function getAllSyncStates(accountId: string): Promise<StoredSyncState[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sync_state'], 'readonly');
    const store = transaction.objectStore('sync_state');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function upsertSyncState(syncState: StoredSyncState): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sync_state'], 'readwrite');
    const store = transaction.objectStore('sync_state');
    const request = store.put(syncState);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updateSyncCursor(
  accountId: string,
  conversationId: string,
  lastSyncedCursor: string | null
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sync_state'], 'readwrite');
    const store = transaction.objectStore('sync_state');
    const request = store.get(conversationId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        result.lastSyncedCursor = lastSyncedCursor;
        const putRequest = store.put(result);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        const newState: StoredSyncState = {
          conversationId,
          lastSyncedCursor,
          lastSuccessfulSync: 0,
          accountId,
        };
        const putRequest = store.put(newState);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function updateLastSuccessfulSync(
  accountId: string,
  conversationId: string
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sync_state'], 'readwrite');
    const store = transaction.objectStore('sync_state');
    const request = store.get(conversationId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        result.lastSuccessfulSync = Date.now();
        const putRequest = store.put(result);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        const newState: StoredSyncState = {
          conversationId,
          lastSyncedCursor: null,
          lastSuccessfulSync: Date.now(),
          accountId,
        };
        const putRequest = store.put(newState);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSyncState(accountId: string, conversationId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sync_state'], 'readwrite');
    const store = transaction.objectStore('sync_state');
    const request = store.get(conversationId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        const deleteRequest = store.delete(conversationId);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}