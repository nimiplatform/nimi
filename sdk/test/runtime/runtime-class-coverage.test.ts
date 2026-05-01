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
  ChatContentPartType,
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
  StreamScenarioRequest,
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
import {
  artifactDelta,
  imageGenerateOutput,
  musicGenerateOutput,
  speechSynthesizeOutput,
  speechTranscribeOutput,
  textDelta,
  textEmbedOutput,
  textGenerateOutput,
  videoGenerateOutput,
} from '../helpers/runtime-ai-shapes.js';

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
            output: textGenerateOutput('hello-from-runtime-generate'),
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
            output: textEmbedOutput([[0.1, 0.2]]),
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
                delta: textDelta('delta-text'),
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
    assert.equal(capturedTextRequests[0]?.head?.fallback, FallbackPolicy.DENY);
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
    assert.equal(capturedTextRequests[1]?.head?.fallback, FallbackPolicy.DENY);

    const streamResult = await runtime.ai.text.stream({
      model: 'cloud/stream-model',
      input: 'stream this',
      route: 'cloud',
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
    assert.equal(capturedEmbedRequests[1]?.head?.fallback, FallbackPolicy.DENY);

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
    assert.equal(capturedTextRequests[capturedTextRequests.length - 1]?.head?.fallback, FallbackPolicy.DENY);

    await assert.rejects(
      async () => runtimeWithoutAuthContext.ai.executeScenario({
        head: {
          appId: APP_ID,
          modelId: 'cloud/model',
          routePolicy: RoutePolicy.CLOUD,
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

test('Runtime text helpers dual-write text content and multimodal ChatMessage parts', async () => {
  const capturedTextRequests: ExecuteScenarioRequest[] = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.executeScenario) {
        return encodeUnary(input.methodId);
      }
      const request = ExecuteScenarioRequest.fromBinary(input.request);
      capturedTextRequests.push(request);
      return ExecuteScenarioResponse.toBinary(
        ExecuteScenarioResponse.create({
          output: textGenerateOutput('ok'),
          finishReason: FinishReason.STOP,
          routeDecision: RoutePolicy.CLOUD,
          modelResolved: 'cloud/model',
          traceId: 'trace-multimodal-runtime',
        }),
      );
    },
    openStream: async () => {
      throw new Error('unexpected stream');
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
        subjectUserId: 'subject-from-context',
      },
    });

    await runtime.ai.text.generate({
      model: 'cloud/model',
      input: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'system from content parts' },
            { type: 'image_url', imageUrl: 'https://example.com/system.png' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', imageUrl: 'https://example.com/image.png', detail: 'high' },
            { type: 'text', text: 'describe image' },
          ],
        },
      ],
      system: 'explicit system',
      route: 'cloud',
    });

    const textGenerate = capturedTextRequests[0]?.spec?.spec.oneofKind === 'textGenerate'
      ? capturedTextRequests[0]?.spec?.spec.textGenerate
      : undefined;

    assert.equal(textGenerate?.systemPrompt, 'system from content parts\n\nexplicit system');
    assert.equal(textGenerate?.input.length, 1);
    assert.equal(textGenerate?.input[0]?.content, 'describe image');
    assert.equal(textGenerate?.input[0]?.parts[0]?.type, ChatContentPartType.IMAGE_URL);
    assert.equal(textGenerate?.input[0]?.parts[0]?.content.oneofKind, 'imageUrl');
    assert.equal(textGenerate?.input[0]?.parts[0]?.content.imageUrl.url, 'https://example.com/image.png');
    assert.equal(textGenerate?.input[0]?.parts[0]?.content.imageUrl.detail, 'high');
    assert.equal(textGenerate?.input[0]?.parts[1]?.type, ChatContentPartType.TEXT);
    assert.equal(textGenerate?.input[0]?.parts[1]?.content.oneofKind, 'text');
    assert.equal(textGenerate?.input[0]?.parts[1]?.content.text, 'describe image');

    await runtime.ai.text.generate({
      model: 'cloud/model',
      input: [
        { role: 'user', content: 'plain text path' },
      ],
      route: 'cloud',
    });

    const plainTextGenerate = capturedTextRequests[1]?.spec?.spec.oneofKind === 'textGenerate'
      ? capturedTextRequests[1]?.spec?.spec.textGenerate
      : undefined;
    assert.equal(plainTextGenerate?.input[0]?.content, 'plain text path');
    assert.equal(plainTextGenerate?.input[0]?.parts.length, 1);
    assert.equal(plainTextGenerate?.input[0]?.parts[0]?.type, ChatContentPartType.TEXT);
    assert.equal(plainTextGenerate?.input[0]?.parts[0]?.content.oneofKind, 'text');
    assert.equal(plainTextGenerate?.input[0]?.parts[0]?.content.text, 'plain text path');

    await runtime.ai.text.generate({
      model: 'cloud/model',
      input: [
        {
          role: 'assistant',
          content: [
            { type: 'video_url', videoUrl: 'https://example.com/clip.mp4' },
            { type: 'text', text: 'prior video context' },
          ],
        },
      ],
      route: 'cloud',
    });

    const videoGenerate = capturedTextRequests[2]?.spec?.spec.oneofKind === 'textGenerate'
      ? capturedTextRequests[2]?.spec?.spec.textGenerate
      : undefined;
    assert.equal(videoGenerate?.input[0]?.parts[0]?.type, ChatContentPartType.VIDEO_URL);
    assert.equal(videoGenerate?.input[0]?.parts[0]?.content.oneofKind, 'videoUrl');
    assert.equal(videoGenerate?.input[0]?.parts[0]?.content.videoUrl, 'https://example.com/clip.mp4');
    assert.equal(videoGenerate?.input[0]?.parts[1]?.type, ChatContentPartType.TEXT);

    await runtime.ai.text.generate({
      model: 'cloud/model',
      input: [
        {
          role: 'user',
          content: [
            { type: 'image_url', imageUrl: 'https://example.com/only-image.png' },
          ],
        },
      ],
      route: 'cloud',
    });
  } finally {
    clearNodeGrpcBridge();
  }
});
