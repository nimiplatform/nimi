export type BrowserStorageKind = 'local' | 'session';

export type StorageJsonReadState = 'ready' | 'missing' | 'unavailable' | 'corrupt' | 'read-error';

export type StorageJsonReadResult<T = unknown> =
  | {
      readonly state: 'ready';
      readonly value: T;
      readonly raw: string;
    }
  | {
      readonly state: Exclude<StorageJsonReadState, 'ready'>;
      readonly value: null;
      readonly error?: string;
    };

export type StorageJsonWriteResult =
  | { readonly state: 'saved' }
  | { readonly state: 'unavailable' | 'write-error'; readonly error?: string };

export type StorageKeyRemoveResult =
  | { readonly state: 'removed' }
  | { readonly state: 'unavailable' | 'write-error'; readonly error?: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown storage error.');
}

function normalizeKey(key: unknown): string {
  return String(key || '').trim();
}

export function resolveBrowserStorage(kind: BrowserStorageKind = 'local'): Storage | null {
  const key = kind === 'session' ? 'sessionStorage' : 'localStorage';
  try {
    if (typeof window !== 'undefined' && window[key]) {
      return window[key] || null;
    }
    if (typeof globalThis !== 'undefined') {
      return (globalThis as typeof globalThis & {
        localStorage?: Storage;
        sessionStorage?: Storage;
      })[key] || null;
    }
  } catch {
    return null;
  }
  return null;
}

export function readStorageJsonFrom<T = unknown>(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  key: string,
  normalize?: (value: unknown) => T,
): StorageJsonReadResult<T> {
  if (!storage) {
    return { state: 'unavailable', value: null };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(normalizeKey(key));
  } catch (error) {
    return { state: 'read-error', value: null, error: errorMessage(error) };
  }

  if (!raw) {
    return { state: 'missing', value: null };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      state: 'ready',
      value: normalize ? normalize(parsed) : (parsed as T),
      raw,
    };
  } catch (error) {
    return { state: 'corrupt', value: null, error: errorMessage(error) };
  }
}

export function writeStorageJsonTo(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  key: string,
  value: unknown,
): StorageJsonWriteResult {
  if (!storage) {
    return { state: 'unavailable' };
  }
  try {
    storage.setItem(normalizeKey(key), JSON.stringify(value));
    return { state: 'saved' };
  } catch (error) {
    return { state: 'write-error', error: errorMessage(error) };
  }
}

export function removeStorageKeyFrom(
  storage: Pick<Storage, 'removeItem'> | null | undefined,
  key: string,
): StorageKeyRemoveResult {
  if (!storage) {
    return { state: 'unavailable' };
  }
  try {
    storage.removeItem(normalizeKey(key));
    return { state: 'removed' };
  } catch (error) {
    return { state: 'write-error', error: errorMessage(error) };
  }
}
