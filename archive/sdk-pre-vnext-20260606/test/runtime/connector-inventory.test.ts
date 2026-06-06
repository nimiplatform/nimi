import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
  RuntimeReasonCode,
  createRuntimeConnectorInventoryClient,
  defaultRuntimeConnectorAuthOptionForProvider,
  listRuntimeConnectorAuthOptionsForProvider,
  providerToRuntimeConnectorVendor,
  runtimeConnectorAuthProfileForId,
  runtimeConnectorToProjection,
  runtimeConnectorVendorToProvider,
  type RuntimeConnectorAdminClient,
  type RuntimeConnectorProjectionInput,
} from '../../src/runtime/index.js';

function connector(overrides: Partial<RuntimeConnectorProjectionInput> = {}): RuntimeConnectorProjectionInput {
  return {
    connectorId: 'conn-1',
    provider: 'openrouter',
    endpoint: '',
    label: 'OpenRouter',
    hasCredential: true,
    authKind: ConnectorAuthKind.API_KEY,
    providerAuthProfile: '',
    ownerType: ConnectorOwnerType.USER,
    ownerId: 'user-1',
    kind: ConnectorKind.REMOTE_MANAGED,
    status: ConnectorStatus.ACTIVE,
    ...overrides,
  };
}

function createMockRuntimeAdmin(): RuntimeConnectorAdminClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listProviderCatalog() {
      calls.push('listProviderCatalog');
      return {
        providers: [{
          provider: 'openrouter',
          displayName: 'OpenRouter',
          defaultEndpoint: 'https://openrouter.ai/api/v1',
          managedSupported: true,
          inlineSupported: true,
        }],
      };
    },
    async listConnectors() {
      calls.push('listConnectors');
      return {
        connectors: [
          connector(),
          connector({
            connectorId: 'local-ignored',
            provider: 'local',
            kind: ConnectorKind.LOCAL,
          }),
        ],
      };
    },
    async createConnector(input) {
      calls.push(`createConnector:${input.provider}:${input.authKind}:${input.providerAuthProfile || ''}:${input.credentialJson || input.apiKey || ''}`);
      return { connector: connector({ connectorId: 'created', provider: input.provider, endpoint: input.endpoint, label: input.label, authKind: input.authKind }) };
    },
    async updateConnector(input) {
      calls.push(`updateConnector:${input.connectorId}:${input.authKind || ''}:${input.providerAuthProfile || ''}:${input.credentialJson || input.apiKey || ''}`);
      return { connector: connector({ connectorId: input.connectorId, label: input.label || 'Updated', endpoint: input.endpoint || '' }) };
    },
    async deleteConnector(input) {
      calls.push(`deleteConnector:${input.connectorId}`);
      return {};
    },
    async testConnector() {
      calls.push('testConnector');
      return { ack: { ok: true } };
    },
    async listConnectorModels(input) {
      calls.push(`listConnectorModels:${input.connectorId}:${input.pageToken || ''}:${input.forceRefresh ? 'force' : 'cached'}`);
      return input.pageToken
        ? {
            models: [
              { available: true, modelId: 'openrouter/model-b', capabilities: ['text.generate'] },
            ],
            nextPageToken: '',
          }
        : {
            models: [
              { available: true, modelId: 'openrouter/model-a', capabilities: ['text.generate', 'image.generate'] },
              { available: false, modelId: 'openrouter/unavailable', capabilities: ['text.generate'] },
              { available: true, modelId: 'openrouter/model-a', capabilities: ['text.generate'] },
            ],
            nextPageToken: 'next',
          };
    },
  };
}

test('runtime connector projection maps Runtime connector evidence without owning provider truth', () => {
  assert.equal(providerToRuntimeConnectorVendor('OpenRouter'), 'openrouter');
  assert.equal(runtimeConnectorVendorToProvider('OPENROUTER'), 'openrouter');
  assert.equal(providerToRuntimeConnectorVendor(''), 'custom');

  assert.deepEqual(runtimeConnectorToProjection(connector({
    endpoint: '',
    ownerType: ConnectorOwnerType.SYSTEM,
    ownerId: 'machine',
  }), [{
    provider: 'openrouter',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    managedSupported: true,
    displayName: 'OpenRouter',
  }]), {
    id: 'conn-1',
    label: 'OpenRouter',
    vendor: 'openrouter',
    provider: 'openrouter',
    authMode: 'api_key',
    providerAuthProfile: undefined,
    endpoint: 'https://openrouter.ai/api/v1',
    scope: 'machine-global',
    hasCredential: true,
    isSystemOwned: true,
    models: [],
  });
});

