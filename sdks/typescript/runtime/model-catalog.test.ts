import assert from 'node:assert/strict';
import test from 'node:test';

import {
  catalogModelSourceToNimiSource,
  createNimiRuntimeModelCatalogClient,
  modelCatalogProviderSourceToNimiSource,
  nimiRuntimeCatalogModelDetailToInput,
  nimiRuntimeJsonToProtoStruct,
  nimiRuntimeProtoStructToJson,
  normalizeNimiRuntimeCatalogModelDetail,
  normalizeNimiRuntimeCatalogWarnings,
  normalizeNimiRuntimeModelCatalogProvider,
  type NimiRuntimeCatalogModelDetail,
  type NimiRuntimeCatalogVoiceEntry,
  type NimiRuntimeCatalogWorkflowBinding,
  type NimiRuntimeCatalogWorkflowModel,
  type NimiRuntimeModelCatalogConnectorClient,
} from './index';
import {
  CatalogModelSource,
  CatalogSourceKind,
  ModelCatalogProviderSource,
} from '../core-generated/runtime-typed-client';

test('Runtime model catalog client projects generated catalog data to SDK DX shapes', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options: unknown }> = [];
  const connectors = {
    async listModelCatalogProviders(request, options) {
      calls.push({ method: 'listModelCatalogProviders', request, options });
      return {
        providers: [
          {
            provider: 'zeta',
            version: 1,
            catalogVersion: '2026-06-01',
            source: ModelCatalogProviderSource.CUSTOM,
            modelCount: 1,
            voiceCount: 0,
            yaml: 'provider: zeta',
            defaultTextModel: 'zeta/chat',
            capabilities: [' text.generate ', ''],
            hasOverlay: true,
            customModelCount: 1,
            overriddenModelCount: 0,
            overlayUpdatedAt: '2026-06-04T00:00:00Z',
            effectiveYaml: 'provider: zeta',
            defaultEndpoint: 'https://zeta.example/v1',
            requiresExplicitEndpoint: true,
            runtimePlane: 'remote',
            executionModule: 'nimillm',
            managedSupported: false,
            inventoryMode: 'dynamic',
          },
          {
            provider: 'acme',
            version: 2,
            catalogVersion: '2026-06-02',
            source: ModelCatalogProviderSource.BUILTIN,
            modelCount: 1,
            voiceCount: 1,
            yaml: '',
            defaultTextModel: 'acme/chat',
            capabilities: ['vision.generate'],
            hasOverlay: false,
            customModelCount: 0,
            overriddenModelCount: 0,
            overlayUpdatedAt: '',
            effectiveYaml: '',
            defaultEndpoint: '',
            requiresExplicitEndpoint: false,
            runtimePlane: 'remote',
            executionModule: 'nimillm',
            managedSupported: true,
            inventoryMode: 'static_source',
          },
        ],
      };
    },
    async listCatalogProviderModels(request, options) {
      calls.push({ method: 'listCatalogProviderModels', request, options });
      return {
        provider: {
          provider: 'acme',
          version: 2,
          catalogVersion: '2026-06-02',
          source: ModelCatalogProviderSource.BUILTIN,
          modelCount: 1,
          voiceCount: 0,
          yaml: '',
          defaultTextModel: 'acme/chat',
          capabilities: ['text.generate'],
          hasOverlay: false,
          customModelCount: 0,
          overriddenModelCount: 0,
          overlayUpdatedAt: '',
          effectiveYaml: '',
          defaultEndpoint: '',
          requiresExplicitEndpoint: false,
          runtimePlane: 'remote',
          executionModule: 'nimillm',
          managedSupported: true,
          inventoryMode: 'static_source',
        },
        models: [
          {
            provider: 'acme',
            modelId: ' acme/chat ',
            modelType: ' text ',
            updatedAt: '2026-06-04',
            capabilities: [' text.generate ', ''],
            source: CatalogModelSource.OVERRIDDEN,
            userScoped: false,
            sourceNote: 'overlay',
            hasVoiceCatalog: true,
            hasVideoGeneration: false,
          },
        ],
        nextPageToken: 'next',
        warnings: [{ code: 'W_OVERLAY', message: 'overlay active' }],
      };
    },
    async getCatalogModelDetail(request, options) {
      calls.push({ method: 'getCatalogModelDetail', request, options });
      return {
        provider: {
          provider: 'acme',
          version: 2,
          catalogVersion: '2026-06-02',
          source: ModelCatalogProviderSource.BUILTIN,
          modelCount: 1,
          voiceCount: 1,
          yaml: '',
          defaultTextModel: 'acme/chat',
          capabilities: ['text.generate'],
          hasOverlay: false,
          customModelCount: 0,
          overriddenModelCount: 0,
          overlayUpdatedAt: '',
          effectiveYaml: '',
          defaultEndpoint: '',
          requiresExplicitEndpoint: false,
          runtimePlane: 'remote',
          executionModule: 'nimillm',
          managedSupported: true,
          inventoryMode: 'static_source',
        },
        model: {
          provider: 'acme',
          modelId: 'acme/video',
          modelType: 'video',
          updatedAt: '2026-06-04',
          capabilities: ['video.generate'],
          source: CatalogModelSource.CUSTOM,
          userScoped: true,
          sourceNote: 'user overlay',
          hasVoiceCatalog: false,
          hasVideoGeneration: true,
          pricing: {
            unit: 'second',
            input: '1',
            output: '2',
            currency: 'USD',
            asOf: '2026-06-04',
            notes: 'test',
          },
          voiceSetId: '',
          voiceDiscoveryMode: '',
          voiceRefKinds: [],
          videoGeneration: {
            modes: ['t2v'],
            inputRoles: [{ key: 'prompt', values: ['text'] }],
            limits: nimiRuntimeJsonToProtoStruct({ durationSec: 8 }),
            optionSupports: ['seed'],
            optionConstraints: nimiRuntimeJsonToProtoStruct({ seed: true }),
            outputs: { videoUrl: true, lastFrameUrl: false },
          },
          sourceRef: {
            sourceKind: CatalogSourceKind.AUTHENTICATED_PROVIDER_INVENTORY,
            url: 'https://example.com/catalog',
            retrievedAt: '2026-06-04',
            note: 'fixture',
          },
          warnings: [],
          voices: [],
          voiceWorkflowModels: [],
        },
        warnings: [],
      };
    },
    async upsertModelCatalogProvider() {
      throw new Error('unused');
    },
    async deleteModelCatalogProvider() {
      throw new Error('unused');
    },
    async upsertCatalogModelOverlay() {
      throw new Error('unused');
    },
    async deleteCatalogModelOverlay() {
      throw new Error('unused');
    },
  } satisfies NimiRuntimeModelCatalogConnectorClient;

  const client = createNimiRuntimeModelCatalogClient({
    connectors,
    callOptions: { metadata: { 'x-test': 'catalog' }, timeoutMs: 100 },
  });

  const providers = await client.listProviders();
  assert.deepEqual(providers.map((provider) => provider.provider), ['acme', 'zeta']);
  assert.equal(providers[0]?.source, 'builtin');
  assert.equal(providers[1]?.source, 'custom');
  assert.deepEqual(providers[1]?.capabilities, ['text.generate']);

  const models = await client.listProviderModels(' acme ', 25, 'cursor-1');
  assert.equal(models.models[0]?.source, 'overridden');
  assert.deepEqual(models.models[0]?.capabilities, ['text.generate']);
  assert.deepEqual(models.warnings, [{ code: 'W_OVERLAY', message: 'overlay active' }]);

  const detail = await client.getModelDetail('acme', 'acme/video');
  assert.equal(detail.model.source, 'custom');
  assert.equal(detail.model.videoGeneration?.limits.durationSec, 8);
  assert.equal(detail.model.videoGeneration?.optionConstraints.seed, true);

  assert.deepEqual(calls[1], {
    method: 'listCatalogProviderModels',
    request: { provider: 'acme', pageSize: 25, pageToken: 'cursor-1' },
    options: { metadata: { 'x-test': 'catalog' }, timeoutMs: 100 },
  });
});

