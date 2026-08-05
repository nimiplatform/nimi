import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import type { MastraEmbeddingModel } from '@mastra/core/vector';
import type { NimiClient, NimiClientEmbeddingOptions } from '@nimiplatform/sdk';
import {
  RoutePolicy,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  VoiceAssetStatus,
  VoiceWorkflowType,
  type RuntimeTypedCallOptions,
  type SubmitScenarioJobRequest,
} from '@nimiplatform/sdk/runtime/generated';

import {
  createNimiMastraEmbeddingModel,
  createNimiMastraProvider,
  createNimiMastraVoice,
  NimiMastraUnsupportedFeatureError,
  NimiMastraVoiceUnsupportedFeatureError,
  type NimiMastraVoiceOptions,
} from './index';
import { createNimiFixtureModel } from './mastra.fixtures';

test('Nimi Mastra embedding model maps AI SDK embed calls to Runtime embeddings', async () => {
  const calls: unknown[] = [];
  const model = createNimiMastraEmbeddingModel({
    model: { modelId: 'text.embed' },
    embedding: {
      async embedText(request) {
        calls.push(request);
        return {
          embeddings: [[0.1, 0.2], [0.3, 0.4]],
          usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
          raw: {
            traceId: 'trace-embed',
            modelResolved: 'embed-1',
            routeDecision: 'local',
            ignoredExtensions: [{ namespace: 'x', reason: 'ignored' }],
          },
        };
      },
    },
  });

  const asMastraEmbedder: MastraEmbeddingModel<string> = model;
  const result = await asMastraEmbedder.doEmbed({
    values: ['first', 'second'],
    providerOptions: { nimi: { caller: 'mastra-rag' } },
  });

  assert.deepEqual(result.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
  assert.equal(result.usage?.tokens, 5);
  assert.equal(result.providerMetadata?.nimi?.traceId, 'trace-embed');
  assert.deepEqual((calls[0] as { values?: readonly string[] }).values, ['first', 'second']);
  assert.deepEqual(
    (calls[0] as { metadata?: { providerOptions?: unknown } }).metadata?.providerOptions,
    { nimi: { caller: 'mastra-rag' } },
  );
});

test('Nimi Mastra embedding model accepts only the text capability facade', () => {
  const embedding = {
    async embedText() {
      return {
        embeddings: [[1]],
        raw: {
          traceId: '',
          modelResolved: '',
          routeDecision: '',
          ignoredExtensions: [],
        },
      };
    },
  };
  for (const model of [
    { modelId: 'implementation-model' },
    { modelId: 'text.embed', providerId: 'runtime' },
  ]) {
    assert.throws(
      () => createNimiMastraEmbeddingModel({ model: model as never, embedding }),
      (error: unknown) => {
        assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
        assert.equal(error.feature, 'embeddingModel.config');
        return true;
      },
    );
  }
});

test('Nimi Mastra provider exposes Runtime-backed embedding model and fails closed without config', async () => {
  let capturedAppId = '';
  const client = {
    ai: {
      createRuntimeEmbeddingClient(options: NimiClientEmbeddingOptions) {
        capturedAppId = options.appId ?? '';
        return {
          async embedText() {
            return {
              embeddings: [[1, 2, 3]],
              raw: {
                traceId: 'trace-provider-embed',
                modelResolved: 'embed-provider-1',
                routeDecision: 'cloud',
                ignoredExtensions: [],
              },
            };
          },
        };
      },
    },
  } as unknown as NimiClient;

  const provider = createNimiMastraProvider({
    client,
    embedding: {
      appId: 'app-1',
    },
  });
  const embedded = await provider.embeddingModel('text.embed').doEmbed({ values: ['hello'] });

  assert.equal(capturedAppId, 'app-1');
  assert.deepEqual(embedded.embeddings, [[1, 2, 3]]);
  assert.equal(provider.textEmbeddingModel('text.embed').modelId, 'text.embed');

  const languageOnly = createNimiMastraProvider({ model: createNimiFixtureModel().model });
  assert.throws(
    () => languageOnly.embeddingModel('embed-1'),
    (error: unknown) => {
      assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
      assert.equal(error.feature, 'provider.embeddingModel');
      return true;
    },
  );
});

test('Nimi Mastra voice rejects provider-native references and speaker kinds', async () => {
  const runtime = {} as never;
  assert.throws(
    () => createNimiMastraVoice({
      runtime,
      head: { appId: 'app-1' },
      defaultVoice: { kind: 'provider_voice_ref', providerVoiceRef: 'private' } as never,
      idempotencyKeyFactory: () => 'idem',
    }),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.defaultVoice',
  );

  const voice = createNimiMastraVoice({
    runtime,
    head: { appId: 'app-1' },
    idempotencyKeyFactory: () => 'idem',
  });
  await assert.rejects(
    () => voice.speak('hello', {
      speaker: 'private',
      speakerKind: 'provider_voice_ref' as never,
    }),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.speak.speakerKind',
  );
});

test('Nimi Mastra voice speak and listen use Runtime speech scenarios', async () => {
  const submitRequests: SubmitScenarioJobRequest[] = [];
  const submitCallOptions: Array<RuntimeTypedCallOptions | undefined> = [];
  const artifactReads: string[] = [];
  const runtimeJobBase = {
    jobId: 'job-voice-1',
    scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
    executionMode: 2,
    routeDecision: RoutePolicy.LOCAL,
    modelResolved: 'voice-model',
    status: ScenarioJobStatus.SUBMITTED,
    providerJobId: 'provider-voice-1',
    reasonCode: 0,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'trace-submit',
    ignoredExtensions: [],
    progressPercent: 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
  };
  const ai = {
    async submitScenarioJob(request: SubmitScenarioJobRequest, options?: RuntimeTypedCallOptions) {
      submitRequests.push(request);
      submitCallOptions.push(options);
      return { job: { ...runtimeJobBase, scenarioType: request.scenarioType } };
    },
    async getScenarioJob() {
      const request = submitRequests.at(-1);
      return { job: { ...runtimeJobBase, scenarioType: request?.scenarioType ?? ScenarioType.SPEECH_SYNTHESIZE, status: ScenarioJobStatus.COMPLETED } };
    },
    async cancelScenarioJob() {
      return { job: { ...runtimeJobBase, status: ScenarioJobStatus.CANCELED } };
    },
    async *subscribeScenarioJobEvents() {
      const request = submitRequests.at(-1);
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-event',
        job: { ...runtimeJobBase, scenarioType: request?.scenarioType ?? ScenarioType.SPEECH_SYNTHESIZE, status: ScenarioJobStatus.COMPLETED },
      };
    },
    async getScenarioArtifacts() {
      const request = submitRequests.at(-1);
      if (request?.scenarioType === ScenarioType.SPEECH_TRANSCRIBE) {
        return {
          jobId: 'job-voice-1',
          traceId: 'trace-stt',
          artifacts: [],
          output: {
            output: {
              oneofKind: 'speechTranscribe' as const,
              speechTranscribe: { text: 'transcribed text', artifacts: [] },
            },
          },
        };
      }
      return {
        jobId: 'job-voice-1',
        traceId: 'trace-tts',
        artifacts: [],
        output: {
          output: {
            oneofKind: 'speechSynthesize' as const,
            speechSynthesize: {
              artifacts: [{
                artifactId: 'audio-voice-1',
                mimeType: 'audio/wav',
                bytes: new Uint8Array(),
                uri: '',
                sha256: 'sha',
                sizeBytes: '2',
                durationMs: '100',
                fps: 0,
                width: 0,
                height: 0,
                sampleRateHz: 24000,
                channels: 1,
              }],
            },
          },
        },
      };
    },
    async listPresetVoices() {
      return {
        voices: [{
          voiceId: 'preset-1',
          name: 'Preset One',
          lang: 'en',
          supportedLangs: ['en'],
          labels: { tone: 'calm' },
          category: 'preset',
          previewAudioUri: 'runtime://preview',
        }],
        modelResolved: 'voice-model',
        traceId: 'trace-voices',
      };
    },
    async listVoiceAssets() {
      return {
        assets: [{
          voiceAssetId: 'asset-1',
          appId: 'app-1',
          subjectUserId: 'user-1',
          workflowType: VoiceWorkflowType.VOICE_CLONE,
          provider: 'runtime',
          modelId: 'voice-model',
          targetModelId: '',
          providerVoiceRef: '',
          persistence: 0,
          status: VoiceAssetStatus.ACTIVE,
          createdAt: undefined,
          updatedAt: undefined,
          expiresAt: undefined,
          metadata: { fields: {} },
        }],
        nextPageToken: '',
      };
    },
  };
  const voice = createNimiMastraVoice({
    runtime: {
      ai,
      artifacts: {
        async readArtifactBytes(request, _options?: RuntimeTypedCallOptions) {
          artifactReads.push(request.artifactId);
          return {
            bytes: Uint8Array.from([9, 8]),
            mimeType: 'audio/wav',
            sizeBytes: '2',
            mimeInferred: false,
          };
        },
      },
    },
    head: { appId: 'app-1', subjectUserId: 'user-1' },
    transcriptionMimeType: 'audio/webm',
    idempotencyKeyFactory: (operation) => `idem-${operation}`,
  });

  const audio = await voice.speak('hello runtime voice', { speaker: 'preset-1', outputFormat: 'wav' });
  assert.deepEqual([...(await readStreamBytes(audio))], [9, 8]);
  assert.deepEqual(artifactReads, ['audio-voice-1']);
  assert.equal(submitRequests[0]?.scenarioType, ScenarioType.SPEECH_SYNTHESIZE);
  assert.match(submitRequests[0]?.requestId ?? '', /^nimi-mastra-voice-speak-/);
  assert.equal(submitRequests[0]?.idempotencyKey, 'idem-speak');
  assert.equal(submitCallOptions[0]?.metadata?.idempotencyKey, 'idem-speak');
  assert.equal(submitRequests[0]?.spec?.spec.oneofKind, 'speechSynthesize');
  if (submitRequests[0]?.spec?.spec.oneofKind === 'speechSynthesize') {
    assert.equal(submitRequests[0].spec.spec.speechSynthesize.text, 'hello runtime voice');
    assert.equal(submitRequests[0].spec.spec.speechSynthesize.voiceRef?.reference.oneofKind, 'presetVoiceId');
  }

  const transcript = await voice.listen(Readable.from([Buffer.from([1, 2, 3])]), { mediaType: 'audio/webm' });
  assert.equal(transcript, 'transcribed text');
  assert.equal(submitRequests[1]?.scenarioType, ScenarioType.SPEECH_TRANSCRIBE);
  assert.match(submitRequests[1]?.requestId ?? '', /^nimi-mastra-voice-listen-/);
  assert.equal(submitRequests[1]?.idempotencyKey, 'idem-listen');
  assert.equal(submitCallOptions[1]?.metadata?.idempotencyKey, 'idem-listen');

  const speakers = await voice.getSpeakers();
  assert.deepEqual(speakers.map((speaker) => speaker.voiceId), ['preset-1', 'asset-1']);
  assert.equal('provider' in speakers[1]!, false);
  assert.equal('modelId' in speakers[1]!, false);

  await assert.rejects(
    () => voice.connect(),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.realtime.connect',
  );
  await assert.rejects(
    () => voice.send(Readable.from([Buffer.from([1])])),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.realtime.send',
  );
  await assert.rejects(
    () => voice.answer(),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.realtime.answer',
  );

  const cataloglessVoice = createNimiMastraVoice({
    runtime: {
      submitScenarioJob: ai.submitScenarioJob,
      getScenarioJob: ai.getScenarioJob,
      cancelScenarioJob: ai.cancelScenarioJob,
      subscribeScenarioJobEvents: ai.subscribeScenarioJobEvents,
      getScenarioArtifacts: ai.getScenarioArtifacts,
    },
    head: { appId: 'app-1', subjectUserId: 'user-1' },
    idempotencyKeyFactory: (operation) => `catalogless-${operation}`,
  });
  assert.deepEqual(await cataloglessVoice.getSpeakers(), []);
});