test('runtime connector auth options project generated managed profiles and inline support', () => {
  const profile = runtimeConnectorAuthProfileForId('openai_codex');
  assert.equal(profile?.id, 'openai_codex');
  assert.ok(listRuntimeConnectorAuthOptionsForProvider('openai_codex').some((item) => item.value === 'oauth:openai_codex'));
  assert.deepEqual(listRuntimeConnectorAuthOptionsForProvider('openai_codex', [{
    provider: 'openai_codex',
    defaultEndpoint: 'https://example.invalid',
    managedSupported: true,
    inlineSupported: false,
    displayName: 'Codex',
  }]).map((item) => item.authMode), ['oauth_managed']);
  assert.equal(defaultRuntimeConnectorAuthOptionForProvider('unknown').authMode, 'api_key');
});

test('runtime connector inventory client caches and clones connector projections', async () => {
  const admin = createMockRuntimeAdmin();
  const client = createRuntimeConnectorInventoryClient({
    runtimeAdmin: admin,
    now: () => 1000,
  });

  const first = await client.listConnectors();
  first[0]?.models.push('mutated');
  const second = await client.listConnectors();

  assert.equal(second.length, 1);
  assert.deepEqual(second[0]?.models, []);
  assert.equal(admin.calls.filter((call) => call === 'listConnectors').length, 1);
  assert.equal(admin.calls.filter((call) => call === 'listProviderCatalog').length, 1);
});

test('runtime connector inventory client coalesces and paginates model descriptors', async () => {
  const admin = createMockRuntimeAdmin();
  const client = createRuntimeConnectorInventoryClient({
    runtimeAdmin: admin,
    now: () => 1000,
  });

  const [left, right] = await Promise.all([
    client.listConnectorModelDescriptors(' conn-1 '),
    client.listConnectorModelDescriptors('conn-1'),
  ]);
  assert.deepEqual(left, [
    { modelId: 'openrouter/model-a', capabilities: ['text.generate', 'image.generate'] },
    { modelId: 'openrouter/model-b', capabilities: ['text.generate'] },
  ]);
  assert.deepEqual(right, left);
  assert.equal(admin.calls.filter((call) => call.startsWith('listConnectorModels')).length, 2);

  await client.listConnectorModelDescriptors('conn-1');
  assert.equal(admin.calls.filter((call) => call.startsWith('listConnectorModels')).length, 2);

  await client.listConnectorModelDescriptors('conn-1', true);
  assert.equal(admin.calls.filter((call) => call.startsWith('listConnectorModels')).length, 4);
});

test('runtime connector inventory client builds explicit typed Runtime connector writes', async () => {
  const admin = createMockRuntimeAdmin();
  const client = createRuntimeConnectorInventoryClient({ runtimeAdmin: admin });

  await client.createConnector({
    provider: 'openai_codex',
    endpoint: 'https://example.invalid',
    label: 'Codex',
    authMode: 'oauth_managed',
    providerAuthProfile: 'openai_codex',
    credentialValue: 'token-1',
  });
  assert.ok(admin.calls.includes('createConnector:openai_codex:2:openai_codex:{"access_token":"token-1"}'));

  await client.updateConnector({
    connectorId: 'conn-1',
    authMode: 'api_key',
    credentialValue: 'key-1',
  });
  assert.ok(admin.calls.includes('updateConnector:conn-1:1::key-1'));
});

test('runtime connector inventory client projects Runtime connector test failures fail-closed', async () => {
  const admin = createMockRuntimeAdmin();
  admin.testConnector = async () => ({
    ack: {
      ok: false,
      reasonCode: RuntimeReasonCode.AI_PROVIDER_AUTH_FAILED,
      actionHint: 'check_key',
    },
  });
  const client = createRuntimeConnectorInventoryClient({ runtimeAdmin: admin });

  await assert.rejects(
    () => client.testConnector('conn-1'),
    (error) => {
      const record = error as { reasonCode?: string; actionHint?: string };
      assert.equal(record.reasonCode, 'AI_PROVIDER_AUTH_FAILED');
      assert.equal(record.actionHint, 'check_key');
      return true;
    },
  );
});
