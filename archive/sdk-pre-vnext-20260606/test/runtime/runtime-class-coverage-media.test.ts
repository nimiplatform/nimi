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
              output: textEmbedOutput([[1, 2, 3]]),
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
          const current = jobs.get(request.jobId);
          const output = current?.scenarioType === ScenarioType.IMAGE_GENERATE
            ? imageGenerateOutput(`artifact-${request.jobId}`)
            : current?.scenarioType === ScenarioType.VIDEO_GENERATE
              ? videoGenerateOutput(`artifact-${request.jobId}`)
              : current?.scenarioType === ScenarioType.SPEECH_SYNTHESIZE
                ? speechSynthesizeOutput(`artifact-${request.jobId}`)
              : current?.scenarioType === ScenarioType.SPEECH_TRANSCRIBE
                ? speechTranscribeOutput(payloadText, `artifact-${request.jobId}`)
                : current?.scenarioType === ScenarioType.MUSIC_GENERATE
                  ? musicGenerateOutput(`artifact-${request.jobId}`)
                  : undefined;
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
            output,
          }));
        }
        case RuntimeMethodIds.connector.listConnectors:
          return encodeUnary(input.methodId, {
            connectors: [{ connectorId: 'connector-1', provider: 'local' }],
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
        const request = StreamScenarioRequest.fromBinary(input.request);
        return {
          async *[Symbol.asyncIterator]() {
            if (request.scenarioType === ScenarioType.SPEECH_SYNTHESIZE) {
              yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
                eventType: StreamEventType.STREAM_EVENT_DELTA,
                sequence: '8',
                traceId: 'trace-speech-stream',
                payload: {
                  oneofKind: 'delta',
                  delta: artifactDelta(new Uint8Array([1]), 'audio/wav'),
                },
              }));
            }
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

    const listConnectors = await runtime.connector.listConnectors({});
    assert.equal(listConnectors.connectors.length, 1);

    const viaCall = await runtime.call(RuntimeMethodIds.connector.listConnectors, {});
    assert.ok(viaCall);

    const rawEmbed = await runtime.unsafeRaw.call(RuntimeMethodIds.ai.executeScenario, {
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

    const rawStream = await runtime.unsafeRaw.call(RuntimeMethodIds.ai.streamScenario, {
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

    await runtime.unsafeRaw.closeStream('remote-stream-1');
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
      },
    });
    await runtime.media.jobs.submit({
      modal: 'video',
      input: {
        model: 'video-model',
        prompt: 'video prompt',
        route: 'cloud',
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
    assert.equal(speechChunkCount, 2);

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
      async () => runtime.unsafeRaw.call('/nimi.runtime.v1.UnknownService/UnknownMethod', {}),
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
        case RuntimeMethodIds.connector.listConnectors:
          throw new Error('forced-connector-error');
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
      async () => runtime.connector.listConnectors({}),
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
