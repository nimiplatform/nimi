import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeRouteOptionsProjection,
} from '../../src/ai/index.js';

test('route options projection orders local models from runtime default-rank and status evidence', () => {
  const snapshot = buildRuntimeRouteOptionsProjection({
    capability: 'text.generate',
    nodeCatalog: [
      {
        provider: 'llama',
        providerHints: { extra: { local_default_rank: 10 } },
      },
      {
        provider: 'speech',
        providerHints: { extra: { local_default_rank: 0 } },
      },
    ],
    runtimeLocalModels: [
      {
        localAssetId: 'local-llama-active',
        assetId: 'local/local-import/Qwen3-4B-Q4_K_M',
        kind: 'chat',
        engine: 'llama',
        status: 'active',
        endpoint: 'http://127.0.0.1:1234/v1',
        capabilities: ['text.generate'],
      },
      {
        localAssetId: 'local-speech-installed',
        assetId: 'local/SpeechTextRoute',
        kind: 'chat',
        engine: 'speech',
        status: 'installed',
        endpoint: 'http://127.0.0.1:2234/v1',
        capabilities: ['text.generate'],
      },
    ],
  });

  assert.equal(snapshot.local.models.length, 2);
  assert.equal(snapshot.local.models[0]?.localModelId, 'local-speech-installed');
  assert.equal(snapshot.local.models[0]?.label, 'SpeechTextRoute');
  assert.equal(snapshot.local.models[0]?.provider, 'speech');
  assert.equal(snapshot.local.defaultEndpoint, 'http://127.0.0.1:2234/v1');
});

test('route options projection filters connector models by projected capability evidence', () => {
  const snapshot = buildRuntimeRouteOptionsProjection({
    capability: 'text.generate',
    connectors: [{
      descriptor: {
        id: 'connector-openai',
        label: 'OpenAI',
        provider: 'openai',
        vendor: 'openai',
      },
      modelDescriptors: [
        {
          modelId: 'gpt-5.4',
          capabilities: ['text.generate'],
        },
        {
          modelId: 'image-only',
          capabilities: ['image.generate'],
        },
      ],
    }],
  });

  assert.equal(snapshot.connectors.length, 1);
  assert.deepEqual(snapshot.connectors[0]?.models, ['gpt-5.4']);
  assert.deepEqual(snapshot.connectors[0]?.modelCapabilities, {
    'gpt-5.4': ['text.generate'],
  });
});

test('route options projection does not synthesize local engine from capability alone', () => {
  const snapshot = buildRuntimeRouteOptionsProjection({
    capability: 'audio.synthesize',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'speech-route',
      modelId: 'speech-route',
      endpoint: 'http://desktop-owned.invalid/v1',
    },
    runtimeLocalModels: [{
      localAssetId: 'speech-route-local',
      assetId: 'speech-route',
      kind: 'tts',
      status: 'active',
      capabilities: ['audio.synthesize'],
    }],
  });

  assert.equal(snapshot.local.models.length, 1);
  assert.equal(snapshot.local.models[0]?.engine, undefined);
  assert.equal(snapshot.local.models[0]?.provider, undefined);
  assert.equal(snapshot.local.defaultEndpoint, undefined);
  assert.equal(snapshot.selected?.source, 'local');
  assert.equal(snapshot.selected?.engine, undefined);
  assert.equal(snapshot.selected?.provider, undefined);
});

test('route options projection can derive local engine from runtime node evidence', () => {
  const snapshot = buildRuntimeRouteOptionsProjection({
    capability: 'audio.synthesize',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'speech-route',
      modelId: 'speech-route',
    },
    nodeCatalog: [{
      provider: 'speech',
      providerHints: { extra: { local_default_rank: 0 } },
    }],
    localMetadataDegraded: true,
  });

  assert.equal(snapshot.selected?.source, 'local');
  assert.equal(snapshot.selected?.engine, 'speech');
  assert.equal(snapshot.selected?.provider, 'speech');
  assert.equal(snapshot.selected?.goRuntimeStatus, 'degraded');
});
