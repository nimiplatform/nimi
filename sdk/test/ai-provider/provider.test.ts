import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';

import { asNimiError, Runtime } from '../../src/runtime/index.js';

import { createNimiAiProvider } from '../../src/ai-provider/index.js';

const APP_ID = 'nimi.ai.provider.test';
const SUBJECT_USER_ID = 'user-test-1';

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  // no-op
}

type RuntimeAiCore = Pick<Runtime['ai'],
  | 'generate'
  | 'streamGenerate'
  | 'embed'
  | 'submitMediaJob'
  | 'getMediaJob'
  | 'cancelMediaJob'
  | 'subscribeMediaJobEvents'
  | 'getMediaResult'
  | 'generateImage'
  | 'generateVideo'
  | 'synthesizeSpeech'
  | 'transcribeAudio'
>;

function createRuntimeStub(
  aiOverrides: Partial<RuntimeAiCore>,
): Runtime {
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

  const ai: RuntimeAiCore = {
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
    getMediaResult: async (request) => {
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
    ...(aiOverrides as RuntimeAiCore),
  };

  const runtime = Object.create(Runtime.prototype) as Runtime;
  (runtime as unknown as { ai: Runtime['ai'] }).ai = ai as Runtime['ai'];
  return runtime;
}

test('createNimiAiProvider requires Runtime class instance', () => {
  let thrown: unknown = null;

  try {
    createNimiAiProvider({
      runtime: { ai: {} } as unknown as Runtime,
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'sdk' });
  assert.equal(nimiError.reasonCode, ReasonCode.SDK_AI_PROVIDER_RUNTIME_REQUIRED);
});

test('createNimiAiProvider accepts missing subjectUserId and keeps request subject unset', async () => {
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
                stringValue: 'hello without explicit subject',
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
        modelResolved: 'chat/default',
        traceId: 'trace-no-subject',
      };
    },
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
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
  assert.equal(capturedRequest.subjectUserId, undefined);
  assert.equal(result.content[0]?.type, 'text');
});

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

