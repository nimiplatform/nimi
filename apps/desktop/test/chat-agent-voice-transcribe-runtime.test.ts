import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiConversationAISnapshot,
  type ConversationCapabilityProjection,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import { createNimiBuiltInChatAIScopeRef, createEmptyNimiAIConfig } from '@nimiplatform/sdk/ai';
import { ExecutionMode, RoutePolicy, ScenarioJobEventType, ScenarioJobStatus, ScenarioType, type SubmitScenarioJobRequest } from '@nimiplatform/sdk/runtime/generated';
import { transcribeChatAgentVoiceRuntime } from '../src/shell/renderer/features/chat/chat-agent-runtime.js';

const testScopeRef = createNimiBuiltInChatAIScopeRef('agent');

function createTranscribeProjection(): ConversationCapabilityProjection {
  return {
    capability: 'audio.transcribe',
    selectedTargetRef: { kind: 'local-runtime', version: 'v2', profileBindingId: 'local-runtime:whisper-1' },
    resolvedBinding: {
      capability: 'audio.transcribe',
      resolvedBindingRef: 'local:audio.transcribe:whisper-1',
      source: 'local-runtime', targetRef: { kind: 'local-runtime' as const, version: 'v2' as const, profileBindingId: 'local-runtime:test-local' }, provider: 'local',
      connectorId: '',
      model: 'whisper-1',
      modelId: 'whisper-1',
      localAssetId: 'whisper-1',
    },
    health: {
      healthy: true,
      status: 'healthy',
      provider: 'local',
      detail: '',
      actionHint: '',
    },
    metadata: null,
    supported: true,
    reasonCode: null,
  };
}

function createTranscribeSnapshot() {
  return createNimiConversationAISnapshot({
    config: createEmptyNimiAIConfig(testScopeRef),
    capability: 'audio.transcribe',
    projection: createTranscribeProjection(),
  });
}

function createScenarioJob(status: ScenarioJobStatus) {
  return {
    jobId: 'job-1',
    scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: RoutePolicy.LOCAL,
    modelResolved: 'whisper-1',
    status,
    providerJobId: 'provider-job-1',
    reasonCode: 0,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'trace-job',
    ignoredExtensions: [],
    progressPercent: status === ScenarioJobStatus.COMPLETED ? 100 : 0,
    progressCurrentStep: status === ScenarioJobStatus.COMPLETED ? 1 : 0,
    progressTotalSteps: 1,
  };
}

test('agent voice transcribe runtime consumes audio.transcribe snapshot and returns typed transcript', async () => {
  let request: unknown = null;
  let callOptionsInput: unknown = null;
  const snapshot = createTranscribeSnapshot();

  const result = await transcribeChatAgentVoiceRuntime({
    audioBytes: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/webm',
    transcribeExecutionSnapshot: snapshot,
  }, {
    buildRuntimeCallOptionsImpl: async (input) => {
      callOptionsInput = input;
      return {
        timeoutMs: input.timeoutMs,
        metadata: { traceId: 'trace-metadata' },
      };
    },
    getAppIdImpl: () => 'nimi.desktop.test',
    createRequestIdImpl: () => 'req-stt-1',
    getRuntimeImpl: () => ({
      ai: {
        async submitScenarioJob(input: SubmitScenarioJobRequest) {
          request = input;
          return { job: createScenarioJob(ScenarioJobStatus.SUBMITTED) };
        },
        async getScenarioJob() {
          return { job: createScenarioJob(ScenarioJobStatus.COMPLETED) };
        },
        async cancelScenarioJob() {
          return { job: createScenarioJob(ScenarioJobStatus.CANCELED) };
        },
        async *subscribeScenarioJobEvents() {
          yield {
            eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
            sequence: '1',
            traceId: 'trace-event',
            job: createScenarioJob(ScenarioJobStatus.COMPLETED),
          };
        },
        async getScenarioArtifacts() {
          return {
            jobId: 'job-1',
            traceId: 'trace-stt',
            artifacts: [],
            output: {
              output: {
                oneofKind: 'speechTranscribe' as const,
                speechTranscribe: {
                  text: 'hello from voice',
                  artifacts: [],
                },
              },
            },
          };
        },
      },
    }) as never,
  });

  assert.equal(result.text, 'hello from voice');
  assert.equal(result.traceId, 'trace-stt');
  assert.ok(request);
  const capturedCallOptionsInput = callOptionsInput as { targetId?: string; timeoutMs?: number };
  const capturedRequest = request as SubmitScenarioJobRequest;
  assert.ok(capturedRequest.spec);
  assert.equal(capturedCallOptionsInput.targetId, 'whisper-1');
  assert.equal(capturedRequest.scenarioType, ScenarioType.SPEECH_TRANSCRIBE);
  assert.equal(capturedRequest.spec.spec.oneofKind, 'speechTranscribe');
  assert.equal(capturedRequest.spec.spec.speechTranscribe.mimeType, 'audio/webm');
  const source = capturedRequest.spec.spec.speechTranscribe.audioSource as { source?: { oneofKind?: string; audioBytes?: Uint8Array } } | undefined;
  assert.equal(source?.source?.oneofKind, 'audioBytes');
  assert.deepEqual(source?.source?.audioBytes, new Uint8Array([1, 2, 3]));
});

test('agent voice transcribe runtime fails close when transcript text is empty', async () => {
  const snapshot = createTranscribeSnapshot();

  await assert.rejects(
    () => transcribeChatAgentVoiceRuntime({
      audioBytes: new Uint8Array([1]),
      mimeType: 'audio/webm',
      transcribeExecutionSnapshot: snapshot,
    }, {
      buildRuntimeCallOptionsImpl: async (input) => ({
        timeoutMs: input.timeoutMs,
        metadata: { traceId: 'trace-metadata' },
      }),
      getAppIdImpl: () => 'nimi.desktop.test',
      createRequestIdImpl: () => 'req-stt-empty',
      getRuntimeImpl: () => ({
        ai: {
          async submitScenarioJob() {
            return { job: createScenarioJob(ScenarioJobStatus.SUBMITTED) };
          },
          async getScenarioJob() {
            return { job: createScenarioJob(ScenarioJobStatus.COMPLETED) };
          },
          async cancelScenarioJob() {
            return { job: createScenarioJob(ScenarioJobStatus.CANCELED) };
          },
          async *subscribeScenarioJobEvents() {
            yield {
              eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
              sequence: '1',
              traceId: 'trace-event',
              job: createScenarioJob(ScenarioJobStatus.COMPLETED),
            };
          },
          async getScenarioArtifacts() {
            return {
              jobId: 'job-1',
              traceId: 'trace-stt',
              artifacts: [],
              output: {
                output: {
                  oneofKind: 'speechTranscribe' as const,
                  speechTranscribe: {
                    text: '   ',
                    artifacts: [],
                  },
                },
              },
            };
          },
        },
      }) as never,
    }),
    /returned no transcript text/i,
  );
});
