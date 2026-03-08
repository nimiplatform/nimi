import assert from 'node:assert/strict';
import test from 'node:test';

import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp.js';
import {
  Ack,
  ReasonCode as RuntimeReasonCode,
} from '../../src/runtime/generated/runtime/v1/common.js';
import {
  AppMessageEvent,
  AppMessageEventType,
  SendAppMessageResponse,
} from '../../src/runtime/generated/runtime/v1/app.js';
import {
  GetRuntimeHealthResponse,
  RuntimeHealthStatus,
} from '../../src/runtime/generated/runtime/v1/audit.js';
import {
  AuthorizationPreset,
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  IssueDelegatedAccessTokenResponse,
  PolicyMode,
} from '../../src/runtime/generated/runtime/v1/grant.js';
import {
  CancelScenarioJobRequest,
  CancelScenarioJobResponse,
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  ExecutionMode,
  FallbackPolicy,
  FinishReason,
  GetScenarioArtifactsRequest,
  GetScenarioArtifactsResponse,
  GetScenarioJobRequest,
  GetScenarioJobResponse,
  RoutePolicy,
  ScenarioJob,
  ScenarioJobEvent,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  StreamEventType,
  StreamScenarioEvent,
  SubmitScenarioJobRequest,
  SubmitScenarioJobResponse,
} from '../../src/runtime/generated/runtime/v1/ai.js';
import { RuntimeUnaryMethodCodecs } from '../../src/runtime/core/method-codecs.js';
import {
  asNimiError,
  Runtime,
  RuntimeMethodIds,
  setNodeGrpcBridge,
  type NodeGrpcBridge,
} from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';

const APP_ID = 'nimi.runtime.class.coverage.test';

type BinaryType = {
  create(value?: Record<string, unknown>): Record<string, unknown>;
  toBinary(value: Record<string, unknown>): Uint8Array;
};

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

function encodeUnary(methodId: string, value?: Record<string, unknown>): Uint8Array {
  const codec = RuntimeUnaryMethodCodecs[methodId] as { responseType?: BinaryType } | undefined;
  assert.ok(codec?.responseType, `missing unary codec for ${methodId}`);
  return codec.responseType.toBinary(codec.responseType.create(value || {}));
}

function createScenarioJob(input: {
  jobId: string;
  scenarioType: ScenarioType;
  status: ScenarioJobStatus;
  routeDecision?: RoutePolicy;
  traceId?: string;
}): ScenarioJob {
  return ScenarioJob.create({
    jobId: input.jobId,
    head: {
      appId: APP_ID,
      subjectUserId: 'subject-1',
      modelId: 'model-1',
      routePolicy: RoutePolicy.LOCAL,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 1000,
      connectorId: '',
    },
    scenarioType: input.scenarioType,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: input.routeDecision ?? RoutePolicy.LOCAL,
    modelResolved: 'resolved-model-1',
    status: input.status,
    providerJobId: `provider-${input.jobId}`,
    reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    reasonDetail: '',
    retryCount: 0,
    createdAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
    updatedAt: Timestamp.create({ seconds: '1700000001', nanos: 0 }),
    artifacts: [],
    traceId: input.traceId || `trace-${input.jobId}`,
  });
}

