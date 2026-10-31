import { offlineScopeKey, type OfflineAccountScope } from './types.js';

// Hard cut: the unscoped legacy database cannot prove its viewing account.
// It is deliberately never opened, copied or automatically removed.
export const OFFLINE_DB_NAME = 'nimi-account-view-cache';
export const OFFLINE_DB_VERSION = 1;

export const OFFLINE_STORE_CHAT_LIST = 'chat-list';
export const OFFLINE_STORE_CHAT_MESSAGES = 'chat-messages';
export const OFFLINE_STORE_CHAT_OUTBOX = 'chat-outbox';
export const OFFLINE_STORE_PROFILE_METADATA = 'profile-metadata';
export const OFFLINE_STORE_HUMAN_DRAFTS = 'human-drafts';

export function offlineDatabaseName(scope: OfflineAccountScope): string {
  return `${OFFLINE_DB_NAME}:${offlineScopeKey(scope)}`;
}

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openOfflineDatabase(scope: OfflineAccountScope): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineDatabaseName(scope), OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE_CHAT_LIST)) {
        const chatStore = db.createObjectStore(OFFLINE_STORE_CHAT_LIST, { keyPath: 'id' });
        chatStore.createIndex('lastMessageAt', 'lastMessageAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_CHAT_MESSAGES)) {
        const messageStore = db.createObjectStore(OFFLINE_STORE_CHAT_MESSAGES, { keyPath: 'id' });
        messageStore.createIndex('chatId_createdAt', ['chatId', 'createdAt'], { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_CHAT_OUTBOX)) {
        const outboxStore = db.createObjectStore(OFFLINE_STORE_CHAT_OUTBOX, { keyPath: 'clientMessageId' });
        outboxStore.createIndex('chatId_enqueuedAt', ['chatId', 'enqueuedAt'], { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_PROFILE_METADATA)) {
        db.createObjectStore(OFFLINE_STORE_PROFILE_METADATA, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_HUMAN_DRAFTS)) {
        db.createObjectStore(OFFLINE_STORE_HUMAN_DRAFTS, { keyPath: 'peerAccountId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function deleteOfflineDatabase(scope: OfflineAccountScope): Promise<void> {
  if (!hasIndexedDb()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(offlineDatabaseName(scope));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('OFFLINE_ACCOUNT_CLEANUP_BLOCKED'));
  });
}
