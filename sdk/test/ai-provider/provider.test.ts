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

function createRuntimeStub(
  aiOverrides: Partial<{
    generate: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    streamGenerate: (request: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
    embed: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    submitScenarioJob: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    getScenarioJob: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    cancelScenarioJob: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    subscribeScenarioJobEvents: (request: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
    getScenarioArtifacts: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }>,
): Runtime {
  const asRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  };
  const normalizeText = (value: unknown): string => String(value || '').trim();
  const scenarioTypeToModal = (scenarioType: number): number => {
    switch (scenarioType) {
      case 3:
        return 2;
      case 4:
        return 3;
      case 5:
        return 4;
      case 6:
        return 5;
      default:
        return 0;
    }
  };
  const modalToScenarioType = (modal: number): number => {
    switch (modal) {
      case 2:
        return 3;
      case 3:
        return 4;
      case 4:
        return 5;
      case 5:
        return 6;
      default:
        return 0;
    }
  };
  const oneofSpecFromScenarioSpec = (specValue: unknown): Record<string, unknown> => {
    const spec = asRecord(asRecord(specValue).spec);
    const oneofKind = normalizeText(spec.oneofKind);
    if (oneofKind === 'imageGenerate') {
      return {
        oneofKind: 'imageSpec',
        imageSpec: asRecord(spec.imageGenerate),
      };
    }
    if (oneofKind === 'videoGenerate') {
      return {
        oneofKind: 'videoSpec',
        videoSpec: asRecord(spec.videoGenerate),
      };
    }
    if (oneofKind === 'speechSynthesize') {
      return {
        oneofKind: 'speechSpec',
        speechSpec: asRecord(spec.speechSynthesize),
      };
    }
    if (oneofKind === 'speechTranscribe') {
      return {
        oneofKind: 'transcriptionSpec',
        transcriptionSpec: asRecord(spec.speechTranscribe),
      };
    }
    return {
      oneofKind: undefined,
    };
  };
  const toEmbeddingOutput = (value: unknown): Record<string, unknown> => {
    const vectors = Array.isArray(asRecord(value).vectors) ? asRecord(value).vectors as unknown[] : [];
    const normalized = vectors.map((entry) => {
      if (Array.isArray(entry)) {
        return entry.map((item) => Number(item)).filter((item) => Number.isFinite(item));
      }
      const values = Array.isArray(asRecord(entry).values) ? asRecord(entry).values as unknown[] : [];
      return values.map((item) => {
        const kind = asRecord(asRecord(item).kind);
        if (kind.oneofKind === 'numberValue') {
          const parsed = Number(kind.numberValue);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      }).filter((item): item is number => item !== null);
    });
    return Struct.fromJson({ vectors: normalized } as never) as unknown as Record<string, unknown>;
  };

  const scenarioJobs = new Map<string, {
    job: {
      jobId: string;
      status: number;
      scenarioType: number;
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
  let scenarioJobCounter = 0;

  const scenarioBridge = {
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
    streamGenerate: async () => emptyAsyncIterable<Record<string, unknown>>(),
    embed: async () => ({
      vectors: [],
      usage: {
        inputTokens: '0',
      },
      routeDecision: 1,
      modelResolved: 'embed/default',
      traceId: 'trace-embed',
    }),
    submitScenarioJob: async (request: Record<string, unknown>) => {
      scenarioJobCounter += 1;
      const jobId = `job-default-${scenarioJobCounter}`;
      const modal = Number(request.modal || 0);
      const modelResolved = String(request.modelId || 'media/default');
      const traceId = `trace-scenario-${scenarioJobCounter}`;
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
      scenarioJobs.set(jobId, {
        job: {
          jobId,
          status: 4,
          scenarioType: modalToScenarioType(modal),
          routeDecision: 1,
          modelResolved,
          traceId,
        },
        artifacts: [artifact],
      });
      return {
        job: scenarioJobs.get(jobId)?.job,
      };
    },
    getScenarioJob: async (request: Record<string, unknown>) => ({
      job: scenarioJobs.get(String(request.jobId || ''))?.job,
    }),
    cancelScenarioJob: async () => ({
      canceled: true,
    }),
    subscribeScenarioJobEvents: async () => emptyAsyncIterable<Record<string, unknown>>(),
    getScenarioArtifacts: async (request: Record<string, unknown>) => {
      const entry = scenarioJobs.get(String(request.jobId || ''));
      return {
        jobId: entry?.job.jobId || '',
        artifacts: entry?.artifacts || [],
        traceId: entry?.job.traceId || '',
      };
    },
    ...aiOverrides,
  };

  const ai = {
    executeScenario: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const head = asRecord(requestRecord.head);
      const scenarioType = Number(requestRecord.scenarioType || 0);
      const spec = asRecord(asRecord(requestRecord.spec).spec);

      if (scenarioType === 2) {
        const embedResult = await scenarioBridge.embed({
          appId: head.appId,
          subjectUserId: head.subjectUserId,
          modelId: head.modelId,
          routePolicy: head.routePolicy,
          fallback: head.fallback,
          timeoutMs: head.timeoutMs,
          connectorId: head.connectorId,
          inputs: asRecord(spec.textEmbed).inputs,
        });
        return {
          output: toEmbeddingOutput(embedResult),
          finishReason: 0,
          usage: embedResult.usage,
          routeDecision: Number(embedResult.routeDecision || 0),
          modelResolved: normalizeText(embedResult.modelResolved),
          traceId: normalizeText(embedResult.traceId),
          ignoredExtensions: [],
        };
      }

      const generateResult = await scenarioBridge.generate({
        appId: head.appId,
        subjectUserId: head.subjectUserId,
        modelId: head.modelId,
        routePolicy: head.routePolicy,
        fallback: head.fallback,
        timeoutMs: head.timeoutMs,
        connectorId: head.connectorId,
        input: asRecord(spec.textGenerate).input,
        systemPrompt: asRecord(spec.textGenerate).systemPrompt,
        tools: asRecord(spec.textGenerate).tools,
        temperature: asRecord(spec.textGenerate).temperature,
        topP: asRecord(spec.textGenerate).topP,
        maxTokens: asRecord(spec.textGenerate).maxTokens,
      });

      return {
        output: generateResult.output,
        finishReason: Number(generateResult.finishReason || 0),
        usage: generateResult.usage,
        routeDecision: Number(generateResult.routeDecision || 0),
        modelResolved: normalizeText(generateResult.modelResolved),
        traceId: normalizeText(generateResult.traceId),
        ignoredExtensions: [],
      };
    },
    streamScenario: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const head = asRecord(requestRecord.head);
      const spec = asRecord(asRecord(requestRecord.spec).spec);
      return scenarioBridge.streamGenerate({
        appId: head.appId,
        subjectUserId: head.subjectUserId,
        modelId: head.modelId,
        routePolicy: head.routePolicy,
        fallback: head.fallback,
        timeoutMs: head.timeoutMs,
        connectorId: head.connectorId,
        input: asRecord(spec.textGenerate).input,
        systemPrompt: asRecord(spec.textGenerate).systemPrompt,
        tools: asRecord(spec.textGenerate).tools,
        temperature: asRecord(spec.textGenerate).temperature,
        topP: asRecord(spec.textGenerate).topP,
        maxTokens: asRecord(spec.textGenerate).maxTokens,
      }) as unknown as AsyncIterable<Record<string, unknown>>;
    },
    submitScenarioJob: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const head = asRecord(requestRecord.head);
      const scenarioType = Number(requestRecord.scenarioType || 0);
      const scenarioResponse = await scenarioBridge.submitScenarioJob({
        appId: head.appId,
        subjectUserId: head.subjectUserId,
        modelId: head.modelId,
        modal: scenarioTypeToModal(scenarioType),
        routePolicy: head.routePolicy,
        fallback: head.fallback,
        timeoutMs: head.timeoutMs,
        connectorId: head.connectorId,
        requestId: requestRecord.requestId,
        idempotencyKey: requestRecord.idempotencyKey,
        labels: requestRecord.labels,
        spec: oneofSpecFromScenarioSpec(requestRecord.spec),
      });
      const scenarioSnapshot = asRecord(scenarioResponse.job);
      return {
        job: {
          jobId: normalizeText(scenarioSnapshot.jobId),
          head: {
            appId: normalizeText(head.appId),
            subjectUserId: normalizeText(head.subjectUserId),
            modelId: normalizeText(head.modelId),
            routePolicy: Number(head.routePolicy || 0),
            fallback: Number(head.fallback || 0),
            timeoutMs: Number(head.timeoutMs || 0),
            connectorId: normalizeText(head.connectorId),
          },
          scenarioType,
          executionMode: 3,
          routeDecision: Number(scenarioSnapshot.routeDecision || 0),
          modelResolved: normalizeText(scenarioSnapshot.modelResolved),
          status: Number(scenarioSnapshot.status || 0),
          providerJobId: normalizeText(scenarioSnapshot.providerJobId),
          reasonCode: scenarioSnapshot.reasonCode,
          reasonDetail: normalizeText(scenarioSnapshot.reasonDetail),
          retryCount: Number(scenarioSnapshot.retryCount || 0),
          createdAt: scenarioSnapshot.createdAt,
          updatedAt: scenarioSnapshot.updatedAt,
          nextPollAt: scenarioSnapshot.nextPollAt,
          artifacts: [],
          usage: scenarioSnapshot.usage,
          traceId: normalizeText(scenarioSnapshot.traceId),
          ignoredExtensions: [],
        },
      };
    },
    getScenarioJob: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const scenarioResponse = await scenarioBridge.getScenarioJob({
        jobId: normalizeText(requestRecord.jobId),
      });
      const scenarioSnapshot = asRecord(scenarioResponse.job);
      const scenarioType = Number(scenarioSnapshot.scenarioType || 0);
      return {
        job: {
          jobId: normalizeText(scenarioSnapshot.jobId),
          head: {
            appId: APP_ID,
            subjectUserId: SUBJECT_USER_ID,
            modelId: normalizeText(scenarioSnapshot.modelResolved),
            routePolicy: 1,
            fallback: 1,
            timeoutMs: 0,
            connectorId: '',
          },
          scenarioType,
          executionMode: 3,
          routeDecision: Number(scenarioSnapshot.routeDecision || 0),
          modelResolved: normalizeText(scenarioSnapshot.modelResolved),
          status: Number(scenarioSnapshot.status || 0),
          providerJobId: normalizeText(scenarioSnapshot.providerJobId),
          reasonCode: scenarioSnapshot.reasonCode,
          reasonDetail: normalizeText(scenarioSnapshot.reasonDetail),
          retryCount: Number(scenarioSnapshot.retryCount || 0),
          createdAt: scenarioSnapshot.createdAt,
          updatedAt: scenarioSnapshot.updatedAt,
          nextPollAt: scenarioSnapshot.nextPollAt,
          artifacts: [],
          usage: scenarioSnapshot.usage,
          traceId: normalizeText(scenarioSnapshot.traceId),
          ignoredExtensions: [],
        },
      };
    },
    cancelScenarioJob: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      await scenarioBridge.cancelScenarioJob({
        jobId: normalizeText(requestRecord.jobId),
        reason: normalizeText(requestRecord.reason),
      });
      const current = scenarioJobs.get(normalizeText(requestRecord.jobId));
      return {
        job: {
          jobId: normalizeText(requestRecord.jobId),
          head: {
            appId: APP_ID,
            subjectUserId: SUBJECT_USER_ID,
            modelId: current?.job.modelResolved || 'media/default',
            routePolicy: 1,
            fallback: 1,
            timeoutMs: 0,
            connectorId: '',
          },
          scenarioType: current?.job.scenarioType || 3,
          executionMode: 3,
          routeDecision: current?.job.routeDecision || 1,
          modelResolved: current?.job.modelResolved || 'media/default',
          status: 6,
          providerJobId: '',
          reasonCode: 0,
          reasonDetail: '',
          retryCount: 0,
          createdAt: undefined,
          updatedAt: undefined,
          nextPollAt: undefined,
          artifacts: [],
          usage: undefined,
          traceId: current?.job.traceId || '',
          ignoredExtensions: [],
        },
      };
    },
    subscribeScenarioJobEvents: async (request) => scenarioBridge.subscribeScenarioJobEvents(
      request as unknown as Record<string, unknown>,
    ) as unknown as AsyncIterable<Record<string, unknown>>,
    getScenarioArtifacts: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const scenarioResponse = await scenarioBridge.getScenarioArtifacts({
        jobId: normalizeText(requestRecord.jobId),
      });
      return {
        jobId: normalizeText(scenarioResponse.jobId),
        artifacts: Array.isArray(scenarioResponse.artifacts) ? scenarioResponse.artifacts : [],
        traceId: normalizeText(scenarioResponse.traceId),
      };
    },
    listScenarioProfiles: async () => ({ profiles: [] }),
    getVoiceAsset: async () => ({ asset: undefined }),
    listVoiceAssets: async () => ({ assets: [] }),
    deleteVoiceAsset: async () => ({ deleted: true }),
    listPresetVoices: async () => ({ voices: [] }),
  } as Runtime['ai'];

  const runtime = Object.create(Runtime.prototype) as Runtime;
  (runtime as unknown as { ai: Runtime['ai'] }).ai = ai;
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

