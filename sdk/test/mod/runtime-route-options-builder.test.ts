import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeRouteOptionsSnapshot,
  buildRuntimeRouteSelectedBinding,
  runtimeRouteLocalKindSupportsCapability,
  runtimeRouteModelSupportsCapability,
} from '../../src/mod/runtime-route-options.js';

test('runtime route model capability matcher accepts local aliases and workflow routing aliases', () => {
  assert.equal(runtimeRouteModelSupportsCapability(['chat'], 'text.generate'), true);
  assert.equal(runtimeRouteModelSupportsCapability(['tts'], 'voice_workflow.tts_t2v'), true);
  assert.equal(runtimeRouteModelSupportsCapability(['speech.transcribe'], 'audio.transcribe'), true);
  assert.equal(runtimeRouteModelSupportsCapability(['image'], 'text.generate'), false);
});

test('runtime route local kind matcher keeps kind fallback for local assets without canonical capabilities', () => {
  assert.equal(runtimeRouteLocalKindSupportsCapability('chat', 'text.generate'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability('stt', 'audio.transcribe'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability('image', 'text.generate'), false);
});

test('buildRuntimeRouteSelectedBinding preserves degraded local selection when local metadata is unavailable', () => {
  const selected = buildRuntimeRouteSelectedBinding({
    capability: 'text.generate',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'qwen-local',
      modelId: 'qwen-local',
      provider: 'llama',
    },
    localModels: [],
    connectors: [],
    localMetadataDegraded: true,
    runtimeDefaultEngine: 'llama',
  });

  assert.deepEqual(selected, {
    source: 'local',
    connectorId: '',
    model: 'qwen-local',
    modelId: 'qwen-local',
    provider: 'llama',
    engine: 'llama',
    goRuntimeStatus: 'degraded',
  });
});

test('buildRuntimeRouteOptionsSnapshot picks local default first and hydrates cloud provider from connector options', () => {
  const snapshot = buildRuntimeRouteOptionsSnapshot({
    capability: 'text.generate',
    selectedBinding: {
      source: 'cloud',
      connectorId: 'connector-openai',
      model: 'gpt-4.1-mini',
    },
    localModels: [{
      localModelId: 'local-qwen',
      model: 'local/Qwen3-4B-Q4_K_M',
      modelId: 'local/Qwen3-4B-Q4_K_M',
      provider: 'llama',
      engine: 'llama',
      capabilities: ['chat'],
    }],
    connectors: [{
      id: 'connector-openai',
      label: 'OpenAI',
      provider: 'openai',
      models: ['gpt-4.1-mini'],
      modelCapabilities: {
        'gpt-4.1-mini': ['text.generate'],
      },
      modelProfiles: [],
    }],
    defaultLocalEndpoint: 'http://127.0.0.1:1234/v1',
  });

  assert.equal(snapshot.selected?.source, 'cloud');
  assert.equal(snapshot.selected?.provider, 'openai');
  assert.equal(snapshot.local.defaultEndpoint, 'http://127.0.0.1:1234/v1');
  assert.equal(snapshot.resolvedDefault?.source, 'local');
  assert.equal(snapshot.resolvedDefault?.model, 'local/Qwen3-4B-Q4_K_M');
});
