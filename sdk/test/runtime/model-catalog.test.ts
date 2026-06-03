import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogModelSource,
  ModelCatalogProviderSource,
  createRuntimeModelCatalogClient,
  normalizeRuntimeCatalogModelDetail,
  normalizeRuntimeModelCatalogProvider,
  runtimeJsonToProtoStruct,
  runtimeProtoStructToJson,
  type CatalogModelDetail,
  type ModelCatalogProviderEntry,
  type RuntimeModelCatalogConnectorClient,
} from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';

function providerEntry(overrides: Partial<ModelCatalogProviderEntry> = {}): ModelCatalogProviderEntry {
  return {
    provider: 'openai',
    version: 1,
    catalogVersion: '2026-03-15',
    source: ModelCatalogProviderSource.OVERRIDDEN,
    inventoryMode: 'static_source',
    modelCount: 12,
    voiceCount: 4,
    yaml: 'provider: openai',
    defaultTextModel: 'gpt-5.2',
    capabilities: ['text.generate', 'audio.synthesize'],
    hasOverlay: true,
    customModelCount: 1,
    overriddenModelCount: 2,
    overlayUpdatedAt: '2026-03-15T12:00:00Z',
    effectiveYaml: 'effective: true',
    defaultEndpoint: 'https://api.openai.com/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'remote',
    executionModule: 'nimillm',
    managedSupported: true,
    ...overrides,
  };
}

function createMockCatalogConnector(label: string, calls: string[]): RuntimeModelCatalogConnectorClient {
  return {
    async listModelCatalogProviders() {
      calls.push(`${label}:listModelCatalogProviders`);
      return {
        providers: [
          providerEntry({ provider: 'zeta' }),
          providerEntry({ provider: 'alpha', source: ModelCatalogProviderSource.BUILTIN }),
        ],
      };
    },
    async listCatalogProviderModels(request) {
      calls.push(`${label}:listCatalogProviderModels:${request.provider}:${request.pageSize}:${request.pageToken}`);
      return {
        provider: providerEntry({ provider: request.provider }),
        models: [{
          provider: request.provider,
          modelId: 'sora-2',
          modelType: 'video',
          updatedAt: '2026-03-15',
          capabilities: ['video.generate'],
          source: CatalogModelSource.CUSTOM,
          userScoped: true,
          sourceNote: 'test',
          hasVoiceCatalog: false,
          hasVideoGeneration: true,
        }],
        nextPageToken: '',
        warnings: [{ code: 'test_warning', message: 'Test warning' }],
      };
    },
    async getCatalogModelDetail(request) {
      calls.push(`${label}:getCatalogModelDetail:${request.provider}:${request.modelId}`);
      return {
        provider: providerEntry({ provider: request.provider }),
        model: modelDetail({ provider: request.provider, modelId: request.modelId }),
        warnings: [],
      };
    },
    async upsertModelCatalogProvider(request) {
      calls.push(`${label}:upsertModelCatalogProvider:${request.provider}:${request.yaml}`);
      return { provider: providerEntry({ provider: request.provider, yaml: request.yaml }) };
    },
    async deleteModelCatalogProvider(request) {
      calls.push(`${label}:deleteModelCatalogProvider:${request.provider}`);
      return {};
    },
    async upsertCatalogModelOverlay(request) {
      calls.push(`${label}:upsertCatalogModelOverlay:${request.provider}:${request.model?.modelId || ''}:${request.voices.length}`);
      return {
        provider: providerEntry({ provider: request.provider }),
        model: modelDetail({ provider: request.provider, modelId: request.model?.modelId || '' }),
        warnings: [],
      };
    },
    async deleteCatalogModelOverlay(request) {
      calls.push(`${label}:deleteCatalogModelOverlay:${request.provider}:${request.modelId}`);
      return { provider: providerEntry({ provider: request.provider }) };
    },
  };
}

function modelDetail(overrides: Partial<CatalogModelDetail> = {}): CatalogModelDetail {
  return {
    provider: 'openai',
    modelId: 'sora-2',
    modelType: 'video',
    updatedAt: '2026-03-15',
    capabilities: ['video.generate'],
    pricing: { unit: 'request', input: 'unknown', output: 'unknown', currency: 'USD', asOf: '2026-03-15', notes: 'unknown' },
    voiceSetId: '',
    voiceDiscoveryMode: '',
    voiceRefKinds: [],
    videoGeneration: {
      modes: ['t2v'],
      inputRoles: [{ key: 't2v', values: ['prompt'] }],
      limits: runtimeJsonToProtoStruct({ duration_sec: { min: 1, max: 8 } }),
      optionSupports: ['duration_sec'],
      optionConstraints: runtimeJsonToProtoStruct({}),
      outputs: { videoUrl: true, lastFrameUrl: false },
    },
    sourceRef: { url: 'https://example.com', retrievedAt: '2026-03-15', note: 'docs' },
    source: CatalogModelSource.CUSTOM,
    userScoped: true,
    warnings: [{ code: 'user_custom_model', message: 'Visible only to current user.' }],
    voices: [],
    voiceWorkflowModels: [],
    modelWorkflowBinding: undefined,
    ...overrides,
  };
}

