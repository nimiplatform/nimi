import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hydrateLocalRouteBindingFromOptions,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-routing.js';
import {
  buildSelectedBinding,
  loadRuntimeRouteOptions,
  pickPreferredRuntimeLocalModel,
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

test('hydrateLocalRouteBindingFromOptions rewrites stale ULID model fields to the authoritative assetId', () => {
  const hydrated = hydrateLocalRouteBindingFromOptions({
    source: 'local',
    connectorId: '',
    model: '01KK5M5ZNHWYK9WV1QWKSW48WG',
    modelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
    localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
    provider: 'media',
    engine: 'media',
  }, {
    capability: 'image.generate',
    selected: {
      source: 'local',
      connectorId: '',
      model: 'local-import/z_image_turbo-Q4_K',
      modelId: 'local-import/z_image_turbo-Q4_K',
      localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
      provider: 'media',
      engine: 'media',
    },
    resolvedDefault: undefined,
    local: {
      models: [{
        localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
        model: 'local-import/z_image_turbo-Q4_K',
        modelId: 'local-import/z_image_turbo-Q4_K',
        engine: 'media',
        provider: 'media',
        capabilities: ['image.generate'],
      }],
    },
    connectors: [],
  });

  assert.equal(hydrated.model, 'local-import/z_image_turbo-Q4_K');
  assert.equal(hydrated.modelId, 'local-import/z_image_turbo-Q4_K');
  assert.equal(hydrated.localModelId, '01KK5M5ZNHWYK9WV1QWKSW48WG');
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

test('buildSelectedBinding keeps selection missing when no explicit binding exists', () => {
  const selected = buildSelectedBinding({
    capability: 'text.embed',
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

  assert.equal(selected, null);
});

test('buildSelectedBinding preserves local selection when local metadata is degraded', () => {
  const selected = buildSelectedBinding({
    capability: 'text.generate',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'qwen2.5-7b-instruct',
      modelId: 'qwen2.5-7b-instruct',
      provider: 'llama',
      engine: 'llama',
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

  assert.ok(selected);
  assert.equal(selected.source, 'local');
  assert.equal(selected.connectorId, '');
  assert.equal(selected.model, 'qwen2.5-7b-instruct');
  assert.equal(selected.modelId, 'qwen2.5-7b-instruct');
  assert.equal(selected.provider, 'llama');
  assert.equal(selected.engine, 'llama');
  assert.equal(selected.goRuntimeStatus, 'degraded');
});

test('buildSelectedBinding keeps selection missing instead of inventing a local fallback when runtime metadata is unavailable', () => {
  const selected = buildSelectedBinding({
    capability: 'text.generate',
    localModels: [],
    connectors: [],
    localMetadataDegraded: true,
  });

  assert.equal(selected, null);
});

test('buildSelectedBinding infers speech engine for local audio.synthesize bindings without explicit engine', () => {
  const selected = buildSelectedBinding({
    capability: 'audio.synthesize',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'speech/kokoro-82m',
      modelId: 'speech/kokoro-82m',
      provider: 'local',
    },
    localModels: [],
    connectors: [],
    localMetadataDegraded: true,
  });

  assert.ok(selected);
  assert.equal(selected?.source, 'local');
  assert.equal(selected?.engine, 'speech');
  assert.equal(selected?.provider, 'speech');
  assert.equal(selected?.goRuntimeStatus, 'degraded');
});

test('buildSelectedBinding infers speech engine for local audio.transcribe bindings without explicit engine', () => {
  const selected = buildSelectedBinding({
    capability: 'audio.transcribe',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'speech/whisper-large-v3',
      modelId: 'speech/whisper-large-v3',
      provider: 'local',
    },
    localModels: [],
    connectors: [],
    localMetadataDegraded: true,
  });

  assert.ok(selected);
  assert.equal(selected?.source, 'local');
  assert.equal(selected?.engine, 'speech');
  assert.equal(selected?.provider, 'speech');
  assert.equal(selected?.goRuntimeStatus, 'degraded');
});

test('buildSelectedBinding infers speech engine for local voice clone bindings without explicit engine', () => {
  const selected = buildSelectedBinding({
    capability: 'voice_workflow.tts_v2v',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'speech/qwen3tts-base',
      modelId: 'speech/qwen3tts-base',
      provider: 'local',
    },
    localModels: [],
    connectors: [],
    localMetadataDegraded: true,
  });

  assert.ok(selected);
  assert.equal(selected?.source, 'local');
  assert.equal(selected?.engine, 'speech');
  assert.equal(selected?.provider, 'speech');
  assert.equal(selected?.goRuntimeStatus, 'degraded');
});

test('buildSelectedBinding infers speech engine for local voice design bindings without explicit engine', () => {
  const selected = buildSelectedBinding({
    capability: 'voice_workflow.tts_t2v',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'speech/qwen3tts-design',
      modelId: 'speech/qwen3tts-design',
      provider: 'local',
    },
    localModels: [],
    connectors: [],
    localMetadataDegraded: true,
  });

  assert.ok(selected);
  assert.equal(selected?.source, 'local');
  assert.equal(selected?.engine, 'speech');
  assert.equal(selected?.provider, 'speech');
  assert.equal(selected?.goRuntimeStatus, 'degraded');
});

test('loadRuntimeRouteOptions preserves media routing for managed image workflow models', async () => {
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

  assert.equal(options.local.models[0]?.adapter, undefined);
  assert.equal(options.local.models[0]?.endpoint, 'http://127.0.0.1:8321/v1');
  assert.equal(options.selected, null);
  assert.equal(options.resolvedDefault?.endpoint, 'http://127.0.0.1:8321/v1');
});

test('loadRuntimeRouteOptions keeps local assets selectable when go runtime only exposes kind metadata', async () => {
  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
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
        provider: 'llama',
        providerHints: {
          extra: {
            local_default_rank: 0,
          },
        },
      }] as never[],
      runtimeLocalModels: [{
        localAssetId: '01KLOCALCHAT',
        assetId: 'local/Gemma-4-27B-it-Q4_K_M',
        kind: 'chat',
        engine: 'llama',
        entry: 'Gemma-4-27B-it-Q4_K_M.gguf',
        files: ['Gemma-4-27B-it-Q4_K_M.gguf'],
        license: 'apache-2.0',
        source: { repo: 'google/gemma', revision: 'main' },
        integrityMode: 'verified',
        hashes: {},
        status: 'active',
        installedAt: '2026-03-08T00:00:00Z',
        updatedAt: '2026-03-08T00:00:00Z',
        endpoint: 'http://127.0.0.1:1234/v1',
        capabilities: [],
        engineConfig: {},
      }] as never[],
    }),
  });

  assert.equal(options.local.models.length, 1);
  assert.equal(options.local.models[0]?.model, 'local/Gemma-4-27B-it-Q4_K_M');
  assert.deepEqual(options.local.models[0]?.capabilities, ['text.generate']);
  assert.equal(options.resolvedDefault?.source, 'local');
  assert.equal(options.resolvedDefault?.model, 'local/Gemma-4-27B-it-Q4_K_M');
});
