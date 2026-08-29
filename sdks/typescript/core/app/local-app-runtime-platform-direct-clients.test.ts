import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FinishReason,
  ReasonCode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
} from '../../core-generated/runtime-typed-client.js';
import {
  AiRealtimeAudioCodec,
  AiRealtimeTurnDetectionMode,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai_realtime.js';
import { createNimiLocalAppAIConsumptionRuntimeClient } from './local-app-runtime-platform-ai.js';
import { createNimiAiRealtimeRuntimeClient } from './local-app-runtime-platform-direct-ai-realtime.js';

test('formal AI consumption runtime adapter keeps the canonical Local App operation family', async () => {
  let textRequest: unknown;
  let executeRequest: unknown;
  const client = createNimiLocalAppAIConsumptionRuntimeClient({
    streamLocalAppTextTurn(request) {
      textRequest = request;
      return (async function* () {
        yield {
          sequence: '1', traceId: 'trace-1',
          payload: { oneofKind: 'delta' as const, delta: { text: 'hello' } },
        };
        yield {
          sequence: '2', traceId: 'trace-1',
          payload: { oneofKind: 'completed' as const, completed: { finishReason: FinishReason.STOP } },
        };
      })();
    },
    async executeLocalAppScenario(request) {
      executeRequest = request;
      return {
        output: {
          oneofKind: 'textEmbed' as const,
          textEmbed: { vectors: [{ values: [0.25, 0.75] }] },
        },
        traceId: 'trace-embed',
      };
    },
    async submitLocalAppScenarioJob() {
      return {
        job: {
          jobId: 'job-1', scenarioType: ScenarioType.IMAGE_GENERATE,
          status: ScenarioJobStatus.SUBMITTED, progressPercent: 0,
          progressCurrentStep: 0, progressTotalSteps: 0,
          reasonCode: ReasonCode.REASON_CODE_UNSPECIFIED, reasonDetail: '',
          artifacts: [], traceId: '', transcriptionText: '',
        },
      };
    },
    async getLocalAppScenarioJob() { throw new Error('not used'); },
    subscribeLocalAppScenarioJobEvents() {
      return (async function* () {
        yield {
          eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED,
          sequence: '1', traceId: '', job: undefined,
        };
      })();
    },
    async cancelLocalAppScenarioJob() { throw new Error('not used'); },
    async readLocalAppArtifact() { throw new Error('not used'); },
    async uploadLocalAppArtifact() { throw new Error('not used'); },
    async listLocalAppVoiceAssets() { return { assets: [], nextPageToken: '' }; },
  });

  const stream = await client.text.streamTurn({ messages: [{ role: 'user', text: 'hello' }] });
  const events = [];
  for await (const event of stream) events.push(event);
  assert.deepEqual(events, [
    { type: 'delta', sequence: '1', traceId: 'trace-1', text: 'hello' },
    { type: 'completed', sequence: '2', traceId: 'trace-1', finishReason: 'stop' },
  ]);
  assert.deepEqual(textRequest, {
    messages: [{ role: 'user', text: 'hello' }],
    stop: [],
  });

  assert.deepEqual(await client.scenario.execute({ type: 'text-embed', inputs: ['hello'] }), {
    output: { type: 'text-embed', vectors: [[0.25, 0.75]] },
    traceId: 'trace-embed',
  });
  assert.deepEqual(executeRequest, {
    spec: { oneofKind: 'textEmbed', textEmbed: { inputs: ['hello'] } },
  });
});

test('formal AI Realtime runtime adapter preserves typed owner input and safe projection', async () => {
  let openRequest: unknown;
  let appendRequest: unknown;
  const control = {
    realtimeSessionId: 'realtime-1', channelId: 'channel-1', subscriptionId: '',
    adapterKind: 3, lifecycle: 2, generation: '1', sequence: '0',
    correlationId: 'correlation-1', backpressure: 1, bufferedItems: 0,
    bufferCapacity: 32, terminalReason: 0, actionHint: '', occurredAt: undefined,
  };
  const client = createNimiAiRealtimeRuntimeClient({
    async openRealtimeSession(request) {
      openRequest = request;
      return {
        realtimeSessionId: 'realtime-1', channelId: 'channel-1', generation: '1',
        negotiatedInputAudio: request.inputAudio,
        negotiatedOutputAudio: undefined,
        control,
      };
    },
    async appendRealtimeInput(request) {
      appendRequest = request;
      return { ack: { ok: true, reasonCode: ReasonCode.ACTION_EXECUTED, actionHint: '' }, control };
    },
    async submitRealtimeOwnerControl() { throw new Error('not used'); },
    readRealtimeEvents() { return (async function* () {})(); },
    async interruptRealtimeOutput() { throw new Error('not used'); },
    async closeRealtimeSession() { throw new Error('not used'); },
  });
  const audio = {
    codec: 'pcm-s16le' as const,
    sampleRateHz: 16_000,
    channelCount: 1 as const,
    frameDurationMs: 20,
    maximumFrameBytes: 640,
  };
  await client.open({
    inputAudio: audio,
    audioOutputEnabled: false,
    turnDetection: 'manual',
    initialInstruction: '',
  });
  assert.deepEqual(openRequest, {
    inputAudio: { ...audio, codec: AiRealtimeAudioCodec.PCM_S16LE },
    audioOutputEnabled: false,
    turnDetection: AiRealtimeTurnDetectionMode.MANUAL,
    initialInstruction: '',
  });
  await client.appendInput({
    realtimeSessionId: 'realtime-1', generation: '1',
    input: { type: 'owner-context', requestId: 'request-1', kind: 'sanitized-result', text: 'safe' },
  });
  assert.deepEqual(appendRequest, {
    realtimeSessionId: 'realtime-1', generation: '1',
    input: {
      oneofKind: 'ownerContext',
      ownerContext: { requestId: 'request-1', kind: 3, text: 'safe' },
    },
  });
});
