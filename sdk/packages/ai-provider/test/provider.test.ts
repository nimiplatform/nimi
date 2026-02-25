import assert from 'node:assert/strict';
import test from 'node:test';

import { asNimiError, type RuntimeClient } from '@nimiplatform/sdk-runtime';

import { createNimiAiProvider } from '../src/index';

const APP_ID = 'nimi.ai.provider.test';
const SUBJECT_USER_ID = 'user-test-1';

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  // no-op
}

function createRuntimeStub(
  aiOverrides: Partial<RuntimeClient['ai']>,
): RuntimeClient {
  const ai = {
    generate: async () => ({
      output: {
        fields: {
          text: {
            kind: {
              oneofKind: 'stringValue',
              stringValue: 'ok',
            },
          },
        },
      },
      finishReason: 1,
      usage: {
        inputTokens: '1',
        outputTokens: '1',
      },
      routeDecision: 1,
      modelResolved: 'model/default',
      traceId: 'trace-default',
    }),
    streamGenerate: async () => emptyAsyncIterable(),
    embed: async () => ({
      vectors: [],
      usage: {
        inputTokens: '0',
      },
      routeDecision: 1,
      modelResolved: 'embed/default',
      traceId: 'trace-embed',
    }),
    generateImage: async () => emptyAsyncIterable(),
    generateVideo: async () => emptyAsyncIterable(),
    synthesizeSpeech: async () => emptyAsyncIterable(),
    transcribeAudio: async () => ({
      text: 'ok',
      usage: {
        inputTokens: '1',
      },
      routeDecision: 1,
      modelResolved: 'stt/default',
      traceId: 'trace-stt',
    }),
    ...aiOverrides,
  };

  return {
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint: '127.0.0.1:46371',
    },
    auth: {} as RuntimeClient['auth'],
    appAuth: {} as RuntimeClient['appAuth'],
    ai: ai as RuntimeClient['ai'],
    workflow: {} as RuntimeClient['workflow'],
    model: {} as RuntimeClient['model'],
    knowledge: {} as RuntimeClient['knowledge'],
    app: {} as RuntimeClient['app'],
    audit: {} as RuntimeClient['audit'],
    closeStream: async () => {},
  };
}

test('createNimiAiProvider text model maps runtime generate response', async () => {
  let capturedRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    generate: async (request) => {
      capturedRequest = request as Record<string, unknown>;
      return {
        output: {
          fields: {
            text: {
              kind: {
                oneofKind: 'stringValue',
                stringValue: 'hello from runtime',
              },
            },
          },
        },
        finishReason: 1,
        usage: {
          inputTokens: '14',
          outputTokens: '7',
        },
        routeDecision: 1,
        modelResolved: 'chat/default',
        traceId: 'trace-generate',
      };
    },
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  const model = nimi('chat/default');
  const result = await model.doGenerate({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'hello',
      }],
    }],
    providerOptions: {},
  });

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.appId, APP_ID);
  assert.equal(capturedRequest.subjectUserId, SUBJECT_USER_ID);
  assert.equal(capturedRequest.routePolicy, 1);
  assert.equal(capturedRequest.fallback, 1);
  assert.deepEqual(result.content, [{
    type: 'text',
    text: 'hello from runtime',
  }]);
  assert.equal(result.finishReason.unified, 'stop');
  assert.equal(result.usage.inputTokens.total, 14);
  assert.equal(result.usage.outputTokens.total, 7);
});

test('createNimiAiProvider text streaming maps delta and finish events', async () => {
  const runtime = createRuntimeStub({
    streamGenerate: async function* () {
      yield {
        payload: {
          oneofKind: 'delta',
          delta: {
            text: 'he',
          },
        },
      };
      yield {
        payload: {
          oneofKind: 'delta',
          delta: {
            text: 'llo',
          },
        },
      };
      yield {
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: 1,
          },
        },
      };
    },
  });

  const model = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  })('chat/default');
  const streamResult = await model.doStream({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'hello',
      }],
    }],
    providerOptions: {},
  });

  const reader = streamResult.stream.getReader();
  const parts: Array<{ type?: string; delta?: string; finishReason?: { unified?: string } }> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value as { type?: string; delta?: string; finishReason?: { unified?: string } });
  }

  assert.ok(parts.some((part) => part.type === 'text-delta' && part.delta === 'he'));
  assert.ok(parts.some((part) => part.type === 'text-delta' && part.delta === 'llo'));
  assert.ok(parts.some((part) => part.type === 'finish' && part.finishReason?.unified === 'stop'));
});

