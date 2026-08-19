import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiDesktopOpenIntent } from '@nimiplatform/kit/core/desktop-open';
import {
  applyDesktopOpenIntentToAppStore as applyDesktopOpenIntent,
} from '../src/shell/renderer/infra/desktop-open/desktop-open-intent-navigation';
import { productionAppStore } from '../src/shell/renderer/app-shell/providers/production-app-store';
import {
  loadRuntimeConfigStateV11,
  persistRuntimeConfigStateV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-persist';
import {
  createDefaultStateV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import {
  SETTINGS_SELECTED_STORAGE_KEY,
} from '../src/shell/renderer/features/settings/settings-storage';
import {
  createDesktopRendererRuntimeConfigNavigationPort,
  type DesktopRendererRuntimeConfigNavigationPort,
} from '../src/shell/renderer/renderer/runtime-config-navigation-port.js';

type DesktopOpenTarget = {
  rowId: string;
  intent: NimiDesktopOpenIntent;
  expected: {
    activeTab: string;
    section?: string;
    query?: string;
    page?: string;
    appId?: string;
  };
};

const DESKTOP_OPEN_TARGETS: readonly DesktopOpenTarget[] = [
  { rowId: 'target.explore-worlds-section', intent: { kind: 'open-explore', section: 'worlds' }, expected: { activeTab: 'explore', section: 'worlds' } },
  { rowId: 'target.explore-worlds', intent: { kind: 'open-explore', section: 'worlds', productIntent: 'discover-worlds' }, expected: { activeTab: 'explore', section: 'worlds' } },
  { rowId: 'target.explore-personas-section', intent: { kind: 'open-explore', section: 'personas' }, expected: { activeTab: 'explore', section: 'personas' } },
  { rowId: 'target.explore-personas', intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' }, expected: { activeTab: 'explore', section: 'personas' } },
  { rowId: 'target.explore-personas-discover', intent: { kind: 'open-explore', section: 'personas', productIntent: 'discover-personas' }, expected: { activeTab: 'explore', section: 'personas' } },
  { rowId: 'target.explore-activity-section', intent: { kind: 'open-explore', section: 'activity' }, expected: { activeTab: 'explore', section: 'activity' } },
  { rowId: 'target.explore-activity', intent: { kind: 'open-explore', section: 'activity', productIntent: 'view-activity' }, expected: { activeTab: 'explore', section: 'activity' } },
  { rowId: 'target.explore-search', intent: { kind: 'open-explore', section: 'personas', query: 'mentor' }, expected: { activeTab: 'explore', section: 'personas', query: 'mentor' } },
  { rowId: 'target.runtime-connector', intent: { kind: 'open-runtime-config', page: 'cloud', action: 'add-connector' }, expected: { activeTab: 'runtime', page: 'cloud' } },
  { rowId: 'target.runtime-model', intent: { kind: 'open-runtime-config', page: 'models', action: 'install-model' }, expected: { activeTab: 'runtime', page: 'localModels' } },
  { rowId: 'target.agents-inventory', intent: { kind: 'open-agents', view: 'inventory' }, expected: { activeTab: 'agents' } },
  { rowId: 'target.apps-surface', intent: { kind: 'open-apps' }, expected: { activeTab: 'apps' } },
  { rowId: 'target.app-selection', intent: { kind: 'open-apps', appId: 'nimi.example' }, expected: { activeTab: 'apps', appId: 'nimi.example' } },
  { rowId: 'target.settings-profile', intent: { kind: 'open-settings', section: 'profile' }, expected: { activeTab: 'settings', section: 'profile' } },
];

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const initialState = productionAppStore.getState();
const previousLocalStorage = globalThis.localStorage;
const previousWindow = globalThis.window;
let runtimeConfigNavigation: DesktopRendererRuntimeConfigNavigationPort;

function applyDesktopOpenIntentToAppStore(intent: NimiDesktopOpenIntent): void {
  applyDesktopOpenIntent(intent, {
    store: productionAppStore.getState(),
    runtimeConfigNavigation,
  });
}

test.beforeEach(() => {
  runtimeConfigNavigation = createDesktopRendererRuntimeConfigNavigationPort();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });
  persistRuntimeConfigStateV11(createDefaultStateV11());
  productionAppStore.setState({
    activeTab: 'chat',
    exploreActiveSection: 'worlds',
    exploreSearchText: '',
    appsDetailAppId: null,
  });
});

test.afterEach(() => {
  productionAppStore.setState(initialState, true);
  if (previousLocalStorage === undefined) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousLocalStorage,
    });
  }
  if (previousWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
  } else {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

for (const target of DESKTOP_OPEN_TARGETS) {
  test(`Desktop Open ${target.rowId} maps to Desktop renderer state`, () => {
    applyDesktopOpenIntentToAppStore(target.intent);

    const appState = productionAppStore.getState();
    assert.equal(appState.activeTab, target.expected.activeTab);

    if (target.expected.activeTab === 'explore') {
      assert.equal(appState.exploreActiveSection, target.expected.section);
      assert.equal(appState.exploreSearchText, target.expected.query ?? '');
    }

    if (target.expected.activeTab === 'runtime') {
      const runtimeState = loadRuntimeConfigStateV11();
      assert.equal(runtimeState.activePage, target.expected.page);
      if (target.rowId === 'target.runtime-connector') {
        assert.deepEqual(runtimeState.actionFocus, {
          page: 'cloud',
          action: 'add-connector',
          focus: 'runtime-config-action-focus.cloud-connector-draft',
        });
      }
      if (target.rowId === 'target.runtime-model') {
        assert.deepEqual(runtimeState.actionFocus, {
          page: 'localModels',
          action: 'install-model',
          focus: 'runtime-config-action-focus.local-models-discover',
        });
      }
    }

    if (target.rowId === 'target.app-selection') {
      assert.equal(appState.appsDetailAppId, target.expected.appId);
    }

    if (target.rowId === 'target.settings-profile') {
      assert.equal(localStorage.getItem(SETTINGS_SELECTED_STORAGE_KEY), target.expected.section);
    }
  });
}

test('Desktop Open Intent maps runtime connector actions to Runtime Cloud state', () => {
  applyDesktopOpenIntentToAppStore({
    kind: 'open-runtime-config',
    page: 'cloud',
    action: 'add-connector',
  });

  assert.equal(productionAppStore.getState().activeTab, 'runtime');
  assert.equal(loadRuntimeConfigStateV11().activePage, 'cloud');
  assert.deepEqual(loadRuntimeConfigStateV11().actionFocus, {
    page: 'cloud',
    action: 'add-connector',
    focus: 'runtime-config-action-focus.cloud-connector-draft',
  });
  assert.deepEqual(runtimeConfigNavigation.get(), {
    revision: 2,
    intent: {
      kind: 'focus-action',
      actionFocus: {
        page: 'cloud',
        action: 'add-connector',
        focus: 'runtime-config-action-focus.cloud-connector-draft',
      },
    },
  });
});

test('Desktop Open Intent maps runtime model install actions to Local Models discovery', () => {
  applyDesktopOpenIntentToAppStore({
    kind: 'open-runtime-config',
    page: 'models',
    action: 'install-model',
  });

  assert.equal(productionAppStore.getState().activeTab, 'runtime');
  assert.equal(loadRuntimeConfigStateV11().activePage, 'localModels');
  assert.deepEqual(loadRuntimeConfigStateV11().actionFocus, {
    page: 'localModels',
    action: 'install-model',
    focus: 'runtime-config-action-focus.local-models-discover',
  });
  assert.deepEqual(runtimeConfigNavigation.get(), {
    revision: 2,
    intent: {
      kind: 'focus-action',
      actionFocus: {
        page: 'localModels',
        action: 'install-model',
        focus: 'runtime-config-action-focus.local-models-discover',
      },
    },
  });
});

test('Desktop Open Intent maps settings profile and app details to owned surfaces', () => {
  applyDesktopOpenIntentToAppStore({
    kind: 'open-settings',
    section: 'profile',
  });
  assert.equal(productionAppStore.getState().activeTab, 'settings');
  assert.equal(localStorage.getItem(SETTINGS_SELECTED_STORAGE_KEY), 'profile');

  applyDesktopOpenIntentToAppStore({
    kind: 'open-apps',
    appId: 'nimi.notes',
  });
  const state = productionAppStore.getState();
  assert.equal(state.activeTab, 'apps');
  assert.equal(state.appsDetailAppId, 'nimi.notes');
});