test('createNimiAiProvider text model projects ChatMessage parts with dual-written content', async () => {
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
                stringValue: 'multimodal ok',
              },
            },
          },
        },
        finishReason: 1,
        usage: {
          inputTokens: '5',
          outputTokens: '3',
        },
        routeDecision: 1,
        modelResolved: 'chat/default',
        traceId: 'trace-multimodal-generate',
      };
    },
  });

  const model = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  })('chat/default');

  await model.doGenerate({
    prompt: [
      {
        role: 'system',
        content: [
          { type: 'text', text: 'system instructions' },
          { type: 'file', mediaType: 'image/png', data: 'https://example.com/system.png' },
        ] as never,
      },
      {
        role: 'user',
        content: [
          { type: 'file', mediaType: 'image/png', data: 'https://example.com/image.png' },
          { type: 'file', mediaType: 'video/mp4', data: 'https://example.com/video.mp4' },
          { type: 'text', text: 'describe the scene' },
        ] as never,
      },
    ],
    providerOptions: {},
  });

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.systemPrompt, 'system instructions');
  const input = capturedRequest.input as Array<Record<string, unknown>>;
  assert.equal(input.length, 1);
  assert.equal(input[0]?.content, 'describe the scene');
  const parts = input[0]?.parts as Array<Record<string, unknown>>;
  assert.equal(parts.length, 3);
  assert.equal(parts[0]?.type, 2);
  assert.equal((parts[0]?.imageUrl as { url?: string })?.url, 'https://example.com/image.png');
  assert.equal(parts[1]?.type, 3);
  assert.equal(parts[1]?.videoUrl, 'https://example.com/video.mp4');
  assert.equal(parts[2]?.type, 1);
  assert.equal(parts[2]?.text, 'describe the scene');
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
  const scenarioJobs = new Map<string, {
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
  let scenarioJobCounter = 0;

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
    submitScenarioJob: async () => {
      scenarioJobCounter += 1;
      const jobId = `job-image-${scenarioJobCounter}`;
      scenarioJobs.set(jobId, {
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
        job: scenarioJobs.get(jobId)?.job,
      };
    },
    getScenarioJob: async (request) => ({
      job: scenarioJobs.get(String((request as { jobId?: string }).jobId || ''))?.job,
    }),
    getScenarioArtifacts: async (request) => {
      const entry = scenarioJobs.get(String((request as { jobId?: string }).jobId || ''));
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
    submitScenarioJob: async (request) => {
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
    getScenarioJob: async () => ({
      job: {
        jobId: 'job-image-compat-1',
        status: 4,
        routeDecision: 1,
        modelResolved: 'image/default',
        traceId: 'trace-image-compat',
      },
    }),
    getScenarioArtifacts: async () => ({
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

  assert.equal(imageSpec.providerOptions, undefined);
});

test('createNimiAiProvider maps runtime failures and exposes video/tts/stt extensions', async () => {
  const scenarioJobs = new Map<string, {
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
  let scenarioJobCounter = 0;

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
    submitScenarioJob: async (request) => {
      scenarioJobCounter += 1;
      const jobId = `job-${scenarioJobCounter}`;
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
      scenarioJobs.set(jobId, {
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
        job: scenarioJobs.get(jobId)?.job,
      };
    },
    getScenarioJob: async (request) => ({
      job: scenarioJobs.get(String((request as { jobId?: string }).jobId || ''))?.job,
    }),
    getScenarioArtifacts: async (request) => {
      const entry = scenarioJobs.get(String((request as { jobId?: string }).jobId || ''));
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
    mode: 't2v',
    prompt: 'create video',
    content: [{
      type: 'text',
      role: 'prompt',
      text: 'create video',
    }],
    options: {
      durationSec: 5,
    },
  });
  assert.equal(video.artifacts.length, 1);
  assert.equal(video.artifacts[0]?.routeDecision, 'cloud');

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
  assert.equal(stt.routeDecision, 'local');
});

test('createNimiAiProvider abort signal cancels scenario job before throwing', async () => {
  let cancelCalled = false;
  const runtime = createRuntimeStub({
    submitScenarioJob: async () => ({
      job: {
        jobId: 'job-abort-1',
        status: 2,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-abort',
      },
    }),
    getScenarioJob: async () => ({
      job: {
        jobId: 'job-abort-1',
        status: 3,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-abort',
      },
    }),
    cancelScenarioJob: async () => {
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
      mode: 't2v',
      prompt: 'cancel me',
      content: [{
        type: 'text',
        role: 'prompt',
        text: 'cancel me',
      }],
      options: {
        durationSec: 5,
      },
      signal: abortController.signal,
    });
  });
  assert.equal(cancelCalled, true);
});

test('createNimiAiProvider forwards requestId/idempotencyKey/labels to submitScenarioJob', async () => {
  let capturedSubmitRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    submitScenarioJob: async (request) => {
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
    getScenarioJob: async () => ({
      job: {
        jobId: 'job-meta-1',
        status: 4,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-meta',
      },
    }),
    getScenarioArtifacts: async () => ({
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
    mode: 't2v',
    prompt: 'meta',
    content: [{
      type: 'text',
      role: 'prompt',
      text: 'meta',
    }],
    options: {
      durationSec: 5,
    },
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
