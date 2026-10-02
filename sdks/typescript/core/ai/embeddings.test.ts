import assert from 'node:assert/strict';
import test from 'node:test';

import { ExecutionMode, RoutePolicy, ScenarioType } from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { ReasonCode } from '../../types';
import {
  buildRuntimeTextEmbeddingRequest,
  createNimiRuntimeEmbeddingClient,
} from './embeddings';

test('Runtime-backed embedding client maps text embedding Scenario requests and output', async () => {
  let capturedRequest: ReturnType<typeof buildRuntimeTextEmbeddingRequest> | null = null;
  let capturedOptions: RuntimeTypedCallOptions | undefined;
  const embedding = createNimiRuntimeEmbeddingClient({
    appId: 'app-1',
    subjectUserId: 'user-1',
    runtime: {
      ai: {
        async executeScenario(request, options) {
          capturedRequest = request;
          capturedOptions = options;
          return {
            output: {
              output: {
                oneofKind: 'textEmbed',
                textEmbed: {
                  spaceId: 'space-embedder-1',
                  vectors: [
                    { values: [0.1, 0.2] },
                    { values: [0.3, 0.4] },
                  ],
                },
              },
            },
            finishReason: 1,
            usage: { inputTokens: '3', outputTokens: '0', totalTokens: '3' },
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'embedder-1',
            traceId: 'trace-embed',
            ignoredExtensions: [],
          };
        },
      },
    },
  });

  const result = await embedding.embedText({ values: [' first ', 'second'] });

  assert.equal(capturedRequest?.scenarioType, ScenarioType.TEXT_EMBED);
  assert.equal(capturedRequest?.executionMode, ExecutionMode.SYNC);
  assert.deepEqual(capturedRequest?.head, {
    appId: 'app-1',
    subjectUserId: 'user-1',
    timeoutMs: 0,
  });
  assert.match(capturedOptions?.metadata?.idempotencyKey ?? '', /^runtime-embed-/);
  assert.equal(capturedRequest?.spec.spec.oneofKind, 'textEmbed');
  assert.deepEqual(capturedRequest?.spec.spec.textEmbed.inputs, ['first', 'second']);
  assert.deepEqual(result.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
  assert.equal(result.spaceId, 'space-embedder-1');
  assert.equal(result.usage?.totalTokens, 3);
  assert.equal(result.raw.routeDecision, 'local');
});

test('Runtime-backed embedding client fails closed for invalid inputs and outputs', async () => {
  const embedding = createNimiRuntimeEmbeddingClient({
    appId: 'app-1',
    runtime: {
      async executeScenario() {
        return {
          output: { output: { oneofKind: undefined } },
          finishReason: 1,
          routeDecision: RoutePolicy.UNSPECIFIED,
          modelResolved: '',
          traceId: '',
          ignoredExtensions: [],
        };
      },
    },
  });

  await assert.rejects(
    () => embedding.embedText({ values: [] }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_INPUT_INVALID,
  );
  await assert.rejects(
    () => embedding.embedText({ values: ['ok'] }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
  );
});

test('Runtime-backed embedding client refuses vectors without their embedding space', async () => {
  const embedding = createNimiRuntimeEmbeddingClient({
    appId: 'app-1',
    runtime: {
      async executeScenario() {
        return {
          output: { output: { oneofKind: 'textEmbed', textEmbed: {
            vectors: [{ values: [0.25, 0.75] }], spaceId: '',
          } } },
          finishReason: 1,
          routeDecision: RoutePolicy.LOCAL,
          modelResolved: 'embedder-1',
          traceId: 'trace-embed',
          ignoredExtensions: [],
        };
      },
    },
  });
  await assert.rejects(
    () => embedding.embedText({ values: ['hello'] }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
  );
});

test('embedding dimensions preserve wire presence and the captured request across an async call', async () => {
  const request = { values: ['hello'], dimensions: 2 };
  let calls = 0;
  const embedding = createNimiRuntimeEmbeddingClient({
    appId: 'app-1',
    runtime: { async executeScenario(wire) {
      calls++;
      assert.equal(wire.spec?.spec.oneofKind, 'textEmbed');
      if (wire.spec?.spec.oneofKind !== 'textEmbed') throw new Error('expected embedding request');
      assert.equal(wire.spec.spec.textEmbed.dimensions, 2);
      request.dimensions = 3;
      request.values.push('later');
      return {
        output: { output: { oneofKind: 'textEmbed', textEmbed: {
          vectors: [{ values: [0.1, 0.2] }], spaceId: 'space-short',
        } } },
        finishReason: 1, routeDecision: RoutePolicy.CLOUD, modelResolved: 'embedder',
        traceId: 'trace', ignoredExtensions: [],
      };
    } },
  });
  const result = await embedding.embedText(request);
  assert.deepEqual(result.embeddings, [[0.1, 0.2]]);
  assert.equal(result.usage, undefined);
  for (const dimensions of [0, -1, 1.5, NaN, Infinity, 0x1_0000_0000]) {
    await assert.rejects(embedding.embedText({ values: ['hello'], dimensions }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_INPUT_INVALID);
  }
  assert.equal(calls, 1);
  const omitted = buildRuntimeTextEmbeddingRequest({ values: ['hello'], options: { appId: 'app-1', runtime: { executeScenario: async () => { throw new Error('unused'); } } }, appId: 'app-1' });
  assert.equal(omitted.spec.spec.oneofKind, 'textEmbed');
  if (omitted.spec.spec.oneofKind !== 'textEmbed') throw new Error('expected embedding request');
  assert.equal(Object.hasOwn(omitted.spec.spec.textEmbed, 'dimensions'), false);
});

test('embedding results enforce vector count, finite values, and the requested width', async () => {
  for (const vectors of [[], [[1]], [[1, 2], [3, 4]], [[NaN, 2]], [[Infinity, 2]]]) {
    const embedding = createNimiRuntimeEmbeddingClient({ appId: 'app-1', runtime: {
      async executeScenario() { return {
        output: { output: { oneofKind: 'textEmbed', textEmbed: {
          vectors: vectors.map((values) => ({ values })), spaceId: 'space-short',
        } } },
        finishReason: 1, routeDecision: RoutePolicy.CLOUD, modelResolved: 'embedder',
        traceId: 'trace', ignoredExtensions: [],
      }; },
    } });
    await assert.rejects(embedding.embedText({ values: ['hello'], dimensions: 2 }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID);
  }
});
