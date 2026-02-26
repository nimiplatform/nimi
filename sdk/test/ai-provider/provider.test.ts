import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';

import { asNimiError, type RuntimeClient } from '../../src/runtime/index.js';

import { createNimiAiProvider } from '../../src/ai-provider/index.js';

const APP_ID = 'nimi.ai.provider.test';
const SUBJECT_USER_ID = 'user-test-1';

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  // no-op
}

function createRuntimeStub(
  aiOverrides: Partial<RuntimeClient['ai']>,
): RuntimeClient {
  const mediaJobs = new Map<string, {
    job: {
      jobId: string;
      status: number;
      routeDecision: number;
      modelResolved: string;
      traceId: string;
    };
    artifacts: Array<{
      artifactId: string;
      mimeType: string;
      bytes: Uint8Array;
    }>;
  }>();
  let mediaJobCounter = 0;

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
    submitMediaJob: async (request) => {
      mediaJobCounter += 1;
      const jobId = `job-default-${mediaJobCounter}`;
      const modal = Number((request as { modal?: number }).modal || 0);
      const modelResolved = String((request as { modelId?: string }).modelId || 'media/default');
      const traceId = `trace-media-${mediaJobCounter}`;
      const artifact = modal === 5
        ? {
          artifactId: `${jobId}-artifact-1`,
          mimeType: 'text/plain',
          bytes: Buffer.from('ok', 'utf8'),
        }
        : {
          artifactId: `${jobId}-artifact-1`,
          mimeType: 'application/octet-stream',
          bytes: Uint8Array.from([1]),
        };
      mediaJobs.set(jobId, {
        job: {
          jobId,
          status: 4,
          routeDecision: 1,
          modelResolved,
          traceId,
        },
        artifacts: [artifact],
      });
      return {
        job: mediaJobs.get(jobId)?.job,
      };
    },
    getMediaJob: async (request) => ({
      job: mediaJobs.get(String((request as { jobId?: string }).jobId || ''))?.job,
    }),
    cancelMediaJob: async () => ({
      canceled: true,
    }),
    subscribeMediaJobEvents: async () => emptyAsyncIterable(),
    getMediaArtifacts: async (request) => {
      const entry = mediaJobs.get(String((request as { jobId?: string }).jobId || ''));
      return {
        jobId: entry?.job.jobId || '',
        artifacts: entry?.artifacts || [],
        traceId: entry?.job.traceId || '',
      };
    },
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
  const mediaJobs = new Map<string, {
    job: {
      jobId: string;
      status: number;
      routeDecision: number;
      modelResolved: string;
      traceId: string;
    };
    artifacts: Array<{
      artifactId: string;
      mimeType: string;
      bytes: Uint8Array;
    }>;
  }>();
  let mediaJobCounter = 0;

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
    submitMediaJob: async () => {
      mediaJobCounter += 1;
      const jobId = `job-image-${mediaJobCounter}`;
      mediaJobs.set(jobId, {
        job: {
          jobId,
          status: 4,
          routeDecision: 1,
          modelResolved: 'image/default',
          traceId: 'trace-image',
        },
        artifacts: [{
          artifactId: 'image-1',
          mimeType: 'image/png',
          bytes: Uint8Array.from([1, 2, 3, 4]),
        }],
      });
      return {
        job: mediaJobs.get(jobId)?.job,
      };
    },
    getMediaJob: async (request) => ({
      job: mediaJobs.get(String((request as { jobId?: string }).jobId || ''))?.job,
    }),
    getMediaArtifacts: async (request) => {
      const entry = mediaJobs.get(String((request as { jobId?: string }).jobId || ''));
      return {
        jobId: entry?.job.jobId || '',
        artifacts: entry?.artifacts || [],
        traceId: entry?.job.traceId || '',
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
  const mediaJobs = new Map<string, {
    job: {
      jobId: string;
      status: number;
      routeDecision: number;
      modelResolved: string;
      traceId: string;
    };
    artifacts: Array<{
      artifactId: string;
      mimeType: string;
      bytes: Uint8Array;
    }>;
  }>();
  let mediaJobCounter = 0;

  const runtime = createRuntimeStub({
    generate: async () => {
      throw JSON.stringify({
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_or_switch_route',
        traceId: 'trace-failure',
        retryable: true,
        message: 'provider timeout',
      });
    },
    submitMediaJob: async (request) => {
      mediaJobCounter += 1;
      const jobId = `job-${mediaJobCounter}`;
      const modal = Number((request as { modal?: number }).modal || 0);
      const modelResolved = String((request as { modelId?: string }).modelId || 'media/default');
      const routeDecision = modal === 3 ? 2 : 1;
      const traceId = modal === 3 ? 'trace-video' : modal === 4 ? 'trace-tts' : 'trace-stt';
      const artifacts = modal === 3
        ? [{
          artifactId: 'video-1',
          mimeType: 'video/mp4',
          bytes: Uint8Array.from([9, 8, 7]),
        }]
        : modal === 4
          ? [{
            artifactId: 'audio-1',
            mimeType: 'audio/wav',
            bytes: Uint8Array.from([6, 5]),
          }]
          : [{
            artifactId: 'stt-1',
            mimeType: 'text/plain',
            bytes: Buffer.from('transcribed text', 'utf8'),
          }];
      mediaJobs.set(jobId, {
        job: {
          jobId,
          status: 4,
          routeDecision,
          modelResolved,
          traceId,
        },
        artifacts,
      });
      return {
        job: mediaJobs.get(jobId)?.job,
      };
    },
    getMediaJob: async (request) => ({
      job: mediaJobs.get(String((request as { jobId?: string }).jobId || ''))?.job,
    }),
    getMediaArtifacts: async (request) => {
      const entry = mediaJobs.get(String((request as { jobId?: string }).jobId || ''));
      return {
        jobId: entry?.job.jobId || '',
        artifacts: entry?.artifacts || [],
        traceId: entry?.job.traceId || '',
      };
    },
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