test('Runtime model catalog projection normalizes sources, warnings, voices, workflows, and JSON structs', () => {
  assert.equal(modelCatalogProviderSourceToNimiSource(ModelCatalogProviderSource.BUILTIN), 'builtin');
  assert.equal(modelCatalogProviderSourceToNimiSource(ModelCatalogProviderSource.CUSTOM), 'custom');
  assert.equal(modelCatalogProviderSourceToNimiSource(ModelCatalogProviderSource.OVERRIDDEN), 'overridden');
  assert.equal(modelCatalogProviderSourceToNimiSource(ModelCatalogProviderSource.REMOTE), 'remote');
  assert.equal(modelCatalogProviderSourceToNimiSource(undefined), 'unknown');
  assert.equal(catalogModelSourceToNimiSource(CatalogModelSource.BUILTIN), 'builtin');
  assert.equal(catalogModelSourceToNimiSource(CatalogModelSource.CUSTOM), 'custom');
  assert.equal(catalogModelSourceToNimiSource(CatalogModelSource.OVERRIDDEN), 'overridden');
  assert.equal(catalogModelSourceToNimiSource(undefined), 'unknown');
  assert.deepEqual(normalizeNimiRuntimeCatalogWarnings(undefined), []);
  assert.equal(normalizeNimiRuntimeModelCatalogProvider(undefined).source, 'unknown');

  const struct = nimiRuntimeJsonToProtoStruct({
    enabled: true,
    durationSec: 8,
    label: 'preview',
    nested: { seed: 42 },
    values: [1, 'two', false, null],
    missing: null,
  });
  assert.deepEqual(nimiRuntimeProtoStructToJson(struct), {
    enabled: true,
    durationSec: 8,
    label: 'preview',
    nested: { seed: 42 },
    values: [1, 'two', false, null],
    missing: null,
  });

  const detail = normalizeNimiRuntimeCatalogModelDetail({
    provider: 'acme',
    modelId: 'acme/voice-video',
    modelType: 'video',
    updatedAt: '2026-06-05',
    capabilities: [' video.generate ', ''],
    source: CatalogModelSource.BUILTIN,
    userScoped: false,
    sourceNote: 'builtin',
    hasVoiceCatalog: true,
    hasVideoGeneration: true,
    pricing: {
      unit: 'second',
      input: '1',
      output: '2',
      currency: 'USD',
      asOf: '2026-06-05',
      notes: 'fixture',
    },
    voiceSetId: 'voice-set-1',
    voiceDiscoveryMode: 'catalog',
    voiceRefKinds: ['named', ''],
    videoGeneration: undefined,
    sourceRef: {
      sourceKind: CatalogSourceKind.AUTHENTICATED_PROVIDER_INVENTORY,
      url: 'https://example.com/catalog',
      retrievedAt: '2026-06-05',
      note: 'fixture',
    },
    warnings: [{ code: 'W_ONE', message: 'one' }],
    voices: [{
      voiceSetId: 'voice-set-1',
      provider: 'acme',
      voiceId: 'voice-1',
      name: 'Voice One',
      langs: [' en ', ''],
      modelIds: ['acme/voice-video'],
      sourceRef: {
        sourceKind: CatalogSourceKind.PROVIDER_DOCUMENTATION,
        url: 'https://example.com/voices',
        retrievedAt: '2026-06-05',
        note: 'voices',
      },
    }],
    voiceWorkflowModels: [{
      workflowModelId: 'workflow-1',
      workflowType: 'speech',
      inputContractRef: 'contract/input',
      outputPersistence: 'artifact',
      targetModelRefs: ['acme/voice-video'],
      langs: ['en'],
      sourceRef: {
        sourceKind: CatalogSourceKind.PROVIDER_DOCUMENTATION,
        url: 'https://example.com/workflows',
        retrievedAt: '2026-06-05',
        note: 'workflows',
      },
    }],
    modelWorkflowBinding: {
      modelId: 'acme/voice-video',
      workflowModelRefs: ['workflow-1'],
      workflowTypes: ['speech'],
    },
  });

  assert.equal(detail.source, 'builtin');
  assert.equal(detail.sourceRef.sourceKind, 'authenticated_provider_inventory');
  assert.equal(detail.videoGeneration, null);
  assert.deepEqual(detail.voiceRefKinds, ['named']);
  assert.equal(detail.voices[0]?.langs[0], 'en');
  assert.equal(detail.voiceWorkflowModels[0]?.workflowModelId, 'workflow-1');
  assert.deepEqual(detail.modelWorkflowBinding, {
    modelId: 'acme/voice-video',
    workflowModelRefs: ['workflow-1'],
    workflowTypes: ['speech'],
  });

  const input = nimiRuntimeCatalogModelDetailToInput(' acme ', catalogDetailFixture());
  assert.equal(input.provider, 'acme');
  assert.equal(input.videoGeneration?.limits.fields.durationSec?.kind.oneofKind, 'numberValue');
  assert.equal(input.videoGeneration?.optionConstraints.fields.seed?.kind.oneofKind, 'boolValue');
});

