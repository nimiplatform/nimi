import type {
  PersistentOutboxEntry,
  PersistentSocialMutationEntry,
} from './types.js';
import {
  OFFLINE_OUTBOX_MAX_ENTRIES,
} from './types.js';
import {
  hasIndexedDb,
  OFFLINE_STORE_CHAT_OUTBOX,
  OFFLINE_STORE_SOCIAL_OUTBOX,
  openOfflineDatabase,
} from './database.js';

type OfflineOutboxMemoryStore = {
  chatOutbox: Map<string, PersistentOutboxEntry>;
  socialOutbox: Map<string, PersistentSocialMutationEntry>;
};

function createMemoryStore(): OfflineOutboxMemoryStore {
  return {
    chatOutbox: new Map(),
    socialOutbox: new Map(),
  };
}

/**
 * D-OFFLINE-002: pending local send intents for admitted Desktop shell recovery.
 *
 * These entries are not Realm commit truth. They are transport records that must
 * be flushed through Realm public APIs and deleted only after Realm accepts them.
 */
export class OfflineOutboxManager {
  private db: IDBDatabase | null = null;
  private memory: OfflineOutboxMemoryStore | null = null;

  async open(): Promise<void> {
    if (this.db || this.memory) {
      return;
    }
    if (!hasIndexedDb()) {
      this.memory = createMemoryStore();
      return;
    }
    this.db = await openOfflineDatabase();
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
      throw new Error('OfflineOutboxManager not opened');
    }
    return this.db;
  }

  private ensureMemory(): OfflineOutboxMemoryStore {
    if (!this.memory) {
      throw new Error('OfflineOutboxManager memory store not opened');
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

  async upsertChatOutboxEntry(entry: PersistentOutboxEntry): Promise<void> {
    const count = await this.getChatOutboxCount();
    const existing = await this.getChatOutboxEntry(entry.clientMessageId);
    if (!existing && count >= OFFLINE_OUTBOX_MAX_ENTRIES) {
      throw new Error(`Outbox full (${OFFLINE_OUTBOX_MAX_ENTRIES} entries). Cannot queue more messages offline.`);
    }
    if (this.memory) {
      this.ensureMemory().chatOutbox.set(entry.clientMessageId, entry);
      return;
    }
    const db = this.ensureDb();
    const tx = db.transaction(OFFLINE_STORE_CHAT_OUTBOX, 'readwrite');
    tx.objectStore(OFFLINE_STORE_CHAT_OUTBOX).put(entry);
    await this.complete(tx);
  }

  async getChatOutboxEntry(clientMessageId: string): Promise<PersistentOutboxEntry | undefined> {
    if (this.memory) {
      return this.ensureMemory().chatOutbox.get(clientMessageId);
    }
    return await this.getByKey<PersistentOutboxEntry>(OFFLINE_STORE_CHAT_OUTBOX, clientMessageId);
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
      const tx = db.transaction(OFFLINE_STORE_CHAT_OUTBOX, 'readonly');
      const store = tx.objectStore(OFFLINE_STORE_CHAT_OUTBOX);
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
      const tx = db.transaction(OFFLINE_STORE_CHAT_OUTBOX, 'readonly');
      const request = tx.objectStore(OFFLINE_STORE_CHAT_OUTBOX).count();
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
    const tx = db.transaction(OFFLINE_STORE_CHAT_OUTBOX, 'readwrite');
    tx.objectStore(OFFLINE_STORE_CHAT_OUTBOX).delete(clientMessageId);
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
    const tx = db.transaction(OFFLINE_STORE_SOCIAL_OUTBOX, 'readwrite');
    tx.objectStore(OFFLINE_STORE_SOCIAL_OUTBOX).put(entry);
    await this.complete(tx);
  }

  async getSocialMutationEntries(): Promise<PersistentSocialMutationEntry[]> {
    if (this.memory) {
      return Array.from(this.ensureMemory().socialOutbox.values())
        .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    }
    const items = await this.getAll<PersistentSocialMutationEntry>(OFFLINE_STORE_SOCIAL_OUTBOX);
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
    const tx = db.transaction(OFFLINE_STORE_SOCIAL_OUTBOX, 'readwrite');
    tx.objectStore(OFFLINE_STORE_SOCIAL_OUTBOX).delete(id);
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
}

let offlineOutboxManager: OfflineOutboxManager | null = null;
let offlineOutboxManagerPromise: Promise<OfflineOutboxManager> | null = null;

export async function getOfflineOutboxManager(): Promise<OfflineOutboxManager> {
  if (offlineOutboxManager) {
    await offlineOutboxManager.open();
    return offlineOutboxManager;
  }
  if (!offlineOutboxManagerPromise) {
    offlineOutboxManagerPromise = (async () => {
      const manager = new OfflineOutboxManager();
      await manager.open();
      offlineOutboxManager = manager;
      return manager;
    })();
  }
  return await offlineOutboxManagerPromise;
}
