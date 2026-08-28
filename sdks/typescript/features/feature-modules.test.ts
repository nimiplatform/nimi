import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecutionMode,
  ReasonCode as RuntimeReasonCode,
  RoutePolicy,
  type RuntimeTypedCallOptions,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
} from '../core-generated/runtime-typed-client';
import {
  assembleNimiConversationText,
  buildNimiConversationFeatureEvents,
  buildNimiConversationHistoryMessages,
  buildNimiConversationHistoryWindow,
  completeNimiConversationText,
  createNimiConversationTextAccumulator,
  measureNimiConversationHistoryWindow,
} from './conversation';
import { ReasonCode } from '../types';
import {
  buildNimiRuntimeGenerationSubmitRequest,
  collectNimiGenerationArtifacts,
  createNimiGenerationJob,
  createNimiRuntimeGenerationClient,
  createNimiSpeechSynthesisScenario,
  createNimiSpeechTranscriptionScenario,
  createNimiVideoGenerationScenario,
  runNimiRuntimeSpeechSynthesis,
  runNimiRuntimeSpeechTranscription,
  transitionNimiGenerationJob,
} from './generation';
import {
  assertNimiAdapterCapabilityParity,
  assertNimiGoldenRun,
  buildNimiStructuredOutputRepairRequest,
  createNimiGoldenRun,
  parseNimiStructuredJson,
} from './evaluation';
import {
  createNimiToolRegistry,
  createNimiApprovalTool,
  createNimiArtifactTool,
  createNimiExternalExecutionTool,
  createNimiFileDescriptorTool,
} from './toolkits';

test('conversation feature builds history windows and UI-friendly stream events', () => {
  const sourceMessages = buildNimiConversationHistoryMessages({
    messages: [
      { id: 'draft', role: 'user', text: 'draft', committed: false },
      { id: 'ok', role: 'assistant', text: '  done  ', committed: true },
      { id: 'bad-role', role: 'unknown', text: 'skip', committed: true },
    ],
    isCommitted: (message) => message.committed,
    getId: (message) => message.id,
    getRole: (message) => message.role,
    getText: (message) => message.text,
    mapAssistantText: (text) => `assistant:${text}`,
  });
  assert.deepEqual(sourceMessages.map((message) => message.text), ['assistant:done']);

  const window = buildNimiConversationHistoryWindow(
    [
      { id: '1', role: 'user', text: 'older', tokenEstimate: 2 },
      { id: '2', role: 'assistant', text: 'middle', tokenEstimate: 2 },
      { id: '3', role: 'user', text: 'current', tokenEstimate: 2 },
    ],
    { maxMessages: 2, maxTokenEstimate: 4 },
  );

  assert.deepEqual(
    window.map((message) => message.id),
    ['2', '3'],
  );

  const events = buildNimiConversationFeatureEvents([
    { type: 'start', traceId: 'trace-1' },
    { type: 'text-delta', text: 'hel' },
    { type: 'text-delta', text: 'lo' },
    { type: 'done', finishReason: 'stop' },
  ]);

  assert.equal(assembleNimiConversationText(events), 'hello');
  assert.deepEqual(
    kitLikeRowsFromConversationEvents(events).map((row) => row.kind),
    ['status', 'assistant-delta', 'assistant-delta', 'status'],
  );
  assert.equal(measureNimiConversationHistoryWindow(window, 10).totalWithReserve, 14);
  assert.equal(completeNimiConversationText(createNimiConversationTextAccumulator(), {
    text: 'done',
    finishReason: 'stop',
  }).terminal, 'completed');
});

test('generation feature transitions jobs and collects artifacts', () => {
  const queued = createNimiGenerationJob({ id: 'job-1', prompt: 'make image' });
  const completed = transitionNimiGenerationJob(queued, {
    status: 'completed',
    artifacts: [{ id: 'artifact-1', kind: 'image', uri: 'file:///tmp/image.png' }],
  });

  assert.equal(completed.status, 'completed');
  assert.equal(collectNimiGenerationArtifacts([completed])[0]?.id, 'artifact-1');
});