test('Runtime model catalog client maps provider and model overlay write operations', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options: unknown }> = [];
  const callOptions = { metadata: { caller: 'catalog-writes' } };
  const detail = catalogDetailFixture();
  const voice = catalogVoiceFixture();
  const workflow = catalogWorkflowFixture();
  const binding = catalogWorkflowBindingFixture();
  const connectors = {
    async listModelCatalogProviders(request, options) {
      calls.push({ method: 'listModelCatalogProviders', request, options });
      return { providers: [] };
    },
    async listCatalogProviderModels(request, options) {
      calls.push({ method: 'listCatalogProviderModels', request, options });
      return {
        provider: providerEntry('acme'),
        models: [],
        nextPageToken: '',
        warnings: [],
      };
    },
    async getCatalogModelDetail(request, options) {
      calls.push({ method: 'getCatalogModelDetail', request, options });
      return {
        provider: providerEntry('acme'),
        model: detail,
        warnings: [],
      };
    },
    async upsertModelCatalogProvider(request, options) {
      calls.push({ method: 'upsertModelCatalogProvider', request, options });
      return { provider: { ...providerEntry('custom'), source: ModelCatalogProviderSource.REMOTE } };
    },
    async deleteModelCatalogProvider(request, options) {
      calls.push({ method: 'deleteModelCatalogProvider', request, options });
      return {};
    },
    async upsertCatalogModelOverlay(request, options) {
      calls.push({ method: 'upsertCatalogModelOverlay', request, options });
      return {
        provider: providerEntry('acme'),
        model: detail,
        warnings: [{ code: 'W_OVERLAY', message: 'overlay active' }],
      };
    },
    async deleteCatalogModelOverlay(request, options) {
      calls.push({ method: 'deleteCatalogModelOverlay', request, options });
      return { provider: { ...providerEntry('acme'), hasOverlay: false } };
    },
  } satisfies NimiRuntimeModelCatalogConnectorClient;
  const client = createNimiRuntimeModelCatalogClient({ connectors, callOptions });

  await client.listProviderModels('acme', 0, '');
  await client.listProviderModels('acme', 2.9, 'next');
  assert.equal((await client.upsertProvider(' custom ', 'provider: custom')).source, 'remote');
  await client.deleteProvider(' custom ');
  const upserted = await client.upsertModelOverlay(' acme ', {
    model: detail,
    voices: [voice],
    voiceWorkflowModels: [workflow],
    modelWorkflowBinding: binding,
  });
  assert.equal(upserted.warnings[0]?.code, 'W_OVERLAY');
  assert.equal((await client.deleteModelOverlay('acme', ' acme/video ')).provider, 'acme');

  assert.deepEqual(calls.map((call) => call.method), [
    'listCatalogProviderModels',
    'listCatalogProviderModels',
    'upsertModelCatalogProvider',
    'deleteModelCatalogProvider',
    'upsertCatalogModelOverlay',
    'deleteCatalogModelOverlay',
  ]);
  assert.equal((calls[0]?.request as { pageSize?: number }).pageSize, 500);
  assert.equal((calls[1]?.request as { pageSize?: number }).pageSize, 2);
  assert.deepEqual(calls[2], {
    method: 'upsertModelCatalogProvider',
    request: { provider: 'custom', yaml: 'provider: custom' },
    options: callOptions,
  });
  const overlayRequest = calls[4]?.request as {
    readonly provider?: string;
    readonly model?: {
      readonly provider?: string;
      readonly sourceRef?: { readonly sourceKind?: CatalogSourceKind };
      readonly videoGeneration?: { readonly limits?: { readonly fields?: Record<string, unknown> } };
    };
    readonly voices?: readonly { readonly provider?: string; readonly voiceId?: string }[];
    readonly voiceWorkflowModels?: readonly { readonly workflowModelId?: string }[];
    readonly modelWorkflowBinding?: { readonly modelId?: string; readonly workflowTypes?: readonly string[] };
  };
  assert.equal(overlayRequest.provider, 'acme');
  assert.equal(overlayRequest.model?.provider, 'acme');
  assert.equal(overlayRequest.model?.sourceRef?.sourceKind, CatalogSourceKind.PROVIDER_DOCUMENTATION);
  assert.equal(overlayRequest.voices?.[0]?.provider, 'acme');
  assert.equal(overlayRequest.voices?.[0]?.voiceId, 'voice-1');
  assert.equal(overlayRequest.voiceWorkflowModels?.[0]?.workflowModelId, 'workflow-1');
  assert.deepEqual(overlayRequest.modelWorkflowBinding?.workflowTypes, ['video.generate']);
  assert.equal((calls[5]?.request as { modelId?: string }).modelId, 'acme/video');

  await assert.rejects(
    client.upsertProvider('custom', ''),
    hasCatalogReasonCode('SDK_RUNTIME_MODEL_CATALOG_INPUT_INVALID'),
  );
  await assert.rejects(
    client.deleteModelOverlay('acme', ''),
    hasCatalogReasonCode('SDK_RUNTIME_MODEL_CATALOG_INPUT_INVALID'),
  );
});

