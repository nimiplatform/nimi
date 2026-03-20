import assert from 'node:assert/strict';
import test from 'node:test';

import { FallbackPolicy, RoutePolicy } from '../../src/runtime/generated/runtime/v1/ai.js';
import type { RuntimeInternalContext } from '../../src/runtime/internal-context.js';
import { runtimeAiRequestRequiresSubject } from '../../src/runtime/runtime-guards.js';
import {
  runtimeGenerateImage,
  runtimeGenerateVideo,
  runtimeListSpeechVoices,
  runtimeStreamImage,
  runtimeStreamSpeech,
  runtimeStreamSpeechSynthesis,
  runtimeStreamVideo,
  runtimeSynthesizeSpeech,
  runtimeTranscribeSpeech,
  streamArtifactsFromMediaOutput,
} from '../../src/runtime/runtime-modality.js';
import { ReasonCode } from '../../src/types/index.js';
import {
  artifactDelta,
  imageGenerateOutput,
  speechSynthesizeOutput,
  speechTranscribeOutput,
  videoGenerateOutput,
} from '../helpers/runtime-ai-shapes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx(overrides?: Partial<RuntimeInternalContext>): RuntimeInternalContext {
  return {
    appId: 'test-app',
    options: { appId: 'test-app', transport: { type: 'node-grpc', endpoint: '127.0.0.1:1' } },
    invoke: async (op) => op(),
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({}),
        getScenarioJob: async () => ({}),
        getScenarioArtifacts: async () => ({}),
        cancelScenarioJob: async () => ({}),
        executeScenario: async () => ({}),
        streamScenario: async () => (async function* () {})(),
        subscribeScenarioJobEvents: async () => (async function* () {})(),
        listPresetVoices: async () => ({}),
      },
      model: { list: async () => ({}) },
      audit: { getRuntimeHealth: async () => ({}) },
      app: { sendAppMessage: async () => ({}), subscribeAppMessages: async () => (async function* () {})() },
      appAuth: {
        authorizeExternalPrincipal: async () => ({}),
        issueDelegatedToken: async () => ({}),
        revokeToken: async () => ({}),
      },
      knowledge: { searchDocuments: async () => ({}) },
      workflow: {
        startWorkflow: async () => ({}),
        getWorkflow: async () => ({}),
        cancelWorkflow: async () => ({}),
        subscribeWorkflowEvents: async () => (async function* () {})(),
      },
    } as never),
    resolveRuntimeCallOptions: (input) => ({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata || {},
      _responseMetadataObserver: input._responseMetadataObserver,
    }),
    resolveRuntimeStreamOptions: (input) => ({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata || {},
      signal: input.signal,
      _responseMetadataObserver: input._responseMetadataObserver,
    }),
    resolveSubjectUserId: async (explicit) => explicit || 'test-subject',
    resolveOptionalSubjectUserId: async (explicit) => explicit || undefined,
    normalizeScenarioHead: async ({ head, metadata }) => {
      const requiresSubject = runtimeAiRequestRequiresSubject({
        request: { head },
        metadata,
      });
      const subjectUserId = requiresSubject
        ? await (overrides?.resolveSubjectUserId ?? (async (explicit) => explicit || 'test-subject'))(head.subjectUserId)
        : await (overrides?.resolveOptionalSubjectUserId ?? (async (explicit) => explicit || undefined))(head.subjectUserId);
      return {
        ...head,
        subjectUserId: subjectUserId || '',
        fallback: head.fallback ?? FallbackPolicy.DENY,
      };
    },
    emitTelemetry: () => {},
    ...overrides,
  } as RuntimeInternalContext;
}

function makeJob(partial?: Record<string, unknown>) {
  return {
    jobId: 'job-1',
    status: 4, // ScenarioJobStatus.COMPLETED
    routeDecision: RoutePolicy.CLOUD,
    modelResolved: 'model-resolved',
    traceId: 'trace-job-1',
    usage: { inputTokens: '10', outputTokens: '5', computeMs: '100' },
    ...(partial || {}),
  };
}

