import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { clearPlatformClient, createPlatformClient } from '@nimiplatform/sdk';
import { describeRuntimeRouteMetadata } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-route-describe.js';

type TauriInvokeCall = {
  command: string;
  payload: Record<string, unknown>;
};

type MutableGlobalTauri = Record<string, unknown> & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
    listen?: () => () => void;
  };
  window?: Record<string, unknown> & {
    __NIMI_TAURI_TEST__?: {
      invoke?: (command: string, payload?: unknown) => Promise<unknown>;
      listen?: () => () => void;
    };
  };
};

function unwrapPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const root = payload as Record<string, unknown>;
  const nested = root.payload;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return {};
  }
  return nested as Record<string, unknown>;
}

function installTauriRuntime(
  calls: TauriInvokeCall[],
  responseMetadata?: Record<string, string>,
): () => void {
  const target = globalThis as unknown as MutableGlobalTauri;
  const previousRoot = target.__NIMI_TAURI_TEST__;
  const previousWindow = target.window;

  const invoke = async (command: string, payload?: unknown) => {
    calls.push({
      command,
      payload: unwrapPayload(payload),
    });
    return {
      responseBytesBase64: '',
      ...(responseMetadata ? { responseMetadata } : {}),
    };
  };

  const windowObject = previousWindow || {};
  windowObject.__NIMI_TAURI_TEST__ = { invoke, listen: () => () => {} };
  target.__NIMI_TAURI_TEST__ = { invoke, listen: () => () => {} };
  target.window = windowObject;

  return () => {
    if (typeof previousRoot === 'undefined') {
      delete target.__NIMI_TAURI_TEST__;
    } else {
      target.__NIMI_TAURI_TEST__ = previousRoot;
    }
    if (typeof previousWindow === 'undefined') {
      target.window = undefined;
    } else {
      target.window = previousWindow;
    }
  };
}

function findRuntimeBridgeUnary(calls: TauriInvokeCall[]): TauriInvokeCall | undefined {
  return calls.find((call) => call.command === 'runtime_bridge_unary');
}