test('createNimiAiProvider stream interruption requires explicit resubscribe', async () => {
  let streamGenerateCalls = 0;
  const runtime = createRuntimeStub({
    streamGenerate: async function* () {
      streamGenerateCalls += 1;
      if (streamGenerateCalls === 1) {
        yield {
          payload: {
            oneofKind: 'failed',
            failed: {
              reasonCode: ReasonCode.AI_STREAM_BROKEN,
              actionHint: 'retry',
            },
          },
        };
        return;
      }

      yield {
        payload: {
          oneofKind: 'delta',
          delta: {
            text: 'retry-ok',
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

  const first = await model.doStream({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'first-attempt',
      }],
    }],
    providerOptions: {},
  });
  const firstReader = first.stream.getReader();
  const firstParts: Array<{
    type?: string;
    delta?: string;
    error?: { reasonCode?: string };
    finishReason?: { unified?: string };
  }> = [];
  while (true) {
    const next = await firstReader.read();
    if (next.done) {
      break;
    }
    firstParts.push(next.value as {
      type?: string;
      delta?: string;
      error?: { reasonCode?: string };
      finishReason?: { unified?: string };
    });
  }

  assert.ok(firstParts.some((part) => part.type === 'error'));
  assert.ok(!firstParts.some((part) => part.type === 'finish'));

  const second = await model.doStream({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'second-attempt',
      }],
    }],
    providerOptions: {},
  });
  const secondReader = second.stream.getReader();
  const secondParts: Array<{
    type?: string;
    delta?: string;
    error?: { reasonCode?: string };
    finishReason?: { unified?: string };
  }> = [];
  while (true) {
    const next = await secondReader.read();
    if (next.done) {
      break;
    }
    secondParts.push(next.value as {
      type?: string;
      delta?: string;
      error?: { reasonCode?: string };
      finishReason?: { unified?: string };
    });
  }

  assert.equal(streamGenerateCalls, 2);
  assert.ok(secondParts.some((part) => part.type === 'text-delta' && part.delta === 'retry-ok'));
  assert.ok(secondParts.some((part) => part.type === 'finish' && part.finishReason?.unified === 'stop'));
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
    getMediaResult: async (request) => {
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

test('createNimiAiProvider image model flattens providerOptions and maps files/mask', async () => {
  let capturedSubmitRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    submitMediaJob: async (request) => {
      capturedSubmitRequest = request as Record<string, unknown>;
      return {
        job: {
          jobId: 'job-image-compat-1',
          status: 4,
          routeDecision: 1,
          modelResolved: 'image/default',
          traceId: 'trace-image-compat',
        },
      };
    },
    getMediaJob: async () => ({
      job: {
        jobId: 'job-image-compat-1',
        status: 4,
        routeDecision: 1,
        modelResolved: 'image/default',
        traceId: 'trace-image-compat',
      },
    }),
    getMediaResult: async () => ({
      jobId: 'job-image-compat-1',
      traceId: 'trace-image-compat',
      artifacts: [{
        artifactId: 'image-compat-1',
        mimeType: 'image/png',
        bytes: Uint8Array.from([7, 8, 9]),
      }],
    }),
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  await nimi.image('image/default').doGenerate({
    prompt: 'draw',
    n: 1,
    size: '1024x1024',
    aspectRatio: '1:1',
    files: [
      { type: 'url', url: 'https://example.com/ref-1.png' } as never,
      { type: 'file', mediaType: 'image/png', data: 'QUJD' } as never,
      { type: 'file', mediaType: 'image/jpeg', data: Uint8Array.from([1, 2, 3]) } as never,
    ],
    mask: { type: 'file', mediaType: 'image/png', data: 'Rk9P' } as never,
    providerOptions: {
      requestId: 'req-top',
      idempotencyKey: 'idem-top',
      labels: { source: 'top' },
      quality: 'high-top',
      steps: 40,
      method: 'top-method',
      nimi: {
        responseFormat: 'b64_json',
        requestId: 'req-nimi',
      },
      localai: {
        idempotencyKey: 'idem-localai',
        quality: 'high-localai',
      },
      nexa: {
        style: 'cinematic',
        method: 'nexa-method',
      },
    },
  });

  assert.ok(capturedSubmitRequest);
  assert.equal(capturedSubmitRequest.requestId, 'req-top');
  assert.equal(capturedSubmitRequest.idempotencyKey, 'idem-top');
  assert.deepEqual(capturedSubmitRequest.labels, { source: 'top' });

  const specRecord = capturedSubmitRequest.spec as { imageSpec?: Record<string, unknown> } | undefined;
  const imageSpec = (specRecord?.imageSpec || {}) as Record<string, unknown>;
  assert.deepEqual(imageSpec.referenceImages, [
    'https://example.com/ref-1.png',
    'data:image/png;base64,QUJD',
    'data:image/jpeg;base64,AQID',
  ]);
  assert.equal(imageSpec.mask, 'data:image/png;base64,Rk9P');
  assert.equal(imageSpec.quality, 'high-top');
  assert.equal(imageSpec.style, 'cinematic');
  assert.equal(imageSpec.responseFormat, 'b64_json');

  const providerOptionsJson = Struct.toJson(imageSpec.providerOptions as never) as Record<string, unknown>;
  assert.equal(providerOptionsJson.requestId, 'req-top');
  assert.equal(providerOptionsJson.idempotencyKey, 'idem-top');
  assert.equal(providerOptionsJson.quality, 'high-top');
  assert.equal(providerOptionsJson.style, 'cinematic');
  assert.equal(providerOptionsJson.steps, 40);
  assert.equal(providerOptionsJson.method, 'top-method');
  assert.equal(providerOptionsJson.responseFormat, 'b64_json');
  assert.equal(providerOptionsJson.nimi, undefined);
  assert.equal(providerOptionsJson.localai, undefined);
  assert.equal(providerOptionsJson.nexa, undefined);
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
    getMediaResult: async (request) => {
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

test('createNimiAiProvider abort signal cancels media job before throwing', async () => {
  let cancelCalled = false;
  const runtime = createRuntimeStub({
    submitMediaJob: async () => ({
      job: {
        jobId: 'job-abort-1',
        status: 2,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-abort',
      },
    }),
    getMediaJob: async () => ({
      job: {
        jobId: 'job-abort-1',
        status: 3,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-abort',
      },
    }),
    cancelMediaJob: async () => {
      cancelCalled = true;
      return { canceled: true } as never;
    },
  });
  const abortController = new AbortController();
  abortController.abort();

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });
  await assert.rejects(async () => {
    await nimi.video('video/default').generate({
      prompt: 'cancel me',
      signal: abortController.signal,
    });
  });
  assert.equal(cancelCalled, true);
});

test('createNimiAiProvider forwards requestId/idempotencyKey/labels to submitMediaJob', async () => {
  let capturedSubmitRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    submitMediaJob: async (request) => {
      capturedSubmitRequest = request as Record<string, unknown>;
      return {
        job: {
          jobId: 'job-meta-1',
          status: 4,
          routeDecision: 1,
          modelResolved: 'video/default',
          traceId: 'trace-meta',
        },
      };
    },
    getMediaJob: async () => ({
      job: {
        jobId: 'job-meta-1',
        status: 4,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-meta',
      },
    }),
    getMediaResult: async () => ({
      jobId: 'job-meta-1',
      traceId: 'trace-meta',
      artifacts: [{
        artifactId: 'video-meta-1',
        mimeType: 'video/mp4',
        bytes: Uint8Array.from([1, 2, 3]),
      }],
    }),
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });
  await nimi.video('video/default').generate({
    prompt: 'meta',
    requestId: 'req-001',
    idempotencyKey: 'idem-001',
    labels: {
      source: 'test',
    },
  });
  assert.ok(capturedSubmitRequest);
  assert.equal(capturedSubmitRequest.requestId, 'req-001');
  assert.equal(capturedSubmitRequest.idempotencyKey, 'idem-001');
  assert.deepEqual(capturedSubmitRequest.labels, { source: 'test' });
});