function makeArtifact(id: string, bytes: Uint8Array, mimeType = 'image/png') {
  return { artifactId: id, mimeType, bytes, uri: '', sha256: '', sizeBytes: String(bytes.length), durationMs: '0', fps: 0, width: 0, height: 0, sampleRateHz: 0, channels: 0 };
}

// ---------------------------------------------------------------------------
// streamArtifactsFromMediaOutput — branch coverage
// ---------------------------------------------------------------------------

test('streamArtifactsFromMediaOutput: empty artifacts array throws contract violation', async () => {
  const output = {
    job: makeJob({ jobId: 'fallback-job' }) as never,
    artifacts: [],
    trace: { traceId: 'trace-1' },
  };

  await assert.rejects(
    async () => {
      for await (const _chunk of streamArtifactsFromMediaOutput(output)) {
        // consume
      }
    },
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
});

test('streamArtifactsFromMediaOutput: artifact with zero-length bytes yields single empty chunk', async () => {
  const output = {
    job: makeJob() as never,
    artifacts: [makeArtifact('art-empty', new Uint8Array(0))],
    trace: { traceId: 'trace-2' },
  };

  const chunks = [];
  for await (const chunk of streamArtifactsFromMediaOutput(output)) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.chunk.length, 0);
  assert.equal(chunks[0]!.eof, true);
});

test('streamArtifactsFromMediaOutput: large artifact is chunked into 64KB parts', async () => {
  const largeBytes = new Uint8Array(64 * 1024 + 100);
  largeBytes.fill(42);
  const output = {
    job: makeJob() as never,
    artifacts: [makeArtifact('art-large', largeBytes)],
    trace: { traceId: 'trace-3' },
  };

  const chunks = [];
  for await (const chunk of streamArtifactsFromMediaOutput(output)) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]!.chunk.length, 64 * 1024);
  assert.equal(chunks[0]!.eof, false);
  assert.equal(chunks[0]!.usage, undefined);
  assert.equal(chunks[1]!.chunk.length, 100);
  assert.equal(chunks[1]!.eof, true);
  assert.ok(chunks[1]!.usage);
});

test('streamArtifactsFromMediaOutput: multiple artifacts yield correct sequences', async () => {
  const output = {
    job: makeJob() as never,
    artifacts: [
      makeArtifact('art-1', new Uint8Array([1, 2])),
      makeArtifact('art-2', new Uint8Array([3, 4])),
    ],
    trace: { traceId: 'trace-4' },
  };

  const chunks = [];
  for await (const chunk of streamArtifactsFromMediaOutput(output)) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]!.sequence, '0');
  assert.equal(chunks[0]!.eof, false);
  assert.equal(chunks[1]!.sequence, '1');
  assert.equal(chunks[1]!.eof, true);
});

test('streamArtifactsFromMediaOutput: artifact with empty artifactId/mimeType throws contract violation', async () => {
  const output = {
    job: makeJob({ jobId: 'fb-id' }) as never,
    artifacts: [{ artifactId: '', mimeType: '', bytes: new Uint8Array([1]) }],
    trace: { traceId: 'trace-5' },
  };

  await assert.rejects(
    async () => {
      for await (const _chunk of streamArtifactsFromMediaOutput(output)) {
        // consume
      }
    },
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
});

test('streamArtifactsFromMediaOutput: routeDecision defaults to UNSPECIFIED when job has none', async () => {
  const output = {
    job: makeJob({ routeDecision: undefined }) as never,
    artifacts: [makeArtifact('art-1', new Uint8Array([1]))],
    trace: { traceId: 'trace-6' },
  };

  const chunks = [];
  for await (const chunk of streamArtifactsFromMediaOutput(output)) {
    chunks.push(chunk);
  }

  assert.equal(chunks[0]!.routeDecision, RoutePolicy.UNSPECIFIED);
});

test('streamArtifactsFromMediaOutput: uses trace.traceId falling back to job.traceId', async () => {
  const outputWithTrace = {
    job: makeJob({ traceId: 'job-trace' }) as never,
    artifacts: [makeArtifact('art-1', new Uint8Array([1]))],
    trace: { traceId: 'trace-override' },
  };
  const chunks1 = [];
  for await (const chunk of streamArtifactsFromMediaOutput(outputWithTrace)) {
    chunks1.push(chunk);
  }
  assert.equal(chunks1[0]!.traceId, 'trace-override');

  const outputWithoutTrace = {
    job: makeJob({ traceId: 'job-trace-fallback' }) as never,
    artifacts: [makeArtifact('art-1', new Uint8Array([1]))],
    trace: {},
  };
  const chunks2 = [];
  for await (const chunk of streamArtifactsFromMediaOutput(outputWithoutTrace)) {
    chunks2.push(chunk);
  }
  assert.equal(chunks2[0]!.traceId, 'job-trace-fallback');
});

test('streamArtifactsFromMediaOutput: artifact with null bytes treated as empty', async () => {
  const output = {
    job: makeJob() as never,
    artifacts: [{ artifactId: 'art-null', mimeType: 'image/png', bytes: null as unknown as Uint8Array }],
    trace: { traceId: 'trace-7' },
  };

  const chunks = [];
  for await (const chunk of streamArtifactsFromMediaOutput(output)) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.chunk.length, 0);
});