test('Runtime model catalog client fails closed on missing provider/model inputs', async () => {
  const connectors = {
    async listModelCatalogProviders() {
      return { providers: [] };
    },
    async listCatalogProviderModels() {
      return { models: [], nextPageToken: '', warnings: [] };
    },
    async getCatalogModelDetail() {
      return { warnings: [] };
    },
    async upsertModelCatalogProvider() {
      throw new Error('unused');
    },
    async deleteModelCatalogProvider() {
      throw new Error('unused');
    },
    async upsertCatalogModelOverlay() {
      throw new Error('unused');
    },
    async deleteCatalogModelOverlay() {
      throw new Error('unused');
    },
  } satisfies NimiRuntimeModelCatalogConnectorClient;
  const client = createNimiRuntimeModelCatalogClient({ connectors });

  await assert.rejects(
    client.listProviderModels(' '),
    (error: unknown) => {
      const shaped = error as { code?: string; actionHint?: string };
      assert.equal(shaped.code, 'SDK_RUNTIME_MODEL_CATALOG_INPUT_INVALID');
      assert.equal(shaped.actionHint, 'provide_catalog_provider');
      return true;
    },
  );

  await assert.rejects(
    client.getModelDetail('acme', ''),
    (error: unknown) => {
      const shaped = error as { code?: string; actionHint?: string };
      assert.equal(shaped.code, 'SDK_RUNTIME_MODEL_CATALOG_INPUT_INVALID');
      assert.equal(shaped.actionHint, 'provide_catalog_model_id');
      return true;
    },
  );
});

