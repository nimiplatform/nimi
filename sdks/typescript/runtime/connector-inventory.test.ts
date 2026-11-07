import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_CHATGPT_PLAN_REVOCATION_UNCONFIRMED_ACTION_HINT,
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
    supportsOssMediaStorage: false,
  },
  {
    provider: 'openai_chatgpt_plan',
    defaultEndpoint: 'https://api.openai.com/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'static_source',
    inlineSupported: false,
    supportsOssMediaStorage: false,
  },
];

test('OSS configuration uses the typed management carrier and projects no storage secrets', async () => {
  const config = { region: 'cn-beijing', bucket: 'test-bucket', keyPrefix: 'nimi-input/' };
  const setup = { change: { oneofKind: 'oss' as const, oss: { config, accessKeyId: 'storage-id', accessKeySecret: 'storage-secret', securityToken: '' } } };
  const requests: unknown[] = [];
  const native = { connectorId: 'connector', provider: 'dashscope', label: 'Video', endpoint: 'https://dashscope.aliyuncs.com', hasCredential: true,
    authKind: ConnectorAuthKind.API_KEY, providerAuthProfile: '', ownerType: ConnectorOwnerType.REALM_USER, ownerId: 'owner', kind: ConnectorKind.REMOTE_MANAGED, status: ConnectorStatus.ACTIVE };
  const client = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listProviderCatalog() { return { providers: [] }; },
    async updateConnector(request) {
      requests.push(request.mediaStorage);
      return { connector: { ...native, mediaStorage: request.mediaStorage?.change.oneofKind === 'oss' ? { ...config, accessKeySecret: 'must-not-project' } : undefined } };
    },
  } as NimiRuntimeConnectorClient });
  const updated = await client.updateConnector({ connectorId: 'connector', mediaStorage: setup });
  assert.deepEqual(updated?.mediaStorage, config);
  assert.ok(!JSON.stringify(updated).includes('storage-secret'));
  assert.ok(!JSON.stringify(updated).includes('must-not-project'));
  const remove = { change: { oneofKind: 'remove' as const, remove: true } };
  const cleared = await client.updateConnector({ connectorId: 'connector', mediaStorage: remove });
  assert.equal(cleared?.mediaStorage, undefined);
  assert.deepEqual(requests, [setup, remove]);
});

test('SVG author selection preserves exact catalog identity and explicit removal', async () => {
  const author = { providerModelId: 'gpt-6.1-sol', remoteModelCatalogId: 'exact-catalog' };
  const calls: unknown[] = [];
  const client = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listProviderCatalog() { return { providers: [] }; },
    async updateConnector(request) {
      calls.push(request.svgAuthor);
      return { connector: { connectorId: 'connection', provider: 'openai', endpoint: 'https://api.openai.com/v1', label: 'OpenAI',
        hasCredential: true, authKind: ConnectorAuthKind.API_KEY, ownerType: ConnectorOwnerType.REALM_USER,
        kind: ConnectorKind.REMOTE_MANAGED, status: ConnectorStatus.ACTIVE,
        svgAuthor: request.svgAuthor?.change.oneofKind === 'author' ? author : undefined } };
    },
  } as NimiRuntimeConnectorClient });
  const setup = { change: { oneofKind: 'author' as const, author } };
  const result = await client.updateConnector({ connectorId: 'connection', svgAuthor: setup });
  assert.deepEqual(result?.svgAuthor, author);
  const remove = { change: { oneofKind: 'remove' as const, remove: true } };
  assert.equal((await client.updateConnector({ connectorId: 'connection', svgAuthor: remove }))?.svgAuthor, undefined);
  assert.deepEqual(calls, [setup, remove]);
});