// ---------------------------------------------------------------------------
// runtimeStreamSpeechSynthesis — branch coverage
// ---------------------------------------------------------------------------

test('runtimeStreamSpeechSynthesis: started event sets model and route for subsequent chunks', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'started', started: { modelResolved: 'started-model', routeDecision: RoutePolicy.CLOUD } },
              sequence: '1',
              traceId: 'trace-s1',
            };
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1, 2, 3]), 'audio/mp3') },
              sequence: '2',
              traceId: 'trace-s2',
            };
            yield {
              payload: { oneofKind: 'completed', completed: {} },
              sequence: '3',
              traceId: 'trace-s3',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'hello',
    voice: 'alice',
    voiceRenderHints: { stability: 0.5, similarityBoost: 0.8, style: 0.1, useSpeakerBoost: true, speed: 1.0 },
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
  // delta chunk
  assert.equal(chunks[0]!.modelResolved, 'started-model');
  assert.equal(chunks[0]!.routeDecision, RoutePolicy.CLOUD);
  assert.equal(chunks[0]!.mimeType, 'audio/mp3');
  assert.equal(chunks[0]!.eof, false);
  // completed chunk
  assert.equal(chunks[1]!.eof, true);
  assert.equal(chunks[1]!.modelResolved, 'started-model');
});

test('runtimeStreamSpeechSynthesis: delta with zero-length chunk is skipped', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array(0), 'audio/wav') },
              sequence: '1',
              traceId: 'trace-d1',
            };
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([5]), 'audio/wav') },
              sequence: '2',
              traceId: 'trace-d2',
            };
            yield {
              payload: { oneofKind: 'completed', completed: {} },
              sequence: '3',
              traceId: 'trace-d3',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'hello',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  // Empty delta skipped, non-empty delta + completed
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]!.chunk.length, 1);
});

test('runtimeStreamSpeechSynthesis: failed event throws NimiError', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: {
                oneofKind: 'failed',
                failed: { reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT, actionHint: 'retry this' },
              },
              sequence: '1',
              traceId: 'trace-f1',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'fail',
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of stream) {
        // consume
      }
    },
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.AI_PROVIDER_TIMEOUT);
      return true;
    },
  );
});

test('runtimeStreamSpeechSynthesis: failed event with empty fields uses defaults', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: {
                oneofKind: 'failed',
                failed: {},
              },
              sequence: '1',
              traceId: 'trace-f2',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'fail-defaults',
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of stream) {
        // consume
      }
    },
    (error: Error & { reasonCode?: string; message?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.AI_STREAM_BROKEN);
      assert.equal(error.message, 'runtime stream failed');
      return true;
    },
  );
});

