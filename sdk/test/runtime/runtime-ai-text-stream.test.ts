import assert from 'node:assert/strict';
import test from 'node:test';

import { FallbackPolicy, RoutePolicy } from '../../src/runtime/generated/runtime/v1/ai.js';
import type { RuntimeInternalContext } from '../../src/runtime/internal-context.js';
import { runtimeAiRequestRequiresSubject } from '../../src/runtime/runtime-guards.js';
import { runtimeStreamText } from '../../src/runtime/runtime-ai-text.js';

function createMockCtx(overrides?: Partial<RuntimeInternalContext>): RuntimeInternalContext {
  return {
    appId: 'test-app',
    options: { appId: 'test-app', transport: { type: 'node-grpc', endpoint: '127.0.0.1:1' } },
    invoke: async (op) => op(),
    invokeWithClient: async (op) => op({
      ai: {
        executeScenario: async () => ({}),
        streamScenario: async () => (async function* () {})(),
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

test('runtimeStreamText uses completed usage when the usage event is absent', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: {
                oneofKind: 'started',
                started: {
                  routeDecision: RoutePolicy.CLOUD,
                  modelResolved: 'chat/completed-usage',
                },
              },
              traceId: 'trace-completed-only',
            };
            yield {
              payload: {
                oneofKind: 'delta',
                delta: {
                  delta: {
                    oneofKind: 'text',
                    text: {
                      text: 'hello',
                    },
                  },
                },
              },
            };
            yield {
              payload: {
                oneofKind: 'completed',
                completed: {
                  finishReason: 1,
                  usage: {
                    inputTokens: '7',
                    outputTokens: '3',
                  },
                },
              },
              traceId: 'trace-completed-only',
            };
          },
        }),
      },
    } as never),
  });

  const result = await runtimeStreamText(ctx, {
    model: 'chat/default',
    input: 'hello',
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }

  const finish = parts.find((part) => part.type === 'finish');
  assert.ok(finish && finish.type === 'finish');
  assert.equal(finish.usage.inputTokens, 7);
  assert.equal(finish.usage.outputTokens, 3);
  assert.equal(finish.usage.totalTokens, 10);
});

test('runtimeStreamText prefers the usage event over completed usage', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: {
                oneofKind: 'usage',
                usage: {
                  inputTokens: '4',
                  outputTokens: '2',
                },
              },
            };
            yield {
              payload: {
                oneofKind: 'completed',
                completed: {
                  finishReason: 1,
                  usage: {
                    inputTokens: '99',
                    outputTokens: '99',
                  },
                },
              },
            };
          },
        }),
      },
    } as never),
  });

  const result = await runtimeStreamText(ctx, {
    model: 'chat/default',
    input: 'hello',
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }

  const finish = parts.find((part) => part.type === 'finish');
  assert.ok(finish && finish.type === 'finish');
  assert.equal(finish.usage.inputTokens, 4);
  assert.equal(finish.usage.outputTokens, 2);
  assert.equal(finish.usage.totalTokens, 6);
});

test('runtimeStreamText returns an empty usage object when the stream ends without usage data', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        streamScenario: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              payload: {
                oneofKind: 'completed',
                completed: {
                  finishReason: 1,
                },
              },
            };
          },
        }),
      },
    } as never),
  });

  const result = await runtimeStreamText(ctx, {
    model: 'chat/default',
    input: 'hello',
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }

  const finish = parts.find((part) => part.type === 'finish');
  assert.ok(finish && finish.type === 'finish');
  assert.deepEqual(finish.usage, {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
  });
});
