import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SETTINGS_SELECTED_STORAGE_KEY,
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from '../src/shell/renderer/features/settings/settings-storage.js';

function installMemoryLocalStorage(seed: Record<string, string> = {}): void {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
}

function clearMemoryLocalStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

test('settings selected storage admits about-legal and rejects stale direct legal selections', () => {
  installMemoryLocalStorage({
    [SETTINGS_SELECTED_STORAGE_KEY]: 'about-legal',
  });
  try {
    assert.equal(loadStoredSettingsSelected('profile'), 'about-legal');

    persistStoredSettingsSelected('privacy-policy');
    assert.equal(loadStoredSettingsSelected('profile'), 'profile');

    persistStoredSettingsSelected('terms-of-service');
    assert.equal(loadStoredSettingsSelected('profile'), 'profile');
  } finally {
    clearMemoryLocalStorage();
  }
});
