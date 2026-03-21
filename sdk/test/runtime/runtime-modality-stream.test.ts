import assert from 'node:assert/strict';
import test from 'node:test';

import { RoutePolicy } from '../../src/runtime/generated/runtime/v1/ai.js';
import { ReasonCode } from '../../src/types/index.js';
import {
  runtimeStreamSpeech,
  runtimeStreamSpeechSynthesis,
  streamArtifactsFromMediaOutput,
} from '../../src/runtime/runtime-modality.js';
import { artifactDelta } from '../helpers/runtime-ai-shapes.js';
import { createMockCtx, makeArtifact, makeJob } from './runtime-modality-test-helpers.js';

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
