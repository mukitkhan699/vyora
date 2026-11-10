import {
  getDB,
  createTransaction,
  type StoredMessage,
  type StoredAttachment,
  type StoredReaction,
  type StoredReceipt,
} from './database.ts';

export type { StoredMessage, StoredAttachment, StoredReaction, StoredReceipt };

export async function getMessages(
  accountId: string,
  conversationId: string,
  options: { before?: string; limit?: number } = {}
): Promise<StoredMessage[]> {
  const { before, limit = 50 } = options;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readonly');
    const store = transaction.objectStore('messages');
    const index = store.index('conversationId_createdAt');

    let range: IDBKeyRange | null = IDBKeyRange.only(conversationId);
    if (before) {
      const cursorRes = store.get(before);
      cursorRes.onsuccess = () => {
        const cursorMsg = cursorRes.result;
        if (cursorMsg) {
          range = IDBKeyRange.upperBound([conversationId, cursorMsg.createdAt], true);
          executeQuery(range);
        } else {
          resolve([]);
        }
      };
      cursorRes.onerror = () => reject(cursorRes.error);
      return;
    }

    executeQuery(range);

    function executeQuery(keyRange: IDBKeyRange | null): void {
      const request = index.openCursor(keyRange, 'prev');
      const messages: StoredMessage[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && messages.length < limit) {
          const msg = cursor.value;
          if (msg.accountId === accountId) {
            messages.push(msg);
          }
          cursor.continue();
        } else {
          resolve(messages.reverse());
        }
      };
      request.onerror = () => reject(request.error);
    }
  });
}

export async function getMessageById(
  accountId: string,
  messageId: string
): Promise<StoredMessage | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readonly');
    const store = transaction.objectStore('messages');
    const request = store.get(messageId);

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

export async function upsertMessage(message: StoredMessage): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readwrite');
    const store = transaction.objectStore('messages');
    const request = store.put(message);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function upsertMessages(messages: StoredMessage[]): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readwrite');
    const store = transaction.objectStore('messages');
    let completed = 0;
    let hasError = false;

    for (const message of messages) {
      const request = store.put(message);
      request.onerror = () => {
        hasError = true;
        reject(request.error);
      };
      request.onsuccess = () => {
        completed++;
        if (completed === messages.length && !hasError) {
          resolve();
        }
      };
    }
  });
}

export async function deleteMessage(accountId: string, messageId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readwrite');
    const store = transaction.objectStore('messages');
    const request = store.get(messageId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        const deleteRequest = store.delete(messageId);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesByClientId(
  accountId: string,
  clientId: string
): Promise<StoredMessage[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readonly');
    const store = transaction.objectStore('messages');
    const index = store.index('clientId');
    const request = index.getAll(clientId);

    request.onsuccess = () => {
      const results = request.result.filter((m) => m.accountId === accountId);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function updateMessageStatus(
  accountId: string,
  messageId: string,
  localStatus: StoredMessage['localStatus'],
  localError?: string
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readwrite');
    const store = transaction.objectStore('messages');
    const request = store.get(messageId);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.accountId === accountId) {
        result.localStatus = localStatus;
        if (localError !== undefined) result.localError = localError;
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

export async function getUnsyncedMessages(accountId: string): Promise<StoredMessage[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readonly');
    const store = transaction.objectStore('messages');
    const index = store.index('accountId');
    const request = index.getAll(accountId);

    request.onsuccess = () => {
      const messages = request.result.filter(
        (m) => m.localStatus && ['pending', 'sending', 'failed'].includes(m.localStatus)
      );
      resolve(messages);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesForSync(
  accountId: string,
  conversationId: string,
  sinceCursor: string | null
): Promise<StoredMessage[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readonly');
    const store = transaction.objectStore('messages');
    const index = store.index('conversationId_createdAt');

    let range: IDBKeyRange;
    if (sinceCursor) {
      const cursorRes = store.get(sinceCursor);
      cursorRes.onsuccess = () => {
        const cursorMsg = cursorRes.result;
        if (cursorMsg) {
          range = IDBKeyRange.lowerBound([conversationId, cursorMsg.createdAt], true);
          executeQuery(range);
        } else {
          executeQuery(IDBKeyRange.only(conversationId));
        }
      };
      cursorRes.onerror = () => reject(cursorRes.error);
      return;
    } else {
      range = IDBKeyRange.only(conversationId);
    }

    function executeQuery(keyRange: IDBKeyRange): void {
      const request = index.openCursor(keyRange, 'next');
      const messages: StoredMessage[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const msg = cursor.value;
          if (msg.accountId === accountId) {
            messages.push(msg);
          }
          cursor.continue();
        } else {
          resolve(messages);
        }
      };
      request.onerror = () => reject(request.error);
    }
  });
}