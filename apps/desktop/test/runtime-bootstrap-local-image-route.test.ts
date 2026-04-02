import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hydrateLocalRouteBindingFromOptions,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-routing.js';
import {
  buildSelectedBinding,
  loadRuntimeRouteOptions,
  pickPreferredRuntimeLocalModel,
  setLocalRoutePlatformForTests,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-options';

test('pickPreferredRuntimeLocalModel ignores removed entries and prefers active state', () => {
  const selected = pickPreferredRuntimeLocalModel([
    {
      localModelId: 'go-removed',
      modelId: 'local-import/z_image_turbo-Q4_K',
      engine: 'localai',
      status: 'removed',
    },
    {
      localModelId: 'go-active',
      modelId: 'local-import/z_image_turbo-Q4_K',
      engine: 'localai',
      status: 'active',
    },
    {
      localModelId: 'go-installed',
      modelId: 'local-import/z_image_turbo-Q4_K',
      engine: 'localai',
      status: 'installed',
    },
  ], 'local-import/z_image_turbo-Q4_K', 'localai');

  assert.deepEqual(selected, {
    localModelId: 'go-active',
    status: 'active',
  });
});

test('hydrateLocalRouteBindingFromOptions prefers fresh local model go-runtime metadata', () => {
  const hydrated = hydrateLocalRouteBindingFromOptions({
    source: 'local',
    connectorId: '',
    model: 'local-import/z_image_turbo-Q4_K',
    modelId: 'local-import/z_image_turbo-Q4_K',
    localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
    provider: 'localai',
    engine: 'localai',
    goRuntimeLocalModelId: 'go-removed',
    goRuntimeStatus: 'removed',
  }, {
    capability: 'image.generate',
    selected: {
      source: 'local',
      connectorId: '',
      model: 'local-import/z_image_turbo-Q4_K',
      modelId: 'local-import/z_image_turbo-Q4_K',
      localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
      provider: 'localai',
      engine: 'localai',
      goRuntimeLocalModelId: 'go-active',
      goRuntimeStatus: 'active',
    },
    resolvedDefault: undefined,
    local: {
      models: [{
        localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
        model: 'local-import/z_image_turbo-Q4_K',
        modelId: 'local-import/z_image_turbo-Q4_K',
        engine: 'localai',
        provider: 'localai',
        goRuntimeLocalModelId: 'go-active',
        goRuntimeStatus: 'active',
        capabilities: ['image.generate'],
      }],
    },
    connectors: [],
  });

  assert.equal(hydrated.goRuntimeLocalModelId, 'go-active');
  assert.equal(hydrated.goRuntimeStatus, 'active');
});

test('hydrateLocalRouteBindingFromOptions clears stale removed go-runtime metadata when refreshed model has none', () => {
  const hydrated = hydrateLocalRouteBindingFromOptions({
    source: 'local',
    connectorId: '',
    model: 'local-import/z_image_turbo-Q4_K',
    modelId: 'local-import/z_image_turbo-Q4_K',
    localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
    provider: 'localai',
    engine: 'localai',
    goRuntimeLocalModelId: 'go-removed',
    goRuntimeStatus: 'removed',
  }, {
    capability: 'image.generate',
    selected: {
      source: 'local',
      connectorId: '',
      model: 'local-import/z_image_turbo-Q4_K',
      modelId: 'local-import/z_image_turbo-Q4_K',
      localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
      provider: 'localai',
      engine: 'localai',
    },
    resolvedDefault: undefined,
    local: {
      models: [{
        localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
        model: 'local-import/z_image_turbo-Q4_K',
        modelId: 'local-import/z_image_turbo-Q4_K',
        engine: 'localai',
        provider: 'localai',
        capabilities: ['image.generate'],
      }],
    },
    connectors: [],
  });

  assert.equal(hydrated.goRuntimeLocalModelId, undefined);
  assert.equal(hydrated.goRuntimeStatus, undefined);
});

test('buildSelectedBinding falls back to cloud embedding connector when no local embedding model exists', () => {
  const selected = buildSelectedBinding({
    capability: 'text.embed',
    runtimeFields: {
      provider: 'localai',
      runtimeModelType: 'chat',
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'qwen2.5-7b-instruct',
      localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
      connectorId: '',
    },
    localModels: [],
    connectors: [{
      id: 'openai-main',
      label: 'OpenAI',
      provider: 'openai',
      models: ['text-embedding-3-small'],
      modelCapabilities: {
        'text-embedding-3-small': ['text.embed'],
      },
      modelProfiles: [],
    }],
    localMetadataDegraded: false,
  });

  assert.equal(selected.source, 'cloud');
  assert.equal(selected.connectorId, 'openai-main');
  assert.equal(selected.model, 'text-embedding-3-small');
});

test('buildSelectedBinding preserves local selection when local metadata is degraded', () => {
  const selected = buildSelectedBinding({
    capability: 'text.generate',
    runtimeFields: {
      provider: 'localai',
      runtimeModelType: 'chat',
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'qwen2.5-7b-instruct',
      localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
      connectorId: '',
    },
    localModels: [],
    connectors: [{
      id: 'openai-main',
      label: 'OpenAI',
      provider: 'openai',
      models: ['gpt-4.1-mini'],
      modelCapabilities: {
        'gpt-4.1-mini': ['text.generate'],
      },
      modelProfiles: [],
    }],
    localMetadataDegraded: true,
  });

  assert.equal(selected.source, 'local');
  assert.equal(selected.connectorId, '');
  assert.equal(selected.model, 'qwen2.5-7b-instruct');
  assert.equal(selected.modelId, 'qwen2.5-7b-instruct');
  assert.equal(selected.provider, 'llama');
  assert.equal(selected.engine, 'llama');
  assert.equal(selected.goRuntimeStatus, 'degraded');
});

test('buildSelectedBinding falls back to llama for text when runtime metadata is unavailable', () => {
  setLocalRoutePlatformForTests('windows');
  try {
    const selected = buildSelectedBinding({
      capability: 'text.generate',
      runtimeFields: {
        provider: 'local',
        runtimeModelType: 'chat',
        localProviderEndpoint: 'http://127.0.0.1:1234/v1',
        localProviderModel: 'qwen3-chat',
        localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
        connectorId: '',
      },
      localModels: [],
      connectors: [],
      localMetadataDegraded: true,
    });

    assert.equal(selected.source, 'local');
    assert.equal(selected.provider, 'llama');
    assert.equal(selected.engine, 'llama');
  } finally {
    setLocalRoutePlatformForTests(null);
  }
});

test('loadRuntimeRouteOptions prefers llama adapter for managed media workflow image models', async () => {
  const options = await loadRuntimeRouteOptions({
    capability: 'image.generate',
    modId: 'world.nimi.test-ai',
  }, {
    sdkListConnectors: async () => ([]),
    sdkListConnectorModelDescriptors: async () => ([]),
    loadLocalRouteMetadata: async () => ({
      snapshot: {
        assets: [],
        health: [],
        generatedAt: new Date().toISOString(),
      },
      nodeCatalog: [{
        provider: 'media',
        adapter: 'media_native_adapter',
        providerHints: {
          extra: {
            local_default_rank: 0,
          },
        },
      }] as never[],
      runtimeLocalModels: [{
        localAssetId: '01JIMAGE',
        assetId: 'local-import/z_image_turbo-Q4_K',
        kind: 'image',
        engine: 'media',
        entry: 'z_image_turbo-Q4_K.gguf',
        files: ['z_image_turbo-Q4_K.gguf'],
        license: 'apache-2.0',
        source: { repo: 'jayn7/Z-Image-Turbo-GGUF', revision: 'main' },
        integrityMode: 'verified',
        hashes: {},
        status: 'installed',
        installedAt: '2026-03-08T00:00:00Z',
        updatedAt: '2026-03-08T00:00:00Z',
        endpoint: 'http://127.0.0.1:8321/v1',
        capabilities: ['image.generate'],
        engineConfig: {
          backend: 'stablediffusion-ggml',
        },
      }] as never[],
    }),
  });

  assert.equal(options.local.models[0]?.adapter, 'llama_native_adapter');
  assert.equal(options.local.models[0]?.endpoint, 'http://127.0.0.1:8321/v1');
  assert.equal(options.selected.adapter, 'llama_native_adapter');
  assert.equal(options.selected.endpoint, 'http://127.0.0.1:8321/v1');
});
