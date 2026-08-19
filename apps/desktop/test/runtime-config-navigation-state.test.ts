import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeConnectorV11,
  normalizePageIdV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import {
  createDefaultStateV11,
  RUNTIME_CONFIG_STORAGE_KEY_V12,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import { normalizeStoredStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-normalize';
import { persistRuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-persist';
import { RUNTIME_SIDEBAR_ITEMS } from '../src/shell/renderer/features/runtime-config/runtime-config-sidebar';
import { resetRuntimePageViewport } from '../src/shell/renderer/features/runtime-config/runtime-config-page-shell';

// ---------------------------------------------------------------------------
// normalizePageIdV11
// ---------------------------------------------------------------------------

test('normalizePageIdV11: canonical page ids pass through unchanged', () => {
  assert.equal(normalizePageIdV11('overview'), 'overview');
  assert.equal(normalizePageIdV11('profiles'), 'profiles');
  assert.equal(normalizePageIdV11('modelMarket'), 'modelMarket');
  assert.equal(normalizePageIdV11('localModels'), 'localModels');
  assert.equal(normalizePageIdV11('loadouts'), 'loadouts');
  assert.equal(normalizePageIdV11('cloud'), 'cloud');
  assert.equal(normalizePageIdV11('environment'), 'environment');
});

test('normalizePageIdV11: retired "models" section migrates to "localModels"', () => {
  assert.equal(normalizePageIdV11('models'), 'localModels');
});

test('normalizePageIdV11: retired model catalog page migrates to cloud connectors', () => {
  assert.equal(normalizePageIdV11('modelCatalog'), 'cloud');
});

test('normalizePageIdV11: unknown values fall back to "overview"', () => {
  assert.equal(normalizePageIdV11(''), 'overview');
  assert.equal(normalizePageIdV11(null), 'overview');
  assert.equal(normalizePageIdV11(undefined), 'overview');
  assert.equal(normalizePageIdV11(42), 'overview');
  assert.equal(normalizePageIdV11('nonexistent'), 'overview');
  assert.equal(normalizePageIdV11('knowledge'), 'overview');
  assert.equal(normalizePageIdV11('advanced'), 'overview');
  assert.equal(normalizePageIdV11({}), 'overview');
});

test('page navigation resets the shared Runtime viewport to the start', () => {
  let requested: ScrollToOptions | null = null;
  resetRuntimePageViewport({
    scrollTo(options: ScrollToOptions) {
      requested = options;
    },
  } as Pick<HTMLDivElement, 'scrollTo'>);

  assert.deepEqual(requested, { top: 0, left: 0 });
});

// ---------------------------------------------------------------------------
// createDefaultStateV11
// ---------------------------------------------------------------------------

test('createDefaultStateV11: activePage defaults to "overview"', () => {
  const state = createDefaultStateV11();

  assert.equal(state.activePage, 'overview');
  assert.equal(state.version, 12);
  assert.equal(state.local.status, 'idle');
});

// ---------------------------------------------------------------------------
// RUNTIME_PAGE_META
// ---------------------------------------------------------------------------

test('ordinary Runtime sidebar lists the expected pages without Mods/developer pages', () => {
  const pageIds = RUNTIME_SIDEBAR_ITEMS.map((item) => item.id);
  const labels = RUNTIME_SIDEBAR_ITEMS.map((item) => item.label);

  assert.deepEqual(pageIds, [
    'overview',
    'profiles',
    'modelMarket',
    'localModels',
    'loadouts',
    'cloud',
    'environment',
  ]);
  // Retired top-level entries must not survive the T2.4 hard cut; the single
  // 'models' section is now split into task-owned Runtime pages above.
  for (const retired of ['recommend', 'catalog', 'data-management', 'performance', 'local', 'runtime', 'mods', 'mod-developer', 'advanced', 'models', 'localAiConfig']) {
    assert.equal((pageIds as string[]).includes(retired), false, `retired id "${retired}" must not be a top-level section`);
  }
  assert.equal(labels.includes('Mods'), false);
  assert.equal(labels.includes('Developer Tools'), false);
  assert.equal(labels.includes('AI Runtime'), false);
});

test('normalizeStoredStateV11: connectors always empty (bridge is source of truth)', () => {
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
      nodeMatrix: [],
      status: 'idle',
      lastCheckedAt: null,
      lastDetail: '',
    },
  };

  const result = normalizeStoredStateV11(stored as never);
  assert.deepEqual(result.connectors, []);
  assert.equal(result.selectedConnectorId, '');
});

// ---------------------------------------------------------------------------
// persistRuntimeConfigStateV11: activePage is persisted
// ---------------------------------------------------------------------------

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
    const original = createDefaultStateV11();
    original.activePage = 'environment';
    original.uiMode = 'advanced';
    original.activeCapability = 'image';

    persistRuntimeConfigStateV11(original);

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V12);
    assert.ok(raw);

    const parsed = JSON.parse(raw);
    const restored = normalizeStoredStateV11(parsed);

    assert.equal(restored.activePage, 'environment');
    assert.equal(restored.uiMode, 'advanced');
    assert.equal(restored.activeCapability, 'image');
    assert.deepEqual(restored.connectors, [], 'connectors should be empty after round-trip');
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test('normalizeConnectorV11: preserves Runtime model capability evidence', () => {
  const connector = normalizeConnectorV11({
    id: 'conn-image',
    label: 'Image Cloud',
    models: ['image-model', 'empty-model'],
    modelCapabilities: {
      'image-model': ['image.generate', 'image.generate'],
      'empty-model': [],
    },
    status: 'healthy',
  });

  assert.deepEqual(connector.modelCapabilities, {
    'image-model': ['image.generate'],
  });
});
