import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTesterSpeechFailure,
  runTesterAudioSynthesize,
  runTesterAudioTranscribe,
  runTesterVoiceClone,
  runTesterVoiceDesign,
} from '../src/shell/renderer/features/tester/tester-speech-actions.js';

function createMockRuntimeClient() {
  const calls: Record<string, unknown>[] = [];
  const runtimeClient = {
    appId: 'desktop-test',
    media: {
      tts: {
        synthesize: async (input: Record<string, unknown>) => {
          calls.push({ kind: 'tts.synthesize', input });
          return {
            artifacts: [{
              uri: 'file:///tmp/test.mp3',
              mimeType: 'audio/mpeg',
              durationMs: 1200,
            }],
            trace: {
              traceId: 'trace-tts',
              modelResolved: String(input.model || ''),
            },
            job: {
              jobId: 'job-tts',
            },
          };
        },
      },
      stt: {
        transcribe: async (input: Record<string, unknown>) => {
          calls.push({ kind: 'stt.transcribe', input });
          return {
            text: 'hello from tester stt',
            trace: {
              traceId: 'trace-stt',
              modelResolved: String(input.model || ''),
            },
            job: {
              jobId: 'job-stt',
            },
          };
        },
      },
    },
    ai: {
      submitScenarioJob: async (input: Record<string, unknown>) => {
        calls.push({ kind: 'ai.submitScenarioJob', input });
        const workflowKind = ((((input.spec as Record<string, unknown>)?.spec as Record<string, unknown>)?.oneofKind) as string | undefined) || '';
        return {
          job: {
            jobId: workflowKind === 'voiceClone' ? 'job-clone' : 'job-design',
            status: 1,
            traceId: 'trace-submit',
            modelResolved: String((input.head as Record<string, unknown>).modelId || ''),
          },
          asset: {
            voiceAssetId: 'voice-asset-1',
            providerVoiceRef: 'provider-voice-ref-1',
          },
        };
      },
      getScenarioJob: async (input: Record<string, unknown>) => {
        calls.push({ kind: 'ai.getScenarioJob', input });
        return {
          job: {
            jobId: String(input.jobId || ''),
            status: 4,
            traceId: 'trace-job',
            modelResolved: 'speech/qwen3-tts',
          },
        };
      },
      getVoiceAsset: async (input: Record<string, unknown>) => {
        calls.push({ kind: 'voice.getAsset', input });
        return {
          asset: {
            voiceAssetId: String(input.voiceAssetId || ''),
            providerVoiceRef: 'provider-voice-ref-1',
            status: 'ACTIVE',
            preferredName: 'tester-voice',
          },
        };
      },
    },
  };
  return { runtimeClient, calls };
}

const mockCallParams = {
  model: 'speech/qwen3-tts',
  route: 'local' as const,
  connectorId: undefined,
  metadata: { traceId: 'trace-meta' },
};

test('tester speech actions synthesize through runtime media.tts', async () => {
  const { runtimeClient, calls } = createMockRuntimeClient();
  const result = await runTesterAudioSynthesize({
    binding: {
      source: 'local',
      provider: 'speech',
      model: 'speech/qwen3-tts',
      modelId: 'speech/qwen3-tts',
      connectorId: '',
    },
    text: 'hello tester tts',
    voice: 'ryan',
    audioFormat: 'mp3',
    language: 'en',
    speed: 1.2,
    pitch: -1,
    volume: 0.8,
    timeoutMs: 120000,
  }, {
    getRuntimeClientImpl: () => runtimeClient as never,
    resolveCallParamsImpl: async () => mockCallParams,
  });

  assert.equal(result.result, 'passed');
  assert.equal((result.output as { audioUri?: string }).audioUri, 'file:///tmp/test.mp3');
  assert.equal(calls[0]?.kind, 'tts.synthesize');
  assert.equal((calls[0]?.input as Record<string, unknown>).voice, 'ryan');
  assert.equal((calls[0]?.input as Record<string, unknown>).language, 'en');
  assert.equal((calls[0]?.input as Record<string, unknown>).speed, 1.2);
  assert.equal((calls[0]?.input as Record<string, unknown>).pitch, -1);
  assert.equal((calls[0]?.input as Record<string, unknown>).volume, 0.8);
  assert.equal((calls[0]?.input as Record<string, unknown>).timeoutMs, 120000);
  assert.equal(result.diagnostics.requestParams.language, 'en');
});

test('tester speech actions allow provider default voice', async () => {
  const { runtimeClient, calls } = createMockRuntimeClient();
  await runTesterAudioSynthesize({
    binding: {
      source: 'cloud',
      provider: 'speech',
      model: 'speech/qwen3-tts',
      modelId: 'speech/qwen3-tts',
      connectorId: 'dashscope',
    },
    text: 'hello default voice',
    voice: '',
    audioFormat: 'mp3',
  }, {
    getRuntimeClientImpl: () => runtimeClient as never,
    resolveCallParamsImpl: async () => ({ ...mockCallParams, route: 'cloud', connectorId: 'dashscope' }),
  });

  assert.equal(calls[0]?.kind, 'tts.synthesize');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0]?.input as Record<string, unknown>, 'voice'), false);
});

