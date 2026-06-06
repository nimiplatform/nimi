import assert from 'node:assert/strict';
import test from 'node:test';

import { ExecutionMode, RoutePolicy, ScenarioType } from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import {
  buildRuntimeTextEmbeddingRequest,
  createNimiRuntimeEmbeddingClient,
} from './embeddings';

test('Runtime-backed embedding client maps text embedding Scenario requests and output', async () => {
  let capturedRequest: ReturnType<typeof buildRuntimeTextEmbeddingRequest> | null = null;
  const embedding = createNimiRuntimeEmbeddingClient({
    appId: 'app-1',
    subjectUserId: 'user-1',
    routePolicy: 'local',
    model: { providerId: 'runtime', modelId: 'embedder-1' },
    runtime: {
      ai: {
        async executeScenario(request) {
          capturedRequest = request;
          return {
            output: {
              output: {
                oneofKind: 'textEmbed',
                textEmbed: {
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
  assert.equal(capturedRequest?.head?.appId, 'app-1');
  assert.equal(capturedRequest?.head?.subjectUserId, 'user-1');
  assert.equal(capturedRequest?.head?.modelId, 'embedder-1');
  assert.equal(capturedRequest?.spec.spec.oneofKind, 'textEmbed');
  assert.deepEqual(capturedRequest?.spec.spec.textEmbed.inputs, ['first', 'second']);
  assert.deepEqual(result.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
  assert.equal(result.usage?.totalTokens, 3);
  assert.equal(result.raw.routeDecision, 'local');
});

test('Runtime-backed embedding client fails closed for invalid inputs and outputs', async () => {
  const embedding = createNimiRuntimeEmbeddingClient({
    appId: 'app-1',
    model: { modelId: 'embedder-1' },
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
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_INPUT_INVALID',
  );
  await assert.rejects(
    () => embedding.embedText({ values: ['ok'] }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_RUNTIME_OUTPUT_INVALID',
  );
});
