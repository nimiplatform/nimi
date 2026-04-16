import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeRuntimeRouteDescribeResultFromMetadata,
  parseRuntimeRouteBinding,
  parseRuntimeRouteDescribeResult,
  parseRuntimeRouteOptions,
  RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY,
} from '../../src/mod/runtime-route.js';

test('parseRuntimeRouteBinding keeps cloud provider metadata', () => {
  const parsed = parseRuntimeRouteBinding({
    source: 'cloud',
    connectorId: 'connector-dashscope',
    provider: 'dashscope',
    model: 'wan2.6-t2i',
  });

  assert.deepEqual(parsed, {
    source: 'cloud',
    connectorId: 'connector-dashscope',
    provider: 'dashscope',
    model: 'wan2.6-t2i',
    modelLabel: undefined,
    modelId: undefined,
    localModelId: undefined,
    engine: undefined,
    adapter: undefined,
    providerHints: undefined,
    endpoint: undefined,
    goRuntimeLocalModelId: undefined,
    goRuntimeStatus: undefined,
  });
});

test('parseRuntimeRouteBinding treats empty local endpoint as unconfigured', () => {
  const parsed = parseRuntimeRouteBinding({
    source: 'local',
    connectorId: '',
    provider: 'media',
    model: 'flux.1-schnell',
    engine: 'media',
    endpoint: '   ',
  });

  assert.deepEqual(parsed, {
    source: 'local',
    connectorId: '',
    provider: 'media',
    model: 'flux.1-schnell',
    modelLabel: undefined,
    modelId: undefined,
    localModelId: undefined,
    engine: 'media',
    adapter: undefined,
    providerHints: undefined,
    endpoint: undefined,
    goRuntimeLocalModelId: undefined,
    goRuntimeStatus: undefined,
  });
});

test('parseRuntimeRouteOptions keeps connector providers and models', () => {
  const parsed = parseRuntimeRouteOptions({
    capability: 'image.generate',
    selected: {
      source: 'cloud',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'wan2.6-t2i',
    },
    resolvedDefault: {
      source: 'cloud',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'wan2.6-t2i',
    },
    local: {
      models: [],
    },
    connectors: [{
      id: 'connector-dashscope',
      label: 'DashScope',
      vendor: 'dashscope',
      provider: 'dashscope',
      models: [
        'qwen-image-2.0-pro',
        'qwen-image-2.0',
        'wan2.6-t2i',
      ],
      modelCapabilities: {
        'qwen-image-2.0-pro': ['image.generate'],
        'qwen-image-2.0': ['image.generate'],
        'wan2.6-t2i': ['image.generate'],
      },
    }],
  }, { includeResolvedDefault: true });

  assert.ok(parsed);
  assert.ok(parsed?.selected);
  assert.equal(parsed?.selected.provider, 'dashscope');
  assert.equal(parsed?.resolvedDefault?.provider, 'dashscope');
  assert.equal(parsed?.connectors[0]?.provider, 'dashscope');
  assert.deepEqual(parsed?.connectors[0]?.models, [
    'qwen-image-2.0-pro',
    'qwen-image-2.0',
    'wan2.6-t2i',
  ]);
});

test('parseRuntimeRouteOptions keeps local adapter and go runtime metadata', () => {
  const parsed = parseRuntimeRouteOptions({
    capability: 'image.generate',
    selected: {
      source: 'local',
      connectorId: '',
      model: 'z-image-turbo',
      modelId: 'z-image-turbo',
      localModelId: 'file:z-image-turbo',
      engine: 'media',
      provider: 'media',
      adapter: 'media_native_adapter',
      goRuntimeLocalModelId: '01JTESTLOCALAIMODEL',
      goRuntimeStatus: 'active',
    },
    local: {
      models: [{
        localModelId: 'file:z-image-turbo',
        model: 'z-image-turbo',
        modelId: 'z-image-turbo',
        engine: 'media',
        provider: 'media',
        adapter: 'media_native_adapter',
        goRuntimeLocalModelId: '01JTESTLOCALAIMODEL',
        goRuntimeStatus: 'active',
        capabilities: ['image.generate'],
      }],
    },
    connectors: [],
  });

  assert.ok(parsed);
  assert.ok(parsed?.selected);
  assert.equal(parsed?.selected.adapter, 'media_native_adapter');
  assert.equal(parsed?.selected.goRuntimeStatus, 'active');
  assert.equal(parsed?.local.models[0]?.goRuntimeLocalModelId, '01JTESTLOCALAIMODEL');
});