test('runtimeStreamSpeechSynthesis: without voice — voiceRef is undefined', async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async (request: unknown) => {
          capturedRequest = request as Record<string, unknown>;
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
                sequence: '0',
                traceId: 'trace-nv',
              };
              yield {
                payload: { oneofKind: 'completed', completed: {} },
                sequence: '1',
                traceId: 'trace-nv',
              };
            },
          };
        },
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'no voice',
  });

  for await (const _chunk of stream) {
    // consume
  }

  const spec = (capturedRequest as Record<string, unknown>)?.spec as Record<string, unknown> | undefined;
  const speechSpec = spec?.spec as { speechSynthesize?: { voiceRef?: unknown } } | undefined;
  assert.equal(speechSpec?.speechSynthesize?.voiceRef, undefined);
});

test('runtimeStreamSpeechSynthesis: without voiceRenderHints — hints are undefined', async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async (request: unknown) => {
          capturedRequest = request as Record<string, unknown>;
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
                sequence: '0',
                traceId: 'trace-nh',
              };
              yield {
                payload: { oneofKind: 'completed', completed: {} },
                sequence: '1',
                traceId: 'trace-nh',
              };
            },
          };
        },
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'no hints',
    voice: 'alice',
  });

  for await (const _chunk of stream) {
    // consume
  }

  const spec = (capturedRequest as Record<string, unknown>)?.spec as Record<string, unknown> | undefined;
  const speechSpec = spec?.spec as { speechSynthesize?: { voiceRenderHints?: unknown; voiceRef?: unknown } } | undefined;
  assert.equal(speechSpec?.speechSynthesize?.voiceRenderHints, undefined);
  assert.ok(speechSpec?.speechSynthesize?.voiceRef);
});

test('runtimeStreamSpeechSynthesis: cloud route requires subject, local does not', async () => {
  let resolveSubjectCalled = false;
  let resolveOptionalCalled = false;

  const ctxCloud = createMockCtx({
    resolveSubjectUserId: async () => {
      resolveSubjectCalled = true;
      return 'subject-cloud';
    },
    resolveOptionalSubjectUserId: async () => {
      resolveOptionalCalled = true;
      return undefined;
    },
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') }, sequence: '0', traceId: '' };
            yield { payload: { oneofKind: 'completed', completed: {} }, sequence: '1', traceId: '' };
          },
        }),
      },
    } as never),
  });

  const streamCloud = await runtimeStreamSpeechSynthesis(ctxCloud, {
    model: 'model',
    text: 'cloud',
    route: 'cloud',
  });
  for await (const _chunk of streamCloud) { /* consume */ }
  assert.equal(resolveSubjectCalled, true, 'cloud route should call resolveSubjectUserId');

  // Reset
  resolveSubjectCalled = false;
  resolveOptionalCalled = false;

  const ctxLocal = createMockCtx({
    resolveSubjectUserId: async () => {
      resolveSubjectCalled = true;
      return 'subject-local';
    },
    resolveOptionalSubjectUserId: async () => {
      resolveOptionalCalled = true;
      return undefined;
    },
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') }, sequence: '0', traceId: '' };
            yield { payload: { oneofKind: 'completed', completed: {} }, sequence: '1', traceId: '' };
          },
        }),
      },
    } as never),
  });

  const streamLocal = await runtimeStreamSpeechSynthesis(ctxLocal, {
    model: 'model',
    text: 'local',
  });
  for await (const _chunk of streamLocal) { /* consume */ }
  assert.equal(resolveOptionalCalled, true, 'local route should call resolveOptionalSubjectUserId');
  assert.equal(resolveSubjectCalled, false, 'local route should not call resolveSubjectUserId');
});

test('runtimeStreamSpeechSynthesis: started with empty model keeps explicit input model', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'started', started: { modelResolved: '', routeDecision: undefined } },
              sequence: '1',
              traceId: '',
            };
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/ogg') },
              sequence: '2',
              traceId: '',
            };
            yield {
              payload: { oneofKind: 'completed', completed: {} },
              sequence: '3',
              traceId: '',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'my-model',
    text: 'test',
    audioFormat: 'audio/ogg',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks[0]!.modelResolved, 'my-model');
  assert.equal(chunks[0]!.mimeType, 'audio/ogg');
});