test('Azure deployment bindings preserve names, clone projections and clear explicitly', async () => {
  const requests: unknown[] = [];
  const binding = { providerModelId: 'gpt-6.1-sol', deploymentName: 'tenant-writing' };
  const client = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listProviderCatalog() { return { providers: [] }; },
    async updateConnector(request) {
      requests.push(request.azureDeployments);
      return { connector: { connectorId: 'azure-connection', provider: 'azure', endpoint: 'https://tenant.example/openai/v1', label: 'Azure',
        hasCredential: true, authKind: ConnectorAuthKind.API_KEY, ownerType: ConnectorOwnerType.REALM_USER,
        kind: ConnectorKind.REMOTE_MANAGED, status: ConnectorStatus.ACTIVE,
        azureDeployments: request.azureDeployments?.deployments.length ? request.azureDeployments : undefined } };
    },
  } as NimiRuntimeConnectorClient });
  const setup = { deployments: [binding] };
  const result = await client.updateConnector({ connectorId: 'azure-connection', azureDeployments: setup });
  assert.deepEqual(result?.azureDeployments, setup);
  binding.deploymentName = 'changed-after-call';
  assert.equal(result?.azureDeployments?.deployments[0]?.deploymentName, 'tenant-writing');
  const cleared = await client.updateConnector({ connectorId: 'azure-connection', azureDeployments: { deployments: [] } });
  assert.equal(cleared?.azureDeployments, undefined);
  assert.equal(requests.length, 2);
});

test('Bedrock invocation bindings preserve explicit routing and clone projections', async () => {
  const client = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listProviderCatalog() { return { providers: [] }; },
    async updateConnector(request) {
      return { connector: { connectorId: 'bedrock-connection', provider: 'bedrock', endpoint: 'https://bedrock-runtime.us-east-1.amazonaws.com', label: 'Bedrock',
        hasCredential: true, authKind: ConnectorAuthKind.API_KEY, ownerType: ConnectorOwnerType.REALM_USER,
        kind: ConnectorKind.REMOTE_MANAGED, status: ConnectorStatus.ACTIVE,
        bedrockInvocations: request.bedrockInvocations?.invocations.length ? request.bedrockInvocations : undefined } };
    },
  } as NimiRuntimeConnectorClient });
  const binding = { providerModelId: 'anthropic.claude-sonnet-5-5', invocationModelId: 'us.anthropic.claude-sonnet-5-5' };
  const setup = { invocations: [binding] };
  const saved = await client.updateConnector({ connectorId: 'bedrock-connection', bedrockInvocations: setup });
  assert.deepEqual(saved?.bedrockInvocations, setup);
  binding.invocationModelId = 'global.anthropic.claude-sonnet-5-5';
  assert.equal(saved?.bedrockInvocations?.invocations[0]?.invocationModelId, 'us.anthropic.claude-sonnet-5-5');
  const cleared = await client.updateConnector({ connectorId: 'bedrock-connection', bedrockInvocations: { invocations: [] } });
  assert.equal(cleared?.bedrockInvocations, undefined);
});

test('catalog reads preserve unavailable models and never perform a connection check', async () => {
  const requested: string[] = [];
  const inventory = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listConnectorModels(request) {
      requested.push(request.pageToken);
      assert.equal(request.forceRefresh, false, 'cache bypass does not request provider discovery');
      return { models: [{ modelLabel: 'Same name', provider: 'test-provider', providerModelId: request.pageToken ? 'model-b' : 'model-a',
        remoteModelCatalogId: request.pageToken ? 'catalog-b' : 'catalog-a', available: !request.pageToken, capabilities: ['text.generate'] }],
        nextPageToken: request.pageToken ? '' : 'next' };
    },
    async testConnector() { assert.fail('catalog browsing must not test connectivity'); },
  } as NimiRuntimeConnectorClient });
  const rows = await inventory.listConnectorCatalog('connection', true);
  assert.deepEqual(rows.map(row => [row.remoteModelCatalogId, row.available]), [['catalog-a', true], ['catalog-b', false]]);
  assert.deepEqual(requested, ['', 'next']);
  assert.deepEqual((await inventory.listConnectorModelDescriptors('connection')).map(row => row.providerModelId), ['model-a']);
  assert.equal(requested.length, 2, 'descriptor projection reuses the same snapshot');
});

