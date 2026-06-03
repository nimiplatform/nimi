import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findRuntimeRouteModelProfile,
  normalizeRuntimeRouteCapabilityToken,
  projectRuntimeRouteCapabilityCoverage,
  projectRuntimeRouteCapabilityCoverageList,
  runtimeRouteBindingsMatch,
  runtimeRouteCapabilitiesMatch,
  runtimeRouteLocalKindForCapability,
  runtimeRouteLocalKindSupportsCapability,
  runtimeRouteModalityForCapability,
} from '../../src/runtime/index.js';
import { LocalAssetKind } from '../../src/runtime/generated/runtime/v1/local_runtime_asset_catalog.js';

test('runtime route local kind projection maps canonical capabilities to Runtime asset kind ids', () => {
  assert.equal(runtimeRouteLocalKindForCapability('text.generate'), 'chat');
  assert.equal(runtimeRouteLocalKindForCapability('text.generate.vision'), 'chat');
  assert.equal(runtimeRouteLocalKindForCapability('text.generate.audio'), 'chat');
  assert.equal(runtimeRouteLocalKindForCapability('text.generate.video'), 'chat');
  assert.equal(runtimeRouteLocalKindForCapability('text.embed'), 'embedding');
  assert.equal(runtimeRouteLocalKindForCapability('image.generate'), 'image');
  assert.equal(runtimeRouteLocalKindForCapability('image.edit'), 'image');
  assert.equal(runtimeRouteLocalKindForCapability('video.generate'), 'video');
  assert.equal(runtimeRouteLocalKindForCapability('audio.synthesize'), 'tts');
  assert.equal(runtimeRouteLocalKindForCapability('voice_workflow.voice_clone'), 'tts');
  assert.equal(runtimeRouteLocalKindForCapability('voice_workflow.voice_design'), 'tts');
  assert.equal(runtimeRouteLocalKindForCapability('audio.transcribe'), 'stt');
  assert.equal(runtimeRouteLocalKindForCapability('world.generate'), null);
  assert.equal(runtimeRouteLocalKindForCapability('music.generate'), null);
});

test('runtime route capability token projection normalizes app-facing aliases', () => {
  assert.equal(normalizeRuntimeRouteCapabilityToken('chat'), 'text.generate');
  assert.equal(normalizeRuntimeRouteCapabilityToken('vision'), 'text.generate.vision');
  assert.equal(normalizeRuntimeRouteCapabilityToken('audio_chat'), 'text.generate.audio');
  assert.equal(normalizeRuntimeRouteCapabilityToken('video_chat'), 'text.generate.video');
  assert.equal(normalizeRuntimeRouteCapabilityToken('image'), 'image.generate');
  assert.equal(normalizeRuntimeRouteCapabilityToken('image.edit'), 'image.edit');
  assert.equal(normalizeRuntimeRouteCapabilityToken('speech.transcribe'), null);
  assert.equal(normalizeRuntimeRouteCapabilityToken('unknown.capability'), null);
});

test('runtime route capability matcher projects app-facing aliases without Kit alias truth', () => {
  assert.equal(runtimeRouteCapabilitiesMatch(['chat'], 'text.generate'), true);
  assert.equal(runtimeRouteCapabilitiesMatch(['image.edit'], 'image.edit'), true);
  assert.equal(runtimeRouteCapabilitiesMatch(['image.generate'], 'image.edit'), false);
  assert.equal(runtimeRouteCapabilitiesMatch(['tts'], 'audio.synthesize'), true);
  assert.equal(runtimeRouteCapabilitiesMatch(['video.generate'], 'image.generate'), false);
  assert.equal(runtimeRouteCapabilitiesMatch(['text.generate'], 'unknown.capability'), false);
});

test('runtime route modality projection preserves chat fallback for non-local capabilities', () => {
  assert.equal(runtimeRouteModalityForCapability('image.generate'), 'image');
  assert.equal(runtimeRouteModalityForCapability('image.edit'), 'image');
  assert.equal(runtimeRouteModalityForCapability('world.generate'), 'chat');
  assert.equal(runtimeRouteModalityForCapability('music.generate'), 'chat');
});