test('Runtime-bound generation client uses Scenario jobs and Runtime artifacts', async () => {
  const submitRequests: ReturnType<typeof buildNimiRuntimeGenerationSubmitRequest>[] = [];
  const submitOptions: RuntimeTypedCallOptions[] = [];
  const runtimeJob = {
    jobId: 'job-runtime-1',
    scenarioType: ScenarioType.IMAGE_GENERATE,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: RoutePolicy.LOCAL,
    modelResolved: 'image-model',
    status: ScenarioJobStatus.SUBMITTED,
    providerJobId: 'provider-job-1',
    reasonCode: 0,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'trace-job',
    ignoredExtensions: [],
    progressPercent: 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
  };
  const runtime = createNimiRuntimeGenerationClient({
    head: { appId: 'app-1' },
    runtime: {
      ai: {
        async submitScenarioJob(
          request: ReturnType<typeof buildNimiRuntimeGenerationSubmitRequest>,
          options?: RuntimeTypedCallOptions,
        ) {
          submitRequests.push(request);
          submitOptions.push(options ?? {});
          return { job: runtimeJob };
        },
        async getScenarioJob() {
          return {
            job: {
              ...runtimeJob,
              status: ScenarioJobStatus.COMPLETED,
              progressPercent: 100,
              artifacts: [{
                artifactId: 'artifact-1',
                mimeType: 'image/png',
                bytes: new Uint8Array(),
                uri: 'runtime://artifact-1',
                sha256: 'sha',
                sizeBytes: '3',
                durationMs: '0',
                fps: 0,
                width: 64,
                height: 64,
                sampleRateHz: 0,
                channels: 0,
              }],
            },
          };
        },
        async cancelScenarioJob() {
          return { job: { ...runtimeJob, status: ScenarioJobStatus.CANCELED } };
        },
        async *subscribeScenarioJobEvents() {
          yield {
            eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
            sequence: '1',
            traceId: 'trace-job',
            job: { ...runtimeJob, status: ScenarioJobStatus.COMPLETED },
          };
        },
        async getScenarioArtifacts() {
          return {
            jobId: 'job-runtime-1',
            traceId: 'trace-job',
            artifacts: [{
              artifactId: 'artifact-1',
              mimeType: 'image/png',
              bytes: new Uint8Array(),
              uri: 'runtime://artifact-1',
              sha256: 'sha',
              sizeBytes: '3',
              durationMs: '0',
              fps: 0,
              width: 64,
              height: 64,
              sampleRateHz: 0,
              channels: 0,
            }],
          };
        },
      },
      artifacts: {
        async readArtifactBytes(request) {
          assert.equal(request.artifactId, 'artifact-1');
          return {
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
            sizeBytes: '3',
            mimeInferred: false,
          };
        },
      },
    },
  });

  const submitted = await runtime.submit({
    scenario: { kind: 'image', prompt: 'make image', size: '1024x1024' },
    requestId: 'request-1',
    idempotencyKey: 'idempotency-1',
  });

  assert.equal(submitted.status, 'submitted');
  assert.equal(submitRequests[0]?.executionMode, ExecutionMode.ASYNC_JOB);
  assert.equal(submitOptions[0]?.metadata?.idempotencyKey, 'idempotency-1');
  assert.equal(submitRequests[0]?.spec?.spec.oneofKind, 'imageGenerate');
  assert.equal((await runtime.get('job-runtime-1')).artifacts[0]?.kind, 'image');
  assert.equal((await runtime.artifacts('job-runtime-1'))[0]?.uri, 'runtime://artifact-1');
  assert.deepEqual([...(await runtime.readArtifactBytes('artifact-1')).bytes], [1, 2, 3]);

  const events = [];
  for await (const event of runtime.events('job-runtime-1')) {
    events.push(event.type);
  }
  assert.deepEqual(events, ['completed']);
});

