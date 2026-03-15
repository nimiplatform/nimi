import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeLocalModelV11,
  normalizePageIdV11,
  setRuntimeConfigPlatformForTests,
} from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import {
  createDefaultStateV11,
  RUNTIME_CONFIG_STORAGE_KEY_V11,
  RUNTIME_CONFIG_STORAGE_KEY_V12,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import { normalizeStoredStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-normalize';
import { persistRuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-persist';
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
    provider: 'local',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
  });

  assert.equal(state.activePage, 'overview');
  assert.equal(state.version, 12);
});

test('createDefaultStateV11: state shape keeps current navigation field only', () => {
  const state = createDefaultStateV11({}) as Record<string, unknown>;

  assert.equal('activePage' in state, true, 'must contain activePage');
});

// ---------------------------------------------------------------------------
// RUNTIME_PAGE_META
// ---------------------------------------------------------------------------

test('RUNTIME_PAGE_META covers all current pages', () => {
  const expectedPages: Array<
    'overview' | 'local' | 'cloud' | 'catalog' | 'runtime' | 'mods' | 'data-management' | 'performance' | 'mod-developer'
  > = [
    'overview',
    'local',
    'cloud',
    'catalog',
    'runtime',
    'mods',
    'data-management',
    'performance',
    'mod-developer',
  ];

  for (const page of expectedPages) {
    assert.ok(RUNTIME_PAGE_META[page], `RUNTIME_PAGE_META must have entry for "${page}"`);
    assert.ok(RUNTIME_PAGE_META[page].name, `RUNTIME_PAGE_META["${page}"].name must be non-empty`);
    assert.ok(RUNTIME_PAGE_META[page].description, `RUNTIME_PAGE_META["${page}"].description must be non-empty`);
  }

  assert.equal(Object.keys(RUNTIME_PAGE_META).length, 9, 'RUNTIME_PAGE_META must have exactly 9 entries');
});

test('normalizeStoredStateV11: new activePage field takes precedence', () => {
  const seed = { localProviderEndpoint: 'http://127.0.0.1:1234/v1' };

  const stored = {
    version: 11 as const,
    initializedByV11: true,
    activePage: 'cloud',
    diagnosticsCollapsed: false,
    uiMode: 'advanced',
    selectedSource: 'cloud',
    activeCapability: 'image',
    local: {
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

test('normalizeStoredStateV11: accepts v12 snapshots and preserves local provider hints', () => {
  const seed = { localProviderEndpoint: 'http://127.0.0.1:1234/v1' };

  const stored = {
    version: 12 as const,
    initializedByV11: true,
    activePage: 'runtime',
    diagnosticsCollapsed: false,
    uiMode: 'advanced',
    selectedSource: 'local',
    activeCapability: 'image',
    local: {
      endpoint: 'http://127.0.0.1:8321/v1',
      models: [{
        localModelId: 'local/flux-default',
        engine: 'nimi_media',
        model: 'flux/default',
        endpoint: 'http://127.0.0.1:8321/v1',
        capabilities: ['image'],
        status: 'installed',
      }],
      nodeMatrix: [{
        nodeId: 'image.generate.nimi_media',
        capability: 'image',
        serviceId: 'nimi-media-openai-gateway',
        provider: 'nimi_media',
        adapter: 'nimi_media_native_adapter',
        available: false,
        reasonCode: 'LOCAL_PROVIDER_ATTACHED_ONLY',
        providerHints: {
          nimiMedia: {
            preferredAdapter: 'nimi_media_native_adapter',
            driver: 'flux',
            family: 'diffusers',
          },
          extra: {
            runtime_support_class: 'attached_only',
          },
        },
      }],
      status: 'unsupported',
      lastCheckedAt: null,
      lastDetail: 'attached endpoint required',
    },
  };

  const result = normalizeStoredStateV11(seed, stored as never);
  assert.equal(result.version, 12);
  assert.equal(result.local.models[0]?.engine, 'nimi_media');
  assert.equal(result.local.nodeMatrix[0]?.provider, 'nimi_media');
  assert.equal(result.local.nodeMatrix[0]?.providerHints?.nimiMedia?.driver, 'flux');
  assert.equal(result.local.nodeMatrix[0]?.providerHints?.extra?.runtime_support_class, 'attached_only');
});

test('normalizeStoredStateV11: connectors always empty (bridge is source of truth)', () => {
  const seed = { localProviderEndpoint: 'http://127.0.0.1:1234/v1' };

  const stored = {
    version: 11 as const,
    initializedByV11: true,
    activePage: 'overview',
    diagnosticsCollapsed: true,
    uiMode: 'simple',
    selectedSource: 'local',
    activeCapability: 'chat',
    local: {
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

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V12);
    assert.ok(raw, 'localStorage should contain persisted state');

    const parsed = JSON.parse(raw);
    assert.equal(store.has(RUNTIME_CONFIG_STORAGE_KEY_V11), false, 'legacy V11 storage key should not be written');
    assert.equal(parsed.version, 12, 'persisted snapshot should be upgraded to V12');
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

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V12);
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

test('normalizeLocalModelV11: windows image and video models default to nimi_media without fake endpoint', () => {
  setRuntimeConfigPlatformForTests('windows');
  try {
    const image = normalizeLocalModelV11({
      localModelId: 'local/flux-default',
      model: 'flux/default',
      capabilities: ['image'],
    });
    const video = normalizeLocalModelV11({
      localModelId: 'local/wan-default',
      model: 'wan/default',
      capabilities: ['video'],
    });

    assert.equal(image.engine, 'nimi_media');
    assert.equal(image.endpoint, '');
    assert.equal(video.engine, 'nimi_media');
    assert.equal(video.endpoint, '');
  } finally {
    setRuntimeConfigPlatformForTests(null);
  }
});

test('normalizeLocalModelV11: windows embedding models default to nexa without fake endpoint', () => {
  setRuntimeConfigPlatformForTests('windows');
  try {
    const embedding = normalizeLocalModelV11({
      localModelId: 'local/embed-default',
      model: 'nexa/embed',
      capabilities: ['embedding'],
    });

    assert.equal(embedding.engine, 'nexa');
    assert.equal(embedding.endpoint, '');
  } finally {
    setRuntimeConfigPlatformForTests(null);
  }
});

test('normalizeLocalModelV11: non-windows image models stay on localai by default', () => {
  setRuntimeConfigPlatformForTests('darwin');
  try {
    const image = normalizeLocalModelV11({
      localModelId: 'local/flux-default',
      model: 'flux/default',
      capabilities: ['image'],
    });

    assert.equal(image.engine, 'localai');
    assert.equal(image.endpoint, 'http://127.0.0.1:1234/v1');
  } finally {
    setRuntimeConfigPlatformForTests(null);
  }
});