test('runtime route local kind support accepts Runtime asset kind wire values', () => {
  assert.equal(runtimeRouteLocalKindSupportsCapability('LOCAL_ASSET_KIND_IMAGE', 'image.generate'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability(LocalAssetKind.TTS, 'audio.synthesize'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability('embedding', 'text.embed'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability('vae', 'text.generate'), false);
  assert.equal(runtimeRouteLocalKindSupportsCapability('music', 'music.generate'), false);
});

test('runtime route capability coverage projects local and cloud evidence by capability', () => {
  const coverage = projectRuntimeRouteCapabilityCoverage({
    capability: 'image',
    localNodes: [{
      capability: 'image',
      available: true,
      provider: 'media',
    }],
    localModels: [],
    connectors: [{
      status: 'healthy',
      models: ['text-only'],
      modelCapabilities: {
        'text-only': ['text.generate'],
      },
    }],
  });
  assert.deepEqual(coverage, {
    capability: 'image',
    localAvailable: true,
    cloudAvailable: false,
    localProvider: 'media',
    errorReason: undefined,
  });
});

test('runtime route capability coverage fails closed for healthy connectors without model capability evidence', () => {
  assert.equal(projectRuntimeRouteCapabilityCoverage({
    capability: 'image',
    connectors: [{
      status: 'healthy',
      models: ['unknown-model'],
      modelCapabilities: {},
    }],
  }).cloudAvailable, false);
  assert.equal(projectRuntimeRouteCapabilityCoverage({
    capability: 'embedding',
    connectors: [{
      status: 'healthy',
      models: ['embedding-model'],
      modelCapabilities: {
        'embedding-model': ['text.embed'],
      },
    }],
  }).cloudAvailable, true);
});

test('runtime route capability coverage list keeps runnable asset kind order', () => {
  const coverage = projectRuntimeRouteCapabilityCoverageList({
    localModels: [{
      status: 'active',
      capabilities: ['audio.synthesize'],
    }],
  });
  assert.deepEqual(coverage.map((item) => item.capability), ['chat', 'image', 'video', 'tts', 'stt', 'embedding']);
  assert.equal(coverage.find((item) => item.capability === 'tts')?.localAvailable, true);
  assert.equal(coverage.find((item) => item.capability === 'chat')?.localAvailable, false);
});

test('runtime route model profile lookup projects binding and connector metadata without owning routing truth', () => {
  const snapshot = {
    capability: 'text.generate',
    selected: null,
    local: { models: [], defaultEndpoint: '' },
    connectors: [{
      id: 'connector-openai',
      label: 'OpenAI',
      provider: 'openai',
      models: ['gpt-a', 'gpt-b'],
      modelCapabilities: {
        'gpt-a': ['text.generate'],
        'gpt-b': ['text.generate'],
      },
      modelProfiles: [{
        model: 'gpt-b',
        maxContextTokens: 128000,
        maxOutputTokens: 4096,
        contextSource: 'provider-api' as const,
      }],
    }],
  };

  assert.deepEqual(findRuntimeRouteModelProfile(snapshot, {
    source: 'cloud',
    connectorId: 'connector-openai',
    model: 'gpt-b',
  }), {
    model: 'gpt-b',
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    contextSource: 'provider-api',
  });
  assert.deepEqual(findRuntimeRouteModelProfile(snapshot, {
    source: 'cloud',
    connectorId: 'connector-openai',
    model: 'inline-profile',
    maxContextTokens: 32000,
    maxOutputTokens: 1200,
  }), {
    model: 'inline-profile',
    maxContextTokens: 32000,
    maxOutputTokens: 1200,
  });
  assert.equal(findRuntimeRouteModelProfile(snapshot, {
    source: 'cloud',
    connectorId: 'missing',
    model: 'gpt-b',
  }), null);
  assert.equal(findRuntimeRouteModelProfile(snapshot, {
    source: 'local',
    connectorId: '',
    model: 'local-model',
  }), null);
});

test('runtime route binding match projects selected route target equality', () => {
  assert.equal(runtimeRouteBindingsMatch({
    source: 'local',
    connectorId: '',
    model: 'local/model-a',
    localModelId: 'local-a',
  }, {
    source: 'local',
    connectorId: '',
    model: 'renamed-local/model-a',
    localModelId: 'local-a',
  }), true);

  assert.equal(runtimeRouteBindingsMatch({
    source: 'local',
    connectorId: '',
    model: 'local/model-a',
    modelId: 'local/model-a',
  }, {
    source: 'local',
    connectorId: '',
    model: 'ignored',
    modelId: 'local/model-a',
  }), true);

  assert.equal(runtimeRouteBindingsMatch({
    source: 'cloud',
    connectorId: 'connector-a',
    model: 'model-a',
  }, {
    source: 'cloud',
    connectorId: 'connector-a',
    modelId: 'model-a',
  }), true);

  assert.equal(runtimeRouteBindingsMatch({
    source: 'cloud',
    connectorId: 'connector-a',
    model: 'model-a',
  }, {
    source: 'cloud',
    connectorId: 'connector-b',
    model: 'model-a',
  }), false);

  assert.equal(runtimeRouteBindingsMatch({
    source: 'cloud',
    connectorId: '',
    model: 'model-a',
  }, {
    source: 'cloud',
    connectorId: '',
    model: 'model-a',
  }), false);
});
