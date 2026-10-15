import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiDesktopOpenIntent } from '@nimiplatform/kit/core/desktop-open';
import {
  applyDesktopOpenIntentToAppStore as applyDesktopOpenIntent,
  resolveDesktopOpenAgentCenterTarget,
} from '../src/shell/renderer/infra/desktop-open/desktop-open-intent-navigation';
import { productionAppStore } from '../src/shell/renderer/app-shell/providers/production-app-store';
import {
  persistRuntimeConfigStateV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-persist';
import {
  createDefaultStateV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
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
    appsSection?: string;
  };
};

const DESKTOP_OPEN_TARGETS: readonly DesktopOpenTarget[] = [
  { rowId: 'target.agent-center', intent: { kind: 'open-agent-center', conversationAnchorId: 'agent_anchor_context' }, expected: { activeTab: 'chat' } },
  { rowId: 'target.explore-worlds-section', intent: { kind: 'open-explore', section: 'worlds' }, expected: { activeTab: 'explore', section: 'worlds' } },
  { rowId: 'target.explore-worlds', intent: { kind: 'open-explore', section: 'worlds', productIntent: 'discover-worlds' }, expected: { activeTab: 'explore', section: 'worlds' } },
  { rowId: 'target.explore-personas-section', intent: { kind: 'open-explore', section: 'personas' }, expected: { activeTab: 'explore', section: 'personas' } },
  { rowId: 'target.explore-personas', intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' }, expected: { activeTab: 'explore', section: 'personas' } },
  { rowId: 'target.explore-personas-discover', intent: { kind: 'open-explore', section: 'personas', productIntent: 'discover-personas' }, expected: { activeTab: 'explore', section: 'personas' } },
  { rowId: 'target.explore-activity-section', intent: { kind: 'open-explore', section: 'activity' }, expected: { activeTab: 'explore', section: 'activity' } },
  { rowId: 'target.explore-activity', intent: { kind: 'open-explore', section: 'activity', productIntent: 'view-activity' }, expected: { activeTab: 'explore', section: 'activity' } },
  { rowId: 'target.explore-search', intent: { kind: 'open-explore', section: 'personas', query: 'mentor' }, expected: { activeTab: 'explore', section: 'personas', query: 'mentor' } },
  { rowId: 'target.runtime-connector', intent: { kind: 'open-runtime-config', page: 'cloud', action: 'add-connector' }, expected: { activeTab: 'runtime', page: 'cloudServices' } },
  { rowId: 'target.runtime-model', intent: { kind: 'open-runtime-config', page: 'models', action: 'install-model' }, expected: { activeTab: 'runtime', page: 'modelLibrary' } },
  { rowId: 'target.apps-surface', intent: { kind: 'open-apps' }, expected: { activeTab: 'apps' } },
  { rowId: 'target.app-selection', intent: { kind: 'open-apps', appId: 'nimi.example' }, expected: { activeTab: 'apps', appId: 'nimi.example' } },
  { rowId: 'target.app-ai-models', intent: { kind: 'open-apps', appId: 'nimi.example', section: 'ai-models' }, expected: { activeTab: 'apps', appId: 'nimi.example', appsSection: 'ai-models' } },

  { rowId: 'target.settings-profile', intent: { kind: 'open-settings', section: 'profile' }, expected: { activeTab: 'settings', section: 'profile' } },
  { rowId: 'target.integrations', intent: { kind: 'open-integrations' }, expected: { activeTab: 'home', section: 'integrations' } },
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

test('Agent Center handoff resolves only a Home-owned handle for the same anchor and retires stale results', async () => {
  const foreign = { agentHandle: 'home_foreign', displayName: 'Another Agent', avatarUrl: null };
  const target = { agentHandle: 'home_target', displayName: 'Target Agent', avatarUrl: null };
  const calls: unknown[] = [];
  let current = true;
  const client = {
    agents: { listReferences: async () => [foreign, target] },
    agentConfigure: { manager: { snapshot: async (input: { agentHandle: string; conversationAnchorId?: string }) => {
      calls.push(input);
      assert.equal(input.conversationAnchorId, undefined);
      return { conversationContext: { conversationAnchorId: input.agentHandle === foreign.agentHandle ? 'another-anchor' : 'agent_anchor_context' } };
    } } },
  } as unknown as Parameters<typeof resolveDesktopOpenAgentCenterTarget>[0];
  const resolved = await resolveDesktopOpenAgentCenterTarget(client, 'agent_anchor_context', () => current);
  // A failed sidebar query has supplied no target. The fresh owner read must
  // contain everything the normal target store and Manager require.
  assert.equal(productionAppStore.getState().agentConversationTargetByHandle[target.agentHandle], undefined);
  productionAppStore.getState().setAgentConversationTargetSnapshot(resolved);
  const stored = productionAppStore.getState().agentConversationTargetByHandle[target.agentHandle];
  assert.ok(stored);
  assert.equal(stored.agentHandle, target.agentHandle);
  assert.equal(stored.conversationAnchorId, 'agent_anchor_context');
  assert.equal(stored.displayName, target.displayName);
  assert.deepEqual(calls, [{ agentHandle: 'home_foreign' }, { agentHandle: 'home_target' }]);
  current = false;
  await assert.rejects(() => resolveDesktopOpenAgentCenterTarget(client, 'agent_anchor_context', () => current), /superseded/);
  assert.equal(calls.length, 2);
});
const previousLocalStorage = globalThis.localStorage;
const previousWindow = globalThis.window;
let runtimeConfigNavigation: DesktopRendererRuntimeConfigNavigationPort;

function applyDesktopOpenIntentToAppStore(intent: NimiDesktopOpenIntent): void {
  applyDesktopOpenIntent(intent, {
    store: productionAppStore.navigation,
    runtimeConfigNavigation,
  });
}

test.beforeEach(() => {
  runtimeConfigNavigation = createDesktopRendererRuntimeConfigNavigationPort(() => productionAppStore.navigation);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });
  persistRuntimeConfigStateV11(createDefaultStateV11());
  productionAppStore.navigation.reset({ id: 'chat' });
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
  test(`Desktop Open ${target.rowId} maps to Desktop renderer state`, async () => {
    applyDesktopOpenIntentToAppStore(target.intent);
    await Promise.resolve();

    const appState = productionAppStore.navigation.getSnapshot().current.destination;
    if (target.rowId === 'target.integrations') {
      assert.equal(appState.homeSection, 'integrations');
    }
    assert.equal(
      appState.id,
      target.rowId === 'target.runtime-connector' ? 'cloud' : target.expected.activeTab,
    );

    if (target.expected.activeTab === 'explore') {
      assert.equal(appState.exploreSection, target.expected.section);
      assert.equal(appState.search, target.expected.query ?? '');
    }

    if (target.expected.activeTab === 'runtime') {
      assert.equal(appState.id === 'cloud' ? 'cloudServices' : appState.runtime?.page, target.expected.page);
      if (target.rowId === 'target.runtime-connector') {
        assert.deepEqual(runtimeConfigNavigation.takeAction(), {
          page: 'cloudServices',
          action: 'add-connector',
          focus: 'runtime-config-action-focus.cloud-connector-draft',
        });
      }
      if (target.rowId === 'target.runtime-model') {
        assert.deepEqual(runtimeConfigNavigation.takeAction(), {
          page: 'modelLibrary',
          action: 'install-model',
          focus: 'runtime-config-action-focus.model-library-install',
        });
      }
    }

    if (target.expected.activeTab === 'apps') {
      assert.equal(appState.appId, target.expected.appId ?? undefined);
      assert.equal(appState.appSection, target.expected.appsSection ?? undefined);
    }

    if (target.rowId === 'target.settings-profile') {
      assert.equal(productionAppStore.navigation.getSnapshot().current.destination.settingsSection, target.expected.section);
    }
  });
}

test('Desktop Open action is consumed once and does not replay through history', async () => {
  applyDesktopOpenIntentToAppStore({ kind: 'open-runtime-config', page: 'cloud', action: 'add-connector' });
  await Promise.resolve();
  assert.equal(productionAppStore.navigation.getSnapshot().current.destination.id, 'cloud');
  assert.deepEqual(runtimeConfigNavigation.takeAction(), {
    page: 'cloudServices', action: 'add-connector', focus: 'runtime-config-action-focus.cloud-connector-draft',
  });
  await productionAppStore.navigation.back();
  await productionAppStore.navigation.forward();
  assert.equal(runtimeConfigNavigation.takeAction(), null);
});

test('Desktop Open Intent maps settings profile and app details to owned surfaces', () => {
  // A public app-only intent replaces a prior source-qualified Home intent.
  productionAppStore.navigation.reset({ id: 'apps', appId: 'nimi.parentos', appEntryKey: 'verified:nimi.parentos' });
  applyDesktopOpenIntentToAppStore({
    kind: 'open-settings',
    section: 'profile',
  });
  assert.equal(productionAppStore.navigation.getSnapshot().current.destination.id, 'settings');
  assert.equal(productionAppStore.navigation.getSnapshot().current.destination.settingsSection, 'profile');

  applyDesktopOpenIntentToAppStore({
    kind: 'open-apps',
    appId: 'nimi.notes',
    section: 'ai-models',
  });
  const state = productionAppStore.navigation.getSnapshot().current.destination;
  assert.equal(state.id, 'apps');
  assert.equal(state.appId, 'nimi.notes');
  assert.equal(state.appEntryKey, undefined);
  assert.equal(state.appSection, 'ai-models');
});