test('runtimeStreamSpeechSynthesis: missing mimeType now throws contract violation', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), '') },
              sequence: '1',
              traceId: '',
            };
            yield {
              payload: { oneofKind: 'completed', completed: {} },
              sequence: '2',
              traceId: '',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'model',
    text: 'test',
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of stream) {
        // consume
      }
    },
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
});

test('runtimeStreamSpeechSynthesis: unknown payload oneofKind is ignored', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'unknown_event' },
              sequence: '1',
              traceId: '',
            };
            yield {
              payload: { oneofKind: undefined },
              sequence: '2',
              traceId: '',
            };
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
              sequence: '3',
              traceId: '',
            };
            yield {
              payload: { oneofKind: 'completed', completed: {} },
              sequence: '4',
              traceId: '',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'model',
    text: 'test',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]!.eof, false);
  assert.equal(chunks[1]!.eof, true);
});

test('runtimeStreamSpeechSynthesis: delta without chunk is skipped but completed still requires real audio chunk', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: {} },
              sequence: '1',
              traceId: '',
            };
            yield {
              payload: { oneofKind: 'completed', completed: {} },
              sequence: '2',
              traceId: '',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'model',
    text: 'test',
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of stream) {
        // consume
      }
    },
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// runtimeStreamSpeech — delegates to runtimeStreamSpeechSynthesis
// ---------------------------------------------------------------------------

test('runtimeStreamSpeech: delegates to runtimeStreamSpeechSynthesis', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([99]), 'audio/wav') },
              sequence: '1',
              traceId: 'trace-delegate',
            };
            yield {
              payload: { oneofKind: 'completed', completed: {} },
              sequence: '2',
              traceId: 'trace-delegate',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeech(ctx, {
    model: 'tts-model',
    text: 'delegate test',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
});

// ---------------------------------------------------------------------------
// runtimeTranscribeSpeech — empty artifacts branch
// ---------------------------------------------------------------------------

test('runtimeTranscribeSpeech: empty artifacts returns empty text', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-1' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-1' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [],
          traceId: 'trace-stt-empty',
          output: speechTranscribeOutput(''),
        }),
      },
    } as never),
  });

  const result = await runtimeTranscribeSpeech(ctx, {
    model: 'stt-model',
    audio: { kind: 'bytes', bytes: new Uint8Array([1]) },
    mimeType: 'audio/wav',
  });

  assert.equal(result.text, '');
});

test('runtimeTranscribeSpeech: artifact with bytes returns decoded text', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-2' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-2' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [{ bytes: Buffer.from('hello world', 'utf8') }],
          traceId: 'trace-stt-text',
          output: speechTranscribeOutput('hello world'),
        }),
      },
    } as never),
  });

  const result = await runtimeTranscribeSpeech(ctx, {
    model: 'stt-model',
    audio: { kind: 'bytes', bytes: new Uint8Array([1]) },
    mimeType: 'audio/wav',
  });

  assert.equal(result.text, 'hello world');
});

test('runtimeTranscribeSpeech: mismatched typed output fails closed', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-3' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-3' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [],
          traceId: 'trace-stt-mismatch',
          output: imageGenerateOutput('img-art-1'),
        }),
      },
    } as never),
  });

  await assert.rejects(
    () => runtimeTranscribeSpeech(ctx, {
      model: 'stt-model',
      audio: { kind: 'bytes', bytes: new Uint8Array([1]) },
      mimeType: 'audio/wav',
    }),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// runtimeGenerateImage — traceId fallback branch
// ---------------------------------------------------------------------------

test('runtimeGenerateImage: artifacts.traceId used when present', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'img-job-1', traceId: 'job-trace' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'img-job-1', traceId: 'job-trace' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('art-1', new Uint8Array([1]))],
          traceId: 'artifacts-trace',
          output: imageGenerateOutput('art-1'),
        }),
      },
    } as never),
  });

  const result = await runtimeGenerateImage(ctx, {
    model: 'image-model',
    prompt: 'test',
  });

  assert.equal(result.trace.traceId, 'artifacts-trace');
});