function providerEntry(provider: string) {
  return {
    provider,
    version: 1,
    catalogVersion: '2026-06-05',
    source: ModelCatalogProviderSource.BUILTIN,
    modelCount: 1,
    voiceCount: 1,
    yaml: `provider: ${provider}`,
    defaultTextModel: `${provider}/chat`,
    capabilities: ['text.generate'],
    hasOverlay: true,
    customModelCount: 0,
    overriddenModelCount: 1,
    overlayUpdatedAt: '2026-06-05T00:00:00Z',
    effectiveYaml: `provider: ${provider}`,
    defaultEndpoint: 'https://example.com/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'remote',
    executionModule: 'nimillm',
    managedSupported: true,
    inventoryMode: 'static_source',
  };
}

function catalogDetailFixture(): NimiRuntimeCatalogModelDetail {
  return {
    provider: 'acme',
    modelId: 'acme/video',
    modelType: 'video',
    updatedAt: '2026-06-05',
    capabilities: ['video.generate'],
    source: 'custom',
    userScoped: true,
    sourceNote: 'overlay',
    hasVoiceCatalog: true,
    hasVideoGeneration: true,
    pricing: {
      unit: 'second',
      input: '1',
      output: '2',
      currency: 'USD',
      asOf: '2026-06-05',
      notes: 'fixture',
    },
    voiceSetId: 'voice-set-1',
    voiceDiscoveryMode: 'catalog',
    voiceRefKinds: ['named'],
    videoGeneration: {
      modes: ['text-to-video'],
      inputRoles: [{ key: 'prompt', values: ['text'] }],
      limits: { durationSec: 8, nested: { enabled: true }, values: [1, 'two', null] },
      optionSupports: ['seed'],
      optionConstraints: { seed: true },
      outputs: { videoUrl: true, lastFrameUrl: true },
    },
    sourceRef: {
      sourceKind: 'provider_documentation',
      url: 'https://example.com/catalog',
      retrievedAt: '2026-06-05',
      note: 'fixture',
    },
    warnings: [{ code: 'W_DETAIL', message: 'detail warning' }],
    voices: [catalogVoiceFixture()],
    voiceWorkflowModels: [catalogWorkflowFixture()],
    modelWorkflowBinding: catalogWorkflowBindingFixture(),
  };
}

