import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_RUNTIME_REASON_CODES,
  createNimiRuntimeConnectorInventoryClient,
  defaultNimiRuntimeConnectorAuthOptionForProvider,
  listNimiRuntimeConnectorAuthOptionsForProvider,
  nimiRuntimeConnectorToProjection,
  providerToNimiRuntimeConnectorVendor,
  type NimiRuntimeConnectorClient,
  type ProviderCatalogEntry,
} from './index';
import {
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
} from '../core-generated/runtime-typed-client';

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    provider: 'openrouter',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'dynamic_endpoint',
    inlineSupported: true,
  },
  {
    provider: 'openai_codex',
    defaultEndpoint: '',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'static_source',
    inlineSupported: false,
  },
];

test('Nimi Runtime connector projection normalizes scope, auth, endpoint, and models', () => {
  const projection = nimiRuntimeConnectorToProjection({
    connectorId: 'conn-1',
    provider: 'openrouter',
    endpoint: '',
    label: '',
    hasCredential: true,
    ownerType: ConnectorOwnerType.SYSTEM,
    ownerId: 'machine',
    kind: ConnectorKind.REMOTE_MANAGED,
    status: ConnectorStatus.ACTIVE,
    authKind: ConnectorAuthKind.OAUTH_MANAGED,
    providerAuthProfile: 'OPENAI_CODEX',
  }, PROVIDER_CATALOG, ['openrouter/auto']);

  assert.equal(projection.id, 'conn-1');
  assert.equal(projection.scope, 'machine-global');
  assert.equal(projection.authMode, 'oauth_managed');
  assert.equal(projection.providerAuthProfile, 'openai_codex');
  assert.equal(projection.endpoint, 'https://openrouter.ai/api/v1');
  assert.deepEqual(projection.models, ['openrouter/auto']);
});

test('Nimi Runtime connector auth options come from generated profile truth', () => {
  assert.deepEqual(
    listNimiRuntimeConnectorAuthOptionsForProvider('openai_codex', PROVIDER_CATALOG).map((item) => item.value),
    ['oauth:openai_codex'],
  );
  assert.equal(defaultNimiRuntimeConnectorAuthOptionForProvider('openrouter', PROVIDER_CATALOG).value, 'api_key');
  assert.equal(providerToNimiRuntimeConnectorVendor('OpenRouter'), 'openrouter');
});

test('Nimi Runtime connector inventory caches connectors and model descriptors as clones', async () => {
  const calls: string[] = [];
  const connectors = {
    async listProviderCatalog() {
      calls.push('catalog');
      return { providers: PROVIDER_CATALOG };
    },
    async listConnectors() {
      calls.push('connectors');
      return {
        connectors: [{
          connectorId: 'conn-1',
          kind: ConnectorKind.REMOTE_MANAGED,
          ownerType: ConnectorOwnerType.USER,
          ownerId: '',
          provider: 'openrouter',
          endpoint: '',
          label: 'OpenRouter',
          status: ConnectorStatus.ACTIVE,
          localCategory: 0,
          hasCredential: true,
          authKind: ConnectorAuthKind.API_KEY,
          providerAuthProfile: '',
        }],
        nextPageToken: '',
      };
    },
    async listConnectorModels(request) {
      calls.push(`models:${request.connectorId}:${request.forceRefresh}`);
      return {
        models: [{
          modelLabel: 'OpenRouter Auto',
          available: true,
          capabilities: ['text.generate'],
          remoteModelCatalogId: 'rmc_openrouter_auto',
          providerModelId: 'openrouter/auto',
          provider: 'openrouter',
        }],
        nextPageToken: '',
      };
    },
    async createConnector() {
      throw new Error('not used');
    },
    async updateConnector() {
      throw new Error('not used');
    },
    async deleteConnector() {},
    async testConnector() {
      return { ack: { ok: true, reasonCode: 0, actionHint: '' } };
    },
  } satisfies NimiRuntimeConnectorClient;
  const client = createNimiRuntimeConnectorInventoryClient({
    connectors,
    now: () => 1000,
  });

  const [first, second] = await Promise.all([client.listConnectors(), client.listConnectors()]);
  assert.equal(first[0]?.id, 'conn-1');
  assert.equal(second[0]?.id, 'conn-1');
  assert.deepEqual(calls, ['catalog', 'connectors']);

  const models = await client.listConnectorModelDescriptors('conn-1');
  assert.deepEqual(models, [{
    modelLabel: 'OpenRouter Auto',
    provider: 'openrouter',
    providerModelId: 'openrouter/auto',
    remoteModelCatalogId: 'rmc_openrouter_auto',
    capabilities: ['text.generate'],
  }]);
  assert.deepEqual(calls, ['catalog', 'connectors', 'models:conn-1:false']);
});

test('Nimi Runtime connector test fails closed on negative Runtime ack', async () => {
  const client = createNimiRuntimeConnectorInventoryClient({
    connectors: {
      async listProviderCatalog() {
        return { providers: [] };
      },
      async listConnectors() {
        return { connectors: [], nextPageToken: '' };
      },
      async createConnector() {
        throw new Error('not used');
      },
      async updateConnector() {
        throw new Error('not used');
      },
      async deleteConnector() {},
      async testConnector() {
        return { ack: { ok: false, reasonCode: 0, actionHint: 'check_connector_config' } };
      },
      async listConnectorModels() {
        return { models: [], nextPageToken: '' };
      },
    },
  });

  await assert.rejects(
    () => client.testConnector('conn-1'),
    (error: unknown) => {
      const shaped = error as { reasonCode?: string };
      assert.equal(shaped.reasonCode, NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED);
      return true;
    },
  );
});

test('Nimi Runtime connector inventory rejects managed OAuth credential carriers', async () => {
  let createCalls = 0;
  const client = createNimiRuntimeConnectorInventoryClient({
    connectors: {
      async listProviderCatalog() { return { providers: [] }; },
      async listConnectors() { return { connectors: [], nextPageToken: '' }; },
      async createConnector() {
        createCalls += 1;
        return { connector: undefined };
      },
      async updateConnector() { return { connector: undefined }; },
      async deleteConnector() {},
      async testConnector() { return { ack: { ok: true, reasonCode: 0, actionHint: '' } }; },
      async listConnectorModels() { return { models: [], nextPageToken: '' }; },
    },
  });

  await assert.rejects(
    () => client.createConnector({
      provider: 'openai_codex',
      endpoint: 'https://chatgpt.com/backend-api/codex',
      label: 'Codex',
      authMode: 'oauth_managed',
      credentialJson: '{"access_token":"must-not-cross"}',
    } as never),
    /authorized non-renderer host/,
  );
  assert.equal(createCalls, 0);
});