test('Runtime speech transcription helper runs Scenario job and extracts typed transcript', async () => {
  const submitRequests: ReturnType<typeof buildNimiRuntimeGenerationSubmitRequest>[] = [];
  const submitOptions: RuntimeTypedCallOptions[] = [];
  const runtimeJob = {
    jobId: 'job-stt-1',
    scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: RoutePolicy.LOCAL,
    modelResolved: 'whisper-1',
    status: ScenarioJobStatus.SUBMITTED,
    providerJobId: 'provider-stt-1',
    reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'trace-submit',
    ignoredExtensions: [],
    progressPercent: 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
  };
  const runtime = {
    async submitScenarioJob(
      request: ReturnType<typeof buildNimiRuntimeGenerationSubmitRequest>,
      options?: RuntimeTypedCallOptions,
    ) {
      submitRequests.push(request);
      submitOptions.push(options ?? {});
      return { job: runtimeJob };
    },
    async getScenarioJob() {
      return { job: { ...runtimeJob, status: ScenarioJobStatus.COMPLETED, progressPercent: 100 } };
    },
    async cancelScenarioJob() {
      return { job: { ...runtimeJob, status: ScenarioJobStatus.CANCELED } };
    },
    async *subscribeScenarioJobEvents() {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-event',
        job: { ...runtimeJob, status: ScenarioJobStatus.COMPLETED, traceId: 'trace-job' },
      };
    },
    async getScenarioArtifacts() {
      return {
        jobId: 'job-stt-1',
        traceId: 'trace-artifacts',
        artifacts: [],
        output: {
          output: {
            oneofKind: 'speechTranscribe' as const,
            speechTranscribe: {
              text: 'hello from speech',
              artifacts: [],
            },
          },
        },
      };
    },
  };

  const result = await runNimiRuntimeSpeechTranscription({
    runtime,
    head: { appId: 'app-1' },
    audio: { type: 'bytes', bytes: new Uint8Array([1, 2, 3]) },
    mimeType: 'audio/webm',
    requestId: 'req-stt',
    idempotencyKey: 'idem-stt',
  });

  assert.equal(result.text, 'hello from speech');
  assert.equal(result.traceId, 'trace-artifacts');
  assert.equal(submitRequests[0]?.scenarioType, ScenarioType.SPEECH_TRANSCRIBE);
  assert.equal(submitOptions[0]?.metadata?.idempotencyKey, 'idem-stt');
  assert.equal(submitRequests[0]?.spec.spec.oneofKind, 'speechTranscribe');
  if (submitRequests[0]?.spec.spec.oneofKind === 'speechTranscribe') {
    assert.equal(submitRequests[0].spec.spec.speechTranscribe.mimeType, 'audio/webm');
    assert.equal(submitRequests[0].spec.spec.speechTranscribe.audioSource?.source.oneofKind, 'audioBytes');
  }
});

