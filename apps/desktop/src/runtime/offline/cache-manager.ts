import type { JsonObject } from '@runtime/net/json';
import type {
  PersistentOutboxEntry,
  PersistentSocialMutationEntry,
} from './types.js';
import {
  OUTBOX_MAX_ENTRIES,
  CACHE_MAX_CHATS,
  CACHE_MAX_MESSAGES_PER_CHAT,
} from './types.js';

const DB_NAME = 'nimi-offline-cache';
const DB_VERSION = 2;
const STORE_CHAT_LIST = 'chat-list';
const STORE_CHAT_MESSAGES = 'chat-messages';
const STORE_CHAT_OUTBOX = 'chat-outbox';
const STORE_SOCIAL_OUTBOX = 'social-outbox';
const STORE_AGENT_METADATA = 'agent-metadata';
const STORE_WORLD_METADATA = 'world-metadata';
const STORE_MODEL_MANIFESTS = 'model-manifests';
const WORLD_LIST_CACHE_KEY = '__world-list__';
const MODEL_MANIFEST_CACHE_KEY = '__model-manifests__';

type MetadataRow = {
  cacheKey: string;
  payload: JsonObject | JsonObject[];
};

type OfflineMemoryStore = {
  chatList: Map<string, JsonObject>;
  chatMessages: Map<string, Map<string, JsonObject>>;
  chatOutbox: Map<string, PersistentOutboxEntry>;
  socialOutbox: Map<string, PersistentSocialMutationEntry>;
  agentMetadata: Map<string, MetadataRow>;
  worldMetadata: Map<string, MetadataRow>;
  modelManifests: Map<string, MetadataRow>;
};

