export const OFFLINE_DB_NAME = 'nimi-offline-cache';
export const OFFLINE_DB_VERSION = 3;

export const OFFLINE_STORE_CHAT_LIST = 'chat-list';
export const OFFLINE_STORE_CHAT_MESSAGES = 'chat-messages';
export const OFFLINE_STORE_CHAT_OUTBOX = 'chat-outbox';
export const OFFLINE_STORE_SOCIAL_OUTBOX = 'social-outbox';
export const OFFLINE_STORE_PROFILE_METADATA = 'profile-metadata';
// Retired in version 3: world lists and details are live Realm reads, never persisted results.
const RETIRED_OFFLINE_STORE_WORLD_METADATA = 'world-metadata';

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
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
      if (!db.objectStoreNames.contains(OFFLINE_STORE_SOCIAL_OUTBOX)) {
        const socialStore = db.createObjectStore(OFFLINE_STORE_SOCIAL_OUTBOX, { keyPath: 'id' });
        socialStore.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_PROFILE_METADATA)) {
        db.createObjectStore(OFFLINE_STORE_PROFILE_METADATA, { keyPath: 'cacheKey' });
      }
      // Only the retired world cache is dropped; chat, outbox and profile stores are kept.
      if (db.objectStoreNames.contains(RETIRED_OFFLINE_STORE_WORLD_METADATA)) {
        db.deleteObjectStore(RETIRED_OFFLINE_STORE_WORLD_METADATA);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