test('parseRuntimeRouteOptions preserves missing explicit selection while keeping resolved default', () => {
  const parsed = parseRuntimeRouteOptions({
    capability: 'text.generate',
    selected: null,
    resolvedDefault: {
      source: 'local',
      connectorId: '',
      model: 'qwen3',
      modelId: 'qwen3',
      provider: 'llama',
      engine: 'llama',
    },
    local: {
      models: [],
    },
    connectors: [],
  }, { includeResolvedDefault: true });

  assert.ok(parsed);
  assert.equal(parsed?.selected, null);
  assert.equal(parsed?.resolvedDefault?.modelId, 'qwen3');
});

test('parseRuntimeRouteBinding drops unknown adapters instead of widening to arbitrary strings', () => {
  const parsed = parseRuntimeRouteBinding({
    source: 'local',
    model: 'local-model',
    adapter: 'totally_unknown_adapter',
  });

  assert.equal(parsed?.adapter, undefined);
});

test('parseRuntimeRouteDescribeResult accepts text.generate typed metadata', () => {
  const parsed = parseRuntimeRouteDescribeResult({
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-001',
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: false,
      traceModeSupport: 'none',
      supportsImageInput: true,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsArtifactRefInput: true,
    },
  });

  assert.deepEqual(parsed, {
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-001',
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: false,
      traceModeSupport: 'none',
      supportsImageInput: true,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsArtifactRefInput: true,
    },
  });
});

test('parseRuntimeRouteDescribeResult accepts audio.synthesize typed metadata', () => {
  const parsed = parseRuntimeRouteDescribeResult({
    capability: 'audio.synthesize',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-speech-001',
    metadataKind: 'audio.synthesize',
    metadata: {
      supportedAudioFormats: ['mp3', 'wav'],
      defaultAudioFormat: 'mp3',
      supportedTimingModes: ['none'],
      supportsLanguage: true,
      supportsEmotion: false,
      voiceRenderHints: {
        speed: { min: 0.5, max: 2.0 },
      },
    },
  });

  assert.deepEqual(parsed, {
    capability: 'audio.synthesize',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-speech-001',
    metadataKind: 'audio.synthesize',
    metadata: {
      supportedAudioFormats: ['mp3', 'wav'],
      defaultAudioFormat: 'mp3',
      supportedTimingModes: ['none'],
      supportsLanguage: true,
      supportsEmotion: false,
      voiceRenderHints: {
        speed: { min: 0.5, max: 2.0 },
      },
      providerExtensionNamespace: undefined,
      providerExtensionSchemaVersion: undefined,
    },
  });
});

