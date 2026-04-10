import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAISnapshot,
  createEmptyAIConfig,
  type ConversationCapabilityProjection,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import { transcribeChatAgentVoiceRuntime } from '../src/shell/renderer/features/chat/chat-agent-runtime.js';

function createTranscribeProjection(): ConversationCapabilityProjection {
  return {
    capability: 'audio.transcribe',
    selectedBinding: {
      source: 'local',
      connectorId: '',
      model: 'whisper-1',
      localModelId: 'whisper-1',
    },
    resolvedBinding: {
      capability: 'audio.transcribe',
      source: 'local',
      provider: 'local',
      connectorId: '',
      model: 'whisper-1',
      modelId: 'whisper-1',
      localModelId: 'whisper-1',
    },
    health: {
      ok: true,
      checkedAt: new Date().toISOString(),
      latencyMs: 10,
    },
    metadata: null,
    supported: true,
    reasonCode: null,
  };
}

test('agent voice transcribe runtime consumes audio.transcribe snapshot and returns typed transcript', async () => {
  let request: { mimeType?: string; audio?: unknown } | null = null;
  const snapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'audio.transcribe',
    projection: createTranscribeProjection(),
  });

  const result = await transcribeChatAgentVoiceRuntime({
    audioBytes: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/webm',
    transcribeExecutionSnapshot: snapshot,
  }, {
    buildRuntimeRequestMetadataImpl: async () => ({ traceId: 'trace-metadata' }),
    getRuntimeClientImpl: () => ({
      media: {
        stt: {
          transcribe: async (input: { mimeType?: string; audio?: unknown }) => {
            request = input;
            return {
              job: {
                jobId: 'job-1',
                status: 'completed',
              },
              text: 'hello from voice',
              artifacts: [],
              trace: {
                traceId: 'trace-stt',
                modelResolved: 'whisper-1',
              },
            };
          },
        },
      },
    }) as never,
  });

  assert.equal(result.text, 'hello from voice');
  assert.equal(result.traceId, 'trace-stt');
  assert.ok(request);
  const capturedRequest = request as { mimeType?: string; audio?: unknown };
  assert.equal(capturedRequest.mimeType, 'audio/webm');
  assert.deepEqual(capturedRequest.audio, {
    kind: 'bytes',
    bytes: new Uint8Array([1, 2, 3]),
  });
});

test('agent voice transcribe runtime fails close when transcript text is empty', async () => {
  const snapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'audio.transcribe',
    projection: createTranscribeProjection(),
  });

  await assert.rejects(
    () => transcribeChatAgentVoiceRuntime({
      audioBytes: new Uint8Array([1]),
      mimeType: 'audio/webm',
      transcribeExecutionSnapshot: snapshot,
    }, {
      buildRuntimeRequestMetadataImpl: async () => ({ traceId: 'trace-metadata' }),
      getRuntimeClientImpl: () => ({
        media: {
          stt: {
            transcribe: async () => ({
              job: {
                jobId: 'job-1',
                status: 'completed',
              },
              text: '   ',
              artifacts: [],
              trace: {
                traceId: 'trace-stt',
                modelResolved: 'whisper-1',
              },
            }),
          },
        },
      }) as never,
    }),
    /returned no transcript text/i,
  );
});
