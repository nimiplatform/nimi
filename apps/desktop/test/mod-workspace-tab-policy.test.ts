import assert from 'node:assert/strict';
import test from 'node:test';
import { createModWorkspaceSlice } from '../src/shell/renderer/app-shell/providers/mod-workspace-slice';
import { MAX_OPEN_MOD_TABS } from '../src/shell/renderer/app-shell/providers/mod-workspace-policy';
import type { AppStoreSet, AppStoreState } from '../src/shell/renderer/app-shell/providers/store-types';

function createHarness() {
  let state = {
    activeTab: 'mods',
    fusedRuntimeMods: {},
    modWorkspaceTabs: [],
    runtimeModFailures: [],
    runtimeModDisabledIds: [],
    runtimeModUninstalledIds: [],
    runtimeModRecentReloads: [],
    runtimeModDiagnostics: [],
    runtimeModSources: [],
    runtimeModDeveloperMode: {
      enabled: false,
      autoReloadEnabled: false,
    },
    localManifestSummaries: [],
    registeredRuntimeModIds: [],
    runtimeModSettingsById: {},
  } as unknown as AppStoreState;

  const set: AppStoreSet = (updater) => {
    const patch = typeof updater === 'function' ? updater(state) : updater;
    state = {
      ...state,
      ...patch,
    };
  };

  state = {
    ...state,
    ...createModWorkspaceSlice(set),
  } as AppStoreState;

  return {
    getState: () => state,
  };
}

test('openModWorkspaceTab opens up to the configured limit and rejects the sixth new mod tab', () => {
  const harness = createHarness();

  for (let index = 1; index <= MAX_OPEN_MOD_TABS; index += 1) {
    const state = harness.getState();
    const result = state.openModWorkspaceTab(`mod:test-${index}`, `Test ${index}`, `test-${index}`);
    assert.equal(result, 'opened');
  }

  const saturated = harness.getState();
  assert.equal(saturated.modWorkspaceTabs.length, MAX_OPEN_MOD_TABS);

  const rejected = saturated.openModWorkspaceTab('mod:test-6', 'Test 6', 'test-6');
  assert.equal(rejected, 'rejected-limit');
  assert.equal(harness.getState().modWorkspaceTabs.length, MAX_OPEN_MOD_TABS);
  assert.equal(harness.getState().activeTab, 'mod:test-5');
});

test('openModWorkspaceTab still activates an already-open mod tab when the limit is reached', () => {
  const harness = createHarness();

  for (let index = 1; index <= MAX_OPEN_MOD_TABS; index += 1) {
    harness.getState().openModWorkspaceTab(`mod:test-${index}`, `Test ${index}`, `test-${index}`);
  }

  const reopened = harness.getState().openModWorkspaceTab('mod:test-2', 'Test 2', 'test-2');
  assert.equal(reopened, 'activated-existing');
  assert.equal(harness.getState().modWorkspaceTabs.length, MAX_OPEN_MOD_TABS);
  assert.equal(harness.getState().activeTab, 'mod:test-2');
});

test('closing one mod tab frees capacity for a new mod tab', () => {
  const harness = createHarness();

  for (let index = 1; index <= MAX_OPEN_MOD_TABS; index += 1) {
    harness.getState().openModWorkspaceTab(`mod:test-${index}`, `Test ${index}`, `test-${index}`);
  }

  harness.getState().closeModWorkspaceTab('mod:test-3');
  const result = harness.getState().openModWorkspaceTab('mod:test-6', 'Test 6', 'test-6');

  assert.equal(result, 'opened');
  assert.equal(harness.getState().modWorkspaceTabs.length, MAX_OPEN_MOD_TABS);
  assert.ok(harness.getState().modWorkspaceTabs.some((tab) => tab.tabId === 'mod:test-6'));
});
