import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aiConfigScopeKeyFromRef,
  cloneAIConfig,
  createAIConfigSubscriptionRegistry,
  createScopedAIConfigStore,
  parseAIConfig,
  parseAIConfigScopeKey,
  validateAIConfigRuntimeBindings,
  validateAIProfileRuntimeBindings,
  type AIConfig,
  type AIProfile,
} from '../src/ai/index.js';

const SCOPE = { kind: 'app', ownerId: 'dev.nimi.tester', surfaceId: 'app-lab' } as const;

const CONFIG: AIConfig = {
  scopeRef: SCOPE,
  capabilities: {
    selectedBindings: {
      'text.generate': {
        source: 'local',
        connectorId: '',
        model: 'local-chat',
        modelId: 'local-chat',
      },
    },
    localProfileRefs: {},
    selectedParams: {},
  },
  profileOrigin: null,
};

test('host AIConfig helpers encode and parse AIScopeRef keys', () => {
  const key = aiConfigScopeKeyFromRef(SCOPE);
  assert.equal(key, 'app:dev.nimi.tester:app-lab');
  assert.deepEqual(parseAIConfigScopeKey(key), SCOPE);
  assert.equal(parseAIConfigScopeKey('app:missing'), null);
});

test('host AIConfig parser normalizes scope-bound configs', () => {
  const parsed = parseAIConfig({
    ...CONFIG,
    capabilities: {
      selectedBindings: CONFIG.capabilities.selectedBindings,
    },
  }, {
    scopeRef: SCOPE,
    validateRuntimeBindings: true,
  });

  assert.deepEqual(parsed.capabilities.localProfileRefs, {});
  assert.deepEqual(parsed.capabilities.selectedParams, {});
  assert.throws(() =>
    parseAIConfig({
      ...CONFIG,
      scopeRef: { kind: 'app', ownerId: 'other' },
    }, {
      scopeRef: SCOPE,
    }),
  /AIConfig schema is invalid/);
});

test('host AIConfig helpers validate Runtime route bindings', () => {
  const invalidConfig: AIConfig = {
    ...CONFIG,
    capabilities: {
      ...CONFIG.capabilities,
      selectedBindings: {
        'text.generate': {
          source: 'cloud',
          connectorId: '',
          model: '',
        },
      },
    },
  };
  assert.deepEqual(validateAIConfigRuntimeBindings(CONFIG), []);
  assert.match(validateAIConfigRuntimeBindings(invalidConfig).join('\n'), /connectorId is required/);
  assert.match(validateAIConfigRuntimeBindings(invalidConfig).join('\n'), /model is required/);

  const profile: AIProfile = {
    profileId: 'bad-profile',
    title: 'Bad profile',
    description: '',
    tags: [],
    capabilities: {
      'text.generate': {
        binding: {
          source: 'local',
          connectorId: 'not-empty',
          model: 'local-chat',
        },
      },
    },
  };
  assert.match(validateAIProfileRuntimeBindings(profile).join('\n'), /connectorId must be empty/);
});

test('host AIConfig subscription registry can isolate subscribers with cloned payloads', () => {
  const registry = createAIConfigSubscriptionRegistry({ cloneOnNotify: true });
  const received: AIConfig[] = [];
  const unsubscribe = registry.subscribe(aiConfigScopeKeyFromRef(SCOPE), (config) => {
    received.push(config);
    config.capabilities.selectedBindings['text.generate'] = null;
  });

  registry.notify(CONFIG);
  unsubscribe();
  registry.notify(CONFIG);

  assert.equal(received.length, 1);
  assert.notEqual(received[0], CONFIG);
  assert.deepEqual(cloneAIConfig(CONFIG), CONFIG);
  assert.deepEqual(CONFIG.capabilities.selectedBindings['text.generate'], {
    source: 'local',
    connectorId: '',
    model: 'local-chat',
    modelId: 'local-chat',
  });
});

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    snapshot() {
      return Object.fromEntries(values.entries());
    },
  };
}

test('scoped AIConfig store persists by host-provided scope keys and index', () => {
  const storage = createMemoryStorage();
  const store = createScopedAIConfigStore({
    storage: () => storage,
    indexKey: 'test:index',
    configKeyForScope: (scopeKey) => `test:${scopeKey}`,
    validateRuntimeBindings: true,
  });

  assert.equal(store.has(SCOPE), false);
  assert.deepEqual(store.load(SCOPE), {
    scopeRef: SCOPE,
    capabilities: {
      selectedBindings: {},
      localProfileRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  });

  const saved = store.save(CONFIG);
  assert.deepEqual(saved, CONFIG);
  assert.equal(store.has(SCOPE), true);
  assert.deepEqual(store.listScopeKeys(), [aiConfigScopeKeyFromRef(SCOPE)]);
  assert.deepEqual(store.load(SCOPE), CONFIG);
  assert.match(storage.snapshot()['test:index'], /app:dev\.nimi\.tester:app-lab/);
});

test('scoped AIConfig store supports app-specific storage keys and memory fallback', () => {
  const store = createScopedAIConfigStore({
    storage: () => null,
    configKeyForScope: () => 'single-app-key',
    memoryFallback: true,
  });

  assert.deepEqual(store.listScopeKeys(), []);
  store.save(CONFIG);
  assert.deepEqual(store.listScopeKeys(), [aiConfigScopeKeyFromRef(SCOPE)]);
  assert.deepEqual(store.load(SCOPE), CONFIG);
});

test('scoped AIConfig store fails closed on malformed runtime bindings', () => {
  const storage = createMemoryStorage({
    'test:app:dev.nimi.tester:app-lab': JSON.stringify({
      ...CONFIG,
      capabilities: {
        selectedBindings: {
          'text.generate': {
            source: 'local',
            connectorId: 'not-empty',
            model: 'local-chat',
          },
        },
      },
    }),
  });
  const store = createScopedAIConfigStore({
    storage: () => storage,
    configKeyForScope: (scopeKey) => `test:${scopeKey}`,
    validateRuntimeBindings: true,
  });

  assert.throws(() => store.load(SCOPE), /AIConfig binding is invalid: .*connectorId.*local/);
});
