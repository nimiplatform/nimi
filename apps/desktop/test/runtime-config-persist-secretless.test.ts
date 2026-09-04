import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultStateV11,
  RUNTIME_CONFIG_STORAGE_KEY_V13,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import { persistRuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-persist';
import { createConnectorV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';

test('persistRuntimeConfigStateV11 does not persist connectors to localStorage', () => {
  // Set up in-memory localStorage
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: () => null,
  };

  try {
    const state = createDefaultStateV11();

    const connector = {
      ...createConnectorV11('gemini', 'Gemini'),
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    };

    state.connectors = [connector];
    state.selectedConnectorId = connector.id;

    persistRuntimeConfigStateV11(state);

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V13);
    assert.ok(raw, 'localStorage should contain persisted state');

    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 13, 'persisted snapshot should use the current schema');
    assert.equal(parsed.connectors, undefined, 'connectors must not be persisted to localStorage');
    assert.equal(parsed.selectedConnectorId, undefined, 'selectedConnectorId must not be persisted');
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});
