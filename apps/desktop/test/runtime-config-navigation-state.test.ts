import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  DEFAULT_LOCAL_ENDPOINT_V11,
  normalizeLocalModelV11,
  normalizePageIdV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import {
  createDefaultStateV11,
  RUNTIME_CONFIG_STORAGE_KEY_V11,
  RUNTIME_CONFIG_STORAGE_KEY_V12,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import { normalizeStoredStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-normalize';
import { persistRuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-persist';
import { RUNTIME_PAGE_META } from '../src/shell/renderer/features/runtime-config/runtime-config-meta-v11';
import { RUNTIME_SIDEBAR_ITEMS } from '../src/shell/renderer/features/runtime-config/runtime-config-sidebar';

// ---------------------------------------------------------------------------
// normalizePageIdV11
// ---------------------------------------------------------------------------

test('normalizePageIdV11: canonical six-section IA values pass through unchanged', () => {
  assert.equal(normalizePageIdV11('overview'), 'overview');
  assert.equal(normalizePageIdV11('profiles'), 'profiles');
  assert.equal(normalizePageIdV11('models'), 'models');
  assert.equal(normalizePageIdV11('cloud'), 'cloud');
  assert.equal(normalizePageIdV11('environment'), 'environment');
  assert.equal(normalizePageIdV11('advanced'), 'advanced');
});

test('normalizePageIdV11: unknown values fall back to "overview"', () => {
  assert.equal(normalizePageIdV11(''), 'overview');
  assert.equal(normalizePageIdV11(null), 'overview');
  assert.equal(normalizePageIdV11(undefined), 'overview');
  assert.equal(normalizePageIdV11(42), 'overview');
  assert.equal(normalizePageIdV11('nonexistent'), 'overview');
  assert.equal(normalizePageIdV11('knowledge'), 'overview');
  assert.equal(normalizePageIdV11({}), 'overview');
});

test('normalizePageIdV11: retired pre-T2.4 page ids fall back to "overview"', () => {
  // Developer-only surfaces are not ordinary sections.
  assert.equal(normalizePageIdV11('mods'), 'overview');
  assert.equal(normalizePageIdV11('mod-developer'), 'overview');
  // Sections merged away by the T2.4 Runtime Surface Cleanup table.
  assert.equal(normalizePageIdV11('recommend'), 'overview');
  assert.equal(normalizePageIdV11('local'), 'overview');
  assert.equal(normalizePageIdV11('catalog'), 'overview');
  assert.equal(normalizePageIdV11('runtime'), 'overview');
  assert.equal(normalizePageIdV11('data-management'), 'overview');
  assert.equal(normalizePageIdV11('performance'), 'overview');
});

// ---------------------------------------------------------------------------
// createDefaultStateV11
// ---------------------------------------------------------------------------

test('createDefaultStateV11: activePage defaults to "overview"', () => {
  const state = createDefaultStateV11({});

  assert.equal(state.activePage, 'overview');
  assert.equal(state.version, 12);
  assert.equal(state.local.endpoint, '');
});

test('createDefaultStateV11: state shape keeps current navigation field only', () => {
  const state = createDefaultStateV11({}) as Record<string, unknown>;

  assert.equal('activePage' in state, true, 'must contain activePage');
});

// ---------------------------------------------------------------------------
// RUNTIME_PAGE_META
// ---------------------------------------------------------------------------

test('RUNTIME_PAGE_META covers exactly the canonical six-section IA', () => {
  const expectedPages: Array<
    'overview' | 'profiles' | 'models' | 'cloud' | 'environment' | 'advanced'
  > = [
    'overview',
    'profiles',
    'models',
    'cloud',
    'environment',
    'advanced',
  ];

  for (const page of expectedPages) {
    assert.ok(RUNTIME_PAGE_META[page], `RUNTIME_PAGE_META must have entry for "${page}"`);
    assert.ok(RUNTIME_PAGE_META[page].name, `RUNTIME_PAGE_META["${page}"].name must be non-empty`);
    assert.ok(RUNTIME_PAGE_META[page].description, `RUNTIME_PAGE_META["${page}"].description must be non-empty`);
  }

  assert.equal(Object.keys(RUNTIME_PAGE_META).length, 6, 'RUNTIME_PAGE_META must have exactly 6 entries');
});

test('ordinary Runtime sidebar is the canonical six-section IA without Mods/developer pages', () => {
  const pageIds = RUNTIME_SIDEBAR_ITEMS.map((item) => item.id);
  const labels = RUNTIME_SIDEBAR_ITEMS.map((item) => item.label);

  assert.deepEqual(pageIds, [
    'overview',
    'profiles',
    'models',
    'cloud',
    'environment',
    'advanced',
  ]);
  // Retired top-level entries must not survive the T2.4 hard cut.
  for (const retired of ['recommend', 'catalog', 'data-management', 'performance', 'local', 'runtime', 'mods', 'mod-developer']) {
    assert.equal((pageIds as string[]).includes(retired), false, `retired id "${retired}" must not be a top-level section`);
  }
  assert.equal(labels.includes('Mods'), false);
  assert.equal(labels.includes('Developer Tools'), false);
  assert.equal(labels.includes('AI Runtime'), false);
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

test('normalizeStoredStateV11: retired Runtime pages are not restored as ordinary UI', () => {
  const seed = { localProviderEndpoint: 'http://127.0.0.1:1234/v1' };

  for (const retiredPage of ['mods', 'mod-developer']) {
    const stored = {
      version: 12 as const,
      initializedByV11: true,
      activePage: retiredPage,
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
    assert.equal(result.activePage, 'overview');
  }
});

test('normalizeStoredStateV11: accepts v12 snapshots and preserves local provider hints', () => {
  const seed = { localProviderEndpoint: 'http://127.0.0.1:1234/v1' };

  const stored = {
    version: 12 as const,
    initializedByV11: true,
    activePage: 'environment',
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
        serviceId: 'svc-nimi-media',
        provider: 'nimi_media',
        adapter: 'nimi_media_native_adapter',
        available: false,
        reasonCode: ReasonCode.ACTION_CONTEXT_INVALID,
        providerHints: {
          nimiMedia: {
            preferredAdapter: 'nimi_media_native_adapter',
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
  const providerHints = result.local.nodeMatrix[0]?.providerHints as {
    nimiMedia?: { preferredAdapter?: string };
    extra?: { runtime_support_class?: string };
  } | undefined;
  assert.equal(result.version, 12);
  assert.equal(result.local.models[0]?.engine, 'nimi_media');
  assert.equal(result.local.nodeMatrix[0]?.provider, 'nimi_media');
  assert.equal(result.local.nodeMatrix[0]?.serviceId, 'svc-nimi-media');
  assert.equal(providerHints?.nimiMedia?.preferredAdapter, 'nimi_media_native_adapter');
  assert.equal(providerHints?.extra?.runtime_support_class, 'attached_only');
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
    state.activePage = 'profiles';

    persistRuntimeConfigStateV11(state);

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V12);
    assert.ok(raw, 'localStorage should contain persisted state');

    const parsed = JSON.parse(raw);
    assert.equal(store.has(RUNTIME_CONFIG_STORAGE_KEY_V11), false, 'legacy V11 storage key should not be written');
    assert.equal(parsed.version, 12, 'persisted snapshot should be upgraded to V12');
    assert.equal(parsed.activePage, 'profiles', 'activePage should be persisted');
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
    original.activePage = 'environment';
    original.uiMode = 'advanced';
    original.activeCapability = 'image';

    persistRuntimeConfigStateV11(original);

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V12);
    assert.ok(raw);

    const parsed = JSON.parse(raw);
    const restored = normalizeStoredStateV11(seed, parsed);

    assert.equal(restored.activePage, 'environment');
    assert.equal(restored.uiMode, 'advanced');
    assert.equal(restored.activeCapability, 'image');
    assert.deepEqual(restored.connectors, [], 'connectors should be empty after round-trip');
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test('normalizeLocalModelV11: does not infer engine or endpoint from capabilities', () => {
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

  assert.equal(image.engine, '');
  assert.equal(image.endpoint, DEFAULT_LOCAL_ENDPOINT_V11);
  assert.equal(video.engine, '');
  assert.equal(video.endpoint, DEFAULT_LOCAL_ENDPOINT_V11);
});

test('normalizeLocalModelV11: preserves Runtime-projected engine and endpoint', () => {
  const image = normalizeLocalModelV11({
    localModelId: 'local/flux-default',
    model: 'flux/default',
    engine: 'media',
    endpoint: 'http://runtime.local/media',
    capabilities: ['image'],
  });

  assert.equal(image.engine, 'media');
  assert.equal(image.endpoint, 'http://runtime.local/media');
});

test('normalizeLocalModelV11: embedding models keep blank endpoint when Runtime does not project one', () => {
  const embedding = normalizeLocalModelV11({
    localModelId: 'local/embed-default',
    model: 'llama/embed',
    capabilities: ['embedding'],
  });

  assert.equal(embedding.engine, '');
  assert.equal(embedding.endpoint, DEFAULT_LOCAL_ENDPOINT_V11);
});
