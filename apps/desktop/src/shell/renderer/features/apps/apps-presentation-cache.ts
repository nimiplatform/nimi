// Display metadata only. Inventory, permissions, launch selectors and run state
// are always read from their owners and are never persisted here.
type CacheRow = { key: string; value: unknown; savedAt: number };
export interface AppsPresentationStorage {
  read(key: string): Promise<CacheRow | undefined>;
  write(row: CacheRow): Promise<void>;
}

export function createAppsPresentationStorage(): AppsPresentationStorage | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nimi-app-presentation-cache', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('content', { keyPath: 'key' });
      store.createIndex('savedAt', 'savedAt');
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('App presentation cache is blocked'));
  });
  // Storage may be unavailable; it must never prevent a live metadata read.
  void database.catch(() => {});
  return {
    async read(key) {
      const db = await database;
      return new Promise((resolve, reject) => {
        const request = db.transaction('content').objectStore('content').get(key);
        request.onsuccess = () => resolve(request.result as CacheRow | undefined);
        request.onerror = () => reject(request.error);
      });
    },
    async write(row) {
      const db = await database;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('content', 'readwrite');
        const store = tx.objectStore('content');
        store.put(row);
        const count = store.count();
        count.onsuccess = () => {
          let excess = count.result - 128;
          if (excess <= 0) return;
          const cursor = store.index('savedAt').openCursor();
          cursor.onsuccess = () => {
            if (!cursor.result || excess-- <= 0) return;
            cursor.result.delete(); cursor.result.continue();
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
  };
}

function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('App information read timed out')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

export class AppsPresentationCache {
  private readonly values = new Map<string, CacheRow>();
  private readonly diskReads = new Map<string, Promise<CacheRow | undefined>>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly failures = new Map<string, { until: number; error: unknown }>();
  private readonly queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly options: {
    readonly scope?: string;
    readonly storage?: AppsPresentationStorage;
    readonly now?: () => number;
    readonly timeoutMs?: number;
  } = {}) {}

  retryFailures(): void { this.failures.clear(); }

  async get<T>(key: string, load: () => Promise<T>, options: {
    readonly maxAgeMs: number;
    readonly onCached?: (value: T) => void;
    readonly persist?: boolean;
  }): Promise<T> {
    const scopedKey = JSON.stringify([this.options.scope ?? '', key]);
    const now = this.options.now ?? Date.now;
    let cached = this.values.get(scopedKey);
    if (!cached && this.options.storage && options.persist !== false) {
      let read = this.diskReads.get(scopedKey);
      if (!read) {
        read = bounded(this.options.storage.read(scopedKey), 200).catch(() => undefined);
        this.diskReads.set(scopedKey, read);
        while (this.diskReads.size > 128) this.diskReads.delete(this.diskReads.keys().next().value!);
      }
      cached = await read;
      if (cached?.key === scopedKey && Number.isFinite(cached.savedAt)) this.values.set(scopedKey, cached);
      else cached = undefined;
    }
    if (cached) {
      options.onCached?.(cached.value as T);
      if (now() - cached.savedAt < options.maxAgeMs) return cached.value as T;
    }
    const failure = this.failures.get(scopedKey);
    if (failure && failure.until > now()) throw failure.error;
    let request = this.pending.get(scopedKey);
    if (!request) {
      request = this.schedule(() => bounded(load(), this.options.timeoutMs ?? 5_000)).then(value => {
        const row = { key: scopedKey, value, savedAt: now() };
        this.values.delete(scopedKey);
        this.values.set(scopedKey, row);
        this.failures.delete(scopedKey);
        while (this.values.size > 128) this.values.delete(this.values.keys().next().value!);
        if (this.options.storage && options.persist !== false && JSON.stringify(value).length <= 1024 * 1024) {
          void this.options.storage.write(row).catch(() => {});
        }
        return value;
      }).catch(error => {
        this.failures.set(scopedKey, { until: now() + 30_000, error });
        while (this.failures.size > 128) this.failures.delete(this.failures.keys().next().value!);
        throw error;
      }).finally(() => this.pending.delete(scopedKey));
      this.pending.set(scopedKey, request);
    }
    return request as Promise<T>;
  }

  private schedule<T>(work: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.active++;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.active--;
          this.queue.shift()?.();
        });
      };
      if (this.active < 4) run(); else this.queue.push(run);
    });
  }
}
