import {
  getDB,
  createTransaction,
  type StoredConversation,
  type StoredParticipant,
} from './database.ts';

export async function getAllConversations(accountId: string): Promise<StoredConversation[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['conversations'], 'readonly');
    const store = transaction.objectStore('conversations');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getConversationById(accountId: string, conversationId: string): Promise<StoredConversation | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['conversations'], 'readonly');
    const store = transaction.objectStore('conversations');
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

export async function upsertConversation(conversation: StoredConversation): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['conversations'], 'readwrite');
    const store = transaction.objectStore('conversations');
    const request = store.put(conversation);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function upsertConversations(conversations: StoredConversation[]): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['conversations'], 'readwrite');
    const store = transaction.objectStore('conversations');
    let completed = 0;
    let hasError = false;

    for (const conversation of conversations) {
      const request = store.put(conversation);
      request.onerror = () => {
        hasError = true;
        reject(request.error);
      };
      request.onsuccess = () => {
        completed++;
        if (completed === conversations.length && !hasError) {
          resolve();
        }
      };
    }
  });
}

export async function deleteConversation(accountId: string, conversationId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['conversations'], 'readwrite');
    const store = transaction.objectStore('conversations');
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

export async function updateConversationSyncCursor(
  accountId: string,
  conversationId: string,
  syncCursor: string | null
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['conversations'], 'readwrite');
    const store = transaction.objectStore('conversations');
    const request = store.get(conversationId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        result.syncCursor = syncCursor;
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

export async function getConversationsBySyncCursor(
  accountId: string,
  syncCursor: string | null
): Promise<StoredConversation[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['conversations'], 'readonly');
    const store = transaction.objectStore('conversations');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const conversations = request.result.filter(
        (c) => c.syncCursor === syncCursor
      );
      resolve(conversations);
    };
    request.onerror = () => reject(request.error);
  });
}