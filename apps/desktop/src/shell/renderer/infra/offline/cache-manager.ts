import type { JsonObject } from '@nimiplatform/sdk/types';
import {
  OFFLINE_CACHE_MAX_CHATS,
  OFFLINE_CACHE_MAX_MESSAGES_PER_CHAT,
} from './types.js';
import {
  hasIndexedDb,
  OFFLINE_STORE_AGENT_METADATA,
  OFFLINE_STORE_CHAT_LIST,
  OFFLINE_STORE_CHAT_MESSAGES,
  OFFLINE_STORE_WORLD_METADATA,
  openOfflineDatabase,
} from './database.js';

const WORLD_LIST_CACHE_KEY = '__world-list__';

type MetadataRow = {
  cacheKey: string;
  payload: JsonObject | JsonObject[];
};

export type OfflineEphemeralStoreOptions = {
  readonly enableEphemeralStore?: boolean;
};

type OfflineEphemeralStore = {
  chatList: Map<string, JsonObject>;
  chatMessages: Map<string, Map<string, JsonObject>>;
  agentMetadata: Map<string, MetadataRow>;
  worldMetadata: Map<string, MetadataRow>;
};

function createEphemeralStore(): OfflineEphemeralStore {
  return {
    chatList: new Map(),
    chatMessages: new Map(),
    agentMetadata: new Map(),
    worldMetadata: new Map(),
  };
}

function toMetadataRow(
  cacheKey: string,
  payload: JsonObject | JsonObject[],
): MetadataRow {
  return { cacheKey, payload };
}

/**
 * D-OFFLINE-005: IndexedDB offline cache with explicit ephemeral store for non-browser tests.
 */
export class OfflineCacheManager {
  private db: IDBDatabase | null = null;
  private ephemeral: OfflineEphemeralStore | null = null;

  constructor(private readonly options: OfflineEphemeralStoreOptions = {}) {}

  async open(): Promise<void> {
    if (this.db || this.ephemeral) {
      return;
    }
    if (!hasIndexedDb()) {
      if (this.options.enableEphemeralStore === true) {
        this.ephemeral = createEphemeralStore();
        return;
      }
      throw new Error(
        'OfflineCacheManager requires IndexedDB or explicit enableEphemeralStore=true',
      );
    }
    this.db = await openOfflineDatabase();
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.ephemeral = null;
  }

