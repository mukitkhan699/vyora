import {
  getDB,
  createTransaction,
  type StoredOutboxMessage,
} from './database.ts';

export async function getOutboxMessages(accountId: string): Promise<StoredOutboxMessage[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['outbox'], 'readonly');
    const store = transaction.objectStore('outbox');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const messages = request.result.filter(
        (m) => m.status !== 'sent'
      );
      resolve(messages);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getOutboxMessage(
  accountId: string,
  clientId: string
): Promise<StoredOutboxMessage | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['outbox'], 'readonly');
    const store = transaction.objectStore('outbox');
    const request = store.get(clientId);

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

export async function addToOutbox(message: StoredOutboxMessage): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['outbox'], 'readwrite');
    const store = transaction.objectStore('outbox');
    const request = store.put(message);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updateOutboxMessage(
  clientId: string,
  updates: Partial<StoredOutboxMessage>
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['outbox'], 'readwrite');
    const store = transaction.objectStore('outbox');
    const request = store.get(clientId);

    request.onsuccess = () => {
      const result = request.result;
      if (result) {
        Object.assign(result, updates);
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

export async function removeFromOutbox(clientId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['outbox'], 'readwrite');
    const store = transaction.objectStore('outbox');
    const request = store.delete(clientId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingOutboxMessages(accountId: string): Promise<StoredOutboxMessage[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['outbox'], 'readonly');
    const store = transaction.objectStore('outbox');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const now = Date.now();
      const messages = request.result.filter(
        (m) =>
          (m.status === 'pending' || m.status === 'failed') &&
          (m.nextRetryAt === 0 || m.nextRetryAt <= now)
      );
      resolve(messages);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getSendingOutboxMessages(accountId: string): Promise<StoredOutboxMessage[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['outbox'], 'readonly');
    const store = transaction.objectStore('outbox');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const messages = request.result.filter(
        (m) => m.status === 'sending'
      );
      resolve(messages);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearSentOutboxMessages(accountId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['outbox'], 'readwrite');
    const store = transaction.objectStore('outbox');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const sentMessages = request.result.filter((m) => m.status === 'sent');
      for (const msg of sentMessages) {
        store.delete(msg.clientId);
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}