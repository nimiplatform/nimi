import type { JsonObject } from '@nimiplatform/sdk/types';
import {
  OFFLINE_CACHE_MAX_CHATS,
  OFFLINE_CACHE_MAX_MESSAGES_PER_CHAT,
  offlineScopeKey,
  type OfflineAccountScope,
  type HumanChatDraft,
} from './types.js';
import {
  hasIndexedDb,
  OFFLINE_STORE_PROFILE_METADATA,
  OFFLINE_STORE_CHAT_LIST,
  OFFLINE_STORE_CHAT_MESSAGES,
  OFFLINE_STORE_HUMAN_DRAFTS,
  openOfflineDatabase,
} from './database.js';


type MetadataRow = {
  cacheKey: string;
  payload: object | object[];
};

export type OfflineEphemeralStoreOptions = {
  readonly scope: OfflineAccountScope;
  readonly enableEphemeralStore?: boolean;
};

type OfflineEphemeralStore = {
  chatList: Map<string, object>;
  chatListReady: boolean;
  chatMessages: Map<string, Map<string, object>>;
  profileMetadata: Map<string, MetadataRow>;
  drafts: Map<string, HumanChatDraft>;
};

function createEphemeralStore(): OfflineEphemeralStore {
  return {
    chatList: new Map(),
    chatListReady: false,
    chatMessages: new Map(),
    profileMetadata: new Map(),
    drafts: new Map(),
  };
}

function toMetadataRow(
  cacheKey: string,
  payload: object | object[],
): MetadataRow {
  return { cacheKey, payload };
}

/**
 * D-OFFLINE-005: IndexedDB offline cache with explicit ephemeral store for non-browser tests.
 */
export class OfflineCacheManager {
  private db: IDBDatabase | null = null;
  private ephemeral: OfflineEphemeralStore | null = null;

  constructor(private readonly options: OfflineEphemeralStoreOptions) { offlineScopeKey(options.scope); }

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
    this.db = await openOfflineDatabase(this.options.scope);
    this.db.onversionchange = () => this.close();
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

  async syncChatList<T extends object>(chats: T[]): Promise<void> {
    const limited = chats.slice(0, OFFLINE_CACHE_MAX_CHATS);
    if (this.ephemeral) {
      const ephemeral = this.ensureEphemeralStore();
      ephemeral.chatList.clear();
      ephemeral.chatListReady = true;
      for (const chat of limited) {
        const record = chat as JsonObject;
        const id = String(record.id || '').trim();
        if (!id) continue;
        ephemeral.chatList.set(id, chat);
      }
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction([OFFLINE_STORE_CHAT_LIST, OFFLINE_STORE_PROFILE_METADATA], 'readwrite');
    const store = tx.objectStore(OFFLINE_STORE_CHAT_LIST);
    store.clear();
    for (const chat of limited) {
      store.put(chat);
    }
    tx.objectStore(OFFLINE_STORE_PROFILE_METADATA).put(toMetadataRow('cache-state:chat-list', { available: true }));
    await this.complete(tx);
  }

  async getCachedChatList<T extends object = JsonObject>(): Promise<T[]> {
    if (this.ephemeral) {
      if (!this.ephemeral.chatListReady) throw new Error('OFFLINE_CHAT_CACHE_UNAVAILABLE');
      return Array.from(this.ensureEphemeralStore().chatList.values()) as T[];
    }
    if (!await this.getByKey(OFFLINE_STORE_PROFILE_METADATA, 'cache-state:chat-list')) throw new Error('OFFLINE_CHAT_CACHE_UNAVAILABLE');
    return await this.getAll<T>(OFFLINE_STORE_CHAT_LIST);
  }

  async syncChatMessages<T extends object>(chatId: string, messages: T[]): Promise<void> {
    const limited = messages.slice(0, OFFLINE_CACHE_MAX_MESSAGES_PER_CHAT);
    if (this.ephemeral) {
      const ephemeral = this.ensureEphemeralStore();
      const byId = new Map<string, object>();
      for (const message of limited) {
        const record = message as JsonObject;
        const id = String(record.id || '').trim();
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
    const tx = db.transaction([OFFLINE_STORE_CHAT_MESSAGES, OFFLINE_STORE_PROFILE_METADATA], 'readwrite');
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
    tx.objectStore(OFFLINE_STORE_PROFILE_METADATA).put(toMetadataRow(`cache-state:messages:${chatId}`, { available: true }));
    await this.complete(tx);
  }

  async getCachedMessages<T extends object = JsonObject>(chatId: string): Promise<T[]> {
    if (this.ephemeral) {
      if (!this.ephemeral.chatMessages.has(chatId)) throw new Error('OFFLINE_MESSAGE_CACHE_UNAVAILABLE');
      return Array.from((this.ensureEphemeralStore().chatMessages.get(chatId) || new Map()).values()) as T[];
    }
    if (!await this.getByKey(OFFLINE_STORE_PROFILE_METADATA, `cache-state:messages:${chatId}`)) throw new Error('OFFLINE_MESSAGE_CACHE_UNAVAILABLE');
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

  async syncProfileMetadata<T extends object>(profileKey: string, payload: T): Promise<void> {
    const row = toMetadataRow(profileKey, payload);
    if (this.ephemeral) {
      this.ensureEphemeralStore().profileMetadata.set(profileKey, row);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(OFFLINE_STORE_PROFILE_METADATA, 'readwrite');
    tx.objectStore(OFFLINE_STORE_PROFILE_METADATA).put(row);
    await this.complete(tx);
  }

  async getCachedProfileMetadata<T extends object = JsonObject>(profileKey: string): Promise<T | null> {
    if (this.ephemeral) {
      const row = this.ensureEphemeralStore().profileMetadata.get(profileKey);
      return row && !Array.isArray(row.payload) ? row.payload as T : null;
    }
    const row = await this.getByKey<MetadataRow>(OFFLINE_STORE_PROFILE_METADATA, profileKey);
    return row && !Array.isArray(row.payload) ? row.payload as T : null;
  }

  async removeProfileMetadata(profileKey: string): Promise<void> {
    if (this.ephemeral) { this.ephemeral.profileMetadata.delete(profileKey); return; }
    const tx = this.ensureDb().transaction(OFFLINE_STORE_PROFILE_METADATA, 'readwrite');
    tx.objectStore(OFFLINE_STORE_PROFILE_METADATA).delete(profileKey);
    await this.complete(tx);
  }

  async saveHumanDraft(draft: HumanChatDraft): Promise<void> {
    if (this.ephemeral) {
      this.ephemeral.drafts.set(draft.peerAccountId, structuredClone(draft));
      return;
    }
    const tx = this.ensureDb().transaction(OFFLINE_STORE_HUMAN_DRAFTS, 'readwrite');
    tx.objectStore(OFFLINE_STORE_HUMAN_DRAFTS).put(draft);
    await this.complete(tx);
  }

  async loadHumanDraft(peerAccountId: string): Promise<HumanChatDraft | null> {
    return this.ephemeral
      ? structuredClone(this.ephemeral.drafts.get(peerAccountId) ?? null)
      : (await this.getByKey<HumanChatDraft>(OFFLINE_STORE_HUMAN_DRAFTS, peerAccountId)) ?? null;
  }
}
