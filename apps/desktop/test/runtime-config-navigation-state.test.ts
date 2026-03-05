import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePageIdV11 } from '../src/shell/renderer/features/runtime-config/state/types/modality';
import { createDefaultStateV11, RUNTIME_CONFIG_STORAGE_KEY_V11 } from '../src/shell/renderer/features/runtime-config/state/storage/defaults';
import { normalizeStoredStateV11 } from '../src/shell/renderer/features/runtime-config/state/storage/normalize';
import { persistRuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/state/storage/persist';
import { RUNTIME_PAGE_META } from '../src/shell/renderer/features/runtime-config/runtime-config-meta-v11';

// ---------------------------------------------------------------------------
// normalizePageIdV11
// ---------------------------------------------------------------------------

test('normalizePageIdV11: current values pass through unchanged', () => {
  assert.equal(normalizePageIdV11('overview'), 'overview');
  assert.equal(normalizePageIdV11('local'), 'local');
  assert.equal(normalizePageIdV11('cloud'), 'cloud');
  assert.equal(normalizePageIdV11('catalog'), 'catalog');
  assert.equal(normalizePageIdV11('runtime'), 'runtime');
  assert.equal(normalizePageIdV11('mods'), 'mods');
});

test('normalizePageIdV11: unknown values fall back to "overview"', () => {
  assert.equal(normalizePageIdV11(''), 'overview');
  assert.equal(normalizePageIdV11(null), 'overview');
  assert.equal(normalizePageIdV11(undefined), 'overview');
  assert.equal(normalizePageIdV11(42), 'overview');
  assert.equal(normalizePageIdV11('nonexistent'), 'overview');
  assert.equal(normalizePageIdV11({}), 'overview');
});

// ---------------------------------------------------------------------------
// createDefaultStateV11
// ---------------------------------------------------------------------------

test('createDefaultStateV11: activePage defaults to "overview"', () => {
  const state = createDefaultStateV11({
    provider: 'local-runtime',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
  });

  assert.equal(state.activePage, 'overview');
  assert.equal(state.version, 11);
});

test('createDefaultStateV11: state shape keeps current navigation field only', () => {
  const state = createDefaultStateV11({}) as Record<string, unknown>;

  assert.equal('activePage' in state, true, 'must contain activePage');
});

// ---------------------------------------------------------------------------
// RUNTIME_PAGE_META
// ---------------------------------------------------------------------------

test('RUNTIME_PAGE_META covers all 6 pages', () => {
  const expectedPages: Array<'overview' | 'local' | 'cloud' | 'catalog' | 'runtime' | 'mods'> = [
    'overview', 'local', 'cloud', 'catalog', 'runtime', 'mods',
  ];

  for (const page of expectedPages) {
    assert.ok(RUNTIME_PAGE_META[page], `RUNTIME_PAGE_META must have entry for "${page}"`);
    assert.ok(RUNTIME_PAGE_META[page].name, `RUNTIME_PAGE_META["${page}"].name must be non-empty`);
    assert.ok(RUNTIME_PAGE_META[page].description, `RUNTIME_PAGE_META["${page}"].description must be non-empty`);
  }

  assert.equal(Object.keys(RUNTIME_PAGE_META).length, 6, 'RUNTIME_PAGE_META must have exactly 6 entries');
});

test('normalizeStoredStateV11: new activePage field takes precedence', () => {
  const seed = { localProviderEndpoint: 'http://127.0.0.1:1234/v1' };

  const stored = {
    version: 11 as const,
    initializedByV11: true,
    activePage: 'cloud',
    diagnosticsCollapsed: false,
    uiMode: 'advanced',
    selectedSource: 'token-api',
    activeCapability: 'image',
    localRuntime: {
      endpoint: 'http://127.0.0.1:1234/v1',
      models: [],
      nodeMatrix: [],
      status: 'idle',
      lastCheckedAt: null,
      lastDetail: '',
    },
  };

  const result = normalizeStoredStateV11(seed, stored as never);
  assert.equal(result.activePage, 'cloud');
});

test('normalizeStoredStateV11: connectors always empty (bridge is source of truth)', () => {
  const seed = { localProviderEndpoint: 'http://127.0.0.1:1234/v1' };

  const stored = {
    version: 11 as const,
    initializedByV11: true,
    activePage: 'overview',
    diagnosticsCollapsed: true,
    uiMode: 'simple',
    selectedSource: 'local-runtime',
    activeCapability: 'chat',
    localRuntime: {
      endpoint: 'http://127.0.0.1:1234/v1',
      models: [],
      nodeMatrix: [],
      status: 'idle',
      lastCheckedAt: null,
      lastDetail: '',
    },
  };

  const result = normalizeStoredStateV11(seed, stored as never);
  assert.deepEqual(result.connectors, []);
  assert.equal(result.selectedConnectorId, '');
});

// ---------------------------------------------------------------------------
// persistRuntimeConfigStateV11: activePage is persisted
// ---------------------------------------------------------------------------

test('persistRuntimeConfigStateV11: persists activePage to localStorage', () => {
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
    const state = createDefaultStateV11({ localProviderEndpoint: 'http://127.0.0.1:1234/v1' });
    state.activePage = 'mods';

    persistRuntimeConfigStateV11(state);

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V11);
    assert.ok(raw, 'localStorage should contain persisted state');

    const parsed = JSON.parse(raw);
    assert.equal(parsed.activePage, 'mods', 'activePage should be persisted');
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

// ---------------------------------------------------------------------------
// Round-trip: persist → load → verify
// ---------------------------------------------------------------------------

test('state round-trip: persist activePage then normalize back correctly', () => {
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
    const seed = { localProviderEndpoint: 'http://127.0.0.1:1234/v1' };
    const original = createDefaultStateV11(seed);
    original.activePage = 'runtime';
    original.uiMode = 'advanced';
    original.activeCapability = 'image';

    persistRuntimeConfigStateV11(original);

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V11);
    assert.ok(raw);

    const parsed = JSON.parse(raw);
    const restored = normalizeStoredStateV11(seed, parsed);

    assert.equal(restored.activePage, 'runtime');
    assert.equal(restored.uiMode, 'advanced');
    assert.equal(restored.activeCapability, 'image');
    assert.deepEqual(restored.connectors, [], 'connectors should be empty after round-trip');
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});