test('tester speech actions transcribe bytes through runtime media.stt', async () => {
  const { runtimeClient, calls } = createMockRuntimeClient();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const result = await runTesterAudioTranscribe({
    binding: {
      source: 'local',
      provider: 'speech',
      model: 'speech/qwen3-asr',
      modelId: 'speech/qwen3-asr',
      connectorId: '',
    },
    audio: { kind: 'bytes', bytes },
    mimeType: 'audio/wav',
  }, {
    getRuntimeClientImpl: () => runtimeClient as never,
    resolveCallParamsImpl: async () => ({ ...mockCallParams, model: 'speech/qwen3-asr' }),
  });

  assert.equal(result.result, 'passed');
  assert.equal(result.output, 'hello from tester stt');
  assert.equal(calls[0]?.kind, 'stt.transcribe');
  assert.deepEqual((calls[0]?.input as Record<string, unknown>).audio, { kind: 'bytes', bytes });
});

test('tester speech actions submit voice clone workflow and fetch asset', async () => {
  const { runtimeClient, calls } = createMockRuntimeClient();
  const result = await runTesterVoiceClone({
    binding: {
      source: 'local',
      provider: 'speech',
      model: 'speech/qwen3tts-base',
      modelId: 'speech/qwen3tts-base',
      connectorId: '',
    },
    prompt: 'hello clone',
    preferredName: 'clone-voice',
    referenceAudio: { kind: 'url', url: 'https://nimi.invalid/reference.wav' },
    referenceAudioMime: 'audio/wav',
  }, {
    getRuntimeClientImpl: () => runtimeClient as never,
    resolveCallParamsImpl: async () => ({ ...mockCallParams, model: 'speech/qwen3tts-base' }),
  });

  assert.equal(result.result, 'passed');
  assert.equal((result.output as { voiceAssetId?: string }).voiceAssetId, 'voice-asset-1');
  const submitCall = calls.find((call) => call.kind === 'ai.submitScenarioJob');
  assert.ok(submitCall);
  assert.equal(((submitCall?.input as Record<string, unknown>).head as Record<string, unknown>).routePolicy, 1);
  assert.equal(
    ((((submitCall?.input as Record<string, unknown>).spec as Record<string, unknown>).spec as Record<string, unknown>).oneofKind),
    'voiceClone',
  );
  assert.ok(calls.some((call) => call.kind === 'voice.getAsset'));
});

test('tester speech actions submit cloud voice clone with provider-scoped workflow model', async () => {
  const { runtimeClient, calls } = createMockRuntimeClient();
  await runTesterVoiceClone({
    binding: {
      source: 'cloud',
      provider: 'dashscope',
      model: 'qwen3-tts-vc',
      modelId: 'qwen3-tts-vc',
      connectorId: 'connector-dashscope',
    },
    prompt: 'hello clone',
    preferredName: 'clone-voice',
    referenceAudio: { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) },
    referenceAudioMime: 'audio/wav',
  }, {
    getRuntimeClientImpl: () => runtimeClient as never,
    resolveCallParamsImpl: async () => ({
      ...mockCallParams,
      model: 'cloud/qwen3-tts-vc',
      route: 'cloud',
      connectorId: 'connector-dashscope',
    }),
  });

  const submitCall = calls.find((call) => call.kind === 'ai.submitScenarioJob');
  assert.ok(submitCall);
  const submitInput = submitCall.input as Record<string, unknown>;
  assert.equal((submitInput.head as Record<string, unknown>).modelId, 'dashscope/qwen3-tts-vc');
  assert.equal((submitInput.head as Record<string, unknown>).routePolicy, 2);
  assert.equal((submitInput.head as Record<string, unknown>).connectorId, 'connector-dashscope');
  assert.equal(
    ((((submitInput.spec as Record<string, unknown>).spec as Record<string, unknown>).voiceClone as Record<string, unknown>).targetModelId),
    'dashscope/qwen3-tts-vc',
  );
});

test('tester speech actions explain missing cloud voice workflow provider metadata', async () => {
  const { runtimeClient } = createMockRuntimeClient();
  await assert.rejects(
    () => runTesterVoiceClone({
      binding: {
        source: 'cloud',
        model: 'qwen3-tts-vc',
        modelId: 'qwen3-tts-vc',
        connectorId: 'connector-dashscope',
      },
      prompt: 'hello clone',
      preferredName: 'clone-voice',
      referenceAudio: { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) },
      referenceAudioMime: 'audio/wav',
    }, {
      getRuntimeClientImpl: () => runtimeClient as never,
      resolveCallParamsImpl: async () => ({
        ...mockCallParams,
        model: 'cloud/qwen3-tts-vc',
        route: 'cloud',
        connectorId: 'connector-dashscope',
      }),
    }),
    /Voice clone route is missing provider metadata for selected cloud model "qwen3-tts-vc". The model is selected/,
  );
});

