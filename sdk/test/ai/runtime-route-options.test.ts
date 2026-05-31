import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findRuntimeRouteModelProfile,
  normalizeRuntimeRouteCapabilityToken,
  projectRuntimeRouteCapabilityCoverage,
  projectRuntimeRouteCapabilityCoverageList,
  runtimeRouteLocalKindForCapability,
  runtimeRouteLocalKindSupportsCapability,
  runtimeRouteModalityForCapability,
} from '../../src/ai/index.js';
import { LocalAssetKind } from '../../src/runtime/generated/runtime/v1/local_runtime_types.js';

test('runtime route local kind projection maps canonical capabilities to Runtime asset kind ids', () => {
  assert.equal(runtimeRouteLocalKindForCapability('text.generate'), 'chat');
  assert.equal(runtimeRouteLocalKindForCapability('text.embed'), 'embedding');
  assert.equal(runtimeRouteLocalKindForCapability('image.generate'), 'image');
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
  assert.equal(normalizeRuntimeRouteCapabilityToken('image'), 'image.generate');
  assert.equal(normalizeRuntimeRouteCapabilityToken('image.edit'), 'image.generate');
  assert.equal(normalizeRuntimeRouteCapabilityToken('speech.transcribe'), 'audio.transcribe');
  assert.equal(normalizeRuntimeRouteCapabilityToken('unknown.capability'), null);
});

test('runtime route modality projection preserves chat fallback for non-local capabilities', () => {
  assert.equal(runtimeRouteModalityForCapability('image.generate'), 'image');
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
