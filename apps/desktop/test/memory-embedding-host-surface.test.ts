import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanonicalModAIScopeRef,
  createDefaultAIScopeRef,
  createEmptyMemoryEmbeddingConfig,
  type AIScopeRef,
  type MemoryEmbeddingConfig,
} from '@nimiplatform/sdk/mod';

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

async function loadMemoryEmbeddingModules() {
  const storage = await import('../src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-storage.js');
  const service = await import('../src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.js');
  return {
    ...storage,
    ...service,
  };
}

test('desktop memory embedding storage round-trips adjacent config by scope', async () => {
  const previousLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createStorageMock(),
  });

  try {
    const {
      loadMemoryEmbeddingConfigForScope,
      persistMemoryEmbeddingConfigForScope,
      listPersistedMemoryEmbeddingScopeKeys,
      scopeKeyFromRef,
    } = await loadMemoryEmbeddingModules();
    const scopeRef = createCanonicalModAIScopeRef('world.nimi.desktop.memory.storage');
    const config: MemoryEmbeddingConfig = {
      ...createEmptyMemoryEmbeddingConfig(scopeRef),
      sourceKind: 'cloud',
      bindingRef: {
        kind: 'cloud',
        connectorId: 'conn-memory',
        modelId: 'gemini-embedding-001',
      },
    };

    persistMemoryEmbeddingConfigForScope(config);

    const restored = loadMemoryEmbeddingConfigForScope(scopeRef);
    assert.deepEqual(restored.scopeRef, scopeRef);
    assert.equal(restored.sourceKind, 'cloud');
    assert.deepEqual(restored.bindingRef, config.bindingRef);
    assert.deepEqual(listPersistedMemoryEmbeddingScopeKeys(), [scopeKeyFromRef(scopeRef)]);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousLocalStorage,
    });
  }
});

test('desktop memory embedding service exposes fail-closed runtime state for configured scope', async () => {
  const previousLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createStorageMock(),
  });

  try {
    const { getDesktopMemoryEmbeddingConfigService } = await loadMemoryEmbeddingModules();
    const service = getDesktopMemoryEmbeddingConfigService();
    const scopeRef: AIScopeRef = createDefaultAIScopeRef();
    const request = {
      scopeRef,
      targetRef: {
        kind: 'agent-core' as const,
        agentId: 'agent-local-1',
      },
    };
    const updates: MemoryEmbeddingConfig[] = [];

    const unsubscribe = service.memoryEmbeddingConfig.subscribe(scopeRef, (config) => {
      updates.push(config);
    });
    service.memoryEmbeddingConfig.update(scopeRef, {
      ...createEmptyMemoryEmbeddingConfig(scopeRef),
      sourceKind: 'local',
      bindingRef: {
        kind: 'local',
        targetId: 'nomic-embed-local',
      },
    });

    const config = service.memoryEmbeddingConfig.get(scopeRef);
    const inspect = await service.memoryEmbeddingRuntime.inspect(request);
    const bind = await service.memoryEmbeddingRuntime.requestBind(request);
    const cutover = await service.memoryEmbeddingRuntime.requestCutover(request);
    unsubscribe();

    assert.equal(updates.length, 1);
    assert.equal(config.sourceKind, 'local');
    assert.deepEqual(config.bindingRef, {
      kind: 'local',
      targetId: 'nomic-embed-local',
    });
    assert.equal(inspect.bindingIntentPresent, true);
    assert.equal(inspect.bindingSourceKind, 'local');
    assert.equal(inspect.resolutionState, 'unavailable');
    assert.equal(inspect.canonicalBankStatus, 'unbound');
    assert.equal(bind.outcome, 'rejected');
    assert.equal(bind.pendingCutover, false);
    assert.equal(cutover.outcome, 'not_ready');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousLocalStorage,
    });
  }
});
