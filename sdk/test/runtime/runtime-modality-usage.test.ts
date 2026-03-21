import assert from 'node:assert/strict';
import test from 'node:test';

import { RoutePolicy } from '../../src/runtime/generated/runtime/v1/ai.js';
import {
  runtimeStreamSpeechSynthesis,
} from '../../src/runtime/runtime-modality.js';
import { artifactDelta } from '../helpers/runtime-ai-shapes.js';
import { createMockCtx } from './runtime-modality-test-helpers.js';

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