test('decodeRuntimeRouteDescribeResultFromMetadata decodes audio.transcribe typed payload from response metadata', () => {
  const encoded = Buffer.from(JSON.stringify({
    capability: 'audio.transcribe',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-stt-001',
    metadataKind: 'audio.transcribe',
    metadata: {
      tiers: ['core_transcript'],
      supportedResponseFormats: ['text', 'json'],
      supportsLanguage: true,
      supportsPrompt: false,
      supportsTimestamps: false,
      supportsDiarization: false,
    },
  }), 'utf8').toString('base64');

  const parsed = decodeRuntimeRouteDescribeResultFromMetadata({
    metadata: {
      [RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encoded,
    },
    expectedCapability: 'audio.transcribe',
    expectedResolvedBindingRef: 'binding-stt-001',
  });

  assert.equal(parsed.metadataKind, 'audio.transcribe');
  if (parsed.metadataKind !== 'audio.transcribe') {
    assert.fail('expected audio.transcribe metadata');
  }
  assert.deepEqual(parsed.metadata.tiers, ['core_transcript']);
  assert.deepEqual(parsed.metadata.supportedResponseFormats, ['text', 'json']);
});

test('decodeRuntimeRouteDescribeResultFromMetadata decodes typed payload from response metadata', () => {
  const encoded = Buffer.from(JSON.stringify({
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-002',
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: true,
      traceModeSupport: 'separate',
      supportsImageInput: true,
      supportsAudioInput: true,
      supportsVideoInput: false,
      supportsArtifactRefInput: true,
    },
  }), 'utf8').toString('base64');

  const parsed = decodeRuntimeRouteDescribeResultFromMetadata({
    metadata: {
      [RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encoded,
    },
    expectedCapability: 'text.generate',
    expectedResolvedBindingRef: 'binding-002',
  });

  assert.equal(parsed.metadataKind, 'text.generate');
  assert.equal(parsed.metadata.supportsThinking, true);
  assert.equal(parsed.metadata.traceModeSupport, 'separate');
});

test('decodeRuntimeRouteDescribeResultFromMetadata decodes voice workflow typed payload from response metadata', () => {
  const encoded = Buffer.from(JSON.stringify({
    capability: 'voice_workflow.tts_v2v',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-voice-001',
    metadataKind: 'voice_workflow.tts_v2v',
    metadata: {
      workflowType: 'tts_v2v',
      requiresTargetSynthesisBinding: true,
      textPromptMode: 'optional',
      supportsLanguageHints: false,
      supportsPreferredName: true,
      referenceAudioUriInput: true,
      referenceAudioBytesInput: true,
      allowedReferenceAudioMimeTypes: ['audio/wav', 'audio/mpeg'],
    },
  }), 'utf8').toString('base64');

  const parsed = decodeRuntimeRouteDescribeResultFromMetadata({
    metadata: {
      [RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encoded,
    },
    expectedCapability: 'voice_workflow.tts_v2v',
    expectedResolvedBindingRef: 'binding-voice-001',
  });

  assert.equal(parsed.metadataKind, 'voice_workflow.tts_v2v');
  if (parsed.metadataKind !== 'voice_workflow.tts_v2v') {
    assert.fail('expected voice workflow route metadata');
  }
  assert.equal(parsed.metadata.workflowType, 'tts_v2v');
  assert.equal(parsed.metadata.requiresTargetSynthesisBinding, true);
  assert.equal(parsed.metadata.textPromptMode, 'optional');
  assert.deepEqual(parsed.metadata.allowedReferenceAudioMimeTypes, ['audio/wav', 'audio/mpeg']);
});

test('decodeRuntimeRouteDescribeResultFromMetadata fails closed on mismatched binding ref', () => {
  const encoded = Buffer.from(JSON.stringify({
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-actual',
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: false,
      traceModeSupport: 'none',
      supportsImageInput: false,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsArtifactRefInput: false,
    },
  }), 'utf8').toString('base64');

  assert.throws(() => decodeRuntimeRouteDescribeResultFromMetadata({
    metadata: {
      [RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encoded,
    },
    expectedCapability: 'text.generate',
    expectedResolvedBindingRef: 'binding-expected',
  }), /RUNTIME_ROUTE_DESCRIBE_METADATA_BINDING_REF_MISMATCH/);
});

test('decodeRuntimeRouteDescribeResultFromMetadata fails closed on invalid schema', () => {
  const encoded = Buffer.from(JSON.stringify({
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-003',
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: false,
      traceModeSupport: 'invalid',
      supportsImageInput: false,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsArtifactRefInput: false,
    },
  }), 'utf8').toString('base64');

  assert.throws(() => decodeRuntimeRouteDescribeResultFromMetadata({
    metadata: {
      [RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encoded,
    },
    expectedCapability: 'text.generate',
    expectedResolvedBindingRef: 'binding-003',
  }), /RUNTIME_ROUTE_DESCRIBE_METADATA_SCHEMA_INVALID/);
});