test('runtimeGenerateImage: falls back to job.traceId when artifacts.traceId is empty', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'img-job-2', traceId: 'job-trace-fb' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'img-job-2', traceId: 'job-trace-fb' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('art-2', new Uint8Array([2]))],
          traceId: '',
          output: imageGenerateOutput('art-2'),
        }),
      },
    } as never),
  });

  const result = await runtimeGenerateImage(ctx, {
    model: 'image-model',
    prompt: 'test-fallback',
  });

  assert.equal(result.trace.traceId, 'job-trace-fb');
});

// ---------------------------------------------------------------------------
// runtimeGenerateVideo — traceId fallback branch
// ---------------------------------------------------------------------------

test('runtimeGenerateVideo: artifacts.traceId used over job.traceId', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'vid-job-1', traceId: 'vid-job-trace' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'vid-job-1', traceId: 'vid-job-trace' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('vid-art', new Uint8Array([1]))],
          traceId: 'vid-art-trace',
          output: videoGenerateOutput('vid-art'),
        }),
      },
    } as never),
  });

  const result = await runtimeGenerateVideo(ctx, {
    mode: 't2v',
    model: 'video-model',
    prompt: 'test',
    content: [{ type: 'text', text: 'hello' }],
  });

  assert.equal(result.trace.traceId, 'vid-art-trace');
});

// ---------------------------------------------------------------------------
// runtimeSynthesizeSpeech — traceId fallback branch
// ---------------------------------------------------------------------------

test('runtimeSynthesizeSpeech: typed artifacts remain valid when top-level artifacts are empty', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'tts-job-1', traceId: 'tts-job-trace' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'tts-job-1', traceId: 'tts-job-trace' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [],
          traceId: undefined,
          output: speechSynthesizeOutput('tts-art-1'),
        }),
      },
    } as never),
  });

  const result = await runtimeSynthesizeSpeech(ctx, {
    model: 'tts-model',
    text: 'speech',
  });

  assert.equal(result.trace.traceId, 'tts-job-trace');
  assert.equal(result.artifacts[0]?.artifactId, 'tts-art-1');
});

// ---------------------------------------------------------------------------
// runtimeStreamImage / runtimeStreamVideo — delegates through generate
// ---------------------------------------------------------------------------

test('runtimeStreamImage: delegates through runtimeGenerateImage to streamArtifactsFromMediaOutput', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'si-job' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'si-job' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('si-art', new Uint8Array([10, 20]))],
          traceId: 'si-trace',
          output: imageGenerateOutput('si-art'),
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamImage(ctx, {
    model: 'image-model',
    prompt: 'stream img',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.eof, true);
});

test('runtimeStreamVideo: delegates through runtimeGenerateVideo to streamArtifactsFromMediaOutput', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'sv-job' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'sv-job' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('sv-art', new Uint8Array([30, 40]))],
          traceId: 'sv-trace',
          output: videoGenerateOutput('sv-art'),
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamVideo(ctx, {
    mode: 't2v',
    model: 'video-model',
    prompt: 'stream vid',
    content: [{ type: 'text', text: 'vid prompt' }],
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.eof, true);
});

// ---------------------------------------------------------------------------
// runtimeListSpeechVoices — branch coverage
// ---------------------------------------------------------------------------

test('runtimeListSpeechVoices: voiceCount is undefined when metadata returns NaN', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (_request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({
              'x-nimi-voice-catalog-source': 'test-source',
              'x-nimi-voice-catalog-version': '2.0',
              'x-nimi-voice-count': 'not-a-number',
            });
          }
          return {
            voices: [{ voiceId: 'v1', name: 'Voice 1', lang: 'en', supportedLangs: ['en', 'fr'] }],
            modelResolved: 'voice-model',
            traceId: 'voice-trace',
          };
        },
      },
    } as never),
  });

  const result = await runtimeListSpeechVoices(ctx, {
    model: 'voice-model',
  });

  assert.equal(result.voiceCount, undefined);
  assert.equal(result.voiceCatalogSource, 'test-source');
  assert.equal(result.voiceCatalogVersion, '2.0');
  assert.equal(result.voices.length, 1);
  assert.equal(result.voices[0]!.voiceId, 'v1');
  assert.deepEqual(result.voices[0]!.supportedLangs, ['en', 'fr']);
});

