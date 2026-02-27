import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultStateV11, RUNTIME_CONFIG_STORAGE_KEY_V11 } from '../src/shell/renderer/features/runtime-config/state/v11/storage/defaults';
import { persistRuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/state/v11/storage/persist';
import { createConnectorV11 } from '../src/shell/renderer/features/runtime-config/state/v11/types';

test('persisted state does not contain tokenApiKey or localOpenAiApiKey (type-level)', () => {
  const state = createDefaultStateV11({
    provider: 'local-runtime',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'local-model',
    localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
    credentialRefId: '',
  });

  const connector = createConnectorV11('gemini', 'Gemini');
  connector.endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
  state.connectors = [connector];
  state.selectedConnectorId = connector.id;

  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes('"tokenApiKey"'), 'serialized state must not contain tokenApiKey');
  assert.ok(!serialized.includes('"localOpenAiApiKey"'), 'serialized state must not contain localOpenAiApiKey');

  for (const c of state.connectors) {
    assert.ok(!('tokenApiKey' in c), `connector ${c.id} must not have tokenApiKey property`);
  }
});

test('persistRuntimeConfigStateV11 strips runtime-injected tokenApiKey from connectors', () => {
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
    const state = createDefaultStateV11({
      provider: 'local-runtime',
      runtimeModelType: 'chat',
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'local-model',
      localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
      credentialRefId: '',
    });

    const connector = createConnectorV11('gemini', 'Gemini');
    connector.endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';

    // Simulate runtime-injected legacy field (bypasses TypeScript type removal)
    (connector as Record<string, unknown>).tokenApiKey = 'sk-leaked-secret-key';

    state.connectors = [connector];
    state.selectedConnectorId = connector.id;

    persistRuntimeConfigStateV11(state);

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V11);
    assert.ok(raw, 'localStorage should contain persisted state');
    assert.ok(!raw.includes('"tokenApiKey"'), 'persisted JSON must not contain tokenApiKey field');
    assert.ok(!raw.includes('sk-leaked-secret-key'), 'persisted JSON must not contain the secret value');

    const parsed = JSON.parse(raw);
    for (const c of parsed.connectors) {
      assert.ok(!('tokenApiKey' in c), `persisted connector ${c.id} must not have tokenApiKey`);
    }
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});
