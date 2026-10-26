import { useSyncExternalStore } from 'react';

export type DownloadHistoryRecord = { readonly key: string; readonly revision: string };
export type DownloadHistoryEntries = Readonly<Record<string, string>>;
const STORAGE_KEY = 'nimi:downloads:removed-history:v1';

export function downloadHistoryRecord(kind: 'setup' | 'model' | 'environment' | 'app', id: string, state: string | number, updatedAt: string): DownloadHistoryRecord {
  return { key: `${kind}:${id}`, revision: JSON.stringify([state, updatedAt]) };
}

export function isDownloadHistoryRemoved(entries: DownloadHistoryEntries, record: DownloadHistoryRecord): boolean {
  return entries[record.key] === record.revision;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.global-downloads
/** Home presentation preferences only. No execution owner or resource is mutated. */
export function createDownloadHistoryStore(scope: string, storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const key = `${STORAGE_KEY}:${scope}`;
  const resolveStorage = () => storage ?? window.localStorage;
  const read = (): DownloadHistoryEntries => {
    const raw = resolveStorage().getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Object.values(parsed).every(value => typeof value === 'string')) {
      throw new Error('Invalid download history preferences');
    }
    return parsed as DownloadHistoryEntries;
  };
  let snapshot: { entries: DownloadHistoryEntries; readFailed: boolean };
  try { snapshot = { entries: scope ? read() : {}, readFailed: false }; }
  catch { snapshot = { entries: {}, readFailed: true }; }
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    remove(records: readonly DownloadHistoryRecord[]) {
      if (!scope) throw new Error('Download history scope is unavailable');
      const entries = { ...read() };
      for (const record of records) entries[record.key] = record.revision;
      // Publish only after a successful durable write; quota/access errors keep rows visible.
      resolveStorage().setItem(key, JSON.stringify(entries));
      snapshot = { entries, readFailed: false };
      for (const listener of listeners) listener();
    },
  };
}

export function useDownloadHistory(store: ReturnType<typeof createDownloadHistoryStore>) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