  private ensureDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('OfflineCacheManager not opened');
    }
    return this.db;
  }

  private ensureEphemeralStore(): OfflineEphemeralStore {
    if (!this.ephemeral) {
      throw new Error('OfflineCacheManager ephemeral store not opened');
    }
    return this.ephemeral;
  }

  private async complete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    if (this.ephemeral) {
      throw new Error(`getAll(${storeName}) not implemented for ephemeral store`);
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
    const limited = chats.slice(0, OFFLINE_CACHE_MAX_CHATS);
    if (this.ephemeral) {
      const ephemeral = this.ensureEphemeralStore();
      ephemeral.chatList.clear();
      for (const chat of limited) {
        const id = String(chat.id || '').trim();
        if (!id) continue;
        ephemeral.chatList.set(id, chat);
      }
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(OFFLINE_STORE_CHAT_LIST, 'readwrite');
    const store = tx.objectStore(OFFLINE_STORE_CHAT_LIST);
    store.clear();
    for (const chat of limited) {
      store.put(chat);
    }
    await this.complete(tx);
  }

  async getCachedChatList<T extends JsonObject>(): Promise<T[]> {
    if (this.ephemeral) {
      return Array.from(this.ensureEphemeralStore().chatList.values()) as T[];
    }
    return await this.getAll<T>(OFFLINE_STORE_CHAT_LIST);
  }

  async syncChatMessages<T extends JsonObject>(chatId: string, messages: T[]): Promise<void> {
    const limited = messages.slice(0, OFFLINE_CACHE_MAX_MESSAGES_PER_CHAT);
    if (this.ephemeral) {
      const ephemeral = this.ensureEphemeralStore();
      const byId = new Map<string, JsonObject>();
      for (const message of limited) {
        const id = String(message.id || '').trim();
        if (!id) continue;
        byId.set(id, {
          ...message,
          chatId,
        });
      }
      ephemeral.chatMessages.set(chatId, byId);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(OFFLINE_STORE_CHAT_MESSAGES, 'readwrite');
    const store = tx.objectStore(OFFLINE_STORE_CHAT_MESSAGES);
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
    if (this.ephemeral) {
      return Array.from((this.ensureEphemeralStore().chatMessages.get(chatId) || new Map()).values()) as T[];
    }
    const db = this.ensureDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE_CHAT_MESSAGES, 'readonly');
      const store = tx.objectStore(OFFLINE_STORE_CHAT_MESSAGES);
      const index = store.index('chatId_createdAt');
      const range = IDBKeyRange.bound([chatId], [chatId, '\uffff']);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  async syncAgentMetadata<T extends JsonObject>(agentId: string, payload: T): Promise<void> {
    const row = toMetadataRow(agentId, payload);
    if (this.ephemeral) {
      this.ensureEphemeralStore().agentMetadata.set(agentId, row);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(OFFLINE_STORE_AGENT_METADATA, 'readwrite');
    tx.objectStore(OFFLINE_STORE_AGENT_METADATA).put(row);
    await this.complete(tx);
  }

  async getCachedAgentMetadata<T extends JsonObject>(agentId: string): Promise<T | null> {
    if (this.ephemeral) {
      const row = this.ensureEphemeralStore().agentMetadata.get(agentId);
      return row && !Array.isArray(row.payload) ? row.payload as T : null;
    }
    const row = await this.getByKey<MetadataRow>(OFFLINE_STORE_AGENT_METADATA, agentId);
    return row && !Array.isArray(row.payload) ? row.payload as T : null;
  }

  async syncWorldList<T extends JsonObject>(worlds: T[]): Promise<void> {
    const row = toMetadataRow(WORLD_LIST_CACHE_KEY, worlds);
    if (this.ephemeral) {
      this.ensureEphemeralStore().worldMetadata.set(WORLD_LIST_CACHE_KEY, row);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(OFFLINE_STORE_WORLD_METADATA, 'readwrite');
    tx.objectStore(OFFLINE_STORE_WORLD_METADATA).put(row);
    await this.complete(tx);
  }

  async getCachedWorldList<T extends JsonObject>(): Promise<T[]> {
    if (this.ephemeral) {
      const row = this.ensureEphemeralStore().worldMetadata.get(WORLD_LIST_CACHE_KEY);
      return row && Array.isArray(row.payload) ? row.payload as T[] : [];
    }
    const row = await this.getByKey<MetadataRow>(OFFLINE_STORE_WORLD_METADATA, WORLD_LIST_CACHE_KEY);
    return row && Array.isArray(row.payload) ? row.payload as T[] : [];
  }

  async syncWorldMetadata<T extends JsonObject>(worldId: string, payload: T): Promise<void> {
    const row = toMetadataRow(worldId, payload);
    if (this.ephemeral) {
      this.ensureEphemeralStore().worldMetadata.set(worldId, row);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(OFFLINE_STORE_WORLD_METADATA, 'readwrite');
    tx.objectStore(OFFLINE_STORE_WORLD_METADATA).put(row);
    await this.complete(tx);
  }

  async getCachedWorldMetadata<T extends JsonObject>(worldId: string): Promise<T | null> {
    if (this.ephemeral) {
      const row = this.ensureEphemeralStore().worldMetadata.get(worldId);
      return row && !Array.isArray(row.payload) ? row.payload as T : null;
    }
    const row = await this.getByKey<MetadataRow>(OFFLINE_STORE_WORLD_METADATA, worldId);
    return row && !Array.isArray(row.payload) ? row.payload as T : null;
  }

}

let offlineCacheManager: OfflineCacheManager | null = null;
let offlineCacheManagerPromise: Promise<OfflineCacheManager> | null = null;

function isNonBrowserOfflineStoreHarness(): boolean {
  return typeof window === 'undefined' && !hasIndexedDb();
}

export async function getOfflineCacheManager(): Promise<OfflineCacheManager> {
  if (offlineCacheManager) {
    await offlineCacheManager.open();
    return offlineCacheManager;
  }
  if (!offlineCacheManagerPromise) {
    offlineCacheManagerPromise = (async () => {
      const manager = new OfflineCacheManager({
        enableEphemeralStore: isNonBrowserOfflineStoreHarness(),
      });
      await manager.open();
      offlineCacheManager = manager;
      return manager;
    })();
  }
  return await offlineCacheManagerPromise;
}
