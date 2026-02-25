function resolveLocalStorage() {
    if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
        return globalThis.localStorage || null;
    }
    return null;
}
export function loadLocalStorageJson(key, fallback, normalize) {
    const storage = resolveLocalStorage();
    if (!storage)
        return fallback;
    try {
        const raw = storage.getItem(String(key || '').trim());
        if (!raw)
            return fallback;
        const parsed = JSON.parse(raw);
        return normalize ? normalize(parsed) : parsed;
    }
    catch {
        return fallback;
    }
}
export function saveLocalStorageJson(key, value) {
    const storage = resolveLocalStorage();
    if (!storage)
        return false;
    try {
        storage.setItem(String(key || '').trim(), JSON.stringify(value));
        return true;
    }
    catch {
        return false;
    }
}
export function removeLocalStorageKey(key) {
    const storage = resolveLocalStorage();
    if (!storage)
        return false;
    try {
        storage.removeItem(String(key || '').trim());
        return true;
    }
    catch {
        return false;
    }
}
export function loadStorageJsonFrom(storage, key) {
    if (!storage)
        return null;
    try {
        const raw = storage.getItem(String(key || '').trim());
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function saveStorageJsonTo(storage, key, value) {
    if (!storage)
        return false;
    try {
        storage.setItem(String(key || '').trim(), JSON.stringify(value));
        return true;
    }
    catch {
        return false;
    }
}