function createMemoryStore(): OfflineMemoryStore {
  return {
    chatList: new Map(),
    chatMessages: new Map(),
    chatOutbox: new Map(),
    socialOutbox: new Map(),
    agentMetadata: new Map(),
    worldMetadata: new Map(),
    modelManifests: new Map(),
  };
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CHAT_LIST)) {
        const chatStore = db.createObjectStore(STORE_CHAT_LIST, { keyPath: 'id' });
        chatStore.createIndex('lastMessageAt', 'lastMessageAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CHAT_MESSAGES)) {
        const messageStore = db.createObjectStore(STORE_CHAT_MESSAGES, { keyPath: 'id' });
        messageStore.createIndex('chatId_createdAt', ['chatId', 'createdAt'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CHAT_OUTBOX)) {
        const outboxStore = db.createObjectStore(STORE_CHAT_OUTBOX, { keyPath: 'clientMessageId' });
        outboxStore.createIndex('chatId_enqueuedAt', ['chatId', 'enqueuedAt'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SOCIAL_OUTBOX)) {
        const socialStore = db.createObjectStore(STORE_SOCIAL_OUTBOX, { keyPath: 'id' });
        socialStore.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AGENT_METADATA)) {
        db.createObjectStore(STORE_AGENT_METADATA, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(STORE_WORLD_METADATA)) {
        db.createObjectStore(STORE_WORLD_METADATA, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(STORE_MODEL_MANIFESTS)) {
        db.createObjectStore(STORE_MODEL_MANIFESTS, { keyPath: 'cacheKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function toMetadataRow(
  cacheKey: string,
  payload: JsonObject | JsonObject[],
): MetadataRow {
  return { cacheKey, payload };
}

/**
 * D-OFFLINE-005: IndexedDB offline cache with in-memory fallback for non-browser tests.
 */
export class OfflineCacheManager {
  private db: IDBDatabase | null = null;
  private memory: OfflineMemoryStore | null = null;

  async open(): Promise<void> {
    if (this.db || this.memory) {
      return;
    }
    if (!hasIndexedDb()) {
      this.memory = createMemoryStore();
      return;
    }
    this.db = await openDatabase();
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.memory = null;
  }

  private ensureDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('OfflineCacheManager not opened');
    }
    return this.db;
  }

  private ensureMemory(): OfflineMemoryStore {
    if (!this.memory) {
      throw new Error('OfflineCacheManager memory store not opened');
    }
    return this.memory;
  }

  private async complete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    if (this.memory) {
      throw new Error(`getAll(${storeName}) not implemented for memory store`);
    }
    const db = this.ensureDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  private async getByKey<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const db = this.ensureDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async syncChatList<T extends JsonObject>(chats: T[]): Promise<void> {
    const limited = chats.slice(0, CACHE_MAX_CHATS);
    if (this.memory) {
      const memory = this.ensureMemory();
      memory.chatList.clear();
      for (const chat of limited) {
        const id = String(chat.id || '').trim();
        if (!id) continue;
        memory.chatList.set(id, chat);
      }
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_CHAT_LIST, 'readwrite');
    const store = tx.objectStore(STORE_CHAT_LIST);
    store.clear();
    for (const chat of limited) {
      store.put(chat);
    }
    await this.complete(tx);
  }

  async getCachedChatList<T extends JsonObject>(): Promise<T[]> {
    if (this.memory) {
      return Array.from(this.ensureMemory().chatList.values()) as T[];
    }
    return await this.getAll<T>(STORE_CHAT_LIST);
  }

  async syncChatMessages<T extends JsonObject>(chatId: string, messages: T[]): Promise<void> {
    const limited = messages.slice(0, CACHE_MAX_MESSAGES_PER_CHAT);
    if (this.memory) {
      const memory = this.ensureMemory();
      const byId = new Map<string, JsonObject>();
      for (const message of limited) {
        const id = String(message.id || '').trim();
        if (!id) continue;
        byId.set(id, {
          ...message,
          chatId,
        });
      }
      memory.chatMessages.set(chatId, byId);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_CHAT_MESSAGES, 'readwrite');
    const store = tx.objectStore(STORE_CHAT_MESSAGES);
    const index = store.index('chatId_createdAt');
    const range = IDBKeyRange.bound([chatId], [chatId, '\uffff']);
    await new Promise<void>((resolve, reject) => {
      const cursorRequest = index.openCursor(range);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
          return;
        }
        resolve();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    for (const message of limited) {
      store.put({ ...message, chatId });
    }
    await this.complete(tx);
  }

  async getCachedMessages<T extends JsonObject>(chatId: string): Promise<T[]> {
    if (this.memory) {
      return Array.from((this.ensureMemory().chatMessages.get(chatId) || new Map()).values()) as T[];
    }
    const db = this.ensureDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHAT_MESSAGES, 'readonly');
      const store = tx.objectStore(STORE_CHAT_MESSAGES);
      const index = store.index('chatId_createdAt');
      const range = IDBKeyRange.bound([chatId], [chatId, '\uffff']);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  async upsertChatOutboxEntry(entry: PersistentOutboxEntry): Promise<void> {
    const count = await this.getChatOutboxCount();
    const existing = await this.getChatOutboxEntry(entry.clientMessageId);
    if (!existing && count >= OUTBOX_MAX_ENTRIES) {
      throw new Error(`Outbox full (${OUTBOX_MAX_ENTRIES} entries). Cannot queue more messages offline.`);
    }
    if (this.memory) {
      this.ensureMemory().chatOutbox.set(entry.clientMessageId, entry);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_CHAT_OUTBOX, 'readwrite');
    tx.objectStore(STORE_CHAT_OUTBOX).put(entry);
    await this.complete(tx);
  }

  async getChatOutboxEntry(clientMessageId: string): Promise<PersistentOutboxEntry | undefined> {
    if (this.memory) {
      return this.ensureMemory().chatOutbox.get(clientMessageId);
    }
    return await this.getByKey<PersistentOutboxEntry>(STORE_CHAT_OUTBOX, clientMessageId);
  }

  async getChatOutboxEntries(chatId?: string): Promise<PersistentOutboxEntry[]> {
    if (this.memory) {
      const values = Array.from(this.ensureMemory().chatOutbox.values());
      const filtered = chatId
        ? values.filter((entry) => entry.chatId === chatId)
        : values;
      return filtered.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    }
    const db = this.ensureDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHAT_OUTBOX, 'readonly');
      const store = tx.objectStore(STORE_CHAT_OUTBOX);
      if (!chatId) {
        const request = store.getAll();
        request.onsuccess = () => {
          const items = (request.result as PersistentOutboxEntry[]).slice();
          items.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
          resolve(items);
        };
        request.onerror = () => reject(request.error);
        return;
      }
      const index = store.index('chatId_enqueuedAt');
      const range = IDBKeyRange.bound([chatId], [chatId, Infinity]);
      const request = index.getAll(range);
      request.onsuccess = () => {
        const items = (request.result as PersistentOutboxEntry[]).slice();
        items.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getChatOutboxCount(): Promise<number> {
    if (this.memory) {
      return this.ensureMemory().chatOutbox.size;
    }
    const db = this.ensureDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHAT_OUTBOX, 'readonly');
      const request = tx.objectStore(STORE_CHAT_OUTBOX).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async markChatOutboxSent(clientMessageId: string): Promise<void> {
    if (this.memory) {
      this.ensureMemory().chatOutbox.delete(clientMessageId);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_CHAT_OUTBOX, 'readwrite');
    tx.objectStore(STORE_CHAT_OUTBOX).delete(clientMessageId);
    await this.complete(tx);
  }

  async markChatOutboxFailed(clientMessageId: string, reason: string): Promise<void> {
    const entry = await this.getChatOutboxEntry(clientMessageId);
    if (!entry) {
      return;
    }
    await this.upsertChatOutboxEntry({
      ...entry,
      status: 'failed',
      failReason: reason,
    });
  }

  async queueSocialMutation(entry: PersistentSocialMutationEntry): Promise<void> {
    if (this.memory) {
      this.ensureMemory().socialOutbox.set(entry.id, entry);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_SOCIAL_OUTBOX, 'readwrite');
    tx.objectStore(STORE_SOCIAL_OUTBOX).put(entry);
    await this.complete(tx);
  }

  async getSocialMutationEntries(): Promise<PersistentSocialMutationEntry[]> {
    if (this.memory) {
      return Array.from(this.ensureMemory().socialOutbox.values())
        .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    }
    const items = await this.getAll<PersistentSocialMutationEntry>(STORE_SOCIAL_OUTBOX);
    return items.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  }

  async getPendingSocialMutationCount(): Promise<number> {
    const entries = await this.getSocialMutationEntries();
    return entries.filter((entry) => entry.status === 'pending').length;
  }

  async markSocialMutationSent(id: string): Promise<void> {
    if (this.memory) {
      this.ensureMemory().socialOutbox.delete(id);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_SOCIAL_OUTBOX, 'readwrite');
    tx.objectStore(STORE_SOCIAL_OUTBOX).delete(id);
    await this.complete(tx);
  }

  async markSocialMutationFailed(id: string, reason: string): Promise<void> {
    const entries = await this.getSocialMutationEntries();
    const existing = entries.find((entry) => entry.id === id);
    if (!existing) {
      return;
    }
    await this.queueSocialMutation({
      ...existing,
      status: 'failed',
      failReason: reason,
    });
  }

  async syncAgentMetadata<T extends JsonObject>(agentId: string, payload: T): Promise<void> {
    const row = toMetadataRow(agentId, payload);
    if (this.memory) {
      this.ensureMemory().agentMetadata.set(agentId, row);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_AGENT_METADATA, 'readwrite');
    tx.objectStore(STORE_AGENT_METADATA).put(row);
    await this.complete(tx);
  }

  async getCachedAgentMetadata<T extends JsonObject>(agentId: string): Promise<T | null> {
    if (this.memory) {
      const row = this.ensureMemory().agentMetadata.get(agentId);
      return row && !Array.isArray(row.payload) ? row.payload as T : null;
    }
    const row = await this.getByKey<MetadataRow>(STORE_AGENT_METADATA, agentId);
    return row && !Array.isArray(row.payload) ? row.payload as T : null;
  }

  async syncWorldList<T extends JsonObject>(worlds: T[]): Promise<void> {
    const row = toMetadataRow(WORLD_LIST_CACHE_KEY, worlds);
    if (this.memory) {
      this.ensureMemory().worldMetadata.set(WORLD_LIST_CACHE_KEY, row);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_WORLD_METADATA, 'readwrite');
    tx.objectStore(STORE_WORLD_METADATA).put(row);
    await this.complete(tx);
  }

  async getCachedWorldList<T extends JsonObject>(): Promise<T[]> {
    if (this.memory) {
      const row = this.ensureMemory().worldMetadata.get(WORLD_LIST_CACHE_KEY);
      return row && Array.isArray(row.payload) ? row.payload as T[] : [];
    }
    const row = await this.getByKey<MetadataRow>(STORE_WORLD_METADATA, WORLD_LIST_CACHE_KEY);
    return row && Array.isArray(row.payload) ? row.payload as T[] : [];
  }

  async syncWorldMetadata<T extends JsonObject>(worldId: string, payload: T): Promise<void> {
    const row = toMetadataRow(worldId, payload);
    if (this.memory) {
      this.ensureMemory().worldMetadata.set(worldId, row);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_WORLD_METADATA, 'readwrite');
    tx.objectStore(STORE_WORLD_METADATA).put(row);
    await this.complete(tx);
  }

  async getCachedWorldMetadata<T extends JsonObject>(worldId: string): Promise<T | null> {
    if (this.memory) {
      const row = this.ensureMemory().worldMetadata.get(worldId);
      return row && !Array.isArray(row.payload) ? row.payload as T : null;
    }
    const row = await this.getByKey<MetadataRow>(STORE_WORLD_METADATA, worldId);
    return row && !Array.isArray(row.payload) ? row.payload as T : null;
  }

  async syncModelManifests<T extends JsonObject>(payload: T[]): Promise<void> {
    const row = toMetadataRow(MODEL_MANIFEST_CACHE_KEY, payload);
    if (this.memory) {
      this.ensureMemory().modelManifests.set(MODEL_MANIFEST_CACHE_KEY, row);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(STORE_MODEL_MANIFESTS, 'readwrite');
    tx.objectStore(STORE_MODEL_MANIFESTS).put(row);
    await this.complete(tx);
  }

  async getCachedModelManifests<T extends JsonObject>(): Promise<T[]> {
    if (this.memory) {
      const row = this.ensureMemory().modelManifests.get(MODEL_MANIFEST_CACHE_KEY);
      return row && Array.isArray(row.payload) ? row.payload as T[] : [];
    }
    const row = await this.getByKey<MetadataRow>(STORE_MODEL_MANIFESTS, MODEL_MANIFEST_CACHE_KEY);
    return row && Array.isArray(row.payload) ? row.payload as T[] : [];
  }
}

let offlineCacheManager: OfflineCacheManager | null = null;
let offlineCacheManagerPromise: Promise<OfflineCacheManager> | null = null;

export async function getOfflineCacheManager(): Promise<OfflineCacheManager> {
  if (offlineCacheManager) {
    await offlineCacheManager.open();
    return offlineCacheManager;
  }
  if (!offlineCacheManagerPromise) {
    offlineCacheManagerPromise = (async () => {
      const manager = new OfflineCacheManager();
      await manager.open();
      offlineCacheManager = manager;
      return manager;
    })();
  }
  return await offlineCacheManagerPromise;
}