test('connector lists consume every page and retain disabled management state', async () => {
  const pages: string[] = [];
  const inventory = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listProviderCatalog() { return { providers: [] }; },
    async listConnectors(request) {
      pages.push(request.pageToken);
      return { connectors: [{ connectorId: request.pageToken ? 'last' : 'first', provider: 'test', endpoint: '', label: 'Same',
        hasCredential: true, ownerType: ConnectorOwnerType.REALM_USER, kind: ConnectorKind.REMOTE_MANAGED,
        status: request.pageToken ? ConnectorStatus.DISABLED : ConnectorStatus.ACTIVE,
        updatedAt: { seconds: '100', nanos: 2 }, lastCheck: { ok: true, reasonCode: 0, checkedAt: { seconds: '90', nanos: 0 } } }],
        nextPageToken: request.pageToken ? '' : 'next' };
    },
  } as NimiRuntimeConnectorClient });
  const rows = await inventory.listConnectors();
  assert.deepEqual(pages, ['', 'next']);
  assert.deepEqual(rows.map(row => row.managementStatus), ['active', 'disabled']);
  assert.equal(rows[1]!.lastCheck?.ok, true, 'management and diagnostic facts remain separate');
  assert.equal(rows[1]!.configurationVersion, '100:2');
});

test('incomplete or cyclic model pagination is rejected instead of cached as complete', async () => {
  for (const maxModelPages of [1, 4]) {
    let calls = 0;
    const inventory = createNimiRuntimeConnectorInventoryClient({ maxModelPages, connectors: {
      async listConnectorModels() { calls++; return { models: [], nextPageToken: 'repeated' }; },
    } as NimiRuntimeConnectorClient });
    await assert.rejects(inventory.listConnectorCatalog('connection'), /did not complete pagination/);
    const previousCalls = calls;
    await assert.rejects(inventory.listConnectorCatalog('connection'), /did not complete pagination/);
    assert.ok(calls > previousCalls, 'failed reads are not cached as empty success');
  }
});

test('a malformed catalog identity cannot turn a nonempty owner response into empty success', async () => {
  const inventory = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listConnectorModels() { return { models: [{ provider: 'test', providerModelId: 'model', remoteModelCatalogId: '', capabilities: [], available: true }], nextPageToken: '' }; },
  } as NimiRuntimeConnectorClient });
  await assert.rejects(inventory.listConnectorCatalog('connection'), /did not complete pagination/);
});

test('clearing account caches fences an in-flight catalog from repopulating them', async () => {
  let finish!: (response: { models: never[]; nextPageToken: string }) => void;
  let calls = 0;
  const inventory = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listConnectorModels() {
      calls++;
      if (calls === 1) return new Promise(resolve => { finish = resolve; });
      return { models: [], nextPageToken: '' };
    },
  } as NimiRuntimeConnectorClient });
  const old = inventory.listConnectorCatalog('same-id');
  inventory.clearCaches();
  finish({ models: [], nextPageToken: '' });
  await old;
  await inventory.listConnectorCatalog('same-id');
  assert.equal(calls, 2);
});

test('connector edits preserve absent fields so a metadata update never clears the stored credential', async () => {
  const requests: Parameters<NimiRuntimeConnectorClient['updateConnector']>[0][] = [];
  const inventory = createNimiRuntimeConnectorInventoryClient({
    connectors: {
      async updateConnector(request) { requests.push(request); return { connector: undefined }; },
    } as NimiRuntimeConnectorClient,
  });
  await inventory.updateConnector({ connectorId: 'saved-connection', label: 'Renamed' });
  assert.equal(requests[0]!.label, 'Renamed');
  assert.equal(requests[0]!.apiKey, undefined);
  assert.equal(requests[0]!.endpoint, undefined);
  assert.equal(requests[0]!.authKind, undefined);
  await inventory.updateConnector({ connectorId: 'saved-connection', credentialValue: ' replacement-key ', authMode: 'api_key' });
  assert.equal(requests[1]!.apiKey, 'replacement-key');
  assert.equal(requests[1]!.label, undefined);
  assert.equal(requests[1]!.authKind, ConnectorAuthKind.API_KEY);
});

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
    providerAuthProfile: 'OPENAI_CHATGPT_PLAN',
  }, PROVIDER_CATALOG, ['openrouter/auto']);

  assert.equal(projection.id, 'conn-1');
  assert.equal(projection.scope, 'machine-global');
  assert.equal(projection.authMode, 'oauth_managed');
  assert.equal(projection.providerAuthProfile, 'openai_chatgpt_plan');
  assert.equal(projection.endpoint, 'https://openrouter.ai/api/v1');
  assert.deepEqual(projection.models, ['openrouter/auto']);
});