test('normalizeRuntimeModelCatalogProvider maps overlay metadata and overridden source', () => {
  const normalized = normalizeRuntimeModelCatalogProvider(providerEntry());
  assert.equal(normalized.source, 'overridden');
  assert.equal(normalized.customModelCount, 1);
  assert.equal(normalized.overriddenModelCount, 2);
  assert.equal(normalized.effectiveYaml, 'effective: true');
});

test('runtimeProtoStructToJson and runtimeJsonToProtoStruct round-trip nested data', () => {
  const input = {
    duration_sec: { min: 1, max: 8 },
    service_tier: ['standard'],
    watermark: false,
  };
  assert.deepEqual(runtimeProtoStructToJson(runtimeJsonToProtoStruct(input)), input);
});

test('normalizeRuntimeCatalogModelDetail maps video generation and warnings', () => {
  const normalized = normalizeRuntimeCatalogModelDetail(modelDetail());
  assert.equal(normalized.source, 'custom');
  assert.equal(normalized.videoGeneration?.outputs.videoUrl, true);
  assert.deepEqual(normalized.videoGeneration?.limits, { duration_sec: { min: 1, max: 8 } });
  assert.equal(normalized.warnings[0]?.code, 'user_custom_model');
});

test('createRuntimeModelCatalogClient normalizes Runtime catalog reads and writes', async () => {
  const calls: string[] = [];
  const client = createRuntimeModelCatalogClient({
    connector: () => createMockCatalogConnector('primary', calls),
    callOptions: { metadata: { callerKind: 'third-party-app', callerId: 'sdk-test', surfaceId: 'sdk.test' } },
  });

  const providers = await client.listProviders();
  assert.deepEqual(providers.map((provider) => provider.provider), ['alpha', 'zeta']);

  const models = await client.listProviderModels('openai', 100, 'next');
  assert.equal(models.models[0]?.source, 'custom');
  assert.equal(models.warnings[0]?.code, 'test_warning');

  const detail = await client.getModelDetail('openai', 'sora-2');
  assert.equal(detail.model.videoGeneration?.modes[0], 't2v');

  await client.upsertProvider('openai', 'provider: openai');
  await client.deleteProvider('openai');
  await client.upsertModelOverlay('openai', { model: detail.model, voices: [{ voiceSetId: 'voices', provider: 'openai', voiceId: 'alloy', name: 'Alloy', langs: ['en'], modelIds: ['sora-2'], sourceRef: { url: 'https://example.com', retrievedAt: '2026-03-15', note: 'docs' } }] });
  await client.deleteModelOverlay('openai', 'sora-2');

  assert.deepEqual(calls, [
    'primary:listModelCatalogProviders',
    'primary:listCatalogProviderModels:openai:100:next',
    'primary:getCatalogModelDetail:openai:sora-2',
    'primary:upsertModelCatalogProvider:openai:provider: openai',
    'primary:deleteModelCatalogProvider:openai',
    'primary:upsertCatalogModelOverlay:openai:sora-2:1',
    'primary:deleteCatalogModelOverlay:openai:sora-2',
  ]);
});

test('createRuntimeModelCatalogClient fails closed on invalid auth token reads', async () => {
  const calls: string[] = [];
  const primary = createMockCatalogConnector('primary', calls);
  primary.listModelCatalogProviders = async () => {
    calls.push('primary:listModelCatalogProviders');
    throw Object.assign(new Error('auth token invalid'), { reasonCode: ReasonCode.AUTH_TOKEN_INVALID });
  };
  const client = createRuntimeModelCatalogClient({
    connector: () => primary,
  });

  await assert.rejects(
    () => client.listProviders(),
    (error) => error instanceof Error
      && error.message === 'auth token invalid'
      && (error as Error & { reasonCode?: string }).reasonCode === ReasonCode.AUTH_TOKEN_INVALID,
  );

  assert.deepEqual(calls, [
    'primary:listModelCatalogProviders',
  ]);
});
