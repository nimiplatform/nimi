import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceConnectorsInState } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-actions.js';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults.js';
import { normalizeConnectorV11, type ApiConnector } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';
import { runSelectedConnectorTestCommand } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-test-command.js';
import type { RuntimeConfigConnectorSdkService } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service.js';

const inventory = normalizeConnectorV11({
  id: 'connection-1', provider: 'test-provider', vendor: 'test-provider',
  endpoint: 'https://provider.example/v1', label: 'My connection',
  hasCredential: true, scope: 'user', authMode: 'api_key',
});
const checked: ApiConnector = {
  ...inventory, status: 'healthy', lastCheckedAt: '2026-10-12T03:00:00Z', lastDetail: '',
  models: ['text-model'], modelCapabilities: { 'text-model': ['text.generate'] },
};
function stateWith(connector = checked) {
  return { ...createDefaultStateV11(), connectors: [connector] };
}

test('reloading inventory uses the persisted owner check', () => {
  const next = replaceConnectorsInState(stateWith(inventory), [{ ...checked, label: 'Renamed' }]);
  assert.deepEqual(next.connectors, [{ ...checked, label: 'Renamed' }]);
});

test('inventory refresh preserves owner failures and never revives an invalidated result', () => {
  const failed: ApiConnector = { ...checked, status: 'unreachable', lastDetail: 'Connection timed out' };
  assert.deepEqual(replaceConnectorsInState(stateWith(), [failed]).connectors, [failed]);
  assert.deepEqual(replaceConnectorsInState(stateWith(failed), [inventory]).connectors, [inventory]);
});

test('changed connection settings do not inherit the previous check', () => {
  const changes: Partial<ApiConnector>[] = [
    { provider: 'other-provider' }, { endpoint: 'https://other.example/v1' },
    { authMode: 'oauth_managed' }, { providerAuthProfile: 'other-profile' },
    { accountLabel: 'other-account' }, { scope: 'machine-global' },
    { hasCredential: false }, { isDraft: true },
  ];
  for (const patch of changes) {
    const changed = { ...inventory, ...patch };
    assert.deepEqual(replaceConnectorsInState(stateWith(), [changed]).connectors, [changed]);
  }
});

test('a fresh check replaces the old result and a save reset stays unchecked on refresh', () => {
  const fresh: ApiConnector = { ...checked, status: 'degraded', lastCheckedAt: '2026-10-12T04:00:00Z' };
  assert.deepEqual(replaceConnectorsInState(stateWith(), [fresh]).connectors, [fresh]);
  assert.deepEqual(replaceConnectorsInState(stateWith(inventory), [inventory]).connectors, [inventory]);
});

test('new and deleted connections follow runtime inventory without reviving old results', () => {
  const added = { ...inventory, id: 'connection-2' };
  const next = replaceConnectorsInState(stateWith(), [added]);
  assert.deepEqual(next.connectors, [added]);
  const empty = replaceConnectorsInState(stateWith(), []);
  assert.deepEqual(empty.connectors, []);
});

test('a delayed connection check cannot replace a newer configuration or observation', async () => {
  const selected: ApiConnector = { ...inventory, configurationVersion: 'version-1' };
  for (const replacement of [
    { ...selected, configurationVersion: 'version-2', endpoint: 'https://replacement.example/v1' },
    { ...selected, status: 'unreachable' as const, lastCheckedAt: '2026-10-27T04:00:00.000Z', lastDetail: 'AI_PROVIDER_AUTH_FAILED' },
  ]) {
    let state = stateWith(selected);
    let complete!: (value: ApiConnector) => void;
    const pending = runSelectedConnectorTestCommand({
      state, selectedConnector: selected, now: Date.now,
      connectorSdk: { sdkTestConnector: () => new Promise<ApiConnector>(resolve => { complete = resolve; }) } as unknown as RuntimeConfigConnectorSdkService,
      updateState: update => { state = update(state); },
      setControlFeedback: () => {},
    });
    state = stateWith(replacement);
    complete({ ...selected, status: 'healthy', lastCheckedAt: '2026-10-27T03:00:00.000Z', lastDetail: '' });
    await pending;
    assert.deepEqual(state.connectors, [replacement]);
  }
});