test('runtimeListSpeechVoices: cloud route prefixes raw model ids before request', async () => {
  let capturedRequest: { modelId?: string } | undefined;
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          capturedRequest = request as { modelId?: string };
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({});
          }
          return {
            voices: [],
            modelResolved: 'cloud/step-tts-2',
            traceId: 'voice-trace',
          };
        },
      },
    } as never),
  });

  await runtimeListSpeechVoices(ctx, {
    model: 'step-tts-2',
    route: 'cloud',
  });

  assert.equal(capturedRequest?.modelId, 'cloud/step-tts-2');
});

test('runtimeListSpeechVoices: voiceCount is a number when metadata is valid', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (_request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({
              'x-nimi-voice-catalog-source': '',
              'x-nimi-voice-catalog-version': '',
              'x-nimi-voice-count': '42',
            });
          }
          return {
            voices: [],
            modelResolved: 'voice-model',
            traceId: 'voice-trace',
          };
        },
      },
    } as never),
  });

  const result = await runtimeListSpeechVoices(ctx, {
    model: 'voice-model',
  });

  assert.equal(result.voiceCount, 42);
  assert.equal(result.voiceCatalogSource, undefined);
  assert.equal(result.voiceCatalogVersion, undefined);
  assert.equal(result.voices.length, 0);
});

test('runtimeListSpeechVoices: undefined voices in response mapped to empty array', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (_request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({});
          }
          return {
            voices: undefined,
            modelResolved: '',
            traceId: '',
          };
        },
      },
    } as never),
  });

  const result = await runtimeListSpeechVoices(ctx, {
    model: 'voice-model',
  });

  assert.equal(result.voices.length, 0);
});

test('runtimeListSpeechVoices: voice with undefined supportedLangs defaults to empty array', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (_request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({});
          }
          return {
            voices: [{ voiceId: 'v2', name: 'Voice 2', lang: 'de', supportedLangs: undefined }],
            modelResolved: 'model',
            traceId: 'trace',
          };
        },
      },
    } as never),
  });

  const result = await runtimeListSpeechVoices(ctx, {
    model: 'voice-model',
  });

  assert.deepEqual(result.voices[0]!.supportedLangs, []);
});

// ---------------------------------------------------------------------------
// runtimeStreamSpeechSynthesis: completed event with usage data
// ---------------------------------------------------------------------------

test('runtimeStreamSpeechSynthesis: completed event carries usage data', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
              sequence: '0',
              traceId: 'trace-usage',
            };
            yield {
              payload: {
                oneofKind: 'completed',
                completed: { usage: { inputTokens: '100', outputTokens: '50', computeMs: '200' } },
              },
              sequence: '1',
              traceId: 'trace-usage',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'usage test',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]!.eof, false);
  assert.equal(chunks[1]!.eof, true);
  assert.ok(chunks[1]!.usage);
  assert.equal(chunks[1]!.usage?.inputTokens, '100');
});

test('runtimeStreamSpeechSynthesis: usage event is used when completed omits usage', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
              sequence: '0',
              traceId: 'trace-usage-event',
            };
            yield {
              payload: {
                oneofKind: 'usage',
                usage: { inputTokens: '12', outputTokens: '6', computeMs: '50' },
              },
              sequence: '1',
              traceId: 'trace-usage-event',
            };
            yield {
              payload: {
                oneofKind: 'completed',
                completed: {},
              },
              sequence: '2',
              traceId: 'trace-usage-event',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'usage event only',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
  assert.equal(chunks[1]!.usage?.inputTokens, '12');
  assert.equal(chunks[1]!.usage?.outputTokens, '6');
});

test('runtimeStreamSpeechSynthesis: usage event wins over completed usage when both exist', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
              sequence: '0',
            };
            yield {
              payload: {
                oneofKind: 'usage',
                usage: { inputTokens: '5', outputTokens: '2', computeMs: '10' },
              },
              sequence: '1',
            };
            yield {
              payload: {
                oneofKind: 'completed',
                completed: { usage: { inputTokens: '100', outputTokens: '50', computeMs: '200' } },
              },
              sequence: '2',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'usage precedence',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks[1]!.usage?.inputTokens, '5');
  assert.equal(chunks[1]!.usage?.outputTokens, '2');
});