test('Nimi Mastra voice requires caller-supplied idempotency keys', async () => {
  assert.throws(
    () => createNimiMastraVoice({
      runtime: createUnexpectedVoiceRuntime(),
      head: { appId: 'app-1', subjectUserId: 'user-1' },
    } as unknown as NimiMastraVoiceOptions),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.idempotencyKeyFactory',
  );

  const runtimeCalls: string[] = [];
  const blankVoice = createNimiMastraVoice({
    runtime: createUnexpectedVoiceRuntime(runtimeCalls),
    head: { appId: 'app-1', subjectUserId: 'user-1' },
    transcriptionMimeType: 'audio/webm',
    idempotencyKeyFactory: () => ' ',
  });

  await assert.rejects(
    () => blankVoice.speak('hello'),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.speak.idempotencyKey',
  );
  await assert.rejects(
    () => blankVoice.listen(Readable.from([Buffer.from([1, 2, 3])]), { mediaType: 'audio/webm' }),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.listen.idempotencyKey',
  );

  const longVoice = createNimiMastraVoice({
    runtime: createUnexpectedVoiceRuntime(runtimeCalls),
    head: { appId: 'app-1', subjectUserId: 'user-1' },
    idempotencyKeyFactory: () => 'x'.repeat(257),
  });
  await assert.rejects(
    () => longVoice.speak('hello'),
    (error: unknown) => error instanceof NimiMastraVoiceUnsupportedFeatureError
      && error.feature === 'voice.speak.idempotencyKey',
  );
  assert.deepEqual(runtimeCalls, []);
});

async function readStreamBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

function createUnexpectedVoiceRuntime(calls: string[] = []) {
  return {
    async submitScenarioJob() {
      calls.push('submitScenarioJob');
      throw new Error('unexpected submitScenarioJob');
    },
    async getScenarioJob() {
      calls.push('getScenarioJob');
      throw new Error('unexpected getScenarioJob');
    },
    async cancelScenarioJob() {
      calls.push('cancelScenarioJob');
      throw new Error('unexpected cancelScenarioJob');
    },
    async *subscribeScenarioJobEvents() {
      calls.push('subscribeScenarioJobEvents');
      throw new Error('unexpected subscribeScenarioJobEvents');
    },
    async getScenarioArtifacts() {
      calls.push('getScenarioArtifacts');
      throw new Error('unexpected getScenarioArtifacts');
    },
  };
}