function catalogVoiceFixture(): NimiRuntimeCatalogVoiceEntry {
  return {
    voiceSetId: 'voice-set-1',
    provider: 'ignored-provider',
    voiceId: 'voice-1',
    name: 'Voice One',
    langs: ['en', 'ja'],
    modelIds: ['acme/video'],
    sourceRef: {
      sourceKind: 'provider_documentation',
      url: 'https://example.com/voices',
      retrievedAt: '2026-06-05',
      note: 'voices',
    },
  };
}

function catalogWorkflowFixture(): NimiRuntimeCatalogWorkflowModel {
  return {
    workflowModelId: 'workflow-1',
    workflowType: 'video.generate',
    inputContractRef: 'contract/video-input',
    outputPersistence: 'artifact',
    targetModelRefs: ['acme/video'],
    langs: ['en'],
    sourceRef: {
      sourceKind: 'provider_documentation',
      url: 'https://example.com/workflows',
      retrievedAt: '2026-06-05',
      note: 'workflows',
    },
  };
}

function catalogWorkflowBindingFixture(): NimiRuntimeCatalogWorkflowBinding {
  return {
    modelId: 'acme/video',
    workflowModelRefs: ['workflow-1'],
    workflowTypes: ['video.generate'],
  };
}

function hasCatalogReasonCode(reasonCode: string): (error: unknown) => boolean {
  return (error: unknown) => {
    const shaped = error as { readonly reasonCode?: string; readonly code?: string };
    assert.equal(shaped.reasonCode ?? shaped.code, reasonCode);
    return true;
  };
}