test('tester speech actions submit voice design workflow and fetch asset', async () => {
  const { runtimeClient, calls } = createMockRuntimeClient();
  const result = await runTesterVoiceDesign({
    binding: {
      source: 'local',
      provider: 'speech',
      model: 'speech/qwen3tts-design',
      modelId: 'speech/qwen3tts-design',
      connectorId: '',
    },
    instructionText: 'warm cinematic female voice',
    previewText: 'hello design',
    language: 'en',
    preferredName: 'design-voice',
  }, {
    getRuntimeClientImpl: () => runtimeClient as never,
    resolveCallParamsImpl: async () => ({ ...mockCallParams, model: 'speech/qwen3tts-design' }),
  });

  assert.equal(result.result, 'passed');
  assert.equal((result.output as { providerVoiceRef?: string }).providerVoiceRef, 'provider-voice-ref-1');
  const submitCall = calls.find((call) => call.kind === 'ai.submitScenarioJob');
  assert.ok(submitCall);
  assert.equal(
    ((((submitCall?.input as Record<string, unknown>).spec as Record<string, unknown>).spec as Record<string, unknown>).oneofKind),
    'voiceDesign',
  );
});

test('tester speech actions submit cloud voice design with provider-scoped workflow model', async () => {
  const { runtimeClient, calls } = createMockRuntimeClient();
  await runTesterVoiceDesign({
    binding: {
      source: 'cloud',
      provider: 'dashscope',
      model: 'qwen3-tts-vd',
      modelId: 'qwen3-tts-vd',
      connectorId: 'connector-dashscope',
    },
    instructionText: 'warm cinematic female voice',
    previewText: 'hello design',
    preferredName: 'design-voice',
  }, {
    getRuntimeClientImpl: () => runtimeClient as never,
    resolveCallParamsImpl: async () => ({
      ...mockCallParams,
      model: 'cloud/qwen3-tts-vd',
      route: 'cloud',
      connectorId: 'connector-dashscope',
    }),
  });

  const submitCall = calls.find((call) => call.kind === 'ai.submitScenarioJob');
  assert.ok(submitCall);
  const submitInput = submitCall.input as Record<string, unknown>;
  assert.equal((submitInput.head as Record<string, unknown>).modelId, 'dashscope/qwen3-tts-vd');
  assert.equal(
    ((((submitInput.spec as Record<string, unknown>).spec as Record<string, unknown>).voiceDesign as Record<string, unknown>).targetModelId),
    'dashscope/qwen3-tts-vd',
  );
});

test('tester speech failure prefers local speech bundle summary over raw reason code', () => {
  const result = buildTesterSpeechFailure({
    message: 'VOICE_WORKFLOW_FAILED',
    reasonCode: 'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED',
    details: {
      reason_code: 'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED',
      detail: 'speech bundle download confirmation required',
    },
  }, {
    fallbackMessage: 'tester speech failed',
    requestParams: { text: 'hello' },
    binding: undefined,
    elapsed: 42,
  });

  assert.equal(result.result, 'failed');
  assert.equal(result.error, 'Explicit download confirmation is required before Local Speech setup can continue.');
  assert.equal(result.diagnostics.responseMetadata.finishReason, 'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED');
});

test('tester voice workflow terminal failures preserve structured local speech reason', async () => {
  const { runtimeClient } = createMockRuntimeClient();
  runtimeClient.ai.getScenarioJob = async (input: Record<string, unknown>) => ({
    job: {
      jobId: String(input.jobId || ''),
      status: 5,
      traceId: 'trace-job',
      modelResolved: 'speech/qwen3-tts',
      reasonCode: 'AI_LOCAL_SPEECH_BUNDLE_DEGRADED',
      reasonDetail: 'speech voices metadata missing',
    },
  });

  await assert.rejects(
    () => runTesterVoiceClone({
      binding: {
        source: 'local',
        provider: 'speech',
        model: 'speech/qwen3tts-base',
        modelId: 'speech/qwen3tts-base',
        connectorId: '',
      },
      prompt: 'hello clone',
      preferredName: 'clone-voice',
      referenceAudio: { kind: 'url', url: 'https://nimi.invalid/reference.wav' },
      referenceAudioMime: 'audio/wav',
    }, {
      getRuntimeClientImpl: () => runtimeClient as never,
      resolveCallParamsImpl: async () => ({ ...mockCallParams, model: 'speech/qwen3tts-base' }),
    }),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.message, 'The Local Speech bundle is degraded and needs repair.');
      assert.equal(error.reasonCode, 'AI_LOCAL_SPEECH_BUNDLE_DEGRADED');
      return true;
    },
  );
});