test('runtimeStreamSpeechSynthesis: missing usage leaves eof chunk usage undefined', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
              sequence: '0',
            };
            yield {
              payload: {
                oneofKind: 'completed',
                completed: {},
              },
              sequence: '1',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'tts-model',
    text: 'no usage',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks[1]!.usage, undefined);
});

// ---------------------------------------------------------------------------
// runtimeStreamSpeechSynthesis: stream ends without completed (implicit end)
// ---------------------------------------------------------------------------

test('runtimeStreamSpeechSynthesis: stream that exhausts without completed yields nothing extra', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'started', started: { modelResolved: 'model', routeDecision: RoutePolicy.LOCAL } },
              sequence: '1',
              traceId: '',
            };
            // Stream ends without completed or failed
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'model',
    text: 'exhausted',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  // Only started, which is skipped, so no chunks
  assert.equal(chunks.length, 0);
});

// ---------------------------------------------------------------------------
// runtimeStreamSpeechSynthesis: connectorId triggers required subject
// ---------------------------------------------------------------------------

test('runtimeStreamSpeechSynthesis: connectorId forces required subject resolution', async () => {
  let resolveSubjectCalled = false;

  const ctx = createMockCtx({
    resolveSubjectUserId: async () => {
      resolveSubjectCalled = true;
      return 'connector-subject';
    },
    resolveOptionalSubjectUserId: async () => undefined,
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
              sequence: '0',
              traceId: '',
            };
            yield { payload: { oneofKind: 'completed', completed: {} }, sequence: '1', traceId: '' };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'model',
    text: 'connector test',
    connectorId: 'my-connector',
  });

  for await (const _chunk of stream) { /* consume */ }
  assert.equal(resolveSubjectCalled, true);
});

// ---------------------------------------------------------------------------
// runtimeStreamSpeechSynthesis: timeoutMs falls back to ctx.options.timeoutMs
// ---------------------------------------------------------------------------

test('runtimeStreamSpeechSynthesis: timeoutMs uses input then ctx fallback', async () => {
  let capturedRequest: Record<string, unknown> | undefined;

  const ctx = createMockCtx({
    options: { appId: 'test-app', transport: { type: 'node-grpc', endpoint: '127.0.0.1:1' }, timeoutMs: 5000 },
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async (request: unknown) => {
          capturedRequest = request as Record<string, unknown>;
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
                sequence: '0',
                traceId: '',
              };
              yield { payload: { oneofKind: 'completed', completed: {} }, sequence: '1', traceId: '' };
            },
          };
        },
      },
    } as never),
  });

  // When input.timeoutMs is undefined, should use ctx.options.timeoutMs
  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'model',
    text: 'timeout test',
  });
  for await (const _chunk of stream) { /* consume */ }

  const head = (capturedRequest as Record<string, unknown>)?.head as { timeoutMs?: number } | undefined;
  assert.equal(head?.timeoutMs, 5000);
});

// ---------------------------------------------------------------------------
// runtimeStreamSpeechSynthesis: started without routeDecision falls back
// ---------------------------------------------------------------------------

test('runtimeStreamSpeechSynthesis: started event without routeDecision uses head routePolicy', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: { oneofKind: 'started', started: { modelResolved: 'model-x' } },
              sequence: '1',
              traceId: '',
            };
            yield {
              payload: { oneofKind: 'delta', delta: artifactDelta(new Uint8Array([1]), 'audio/wav') },
              sequence: '2',
              traceId: '',
            };
            yield {
              payload: { oneofKind: 'completed', completed: {} },
              sequence: '3',
              traceId: '',
            };
          },
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamSpeechSynthesis(ctx, {
    model: 'model',
    text: 'route fallback',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  // routeDecision should fall back to the request's routePolicy (LOCAL since route is unset)
  assert.equal(chunks[0]!.routeDecision, RoutePolicy.LOCAL);
});
