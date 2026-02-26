function resolveLocalStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: Storage }).localStorage) {
    return (globalThis as { localStorage?: Storage }).localStorage || null;
  }
  return null;
}

export function loadLocalStorageJson<T>(
  key: string,
  fallback: T,
  normalize?: (value: unknown) => T,
): T {
  const storage = resolveLocalStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(String(key || '').trim());
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return normalize ? normalize(parsed) : (parsed as T);
  } catch {
    return fallback;
  }
}

export function saveLocalStorageJson(key: string, value: unknown): boolean {
  const storage = resolveLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(String(key || '').trim(), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorageKey(key: string): boolean {
  const storage = resolveLocalStorage();
  if (!storage) return false;
  try {
    storage.removeItem(String(key || '').trim());
    return true;
  } catch {
    return false;
  }
}

export function loadStorageJsonFrom(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  key: string,
): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(String(key || '').trim());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveStorageJsonTo(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  key: string,
  value: unknown,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(String(key || '').trim(), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