test('Runtime speech synthesis helper runs Scenario job and requires typed audio artifacts', async () => {
  const submitRequests: ReturnType<typeof buildNimiRuntimeGenerationSubmitRequest>[] = [];
  const submitOptions: RuntimeTypedCallOptions[] = [];
  const runtimeJob = {
    jobId: 'job-tts-1',
    scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: RoutePolicy.LOCAL,
    modelResolved: 'tts-1',
    status: ScenarioJobStatus.SUBMITTED,
    providerJobId: 'provider-tts-1',
    reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'trace-submit',
    ignoredExtensions: [],
    progressPercent: 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
  };
  const runtime = {
    async submitScenarioJob(
      request: ReturnType<typeof buildNimiRuntimeGenerationSubmitRequest>,
      options?: RuntimeTypedCallOptions,
    ) {
      submitRequests.push(request);
      submitOptions.push(options ?? {});
      return { job: runtimeJob };
    },
    async getScenarioJob() {
      return { job: { ...runtimeJob, status: ScenarioJobStatus.COMPLETED, progressPercent: 100 } };
    },
    async cancelScenarioJob() {
      return { job: { ...runtimeJob, status: ScenarioJobStatus.CANCELED } };
    },
    async *subscribeScenarioJobEvents() {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-event',
        job: { ...runtimeJob, status: ScenarioJobStatus.COMPLETED, traceId: 'trace-job' },
      };
    },
    async getScenarioArtifacts() {
      return {
        jobId: 'job-tts-1',
        traceId: 'trace-artifacts',
        artifacts: [],
        output: {
          output: {
            oneofKind: 'speechSynthesize' as const,
            speechSynthesize: {
              artifacts: [{
                artifactId: 'audio-1',
                mimeType: 'audio/wav',
                bytes: Uint8Array.from([1, 2, 3]),
                uri: '',
                sha256: 'sha',
                sizeBytes: '3',
                durationMs: '1000',
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
  };

  const result = await runNimiRuntimeSpeechSynthesis({
    runtime,
    head: { appId: 'app-1' },
    text: 'hello from tts',
    audioFormat: 'wav',
    requestId: 'req-tts',
    idempotencyKey: 'idem-tts',
  });

  assert.equal(result.artifacts[0]?.artifactId, 'audio-1');
  assert.equal(result.traceId, 'trace-artifacts');
  assert.equal(submitRequests[0]?.scenarioType, ScenarioType.SPEECH_SYNTHESIZE);
  assert.equal(submitOptions[0]?.metadata?.idempotencyKey, 'idem-tts');
  assert.equal(submitRequests[0]?.spec.spec.oneofKind, 'speechSynthesize');
  if (submitRequests[0]?.spec.spec.oneofKind === 'speechSynthesize') {
    assert.equal(submitRequests[0].spec.spec.speechSynthesize.text, 'hello from tts');
    assert.equal(submitRequests[0].spec.spec.speechSynthesize.audioFormat, 'wav');
  }

  const invalidOutputRuntime = {
    ...runtime,
    async getScenarioArtifacts() {
      return {
        jobId: 'job-tts-1',
        traceId: 'trace-invalid',
        artifacts: [],
        output: { output: { oneofKind: undefined } },
      };
    },
  };
  await assert.rejects(
    () => runNimiRuntimeSpeechSynthesis({
      runtime: invalidOutputRuntime,
      head: { appId: 'app-1' },
      text: 'hello',
      requestId: 'req-invalid',
      idempotencyKey: 'idem-invalid',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );

  const noAudioRuntime = {
    ...runtime,
    async getScenarioArtifacts() {
      return {
        jobId: 'job-tts-1',
        traceId: 'trace-no-audio',
        artifacts: [],
        output: {
          output: {
            oneofKind: 'speechSynthesize' as const,
            speechSynthesize: { artifacts: [] },
          },
        },
      };
    },
  };
  await assert.rejects(
    () => runNimiRuntimeSpeechSynthesis({
      runtime: noAudioRuntime,
      head: { appId: 'app-1' },
      text: 'hello',
      requestId: 'req-no-audio',
      idempotencyKey: 'idem-no-audio',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.RUNTIME_CALL_FAILED,
  );
});

test('generation feature builds video speech and transcription Runtime scenarios', () => {
  const video = buildNimiRuntimeGenerationSubmitRequest(
    { appId: 'app-1' },
    {
      scenario: createNimiVideoGenerationScenario({
        kind: 'video',
        mode: 'i2v-first-frame',
        prompt: 'animate',
        content: [{ type: 'image-url', role: 'first-frame', url: 'https://example.com/frame.png' }],
        options: { durationSec: 5, seed: 42 },
      }),
      requestId: 'req-video',
      idempotencyKey: 'idem-video',
    },
  );
  assert.equal(video.scenarioType, ScenarioType.VIDEO_GENERATE);
  assert.equal(video.spec.spec.oneofKind, 'videoGenerate');
  assert.equal(video.spec.spec.videoGenerate.mode, 2);
  assert.equal(video.spec.spec.videoGenerate.content[0]?.imageUrl?.url, 'https://example.com/frame.png');
  assert.equal(video.spec.spec.videoGenerate.options?.durationSec, 5);
  assert.equal(video.spec.spec.videoGenerate.options?.seed, '42');

  const textVideo = buildNimiRuntimeGenerationSubmitRequest(
    { appId: 'app-1' },
    {
      scenario: createNimiVideoGenerationScenario({
        kind: 'video',
        mode: 't2v',
        prompt: 'sunrise',
      }),
      requestId: 'req-text-video',
      idempotencyKey: 'idem-text-video',
    },
  );
  assert.equal(textVideo.spec.spec.oneofKind, 'videoGenerate');
  assert.equal(textVideo.spec.spec.videoGenerate.content[0]?.text, 'sunrise');

  const speech = buildNimiRuntimeGenerationSubmitRequest(
    { appId: 'app-1' },
    {
      scenario: createNimiSpeechSynthesisScenario({
        kind: 'speech-synthesize',
        text: 'hello',
        audioFormat: 'wav',
        timingMode: 'word',
      }),
      requestId: 'req-tts',
      idempotencyKey: 'idem-tts',
    },
  );
  assert.equal(speech.scenarioType, ScenarioType.SPEECH_SYNTHESIZE);
  assert.equal(speech.spec.spec.oneofKind, 'speechSynthesize');
  assert.equal(speech.spec.spec.speechSynthesize.text, 'hello');
  assert.equal(speech.spec.spec.speechSynthesize.timingMode, 2);

  const stt = buildNimiRuntimeGenerationSubmitRequest(
    { appId: 'app-1' },
    {
      scenario: createNimiSpeechTranscriptionScenario({
        kind: 'speech-transcribe',
        mimeType: 'audio/wav',
        audio: { type: 'chunks', chunks: [Uint8Array.from([1]), new Uint8Array()] },
        timestamps: true,
      }),
      requestId: 'req-stt',
      idempotencyKey: 'idem-stt',
    },
  );
  assert.equal(stt.scenarioType, ScenarioType.SPEECH_TRANSCRIBE);
  assert.equal(stt.spec.spec.oneofKind, 'speechTranscribe');
  assert.equal(stt.spec.spec.speechTranscribe.audioSource?.source.oneofKind, 'audioChunks');
  if (stt.spec.spec.speechTranscribe.audioSource?.source.oneofKind === 'audioChunks') {
    assert.equal(stt.spec.spec.speechTranscribe.audioSource.source.audioChunks.chunks.length, 1);
  }

  assert.throws(
    () => buildNimiRuntimeGenerationSubmitRequest(
      { appId: 'app-1' },
      {
        scenario: createNimiVideoGenerationScenario({
          kind: 'video',
          mode: 'i2v-first-frame',
          content: [{ type: 'image-url', role: 'first-frame', url: 'https://127.0.0.1/frame.png' }],
        }),
        requestId: 'req-bad',
        idempotencyKey: 'idem-bad',
      },
    ),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_GENERATION_URL_UNSAFE',
  );
});

test('evaluation feature checks golden event order and adapter parity', () => {
  assertNimiGoldenRun(
    createNimiGoldenRun('golden-1', [
      { type: 'start' },
      { type: 'text-delta', text: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ]),
    ['start', 'text-delta', 'done'],
  );

  assertNimiAdapterCapabilityParity(
    {
      adapterId: 'test',
      targetLibrary: 'test',
      capabilityLevel: 'L2',
      capabilities: {
        'text.generate': { support: 'supported', mode: 'adapter-mapped' },
        'text.stream': { support: 'supported', mode: 'adapter-mapped' },
      },
      unsupportedBehavior: 'throw',
    },
    ['text.generate', 'text.stream'],
  );

  const parsed = parseNimiStructuredJson<{ ok: true }>({
    raw: 'answer: {"ok":true}',
    expect: 'object',
    validate: (value): value is { ok: true } => {
      return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true;
    },
  });
  assert.equal(parsed.ok, true);

  const failed = parseNimiStructuredJson({ raw: 'not-json', expect: 'object' });
  assert.equal(failed.ok, false);
  assert.equal(failed.ok ? '' : buildNimiStructuredOutputRepairRequest({
    failure: failed,
    originalText: 'not-json',
  }).failureReason, 'invalid-json');
});

test('toolkits feature creates approval external artifact and file tools', async () => {
  const tools = [
    createNimiApprovalTool({ name: 'approve', description: 'Approve work' }),
    createNimiExternalExecutionTool({ name: 'run', description: 'Run work' }),
    createNimiArtifactTool({ name: 'artifact', description: 'Create artifact', artifactKind: 'image' }),
    createNimiFileDescriptorTool({ name: 'file', description: 'Describe file' }),
  ];

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['approve', 'run', 'artifact', 'file'],
  );
  assert.equal(tools[0]?.policy, 'approval-required');

  const registry = createNimiToolRegistry([
    {
      name: 'local',
      description: 'Local tool',
      inputSchema: {},
      execute: () => ({ ok: true }),
    },
    createNimiApprovalTool({ name: 'approval', description: 'Approval tool' }),
    createNimiExternalExecutionTool({ name: 'external', description: 'External tool' }),
  ]);
  assert.deepEqual(registry.select({ include: ['local'] }).map((tool) => tool.name), ['local']);
  assert.equal((await registry.execute({ toolName: 'local' })).ok, true);
  assert.equal((await registry.execute({ toolName: 'approval' })).ok, false);
  assert.equal((await registry.execute({ toolName: 'external' })).ok, false);
});

function kitLikeRowsFromConversationEvents(
  events: readonly ReturnType<typeof buildNimiConversationFeatureEvents>[number][],
): readonly { readonly kind: string; readonly text?: string }[] {
  return events.map((event) => {
    if (event.type === 'conversation.text_delta') {
      return { kind: 'assistant-delta', text: event.text };
    }
    return { kind: 'status' };
  });
}