test('describeRuntimeRouteMetadata decodes text.generate typed metadata from runtime response header', async () => {
  const calls: TauriInvokeCall[] = [];
  const encoded = Buffer.from(JSON.stringify({
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-local-001',
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: false,
      traceModeSupport: 'none',
      supportsImageInput: true,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsArtifactRefInput: true,
    },
  }), 'utf8').toString('base64');
  const restoreTauri = installTauriRuntime(calls, {
    'x-nimi-route-describe-result': encoded,
  });

  try {
    clearPlatformClient();
    await createPlatformClient({
      authMode: 'external-principal',
      realmBaseUrl: 'http://localhost:3002',
      subjectUserIdProvider: () => 'subject-user-001',
    });

    const result = await describeRuntimeRouteMetadata({
      modId: 'core:runtime',
      capability: 'text.generate',
      resolvedBindingRef: 'binding-local-001',
      resolvedBinding: {
        capability: 'text.generate',
        source: 'local',
        provider: 'llama',
        model: 'qwen3-chat',
        modelId: 'qwen3-chat',
        localModelId: 'desktop-local-asset-1',
        goRuntimeLocalModelId: 'runtime-local-asset-1',
        engine: 'llama',
        connectorId: '',
      },
    });

    assert.equal(result.metadataKind, 'text.generate');
    assert.equal(result.metadata.supportsThinking, false);
    assert.equal(result.metadata.supportsImageInput, true);

    const unaryCall = findRuntimeBridgeUnary(calls);
    assert.ok(unaryCall);
    const requestBytesBase64 = String(unaryCall?.payload.requestBytesBase64 || '').trim();
    const requestText = Buffer.from(requestBytesBase64, 'base64').toString('utf8');
    assert.equal(requestText.includes('nimi.scenario.text_generate.route_describe'), true);
    assert.equal(requestText.includes('binding-local-001'), true);
    assert.equal(requestText.includes('desktop-local-asset-1'), true);
    assert.equal(requestText.includes('runtime-local-asset-1'), true);
    assert.equal(requestText.includes('qwen3-chat'), true);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('describeRuntimeRouteMetadata keeps Desktop inline cloud route fail-closed', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);

  try {
    clearPlatformClient();
    await createPlatformClient({
      authMode: 'external-principal',
      realmBaseUrl: 'http://localhost:3002',
      subjectUserIdProvider: () => 'subject-user-001',
    });

    await assert.rejects(() => describeRuntimeRouteMetadata({
      modId: 'core:runtime',
      capability: 'text.generate',
      resolvedBindingRef: 'binding-inline-cloud',
      resolvedBinding: {
        capability: 'text.generate',
        source: 'cloud',
        provider: 'openai',
        model: 'gpt-4o-mini',
        modelId: 'gpt-4o-mini',
        connectorId: '',
      },
    }), /managed connector authority on Desktop/);

    assert.equal(calls.length, 0);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('describeRuntimeRouteMetadata decodes voice workflow typed metadata from runtime response header', async () => {
  const calls: TauriInvokeCall[] = [];
  const encoded = Buffer.from(JSON.stringify({
    capability: 'voice_workflow.tts_v2v',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-voice-cloud-001',
    metadataKind: 'voice_workflow.tts_v2v',
    metadata: {
      workflowType: 'tts_v2v',
      requiresTargetSynthesisBinding: true,
      textPromptMode: 'unsupported',
      supportsLanguageHints: false,
      supportsPreferredName: true,
      referenceAudioUriInput: true,
      referenceAudioBytesInput: true,
      allowedReferenceAudioMimeTypes: ['audio/wav', 'audio/mpeg'],
    },
  }), 'utf8').toString('base64');
  const restoreTauri = installTauriRuntime(calls, {
    'x-nimi-route-describe-result': encoded,
  });

  try {
    clearPlatformClient();
    await createPlatformClient({
      authMode: 'external-principal',
      realmBaseUrl: 'http://localhost:3002',
      subjectUserIdProvider: () => 'subject-user-001',
    });

    const result = await describeRuntimeRouteMetadata({
      modId: 'core:runtime',
      capability: 'voice_workflow.tts_v2v',
      resolvedBindingRef: 'binding-voice-cloud-001',
      resolvedBinding: {
        capability: 'voice_workflow.tts_v2v',
        source: 'cloud',
        provider: 'elevenlabs',
        model: 'voice-clone-v1',
        modelId: 'voice-clone-v1',
        connectorId: 'connector-elevenlabs',
      },
    });

    assert.equal(result.metadataKind, 'voice_workflow.tts_v2v');
    if (result.metadataKind !== 'voice_workflow.tts_v2v') {
      assert.fail('expected voice workflow route metadata');
    }
    assert.equal(result.metadata.workflowType, 'tts_v2v');
    assert.equal(result.metadata.requiresTargetSynthesisBinding, true);
    assert.equal(result.metadata.textPromptMode, 'unsupported');
    assert.equal(result.metadata.referenceAudioUriInput, true);
    assert.deepEqual(result.metadata.allowedReferenceAudioMimeTypes, ['audio/wav', 'audio/mpeg']);

    const unaryCall = findRuntimeBridgeUnary(calls);
    assert.ok(unaryCall);
    const requestBytesBase64 = String(unaryCall?.payload.requestBytesBase64 || '').trim();
    const requestText = Buffer.from(requestBytesBase64, 'base64').toString('utf8');
    assert.equal(requestText.includes('nimi.scenario.voice_clone.route_describe'), true);
    assert.equal(requestText.includes('binding-voice-cloud-001'), true);
    assert.equal(requestText.includes('voice-clone-v1'), true);
    assert.equal(requestText.includes('https://nimi.invalid/route-describe-reference.wav'), true);
    assert.equal(requestText.includes('runtime-route-describe-probe'), true);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('describeRuntimeRouteMetadata decodes audio.synthesize typed metadata from runtime response header', async () => {
  const calls: TauriInvokeCall[] = [];
  const encoded = Buffer.from(JSON.stringify({
    capability: 'audio.synthesize',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-speech-cloud-001',
    metadataKind: 'audio.synthesize',
    metadata: {
      supportedAudioFormats: ['mp3'],
      defaultAudioFormat: 'mp3',
      supportedTimingModes: ['none'],
      supportsLanguage: true,
      supportsEmotion: false,
    },
  }), 'utf8').toString('base64');
  const restoreTauri = installTauriRuntime(calls, {
    'x-nimi-route-describe-result': encoded,
  });

  try {
    clearPlatformClient();
    await createPlatformClient({
      authMode: 'external-principal',
      realmBaseUrl: 'http://localhost:3002',
      subjectUserIdProvider: () => 'subject-user-001',
    });

    const result = await describeRuntimeRouteMetadata({
      modId: 'core:runtime',
      capability: 'audio.synthesize',
      resolvedBindingRef: 'binding-speech-cloud-001',
      resolvedBinding: {
        capability: 'audio.synthesize',
        source: 'cloud',
        provider: 'openai',
        model: 'gpt-audio',
        modelId: 'gpt-audio',
        connectorId: 'connector-openai',
      },
    });

    assert.equal(result.metadataKind, 'audio.synthesize');
    if (result.metadataKind !== 'audio.synthesize') {
      assert.fail('expected audio.synthesize route metadata');
    }
    assert.deepEqual(result.metadata.supportedAudioFormats, ['mp3']);

    const unaryCall = findRuntimeBridgeUnary(calls);
    assert.ok(unaryCall);
    const requestBytesBase64 = String(unaryCall?.payload.requestBytesBase64 || '').trim();
    const requestText = Buffer.from(requestBytesBase64, 'base64').toString('utf8');
    assert.equal(requestText.includes('nimi.scenario.speech_synthesize.route_describe'), true);
    assert.equal(requestText.includes('runtime.route.describe(audio.synthesize)'), true);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('speech transcribe route describe probe keeps binary placeholder payload in source spec', () => {
  const source = readFileSync(
    new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-route-describe.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("SPEECH_TRANSCRIBE_ROUTE_DESCRIBE_PROBE_NAMESPACE = 'nimi.scenario.speech_transcribe.route_describe'"), true);
  assert.equal(source.includes("oneofKind: 'speechTranscribe'"), true);
  assert.equal(source.includes("oneofKind: 'audioBytes'"), true);
  assert.equal(source.includes("mimeType: 'audio/wav'"), true);
  assert.equal(source.includes("responseFormat: 'json'"), true);
});

test('voice clone route describe probe keeps explicit placeholder fields in source payload', () => {
  const source = readFileSync(
    new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-route-describe.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("referenceAudioUri: VOICE_CLONE_ROUTE_DESCRIBE_REFERENCE_AUDIO_URI"), true);
  assert.equal(source.includes("referenceAudioMime: 'audio/wav'"), true);
  assert.equal(source.includes('languageHints: []'), true);
  assert.equal(source.includes('preferredName: VOICE_CLONE_ROUTE_DESCRIBE_PREFERRED_NAME'), true);
});
