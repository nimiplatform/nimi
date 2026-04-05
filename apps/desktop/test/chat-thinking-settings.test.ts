import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAT_THINKING_PREFERENCE_STORAGE_KEY,
  loadStoredChatThinkingPreference,
  persistStoredChatThinkingPreference,
} from '../src/shell/renderer/features/chat/chat-settings-storage.js';

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) || null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] || null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

test('chat thinking settings persist globally with off as the default', () => {
  const previousStorage = globalThis.localStorage;
  const localStorageMock = createStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });

  try {
    assert.equal(loadStoredChatThinkingPreference(), 'off');
    persistStoredChatThinkingPreference('on');
    assert.equal(localStorageMock.getItem(CHAT_THINKING_PREFERENCE_STORAGE_KEY), 'on');
    assert.equal(loadStoredChatThinkingPreference(), 'on');

    localStorageMock.setItem(CHAT_THINKING_PREFERENCE_STORAGE_KEY, 'invalid');
    assert.equal(loadStoredChatThinkingPreference(), 'off');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    });
  }
});