test('Runtime text and embedding helpers map requests and stream parts', async () => {
  const capturedTextRequests: ExecuteScenarioRequest[] = [];
  const capturedEmbedRequests: ExecuteScenarioRequest[] = [];
  let streamCallCount = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.executeScenario) {
        return encodeUnary(input.methodId);
      }
      const request = ExecuteScenarioRequest.fromBinary(input.request);
      if (request.scenarioType === ScenarioType.TEXT_GENERATE) {
        capturedTextRequests.push(request);
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: Struct.fromJson({ text: 'hello-from-runtime-generate' } as never),
            finishReason: FinishReason.LENGTH,
            usage: {
              inputTokens: '2',
              outputTokens: '3',
              computeMs: '11',
            },
            routeDecision: RoutePolicy.CLOUD,
            modelResolved: 'cloud/model',
            traceId: 'trace-generate',
          }),
        );
      }
      if (request.scenarioType === ScenarioType.TEXT_EMBED) {
        capturedEmbedRequests.push(request);
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: Struct.fromJson({ vectors: [[0.1, 0.2]] } as never),
            usage: {
              inputTokens: '4',
              outputTokens: '0',
              computeMs: '7',
            },
            routeDecision: RoutePolicy.CLOUD,
            modelResolved: 'cloud/embed-model',
            traceId: 'trace-embed',
          }),
        );
      }
      return encodeUnary(input.methodId);
    },
    openStream: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.streamScenario) {
        return {
          async *[Symbol.asyncIterator]() {
            // no-op
          },
        };
      }

      streamCallCount += 1;
      if (streamCallCount === 1) {
        return {
          async *[Symbol.asyncIterator]() {
            yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
              eventType: StreamEventType.STREAM_EVENT_STARTED,
              sequence: '1',
              traceId: 'trace-stream-1',
              payload: {
                oneofKind: 'started',
                started: {
                  modelResolved: 'cloud/stream-model',
                  routeDecision: RoutePolicy.CLOUD,
                },
              },
            }));
            yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
              eventType: StreamEventType.STREAM_EVENT_DELTA,
              sequence: '2',
              traceId: 'trace-stream-1',
              payload: {
                oneofKind: 'delta',
                delta: {
                  text: 'delta-text',
                },
              },
            }));
            yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
              eventType: StreamEventType.STREAM_EVENT_USAGE,
              sequence: '3',
              traceId: 'trace-stream-1',
              payload: {
                oneofKind: 'usage',
                usage: {
                  inputTokens: '6',
                  outputTokens: '7',
                  computeMs: '12',
                },
              },
            }));
            yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
              eventType: StreamEventType.STREAM_EVENT_COMPLETED,
              sequence: '4',
              traceId: 'trace-stream-1',
              payload: {
                oneofKind: 'completed',
                completed: {
                  finishReason: FinishReason.TOOL_CALL,
                },
              },
            }));
          },
        };
      }

      return {
        async *[Symbol.asyncIterator]() {
          yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
            eventType: StreamEventType.STREAM_EVENT_FAILED,
            sequence: '5',
            traceId: 'trace-stream-2',
            payload: {
              oneofKind: 'failed',
              failed: {
                reasonCode: RuntimeReasonCode.AI_PROVIDER_TIMEOUT,
                actionHint: 'retry',
              },
            },
          }));
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        getSubjectUserId: async () => 'subject-from-context',
      },
    });

    const textResult = await runtime.ai.text.generate({
      model: 'cloud/model',
      input: [
        { role: 'system', content: 'system-one' },
        { role: 'user', content: 'hello user' },
      ],
      system: 'system-two',
      route: 'cloud',
      fallback: 'allow',
      temperature: 0.4,
      topP: 0.9,
      maxTokens: 42,
    });
    assert.equal(textResult.text, 'hello-from-runtime-generate');
    assert.equal(textResult.finishReason, 'length');
    assert.equal(textResult.usage.totalTokens, 5);
    assert.equal(textResult.trace.routeDecision, 'cloud');
    assert.equal(capturedTextRequests[0]?.head?.subjectUserId, 'subject-from-context');
    assert.equal(capturedTextRequests[0]?.head?.routePolicy, RoutePolicy.CLOUD);
    assert.equal(capturedTextRequests[0]?.head?.fallback, FallbackPolicy.ALLOW);
    assert.equal(
      capturedTextRequests[0]?.spec?.spec.oneofKind === 'textGenerate'
        ? capturedTextRequests[0]?.spec?.spec.textGenerate.systemPrompt
        : '',
      'system-one\n\nsystem-two',
    );

    await runtime.ai.executeScenario({
      head: {
        appId: APP_ID,
        modelId: 'cloud/model-low-level',
        routePolicy: RoutePolicy.CLOUD,
        fallback: FallbackPolicy.ALLOW,
        timeoutMs: 1000,
        connectorId: '',
      },
      scenarioType: ScenarioType.TEXT_GENERATE,
      executionMode: ExecutionMode.SYNC,
      spec: {
        spec: {
          oneofKind: 'textGenerate',
          textGenerate: {
            input: [{ role: 'user', content: 'low level', name: '' }],
            systemPrompt: '',
            tools: [],
            temperature: 0,
            topP: 0,
            maxTokens: 8,
          },
        },
      },
      extensions: [],
    });
    assert.equal(capturedTextRequests[1]?.head?.subjectUserId, 'subject-from-context');

    const streamResult = await runtime.ai.text.stream({
      model: 'cloud/stream-model',
      input: 'stream this',
      route: 'cloud',
      fallback: 'allow',
    });
    const streamParts: Array<{ type: string; reason?: string }> = [];
    for await (const part of streamResult.stream) {
      if (part.type === 'finish') {
        streamParts.push({ type: part.type, reason: part.finishReason });
      } else {
        streamParts.push({ type: part.type });
      }
    }
    assert.deepEqual(streamParts, [
      { type: 'start' },
      { type: 'delta' },
      { type: 'finish', reason: 'tool-calls' },
    ]);

    const streamErrorResult = await runtime.ai.text.stream({
      model: 'cloud/stream-model',
      input: 'stream error',
      route: 'cloud',
      fallback: 'allow',
    });
    let streamErrorReason = '';
    for await (const part of streamErrorResult.stream) {
      if (part.type === 'error') {
        streamErrorReason = part.error.reasonCode;
      }
    }
    assert.equal(streamErrorReason, String(RuntimeReasonCode.AI_PROVIDER_TIMEOUT));

    const embeddingResult = await runtime.ai.embedding.generate({
      model: 'cloud/embed-model',
      subjectUserId: 'subject-explicit',
      input: ['alpha', 'beta'],
      route: 'cloud',
      fallback: 'allow',
    });
    assert.equal(embeddingResult.vectors.length, 1);
    assert.equal(embeddingResult.trace.traceId, 'trace-embed');
    assert.equal(capturedEmbedRequests[0]?.head?.subjectUserId, 'subject-explicit');
    assert.equal(capturedEmbedRequests[0]?.head?.routePolicy, RoutePolicy.CLOUD);

    await runtime.ai.executeScenario({
      head: {
        appId: APP_ID,
        modelId: 'cloud/embed-model',
        routePolicy: RoutePolicy.CLOUD,
        fallback: FallbackPolicy.ALLOW,
        timeoutMs: 1000,
        connectorId: '',
      },
      scenarioType: ScenarioType.TEXT_EMBED,
      executionMode: ExecutionMode.SYNC,
      spec: {
        spec: {
          oneofKind: 'textEmbed',
          textEmbed: {
            inputs: ['gamma'],
          },
        },
      },
      extensions: [],
    });
    assert.equal(capturedEmbedRequests[1]?.head?.subjectUserId, 'subject-from-context');

    await assert.rejects(
      async () => runtime.ai.embedding.generate({
        model: 'cloud/embed-model',
        input: '',
      }),
      (error: unknown) => asNimiError(error, { source: 'sdk' }).reasonCode === ReasonCode.AI_INPUT_INVALID,
    );

    await assert.rejects(
      async () => runtime.ai.text.generate({
        model: 'cloud/model',
        input: [{ role: 'system', content: 'system only' }],
      }),
      (error: unknown) => asNimiError(error, { source: 'sdk' }).reasonCode === ReasonCode.AI_INPUT_INVALID,
    );

    const runtimeWithoutAuthContext = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });
    await runtimeWithoutAuthContext.ai.text.generate({
      model: 'local/model-anon',
      input: 'anonymous local request',
    });
    assert.equal(capturedTextRequests[capturedTextRequests.length - 1]?.head?.subjectUserId, '');
    assert.equal(capturedTextRequests[capturedTextRequests.length - 1]?.head?.routePolicy, RoutePolicy.LOCAL);

    await runtimeWithoutAuthContext.ai.executeScenario({
      head: {
        appId: APP_ID,
        modelId: 'local/model-low-level',
        routePolicy: RoutePolicy.LOCAL,
        fallback: FallbackPolicy.DENY,
        timeoutMs: 1000,
        connectorId: '',
      },
      scenarioType: ScenarioType.TEXT_GENERATE,
      executionMode: ExecutionMode.SYNC,
      spec: {
        spec: {
          oneofKind: 'textGenerate',
          textGenerate: {
            input: [{ role: 'user', content: 'low level anonymous local', name: '' }],
            systemPrompt: '',
            tools: [],
            temperature: 0,
            topP: 0,
            maxTokens: 8,
          },
        },
      },
      extensions: [],
    });
    assert.equal(capturedTextRequests[capturedTextRequests.length - 1]?.head?.subjectUserId, '');

    await assert.rejects(
      async () => runtimeWithoutAuthContext.ai.executeScenario({
        head: {
          appId: APP_ID,
          modelId: 'cloud/model',
          routePolicy: RoutePolicy.CLOUD,
          fallback: FallbackPolicy.ALLOW,
          timeoutMs: 1000,
          connectorId: '',
        },
        scenarioType: ScenarioType.TEXT_GENERATE,
        executionMode: ExecutionMode.SYNC,
        spec: {
          spec: {
            oneofKind: 'textGenerate',
            textGenerate: {
              input: [{ role: 'user', content: 'low level requires subject', name: '' }],
              systemPrompt: '',
              tools: [],
              temperature: 0,
              topP: 0,
              maxTokens: 8,
            },
          },
        },
        extensions: [],
      }),
      (error: unknown) => asNimiError(error, { source: 'sdk' }).reasonCode === ReasonCode.AUTH_CONTEXT_MISSING,
    );
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime media helpers, raw calls and passthrough modules cover bridge paths', async () => {
  const submitted: SubmitScenarioJobRequest[] = [];
  const cancelled: CancelScenarioJobRequest[] = [];
  const closedStreamIds: string[] = [];
  const jobs = new Map<string, ScenarioJob>();
  let sequence = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      switch (input.methodId) {
        case RuntimeMethodIds.audit.getRuntimeHealth:
          return GetRuntimeHealthResponse.toBinary(GetRuntimeHealthResponse.create({
            status: RuntimeHealthStatus.READY,
            reason: '',
            queueDepth: 2,
            activeWorkflows: 1,
            activeInferenceJobs: 3,
            cpuMilli: '100',
            memoryBytes: '2048',
            vramBytes: '1024',
            sampledAt: Timestamp.create({ seconds: '1700000100', nanos: 0 }),
          }));
        case RuntimeMethodIds.ai.executeScenario: {
          const request = ExecuteScenarioRequest.fromBinary(input.request);
          if (request.scenarioType === ScenarioType.TEXT_EMBED) {
            return ExecuteScenarioResponse.toBinary(ExecuteScenarioResponse.create({
              output: Struct.fromJson({ vectors: [[1, 2, 3]] } as never),
              usage: { inputTokens: '1', outputTokens: '0', computeMs: '1' },
              routeDecision: RoutePolicy.LOCAL,
              modelResolved: 'embed-raw',
              traceId: 'trace-raw-embed',
            }));
          }
          return ExecuteScenarioResponse.toBinary(ExecuteScenarioResponse.create({}));
        }
        case RuntimeMethodIds.ai.submitScenarioJob: {
          const request = SubmitScenarioJobRequest.fromBinary(input.request);
          submitted.push(request);
          sequence += 1;
          const jobId = `job-${sequence}`;
          const job = createScenarioJob({
            jobId,
            scenarioType: request.scenarioType,
            status: ScenarioJobStatus.COMPLETED,
            routeDecision: RoutePolicy.CLOUD,
            traceId: `trace-${jobId}`,
          });
          jobs.set(jobId, job);
          return SubmitScenarioJobResponse.toBinary(SubmitScenarioJobResponse.create({ job }));
        }
        case RuntimeMethodIds.ai.getScenarioJob: {
          const request = GetScenarioJobRequest.fromBinary(input.request);
          const job = jobs.get(request.jobId);
          return GetScenarioJobResponse.toBinary(GetScenarioJobResponse.create({ job }));
        }
        case RuntimeMethodIds.ai.cancelScenarioJob: {
          const request = CancelScenarioJobRequest.fromBinary(input.request);
          cancelled.push(request);
          const current = jobs.get(request.jobId);
          const job = createScenarioJob({
            jobId: request.jobId,
            scenarioType: current?.scenarioType ?? ScenarioType.IMAGE_GENERATE,
            status: ScenarioJobStatus.CANCELED,
          });
          jobs.set(request.jobId, job);
          return CancelScenarioJobResponse.toBinary(CancelScenarioJobResponse.create({ job }));
        }
        case RuntimeMethodIds.ai.getScenarioArtifacts: {
          const request = GetScenarioArtifactsRequest.fromBinary(input.request);
          const payloadText = `artifact-${request.jobId}`;
          return GetScenarioArtifactsResponse.toBinary(GetScenarioArtifactsResponse.create({
            artifacts: [{
              artifactId: `artifact-${request.jobId}`,
              mimeType: 'text/plain',
              bytes: Buffer.from(payloadText, 'utf8'),
              uri: '',
              sha256: '',
              sizeBytes: String(payloadText.length),
              durationMs: '0',
              fps: 0,
              width: 0,
              height: 0,
              sampleRateHz: 0,
              channels: 0,
            }],
            traceId: `trace-${request.jobId}`,
          }));
        }
        case RuntimeMethodIds.model.list:
          return encodeUnary(input.methodId, {
            models: [{ modelId: 'model-1' }],
          });
        case RuntimeMethodIds.app.sendAppMessage:
          return SendAppMessageResponse.toBinary(SendAppMessageResponse.create({
            messageId: 'msg-1',
            accepted: true,
            reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
          }));
        default:
          return encodeUnary(input.methodId);
      }
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.subscribeScenarioJobEvents) {
        return {
          async *[Symbol.asyncIterator]() {
            yield ScenarioJobEvent.toBinary(ScenarioJobEvent.create({
              eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
              sequence: '1',
              traceId: 'trace-media-event',
              job: createScenarioJob({
                jobId: 'job-1',
                scenarioType: ScenarioType.IMAGE_GENERATE,
                status: ScenarioJobStatus.COMPLETED,
              }),
            }));
          },
        };
      }

      if (input.methodId === RuntimeMethodIds.ai.streamScenario) {
        return {
          async *[Symbol.asyncIterator]() {
            yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
              eventType: StreamEventType.STREAM_EVENT_COMPLETED,
              sequence: '9',
              traceId: 'trace-raw-stream',
              payload: {
                oneofKind: 'completed',
                completed: { finishReason: FinishReason.STOP },
              },
            }));
          },
        };
      }

      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        return {
          async *[Symbol.asyncIterator]() {
            yield AppMessageEvent.toBinary(AppMessageEvent.create({
              eventType: AppMessageEventType.APP_MESSAGE_EVENT_RECEIVED,
              sequence: '1',
              messageId: 'msg-1',
              fromAppId: 'from-app',
              toAppId: APP_ID,
              subjectUserId: 'subject-1',
              messageType: 'demo.message',
              reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
              traceId: 'trace-app-message',
            }));
          },
        };
      }

      return {
        async *[Symbol.asyncIterator]() {
          // no-op
        },
      };
    },
    closeStream: async (_config, input) => {
      closedStreamIds.push(input.streamId);
    },
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    await Promise.all([runtime.connect(), runtime.connect()]);
    await runtime.ready({ timeoutMs: 2000 });
    const health = await runtime.health();
    assert.equal(health.status, 'healthy');

    const listModels = await runtime.model.list({});
    assert.equal(listModels.models.length, 1);

    const viaCall = await runtime.call(RuntimeMethodIds.model.list, {});
    assert.ok(viaCall);

    const rawEmbed = await runtime.raw.call(RuntimeMethodIds.ai.executeScenario, {
      head: {
        appId: APP_ID,
        subjectUserId: 'subject-1',
        modelId: 'embed-raw',
        routePolicy: RoutePolicy.LOCAL,
        fallback: FallbackPolicy.DENY,
        timeoutMs: 1000,
        connectorId: '',
      },
      scenarioType: ScenarioType.TEXT_EMBED,
      executionMode: ExecutionMode.SYNC,
      spec: {
        spec: {
          oneofKind: 'textEmbed',
          textEmbed: { inputs: ['raw'] },
        },
      },
      extensions: [],
    });
    assert.ok(rawEmbed);

    const rawStream = await runtime.raw.call(RuntimeMethodIds.ai.streamScenario, {
      head: {
        appId: APP_ID,
        subjectUserId: 'subject-1',
        modelId: 'stream-raw',
        routePolicy: RoutePolicy.LOCAL,
        fallback: FallbackPolicy.DENY,
        timeoutMs: 1000,
        connectorId: '',
      },
      scenarioType: ScenarioType.TEXT_GENERATE,
      executionMode: ExecutionMode.STREAM,
      spec: {
        spec: {
          oneofKind: 'textGenerate',
          textGenerate: {
            input: [{ role: 'user', content: 'raw stream', name: '' }],
            systemPrompt: '',
            tools: [],
            temperature: 0,
            topP: 0,
            maxTokens: 16,
          },
        },
      },
      extensions: [],
    }) as AsyncIterable<StreamScenarioEvent>;
    const rawStreamItems: StreamScenarioEvent[] = [];
    for await (const event of rawStream) {
      rawStreamItems.push(event);
    }
    assert.equal(rawStreamItems.length, 1);

    await runtime.raw.closeStream('remote-stream-1');
    assert.deepEqual(closedStreamIds, ['remote-stream-1']);

    await runtime.app.sendMessage({
      fromAppId: 'from-app',
      toAppId: APP_ID,
      subjectUserId: 'subject-1',
      messageType: 'demo.message',
      payload: Struct.fromJson({ ok: true } as never),
      requireAck: true,
    });
    const appStream = await runtime.app.subscribeMessages({
      appId: APP_ID,
      subjectUserId: 'subject-1',
      cursor: '',
      fromAppIds: [],
    });
    let appEventCount = 0;
    for await (const _event of appStream) {
      appEventCount += 1;
    }
    assert.equal(appEventCount, 1);

    await runtime.media.jobs.submit({
      modal: 'image',
      input: {
        model: 'image-model',
        prompt: 'image prompt',
        route: 'local',
        fallback: 'deny',
      },
    });
    await runtime.media.jobs.submit({
      modal: 'video',
      input: {
        model: 'video-model',
        prompt: 'video prompt',
        route: 'cloud',
        fallback: 'allow',
      },
    });
    await runtime.media.jobs.submit({
      modal: 'tts',
      input: {
        model: 'tts-model',
        text: 'say this',
      },
    });
    await runtime.media.jobs.submit({
      modal: 'stt',
      input: {
        model: 'stt-model',
        audio: { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) },
        mimeType: 'audio/wav',
      },
    });
    await runtime.media.jobs.submit({
      modal: 'stt',
      input: {
        model: 'stt-model',
        audio: { kind: 'url', url: 'https://example.com/audio.wav' },
        mimeType: 'audio/wav',
      },
    });
    await runtime.media.jobs.submit({
      modal: 'stt',
      input: {
        model: 'stt-model',
        audio: { kind: 'chunks', chunks: [new Uint8Array([7, 8])] },
        mimeType: 'audio/wav',
      },
    });

    const submittedKinds = submitted.map((request) => request.spec?.spec.oneofKind);
    assert.ok(submittedKinds.includes('imageGenerate'));
    assert.ok(submittedKinds.includes('videoGenerate'));
    assert.ok(submittedKinds.includes('speechSynthesize'));
    assert.ok(submittedKinds.includes('speechTranscribe'));

    const transcriptionSources = submitted
      .filter((request) => request.spec?.spec.oneofKind === 'speechTranscribe')
      .map((request) => request.spec?.spec.oneofKind === 'speechTranscribe'
        ? request.spec.spec.speechTranscribe.audioSource?.source.oneofKind
        : undefined);
    assert.ok(transcriptionSources.includes('audioBytes'));
    assert.ok(transcriptionSources.includes('audioUri'));
    assert.ok(transcriptionSources.includes('audioChunks'));

    const imageOutput = await runtime.media.image.generate({
      model: 'image-model',
      prompt: 'img',
      timeoutMs: 1000,
    });
    assert.equal(imageOutput.artifacts.length, 1);
    assert.equal(imageOutput.trace.traceId?.startsWith('trace-job-'), true);

    const videoOutput = await runtime.media.video.generate({
      model: 'video-model',
      prompt: 'vid',
      timeoutMs: 1000,
    });
    assert.equal(videoOutput.artifacts.length, 1);

    const speechOutput = await runtime.media.tts.synthesize({
      model: 'tts-model',
      text: 'hello world',
      timeoutMs: 1000,
    });
    assert.equal(speechOutput.artifacts.length, 1);

    const transcribeOutput = await runtime.media.stt.transcribe({
      model: 'stt-model',
      audio: { kind: 'bytes', bytes: Buffer.from('hello', 'utf8') },
      mimeType: 'audio/wav',
      timeoutMs: 1000,
    });
    assert.ok(transcribeOutput.text.startsWith('artifact-'));

    const imageStream = await runtime.media.image.stream({
      model: 'image-model',
      prompt: 'stream image',
    });
    let imageChunkCount = 0;
    for await (const _chunk of imageStream) {
      imageChunkCount += 1;
    }
    assert.equal(imageChunkCount, 1);

    const videoStream = await runtime.media.video.stream({
      model: 'video-model',
      prompt: 'stream video',
    });
    let videoChunkCount = 0;
    for await (const _chunk of videoStream) {
      videoChunkCount += 1;
    }
    assert.equal(videoChunkCount, 1);

    const speechStream = await runtime.media.tts.stream({
      model: 'tts-model',
      text: 'stream speech',
    });
    let speechChunkCount = 0;
    for await (const _chunk of speechStream) {
      speechChunkCount += 1;
    }
    assert.equal(speechChunkCount, 1);

    const job = await runtime.media.jobs.get('job-1');
    assert.equal(job.jobId, 'job-1');
    await runtime.media.jobs.cancel({
      jobId: 'job-1',
      reason: 'stop now',
    });
    assert.equal(cancelled.length >= 1, true);
    const artifacts = await runtime.media.jobs.getArtifacts('job-1');
    assert.equal(artifacts.artifacts.length, 1);
    const subscription = await runtime.media.jobs.subscribe('job-1');
    let mediaEventCount = 0;
    for await (const _event of subscription) {
      mediaEventCount += 1;
    }
    assert.equal(mediaEventCount, 1);

    const oneSubmitRequest = submitted[0];
    assert.ok(oneSubmitRequest);
    const submitRequestWithoutSubject = {
      ...oneSubmitRequest,
      head: {
        ...oneSubmitRequest.head,
        subjectUserId: undefined,
      },
    };
    const lowLevelSubmit = await runtime.ai.submitScenarioJob(submitRequestWithoutSubject as never);
    assert.ok(lowLevelSubmit.job);
    assert.equal(submitted[submitted.length - 1]?.head?.subjectUserId, 'subject-1');
    const lowLevelGet = await runtime.ai.getScenarioJob({ jobId: lowLevelSubmit.job?.jobId || 'job-1' });
    assert.ok(lowLevelGet.job);
    const lowLevelArtifacts = await runtime.ai.getScenarioArtifacts({ jobId: lowLevelSubmit.job?.jobId || 'job-1' });
    assert.ok(lowLevelArtifacts.artifacts.length >= 1);
    const lowLevelCancel = await runtime.ai.cancelScenarioJob({
      jobId: lowLevelSubmit.job?.jobId || 'job-1',
      reason: 'cancel scenario',
    });
    assert.ok(lowLevelCancel.job);
    const lowLevelMediaEvents = await runtime.ai.subscribeScenarioJobEvents({
      jobId: lowLevelSubmit.job?.jobId || 'job-1',
    });
    let lowLevelMediaCount = 0;
    for await (const _event of lowLevelMediaEvents) {
      lowLevelMediaCount += 1;
    }
    assert.equal(lowLevelMediaCount, 1);

    await assert.rejects(
      async () => runtime.raw.call('/nimi.runtime.v1.UnknownService/UnknownMethod', {}),
      (error: unknown) => asNimiError(error, { source: 'sdk' }).reasonCode === ReasonCode.SDK_RUNTIME_CODEC_MISSING,
    );

    await runtime.close();
    await runtime.close();
    assert.equal(runtime.state().status, 'closed');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime emits telemetry and auth/error events across lifecycle', async () => {
  const telemetryNames: string[] = [];
  let tokenIssuedEvents = 0;
  let tokenRevokedEvents = 0;
  let errorEvents = 0;
  let connectedEvents = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      switch (input.methodId) {
        case RuntimeMethodIds.appAuth.authorizeExternalPrincipal: {
          const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
          assert.equal(request.scopeCatalogVersion, '1.0.0');
          return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
            tokenId: 'token-authorized-1',
            appId: APP_ID,
            subjectUserId: 'subject-1',
            externalPrincipalId: 'external-1',
            effectiveScopes: [`app.${APP_ID}.chat.read`],
            policyVersion: '1.0.0',
            issuedScopeCatalogVersion: '2.0.0',
            canDelegate: false,
            secret: 'secret-1',
          }));
        }
        case RuntimeMethodIds.appAuth.issueDelegatedToken:
          return IssueDelegatedAccessTokenResponse.toBinary(IssueDelegatedAccessTokenResponse.create({
            tokenId: 'token-delegated-1',
            parentTokenId: 'token-authorized-1',
            effectiveScopes: [`app.${APP_ID}.chat.read`],
            policyVersion: '1.0.0',
          }));
        case RuntimeMethodIds.appAuth.revokeToken:
          return Ack.toBinary(Ack.create({
            ok: true,
            reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
            actionHint: '',
          }));
        case RuntimeMethodIds.model.list:
          throw new Error('forced-model-error');
        default:
          return encodeUnary(input.methodId);
      }
    },
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          // no-op
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      telemetry: {
        enabled: true,
        onEvent: (event) => {
          telemetryNames.push(event.name);
        },
      },
    });

    runtime.events.once('runtime.connected', () => {
      connectedEvents += 1;
    });
    runtime.events.on('auth.token.issued', () => {
      tokenIssuedEvents += 1;
    });
    runtime.events.on('auth.token.revoked', () => {
      tokenRevokedEvents += 1;
    });
    runtime.events.on('error', () => {
      errorEvents += 1;
    });

    await runtime.scope.register({
      manifestVersion: '1.0.0',
      scopes: [`app.${APP_ID}.chat.read`],
    });
    await runtime.scope.publish();

    await runtime.appAuth.authorizeExternalPrincipal({
      domain: 'app-auth',
      appId: APP_ID,
      externalPrincipalId: 'external-1',
      externalPrincipalType: 2,
      subjectUserId: 'subject-1',
      consentId: 'consent-1',
      consentVersion: '1.0',
      decisionAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
      policyVersion: '1.0.0',
      policyMode: PolicyMode.PRESET,
      preset: AuthorizationPreset.READ_ONLY,
      scopes: [`app.${APP_ID}.chat.read`],
      resourceSelectors: undefined,
      canDelegate: false,
      maxDelegationDepth: 0,
      ttlSeconds: 3600,
      scopeCatalogVersion: '',
      policyOverride: false,
    });

    await runtime.appAuth.issueDelegatedToken({
      appId: APP_ID,
      parentTokenId: 'token-authorized-1',
      scopes: [`app.${APP_ID}.chat.read`],
      ttlSeconds: 60,
    });

    await runtime.appAuth.revokeToken({
      appId: APP_ID,
      tokenId: 'token-delegated-1',
    });

    await assert.rejects(
      async () => runtime.model.list({}),
      (error: unknown) => asNimiError(error, { source: 'runtime' }).reasonCode === ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED,
    );

    await runtime.connect();
    await runtime.close();

    assert.equal(connectedEvents, 1);
    assert.equal(tokenIssuedEvents >= 2, true);
    assert.equal(tokenRevokedEvents, 1);
    assert.equal(errorEvents, 1);
    assert.ok(telemetryNames.includes('runtime.connected'));
    assert.ok(telemetryNames.includes('runtime.disconnected'));
    assert.ok(telemetryNames.includes('runtime.app-auth.scope-version-mismatch'));
    assert.ok(telemetryNames.includes('runtime.error'));
  } finally {
    clearNodeGrpcBridge();
  }
});
