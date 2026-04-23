import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AGENT_AVATAR_LAUNCH_POLICY,
  loadStoredAgentAvatarLaunchPolicy,
  persistStoredAgentAvatarLaunchPolicy,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-launch-policy-storage.js';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  const globalRecord = globalThis as Record<string, unknown>;
  const previousWindow = globalRecord.window;
  const previousLocalStorage = globalRecord.localStorage;
  globalRecord.localStorage = storage;
  globalRecord.window = { localStorage: storage };
  return () => {
    if (typeof previousLocalStorage === 'undefined') {
      delete globalRecord.localStorage;
    } else {
      globalRecord.localStorage = previousLocalStorage;
    }
    if (typeof previousWindow === 'undefined') {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
  };
}

test('agent avatar launch policy storage falls back to defaults', () => {
  const restore = installLocalStorageMock();
  try {
    assert.deepEqual(
      loadStoredAgentAvatarLaunchPolicy('agent-1'),
      DEFAULT_AGENT_AVATAR_LAUNCH_POLICY,
    );
  } finally {
    restore();
  }
});

test('agent avatar launch policy storage persists per agent', () => {
  const restore = installLocalStorageMock();
  try {
    persistStoredAgentAvatarLaunchPolicy('agent-1', {
      defaultLaunchTarget: 'new',
      autoRefreshLiveInventory: false,
    });

    assert.deepEqual(loadStoredAgentAvatarLaunchPolicy('agent-1'), {
      defaultLaunchTarget: 'new',
      autoRefreshLiveInventory: false,
    });
    assert.deepEqual(
      loadStoredAgentAvatarLaunchPolicy('agent-2'),
      DEFAULT_AGENT_AVATAR_LAUNCH_POLICY,
    );
  } finally {
    restore();
  }
});
