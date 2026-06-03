import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAISnapshotRecord,
  createScopedAISnapshotStore,
  type AIConfig,
} from '../src/ai/index.js';

const SCOPE = { kind: 'app', ownerId: 'dev.nimi.tester', surfaceId: 'app-lab' } as const;
const OTHER_SCOPE = { kind: 'app', ownerId: 'dev.nimi.other', surfaceId: 'lab' } as const;

const CONFIG: AIConfig = {
  scopeRef: SCOPE,
  capabilities: {
    selectedBindings: {
      'text.generate': {
        source: 'local',
        connectorId: '',
        model: 'local-chat',
      },
    },
    localProfileRefs: {},
    selectedParams: {},
  },
  profileOrigin: null,
};

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

test('scoped AISnapshot store persists host snapshots and latest-by-scope lookup', () => {
  const storage = createMemoryStorage();
  const store = createScopedAISnapshotStore({
    storage: () => storage,
    indexKey: 'snapshot:index',
    snapshotKeyForExecution: (executionId) => `snapshot:${executionId}`,
    maxSnapshots: 3,
  });
  const first = createAISnapshotRecord({
    executionId: 'exec-1',
    createdAt: '2026-06-02T00:00:00.000Z',
    config: CONFIG,
    capability: 'text.generate',
    selectedBinding: CONFIG.capabilities.selectedBindings['text.generate'] ?? null,
  });
  const second = createAISnapshotRecord({
    executionId: 'exec-2',
    createdAt: '2026-06-02T00:00:01.000Z',
    config: CONFIG,
    capability: 'text.generate',
    selectedBinding: CONFIG.capabilities.selectedBindings['text.generate'] ?? null,
  });

  assert.deepEqual(store.record(first), first);
  store.record(second);

  assert.deepEqual(store.listExecutionIds(), ['exec-1', 'exec-2']);
  assert.deepEqual(store.get('exec-1'), first);
  assert.deepEqual(store.getLatest(SCOPE), second);
  assert.match(storage.snapshot()['snapshot:index'], /exec-2/);
});

test('scoped AISnapshot store evicts from the active index without treating stale records as live', () => {
  const storage = createMemoryStorage();
  const store = createScopedAISnapshotStore({
    storage: () => storage,
    indexKey: 'snapshot:index',
    snapshotKeyForExecution: (executionId) => `snapshot:${executionId}`,
    maxSnapshots: 2,
  });
  for (let index = 1; index <= 3; index += 1) {
    store.record(createAISnapshotRecord({
      executionId: `exec-${index}`,
      createdAt: `2026-06-02T00:00:0${index}.000Z`,
      config: CONFIG,
      capability: 'text.generate',
      selectedBinding: CONFIG.capabilities.selectedBindings['text.generate'] ?? null,
    }));
  }

  assert.deepEqual(store.listExecutionIds(), ['exec-2', 'exec-3']);
  assert.equal(store.get('exec-1'), null);
  assert.equal(storage.getItem('snapshot:exec-1') !== null, true);
});

test('scoped AISnapshot store keeps latest lookup scoped', () => {
  const store = createScopedAISnapshotStore({
    storage: () => null,
    enableEphemeralStore: true,
  });
  const otherConfig: AIConfig = { ...CONFIG, scopeRef: OTHER_SCOPE };
  const first = createAISnapshotRecord({
    executionId: 'scope-1',
    config: CONFIG,
    capability: 'text.generate',
    selectedBinding: CONFIG.capabilities.selectedBindings['text.generate'] ?? null,
  });
  const second = createAISnapshotRecord({
    executionId: 'scope-2',
    config: otherConfig,
    capability: 'text.generate',
    selectedBinding: CONFIG.capabilities.selectedBindings['text.generate'] ?? null,
  });

  store.record(first);
  store.record(second);

  assert.deepEqual(store.getLatest(SCOPE), first);
  assert.deepEqual(store.getLatest(OTHER_SCOPE), second);
});

test('scoped AISnapshot store fails closed without storage or explicit ephemeral store', () => {
  const store = createScopedAISnapshotStore({
    storage: () => null,
  });
  const snapshot = createAISnapshotRecord({
    executionId: 'exec',
    config: CONFIG,
    capability: 'text.generate',
    selectedBinding: CONFIG.capabilities.selectedBindings['text.generate'] ?? null,
  });

  assert.throws(
    () => store.record(snapshot),
    /AISnapshot store record requires host storage or explicit enableEphemeralStore=true/,
  );
  assert.throws(
    () => store.get('exec'),
    /AISnapshot store get requires host storage or explicit enableEphemeralStore=true/,
  );
  assert.throws(
    () => store.getLatest(SCOPE),
    /AISnapshot store getLatest requires host storage or explicit enableEphemeralStore=true/,
  );
  assert.throws(
    () => store.listExecutionIds(),
    /AISnapshot store listExecutionIds requires host storage or explicit enableEphemeralStore=true/,
  );
});
