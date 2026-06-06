import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aiConfigScopeKeyFromRef,
  cloneAIConfig,
  createAIConfigSubscriptionRegistry,
  createScopedAIConfigStore,
  parseAIConfig,
  parseAIConfigScopeKey,
  validateAIConfigCompactRefsForHost,
  validateAIProfileCompactRefsForHost,
  type AIConfig,
  type AIProfile,
} from '../src/ai/index.js';

const SCOPE = { kind: 'app', ownerId: 'dev.nimi.tester', surfaceId: 'app-lab' } as const;

const CONFIG: AIConfig = {
  scopeRef: SCOPE,
  capabilities: {
    targetRefs: {
      'text.generate': {
        kind: 'local_runtime_target_ref',
        targetId: 'target-chat',
        profileId: 'profile-chat',
      },
    },
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
      targetRefs: CONFIG.capabilities.targetRefs,
    },
  }, {
    scopeRef: SCOPE,
    validateCompactRefs: true,
  });

  assert.deepEqual(parsed.capabilities.targetRefs, CONFIG.capabilities.targetRefs);
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

test('host AIConfig helpers validate compact refs and reject Runtime route bindings', () => {
  const invalidConfig: AIConfig = {
    ...CONFIG,
    capabilities: {
      ...CONFIG.capabilities,
      targetRefs: {
        'text.generate': {
          kind: 'cloud_connector_target_ref',
          connectorId: '',
          providerModelId: '',
        },
      },
    },
  };
  assert.deepEqual(validateAIConfigCompactRefsForHost(CONFIG), []);
  assert.match(validateAIConfigCompactRefsForHost(invalidConfig).join('\n'), /connectorId is required/);
  assert.match(validateAIConfigCompactRefsForHost(invalidConfig).join('\n'), /providerModelId is required/);

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
  } as unknown as AIProfile;
  assert.match(validateAIProfileCompactRefsForHost(profile).join('\n'), /binding is forbidden/);
});

test('host AIConfig subscription registry can isolate subscribers with cloned payloads', () => {
  const registry = createAIConfigSubscriptionRegistry({ cloneOnNotify: true });
  const received: AIConfig[] = [];
  const unsubscribe = registry.subscribe(aiConfigScopeKeyFromRef(SCOPE), (config) => {
    received.push(config);
    delete config.capabilities.targetRefs['text.generate'];
  });

  registry.notify(CONFIG);
  unsubscribe();
  registry.notify(CONFIG);

  assert.equal(received.length, 1);
  assert.notEqual(received[0], CONFIG);
  assert.deepEqual(cloneAIConfig(CONFIG), CONFIG);
  assert.deepEqual(CONFIG.capabilities.targetRefs['text.generate'], {
    kind: 'local_runtime_target_ref',
    targetId: 'target-chat',
    profileId: 'profile-chat',
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
    validateCompactRefs: true,
  });

  assert.equal(store.has(SCOPE), false);
  assert.deepEqual(store.load(SCOPE), {
    scopeRef: SCOPE,
    capabilities: {
      targetRefs: {},
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

test('scoped AIConfig store supports app-specific storage keys and explicit ephemeral store', () => {
  const store = createScopedAIConfigStore({
    storage: () => null,
    configKeyForScope: () => 'single-app-key',
    enableEphemeralStore: true,
  });

  assert.deepEqual(store.listScopeKeys(), []);
  store.save(CONFIG);
  assert.deepEqual(store.listScopeKeys(), [aiConfigScopeKeyFromRef(SCOPE)]);
  assert.deepEqual(store.load(SCOPE), CONFIG);
});

test('scoped AIConfig store fails closed without storage or explicit ephemeral store', () => {
  const store = createScopedAIConfigStore({
    storage: () => null,
  });

  assert.throws(
    () => store.has(SCOPE),
    /AIConfig store has requires host storage or explicit enableEphemeralStore=true/,
  );
  assert.throws(
    () => store.load(SCOPE),
    /AIConfig store load requires host storage or explicit enableEphemeralStore=true/,
  );
  assert.throws(
    () => store.save(CONFIG),
    /AIConfig store save requires host storage or explicit enableEphemeralStore=true/,
  );
  assert.throws(
    () => store.listScopeKeys(),
    /AIConfig store listScopeKeys requires host storage or explicit enableEphemeralStore=true/,
  );
});

test('scoped AIConfig store fails closed on malformed runtime bindings', () => {
  const storage = createMemoryStorage({
    'test:app:dev.nimi.tester:app-lab': JSON.stringify({
      ...CONFIG,
      capabilities: {
        targetRefs: {
          'text.generate': {
            kind: 'local_runtime_target_ref',
            targetId: '/Users/snwozy/private-model',
          },
        },
      },
    }),
  });
  const store = createScopedAIConfigStore({
    storage: () => storage,
    configKeyForScope: (scopeKey) => `test:${scopeKey}`,
    validateCompactRefs: true,
  });

  assert.throws(() => store.load(SCOPE), /AIConfig binding is invalid: .*portable non-path/);
});
