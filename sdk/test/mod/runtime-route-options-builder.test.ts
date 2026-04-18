import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeRouteOptionsSnapshot,
  buildRuntimeRouteSelectedBinding,
  runtimeRouteLocalKindSupportsCapability,
  runtimeRouteModelSupportsCapability,
} from '../../src/mod/runtime-route-options.js';

test('runtime route model capability matcher keeps workflow capability independent from plain tts aliases', () => {
  assert.equal(runtimeRouteModelSupportsCapability(['chat'], 'text.generate'), true);
  assert.equal(runtimeRouteModelSupportsCapability(['tts'], 'voice_workflow.tts_t2v'), false);
  assert.equal(runtimeRouteModelSupportsCapability(['voice_workflow.tts_t2v'], 'voice_workflow.tts_t2v'), true);
  assert.equal(runtimeRouteModelSupportsCapability(['speech.transcribe'], 'audio.transcribe'), true);
  assert.equal(runtimeRouteModelSupportsCapability(['image'], 'text.generate'), false);
});

test('runtime route local kind matcher keeps kind fallback for local assets without canonical capabilities', () => {
  assert.equal(runtimeRouteLocalKindSupportsCapability('chat', 'text.generate'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability('stt', 'audio.transcribe'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability('tts', 'voice_workflow.tts_t2v'), false);
  assert.equal(runtimeRouteLocalKindSupportsCapability('image', 'world.generate'), false);
  assert.equal(runtimeRouteLocalKindSupportsCapability('image', 'text.generate'), false);
});

test('runtime route model capability matcher recognizes world.generate as cloud-first canonical capability', () => {
  assert.equal(runtimeRouteModelSupportsCapability(['world.generate'], 'world.generate'), true);
  assert.equal(runtimeRouteModelSupportsCapability(['world'], 'world.generate'), true);
  assert.equal(runtimeRouteModelSupportsCapability(['image.generate'], 'world.generate'), false);
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

test('buildRuntimeRouteSelectedBinding canonicalizes local plain-speech bindings when provider is generic local', () => {
  const synthSelected = buildRuntimeRouteSelectedBinding({
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

  assert.deepEqual(synthSelected, {
    source: 'local',
    connectorId: '',
    model: 'speech/kokoro-82m',
    modelId: 'speech/kokoro-82m',
    provider: 'speech',
    engine: 'speech',
    goRuntimeStatus: 'degraded',
  });

  const sttSelected = buildRuntimeRouteSelectedBinding({
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

  assert.deepEqual(sttSelected, {
    source: 'local',
    connectorId: '',
    model: 'speech/whisper-large-v3',
    modelId: 'speech/whisper-large-v3',
    provider: 'speech',
    engine: 'speech',
    goRuntimeStatus: 'degraded',
  });

  const voiceCloneSelected = buildRuntimeRouteSelectedBinding({
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

  assert.deepEqual(voiceCloneSelected, {
    source: 'local',
    connectorId: '',
    model: 'speech/qwen3tts-base',
    modelId: 'speech/qwen3tts-base',
    provider: 'speech',
    engine: 'speech',
    goRuntimeStatus: 'degraded',
  });

  const voiceDesignSelected = buildRuntimeRouteSelectedBinding({
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

  assert.deepEqual(voiceDesignSelected, {
    source: 'local',
    connectorId: '',
    model: 'speech/qwen3tts-design',
    modelId: 'speech/qwen3tts-design',
    provider: 'speech',
    engine: 'speech',
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

test('buildRuntimeRouteOptionsSnapshot does not invent a cloud default binding from the first connector model', () => {
  const snapshot = buildRuntimeRouteOptionsSnapshot({
    capability: 'text.generate',
    localModels: [],
    connectors: [{
      id: 'connector-openrouter',
      label: 'OpenRouter',
      provider: 'openrouter',
      models: ['openai/gpt-4.1'],
      modelCapabilities: {
        'openai/gpt-4.1': ['text.generate'],
      },
      modelProfiles: [],
    }],
  });

  assert.equal(snapshot.selected, null);
  assert.equal(snapshot.resolvedDefault, undefined);
});
