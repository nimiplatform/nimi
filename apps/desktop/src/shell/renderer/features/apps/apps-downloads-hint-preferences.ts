const APPS_DOWNLOADS_HINT_STORAGE_KEY = 'nimi.apps.downloads-hint.v1';

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDownloadsHintDismissed(storage: Storage | null = defaultStorage()): boolean {
  return storage?.getItem(APPS_DOWNLOADS_HINT_STORAGE_KEY) === 'dismissed';
}

export function dismissDownloadsHint(storage: Storage | null = defaultStorage()): void {
  storage?.setItem(APPS_DOWNLOADS_HINT_STORAGE_KEY, 'dismissed');
}
