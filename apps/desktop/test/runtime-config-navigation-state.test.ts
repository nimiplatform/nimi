import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeConnectorV11,
  normalizePageIdV11,
  normalizeRuntimeConfigActionFocus,
} from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import {
  createDefaultStateV11,
  RUNTIME_CONFIG_STORAGE_KEY_V15,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import { normalizeStoredStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-normalize';
import {
  loadRuntimeConfigStateV11,
  persistRuntimeConfigStateV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-persist';
import { RUNTIME_NAV_DESTINATIONS } from '../src/shell/renderer/features/runtime-config/runtime-config-nav';
import { resetRuntimePageViewport } from '../src/shell/renderer/features/runtime-config/runtime-config-page-shell';
import { createDesktopRendererRuntimeConfigNavigationPort } from '../src/shell/renderer/renderer/runtime-config-navigation-port';

// ---------------------------------------------------------------------------
// normalizePageIdV11
// ---------------------------------------------------------------------------

test('normalizePageIdV11: canonical destination ids pass through unchanged', () => {
  assert.equal(normalizePageIdV11('aiSettings'), 'aiSettings');
  assert.equal(normalizePageIdV11('modelLibrary'), 'modelLibrary');
  assert.equal(normalizePageIdV11('cloudServices'), 'cloudServices');
  assert.equal(normalizePageIdV11('advancedDiagnostics'), 'advancedDiagnostics');
});

test('retired page values reset to AI Settings instead of preserving aliases', () => {
  for (const retired of ['profiles', 'loadouts', 'modelMarket', 'localAssets', 'cloud', 'overview', 'environment']) {
    assert.equal(normalizePageIdV11(retired), 'aiSettings');
  }
});

test('normalizePageIdV11: unknown values fall back to "aiSettings"', () => {
  assert.equal(normalizePageIdV11(''), 'aiSettings');
  assert.equal(normalizePageIdV11(null), 'aiSettings');
  assert.equal(normalizePageIdV11(undefined), 'aiSettings');
  assert.equal(normalizePageIdV11(42), 'aiSettings');
  assert.equal(normalizePageIdV11('nonexistent'), 'aiSettings');
  assert.equal(normalizePageIdV11('knowledge'), 'aiSettings');
  assert.equal(normalizePageIdV11('advanced'), 'aiSettings');
  assert.equal(normalizePageIdV11({}), 'aiSettings');
});

test('action focus accepts only the current destinations and actions', () => {
  const current = { page: 'cloudServices', action: 'add-connector', focus: 'runtime-config-action-focus.cloud-connector-draft' };
  assert.deepEqual(normalizeRuntimeConfigActionFocus(current), current);
  assert.equal(normalizeRuntimeConfigActionFocus({ ...current, page: 'cloud' }), null);
  assert.equal(normalizeRuntimeConfigActionFocus({ page: 'loadouts', action: 'open-loadouts', focus: 'runtime-config-action-focus.loadouts' }), null);
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

test('createDefaultStateV11: activePage defaults to "aiSettings"', () => {
  const state = createDefaultStateV11();

  assert.equal(state.activePage, 'aiSettings');
  assert.equal(state.version, 15);
  assert.equal(state.local.status, 'idle');
});

// ---------------------------------------------------------------------------
// RUNTIME_NAV_DESTINATIONS
// ---------------------------------------------------------------------------

test('the Runtime navigation lists exactly the four text destinations in order', () => {
  const pageIds = RUNTIME_NAV_DESTINATIONS.map((item) => item.id);

  assert.deepEqual(pageIds, [
    'aiSettings',
    'modelLibrary',
    'cloudServices',
    'advancedDiagnostics',
  ]);
  // Retired top-level entries must not survive the S4 hard cut.
  for (const retired of ['overview', 'profiles', 'loadouts', 'modelMarket', 'localAssets', 'cloud', 'environment', 'recommend', 'catalog', 'data-management', 'performance', 'local', 'runtime', 'mods', 'mod-developer', 'advanced', 'models', 'localModels', 'localAiConfig']) {
    assert.equal((pageIds as string[]).includes(retired), false, `retired id "${retired}" must not be a destination`);
  }
  for (const item of RUNTIME_NAV_DESTINATIONS) {
    assert.equal(typeof item.label, 'string');
    assert.notEqual(item.label.trim(), '');
  }
});

test('normalizeStoredStateV11: connectors always empty (bridge is source of truth)', () => {
  const stored = {
    version: 15 as const,
    initializedByV11: true,
    activePage: 'advancedDiagnostics',
    diagnosticsCollapsed: true,
    uiMode: 'simple',
    selectedSource: 'local',
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
// persistRuntimeConfigStateV11: activePage is persisted under the v15 key
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round-trip: persist → load → verify
// ---------------------------------------------------------------------------

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: () => null,
  };
  return store;
}

function uninstallMemoryLocalStorage() {
  delete (globalThis as Record<string, unknown>).localStorage;
}

test('state round-trip: persist activePage then normalize back correctly', () => {
  const store = installMemoryLocalStorage();

  try {
    const original = createDefaultStateV11();
    original.activePage = 'advancedDiagnostics';
    original.uiMode = 'advanced';

    persistRuntimeConfigStateV11(original);

    const raw = store.get(RUNTIME_CONFIG_STORAGE_KEY_V15);
    assert.ok(raw);
    assert.equal(store.has('nimi:runtime-config:v14'), false, 'v14 key must not be written');
    assert.equal(store.has('nimi:runtime-config:v13'), false, 'v13 key must not be written');

    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 15);
    const restored = normalizeStoredStateV11(parsed);

    assert.equal(restored.activePage, 'advancedDiagnostics');
    assert.equal(restored.uiMode, 'advanced');
    assert.deepEqual(restored.connectors, [], 'connectors should be empty after round-trip');
  } finally {
    uninstallMemoryLocalStorage();
  }
});

test('legacy v13/v14 payloads are never migrated; the preference resets safely to defaults', () => {
  const store = installMemoryLocalStorage();

  try {
    store.set('nimi:runtime-config:v13', JSON.stringify({
      version: 13,
      initializedByV11: true,
      activePage: 'loadouts',
      diagnosticsCollapsed: false,
      uiMode: 'advanced',
      selectedSource: 'cloud',
      local: { status: 'idle', lastCheckedAt: null, lastDetail: '' },
    }));

    const loaded = loadRuntimeConfigStateV11();
    assert.equal(loaded.version, 15);
    // No page mapping, no preference carry-over: the hard cut resets to the
    // default destination.
    assert.equal(loaded.activePage, 'aiSettings');
    assert.equal(loaded.uiMode, 'simple');
    assert.equal(loaded.selectedSource, 'local');
    assert.equal(loaded.diagnosticsCollapsed, true);
  } finally {
    uninstallMemoryLocalStorage();
  }
});

test('a v14 payload is ignored even when a v15 snapshot exists alongside it', () => {
  const store = installMemoryLocalStorage();

  try {
    store.set('nimi:runtime-config:v14', JSON.stringify({
      version: 14,
      initializedByV11: true,
      activePage: 'environment',
      diagnosticsCollapsed: false,
      uiMode: 'advanced',
      selectedSource: 'cloud',
      local: { status: 'idle', lastCheckedAt: null, lastDetail: '' },
    }));

    // Only the v14 payload exists: reset to defaults instead of mapping pages.
    const reset = loadRuntimeConfigStateV11();
    assert.equal(reset.activePage, 'aiSettings');
    assert.equal(reset.version, 15);

    // Once a v15 snapshot exists it is the only payload that is read.
    store.set(RUNTIME_CONFIG_STORAGE_KEY_V15, JSON.stringify({
      version: 15,
      initializedByV11: true,
      activePage: 'modelLibrary',
      diagnosticsCollapsed: true,
      uiMode: 'advanced',
      selectedSource: 'local',
      local: { status: 'idle', lastCheckedAt: null, lastDetail: '' },
    }));
    const loaded = loadRuntimeConfigStateV11();
    assert.equal(loaded.activePage, 'modelLibrary');
    assert.equal(loaded.uiMode, 'advanced');
  } finally {
    uninstallMemoryLocalStorage();
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

// ---------------------------------------------------------------------------
// runtime config navigation port: setup-task intent
// ---------------------------------------------------------------------------

test('navigation port carries the open-setup-task intent verbatim', () => {
  const port = createDesktopRendererRuntimeConfigNavigationPort();
  const seen: unknown[] = [];
  port.subscribe(() => seen.push(port.get().intent));

  port.openSetupTask('task-1');
  assert.deepEqual(port.get().intent, { kind: 'open-setup-task', taskId: 'task-1' });
  assert.equal(seen.length, 1);

  // A blank task id never navigates.
  port.openSetupTask('   ');
  assert.equal(seen.length, 1);
  assert.deepEqual(port.get().intent, { kind: 'open-setup-task', taskId: 'task-1' });
});

test('navigation port carries the open-profile-use intent with the exact owner', () => {
  const port = createDesktopRendererRuntimeConfigNavigationPort();
  port.openProfileUse({ kind: 'app', ownerAppId: 'app.chat', returnFocus: 'apps:app.chat' });

  assert.deepEqual(port.get().intent, {
    kind: 'open-profile-use',
    owner: { kind: 'app', ownerAppId: 'app.chat', returnFocus: 'apps:app.chat' },
  });
});
