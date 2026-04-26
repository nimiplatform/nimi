function installMemoryLocalStorage(): void {
  if (typeof window === 'undefined') return;
  if (typeof window.localStorage?.clear === 'function') return;

  const store = new Map<string, string>();
  const localStorage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorage,
  });
}

installMemoryLocalStorage();