test('createNimiAiProvider embedding and image models map runtime responses', async () => {
  const runtime = createRuntimeStub({
    embed: async () => ({
      vectors: [{
        values: [
          { kind: { oneofKind: 'numberValue', numberValue: 0.1 } },
          { kind: { oneofKind: 'numberValue', numberValue: 0.2 } },
        ],
      }],
      usage: {
        inputTokens: '3',
      },
      routeDecision: 2,
      modelResolved: 'embed/default',
      traceId: 'trace-embed',
    }),
    generateImage: async function* () {
      yield {
        artifactId: 'image-1',
        mimeType: 'image/png',
        chunk: Uint8Array.from([1, 2]),
        traceId: 'trace-image',
        routeDecision: 1,
        modelResolved: 'image/default',
      };
      yield {
        artifactId: 'image-1',
        mimeType: 'image/png',
        chunk: Uint8Array.from([3, 4]),
        traceId: 'trace-image',
        routeDecision: 1,
        modelResolved: 'image/default',
      };
    },
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  const embeddingResult = await nimi.embedding('embed/default').doEmbed({
    values: ['query'],
    providerOptions: {},
  });
  assert.deepEqual(embeddingResult.embeddings, [[0.1, 0.2]]);

  const imageResult = await nimi.image('image/default').doGenerate({
    prompt: 'draw',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
  });
  assert.equal(imageResult.images.length, 1);
  assert.equal(imageResult.images[0], Buffer.from([1, 2, 3, 4]).toString('base64'));
});

test('createNimiAiProvider maps runtime failures and exposes video/tts/stt extensions', async () => {
  const runtime = createRuntimeStub({
    generate: async () => {
      throw JSON.stringify({
        reasonCode: 'AI_PROVIDER_TIMEOUT',
        actionHint: 'retry_or_switch_route',
        traceId: 'trace-failure',
        retryable: true,
        message: 'provider timeout',
      });
    },
    generateVideo: async function* () {
      yield {
        artifactId: 'video-1',
        mimeType: 'video/mp4',
        chunk: Uint8Array.from([9, 8, 7]),
        routeDecision: 2,
        modelResolved: 'video/default',
        traceId: 'trace-video',
      };
    },
    synthesizeSpeech: async function* () {
      yield {
        artifactId: 'audio-1',
        mimeType: 'audio/wav',
        chunk: Uint8Array.from([6, 5]),
        routeDecision: 1,
        modelResolved: 'tts/default',
        traceId: 'trace-tts',
      };
    },
    transcribeAudio: async () => ({
      text: 'transcribed text',
      usage: {
        inputTokens: '4',
      },
      routeDecision: 1,
      modelResolved: 'stt/default',
      traceId: 'trace-stt',
    }),
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  let thrown: unknown = null;
  try {
    await nimi('chat/default').doGenerate({
      prompt: [{
        role: 'user',
        content: [{
          type: 'text',
          text: 'hello',
        }],
      }],
      providerOptions: {},
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'runtime' });
  assert.equal(nimiError.reasonCode, 'AI_PROVIDER_TIMEOUT');
  assert.equal(nimiError.retryable, true);

  const video = await nimi.video('video/default').generate({
    prompt: 'create video',
  });
  assert.equal(video.artifacts.length, 1);
  assert.equal(video.artifacts[0]?.routeDecision, 'token-api');

  const tts = await nimi.tts('tts/default').synthesize({
    text: 'hello',
  });
  assert.equal(tts.artifacts.length, 1);
  assert.equal(tts.artifacts[0]?.mimeType, 'audio/wav');

  const stt = await nimi.stt('stt/default').transcribe({
    audioBytes: Uint8Array.from([1, 2, 3]),
    mimeType: 'audio/wav',
  });
  assert.equal(stt.text, 'transcribed text');
  assert.equal(stt.routeDecision, 'local-runtime');
});