test('Nimi Runtime connector auth options come from generated profile truth', () => {
  const authCatalog = PROVIDER_CATALOG.map(({ provider, inlineSupported }) => ({ provider, inlineSupported }));
  assert.deepEqual(
    listNimiRuntimeConnectorAuthOptionsForProvider('openai_chatgpt_plan', authCatalog).map((item) => item.value),
    ['oauth:openai_chatgpt_plan'],
  );
  assert.equal(defaultNimiRuntimeConnectorAuthOptionForProvider('openrouter', authCatalog).value, 'api_key');
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

test('checks return owner observations and invalidate cached inventory even on failure', async () => {
  const record = { connectorId: 'checked-1', provider: 'openai', endpoint: '', label: 'Saved', hasCredential: true,
    ownerType: ConnectorOwnerType.REALM_USER, ownerId: 'account', kind: ConnectorKind.REMOTE_MANAGED,
    status: ConnectorStatus.ACTIVE, authKind: ConnectorAuthKind.API_KEY, providerAuthProfile: '', createdAt: undefined, updatedAt: undefined };
  let lastCheck: { ok: boolean; reasonCode: number; checkedAt: { seconds: string; nanos: number } } | undefined;
  let reads = 0;
  let pass = true;
  const inventory = createNimiRuntimeConnectorInventoryClient({ connectors: {
    async listProviderCatalog() { return { providers: [] }; },
    async listConnectors() { reads++; return { connectors: [{ ...record, lastCheck }], nextPageToken: '' }; },
    async testConnector() {
      lastCheck = { ok: pass, reasonCode: 0, checkedAt: { seconds: '1792976400', nanos: 0 } };
      return { ack: { ok: pass, reasonCode: 0, actionHint: '' }, connector: { ...record, lastCheck } };
    },
  } as NimiRuntimeConnectorClient });
  assert.equal((await inventory.listConnectors())[0]!.lastCheck, undefined);
  assert.equal((await inventory.testConnector(record.connectorId)).lastCheck?.ok, true);
  assert.equal((await inventory.listConnectors())[0]!.lastCheck?.ok, true);
  pass = false;
  await assert.rejects(inventory.testConnector(record.connectorId));
  assert.equal((await inventory.listConnectors())[0]!.lastCheck?.ok, false);
  assert.equal(reads, 3);
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
      provider: 'openai_chatgpt_plan',
      endpoint: 'https://api.openai.com/v1',
      label: 'ChatGPT plan',
      authMode: 'oauth_managed',
      credentialJson: '{"access_token":"must-not-cross"}',
    } as never),
    /authorized non-renderer host/,
  );
  assert.equal(createCalls, 0);
});

test('a committed connector deletion reports its audit diagnostic without becoming a failed delete', async () => {
  const diagnostic = { reasonCode: 769, actionHint: 'inspect_runtime_audit', message: 'Change committed.' };
  const reported: unknown[] = [];
  const client = createNimiRuntimeConnectorInventoryClient({
    connectors: { deleteConnector: async () => ({ ack: { ok: true }, auditDiagnostic: diagnostic }) } as never,
    onAuditDiagnostic: value => reported.push(value),
  });
  assert.deepEqual(await client.deleteConnector('connector-1'), { actionHint: null });
  assert.deepEqual(reported, [diagnostic]);
});

test('a committed ChatGPT plan deletion keeps the unconfirmed sign-out hint', async () => {
  const client = createNimiRuntimeConnectorInventoryClient({
    connectors: {
      deleteConnector: async () => ({ ack: { ok: true, reasonCode: 0, actionHint: 'chatgpt_plan_revocation_unconfirmed' } }),
    } as never,
  });
  assert.deepEqual(await client.deleteConnector('connector-plan'), { actionHint: NIMI_CHATGPT_PLAN_REVOCATION_UNCONFIRMED_ACTION_HINT });
});
