const STORAGE_PREFIX = 'nimi.desktop.';

export class RuntimeStorage {
  static get<T = unknown>(key: string, defaultValue: T | null = null): T | null {
    try {
      const item = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
      if (item === null) return defaultValue;
      return JSON.parse(item) as T;
    } catch {
      return defaultValue;
    }
  }

  static set(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  static remove(key: string): boolean {
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      return true;
    } catch {
      return false;
    }
  }

  static clear(): boolean {
    try {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(STORAGE_PREFIX));
      keys.forEach((key) => localStorage.removeItem(key));
      return true;
    } catch {
      return false;
    }
  }
}
