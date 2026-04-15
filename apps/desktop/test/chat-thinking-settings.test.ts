import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_CHAT_BEHAVIOR_SETTINGS_STORAGE_KEY,
  CHAT_THINKING_PREFERENCE_STORAGE_KEY,
  loadStoredAgentChatExperienceSettings,
  loadStoredChatThinkingPreference,
  persistStoredAgentChatExperienceSettings,
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

test('agent chat behavior settings persist as one canonical feature-local record', () => {
  const previousStorage = globalThis.localStorage;
  const localStorageMock = createStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });

  try {
    assert.deepEqual(loadStoredAgentChatExperienceSettings(), {
      thinkingPreference: 'off',
      maxOutputTokensOverride: null,
    });

    persistStoredAgentChatExperienceSettings({
      thinkingPreference: 'on',
      maxOutputTokensOverride: null,
    });

    assert.deepEqual(JSON.parse(localStorageMock.getItem(AGENT_CHAT_BEHAVIOR_SETTINGS_STORAGE_KEY) || 'null'), {
      thinkingPreference: 'on',
      maxOutputTokensOverride: null,
    });
    assert.equal(localStorageMock.getItem(CHAT_THINKING_PREFERENCE_STORAGE_KEY), 'on');
    assert.deepEqual(loadStoredAgentChatExperienceSettings(), {
      thinkingPreference: 'on',
      maxOutputTokensOverride: null,
    });
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    });
  }
});

test('agent chat behavior settings migrate the legacy thinking preference when no unified record exists', () => {
  const previousStorage = globalThis.localStorage;
  const localStorageMock = createStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });

  try {
    localStorageMock.setItem(CHAT_THINKING_PREFERENCE_STORAGE_KEY, 'on');
    assert.deepEqual(loadStoredAgentChatExperienceSettings(), {
      thinkingPreference: 'on',
      maxOutputTokensOverride: null,
    });
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    });
  }
});
