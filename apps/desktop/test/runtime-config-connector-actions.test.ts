import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceConnectorsInState } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-actions.js';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults.js';
import { normalizeConnectorV11, type ApiConnector } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';

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

test('reloading inventory on page return retains the actual check and discovered models', () => {
  const next = replaceConnectorsInState(stateWith(), [{ ...inventory, label: 'Renamed' }]);
  assert.deepEqual(next.connectors, [{ ...checked, label: 'Renamed' }]);
});

test('inventory refresh preserves failed checks as well as successful checks', () => {
  const failed: ApiConnector = { ...checked, status: 'unreachable', lastDetail: 'Connection timed out' };
  assert.deepEqual(replaceConnectorsInState(stateWith(failed), [inventory]).connectors, [failed]);
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
