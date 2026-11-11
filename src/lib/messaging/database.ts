const DB_NAME = 'zunari-messaging';
const DB_VERSION = 1;

export interface StoredConversation {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  avatarUrl: string | null;
  lastMessageAt: number;
  lastMessage?: StoredMessage | null;
  unreadCount: number;
  participants: StoredParticipant[];
  syncCursor: string | null;
  cacheTimestamp: number;
  accountId: string;
}

export interface StoredParticipant {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  leftAt: number | null;
  lastReadMessageId: string | null;
  user?: {
    id: string;
    username: string;
    name: string;
    avatarUrl: string;
    verified: boolean;
    isGold: boolean;
  };
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  clientId: string | null;
  text: string;
  replyToMessageId: string | null;
  /** Identity snapshot so cached history renders group names/avatars offline. */
  sender?: StoredMessageSender;
  /** Quoted-message snapshot so replies render offline. */
  replyToMessage?: StoredReplyPreview | null;
  isEdited: boolean;
  editedAt: number | null;
  isDeleted: boolean;
  deletedAt: number | null;
  createdAt: number;
  localStatus?: 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  localError?: string;
  attachments: StoredAttachment[];
  reactions: StoredReaction[];
  receipts: StoredReceipt[];
  accountId: string;
}

export interface StoredMessageSender {
  id: string;
  username: string;
  name: string;
  avatarUrl: string;
  verified: boolean;
  isGold: boolean;
}

export interface StoredReplyPreview {
  id: string;
  senderId: string | null;
  senderUsername?: string;
  text: string;
}

export interface StoredAttachment {
  id: string;
  messageId: string;
  mediaAssetId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  status: 'active' | 'expired' | 'cleaned';
  expiresAt: number;
  createdAt: number;
  url: string;
}

export interface StoredReaction {
  emoji: string;
  userId: string;
  username?: string;
  createdAt: number;
}

export interface StoredReceipt {
  userId: string;
  deliveredAt: number | null;
  readAt: number | null;
}

export interface StoredOutboxMessage {
  clientId: string;
  conversationId: string;
  text: string;
  replyToMessageId?: string;
  attachmentAssetIds?: string[];
  createdAt: number;
  retryCount: number;
  nextRetryAt: number;
  status: 'pending' | 'sending' | 'failed' | 'sent';
  lastError?: string;
  accountId: string;
}

export interface StoredSyncState {
  conversationId: string;
  lastSyncedCursor: string | null;
  lastSuccessfulSync: number;
  accountId: string;
}

export interface StoredMediaMetadata {
  assetId: string;
  conversationId: string;
  localBlob: Blob | null;
  fileSize: number;
  contentType: string;
  lastAccessed: number;
  expiresAt: number;
  isPinned: boolean;
  accountId: string;
}

type StoreName =
  | 'conversations'
  | 'messages'
  | 'outbox'
  | 'sync_state'
  | 'media_metadata';

interface DatabaseSchema {
  conversations: StoredConversation;
  messages: StoredMessage;
  outbox: StoredOutboxMessage;
  sync_state: StoredSyncState;
  media_metadata: StoredMediaMetadata;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        createStores(db);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('IndexedDB upgrade blocked by another tab');
    };
  });

  return dbPromise;
}

function createStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('conversations')) {
    const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
    convStore.createIndex('accountId', 'accountId', { unique: false });
    convStore.createIndex('lastMessageAt', 'lastMessageAt', { unique: false });
    convStore.createIndex('type', 'type', { unique: false });
  }

  if (!db.objectStoreNames.contains('messages')) {
    const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
    msgStore.createIndex('conversationId', 'conversationId', { unique: false });
    msgStore.createIndex('accountId', 'accountId', { unique: false });
    msgStore.createIndex('createdAt', 'createdAt', { unique: false });
    msgStore.createIndex('clientId', 'clientId', { unique: false });
    msgStore.createIndex('conversationId_createdAt', ['conversationId', 'createdAt'], { unique: false });
  }

  if (!db.objectStoreNames.contains('outbox')) {
    const outboxStore = db.createObjectStore('outbox', { keyPath: 'clientId' });
    outboxStore.createIndex('accountId', 'accountId', { unique: false });
    outboxStore.createIndex('conversationId', 'conversationId', { unique: false });
    outboxStore.createIndex('status', 'status', { unique: false });
    outboxStore.createIndex('nextRetryAt', 'nextRetryAt', { unique: false });
  }

  if (!db.objectStoreNames.contains('sync_state')) {
    const syncStore = db.createObjectStore('sync_state', { keyPath: 'conversationId' });
    syncStore.createIndex('accountId', 'accountId', { unique: false });
    syncStore.createIndex('lastSuccessfulSync', 'lastSuccessfulSync', { unique: false });
  }

  if (!db.objectStoreNames.contains('media_metadata')) {
    const mediaStore = db.createObjectStore('media_metadata', { keyPath: 'assetId' });
    mediaStore.createIndex('conversationId', 'conversationId', { unique: false });
    mediaStore.createIndex('accountId', 'accountId', { unique: false });
    mediaStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
    mediaStore.createIndex('expiresAt', 'expiresAt', { unique: false });
  }
}

export async function getDB(): Promise<IDBDatabase> {
  return openDatabase();
}

export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

export function createTransaction(
  storeNames: StoreName[],
  mode: IDBTransactionMode = 'readonly'
): Promise<IDBTransaction> {
  return getDB().then((db) => db.transaction(storeNames, mode));
}

export async function clearAccountData(accountId: string): Promise<void> {
  const db = await getDB();
  const storeNames: StoreName[] = ['conversations', 'messages', 'outbox', 'sync_state', 'media_metadata'];

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, 'readwrite');
    let completed = 0;
    let hasError = false;

    storeNames.forEach((storeName) => {
      const store = transaction.objectStore(storeName);
      const index = store.index('accountId');
      const request = index.getAllKeys(IDBKeyRange.only(accountId));

      request.onsuccess = () => {
        const keys = request.result;
        keys.forEach((key) => store.delete(key));
      };
    });

    transaction.oncomplete = () => {
      if (!hasError) resolve();
    };
    transaction.onerror = () => {
      hasError = true;
      reject(transaction.error);
    };
  });
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const storeNames: StoreName[] = ['conversations', 'messages', 'outbox', 'sync_state', 'media_metadata'];

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, 'readwrite');
    let hasError = false;

    storeNames.forEach((storeName) => {
      const store = transaction.objectStore(storeName);
      store.clear();
    });

    transaction.oncomplete = () => {
      if (!hasError) resolve();
    };
    transaction.onerror = () => {
      hasError = true;
      reject(transaction.error);
    };
  });
}

export async function isIndexedDBAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.indexedDB) return false;
  try {
    const testDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('__test__', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    testDb.close();
    await indexedDB.deleteDatabase('__test__');
    return true;
  } catch {
    return false;
  }
}

export { DB_NAME, DB_VERSION };
export type { DatabaseSchema };