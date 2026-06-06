import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecutionMode,
  FallbackPolicy,
  FinishReason,
  RoutePolicy,
  ScenarioType,
  type ExecuteScenarioRequest,
  type ExecuteScenarioResponse,
  type StreamScenarioEvent,
  type StreamScenarioRequest,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import {
  collectNimiTextStream,
  createNimiRuntimeAIModel,
  type NimiRuntimeAIScenarioClient,
} from './index';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { textPart } from '../contracts';

class FakeScenarioClient implements NimiRuntimeAIScenarioClient {
  executeRequests: ExecuteScenarioRequest[] = [];
  streamRequests: StreamScenarioRequest[] = [];
  executeOptions: RuntimeTypedCallOptions[] = [];
  streamOptions: RuntimeTypedCallOptions[] = [];

  async executeScenario(
    request: ExecuteScenarioRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ExecuteScenarioResponse> {
    this.executeRequests.push(request);
    this.executeOptions.push(options ?? {});
    return {
      output: {
        output: {
          oneofKind: 'textGenerate',
          textGenerate: { text: 'hello runtime' },
        },
      },
      finishReason: FinishReason.STOP,
      usage: { inputTokens: '4', outputTokens: '2', computeMs: '9' },
      routeDecision: RoutePolicy.LOCAL,
      modelResolved: 'runtime-model-resolved',
      traceId: 'trace-runtime-ai',
      ignoredExtensions: [],
    };
  }

  async *streamScenario(
    request: StreamScenarioRequest,
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<StreamScenarioEvent> {
    this.streamRequests.push(request);
    this.streamOptions.push(options ?? {});
    yield {
      eventType: 1,
      sequence: '1',
      traceId: 'trace-stream',
      payload: {
        oneofKind: 'started',
        started: {
          modelResolved: 'runtime-stream-model',
          routeDecision: RoutePolicy.CLOUD,
        },
      },
    };
    yield {
      eventType: 2,
      sequence: '2',
      traceId: 'trace-stream',
      payload: {
        oneofKind: 'delta',
        delta: {
          delta: {
            oneofKind: 'reasoning',
            reasoning: { text: 'think ' },
          },
        },
      },
    };
    yield {
      eventType: 2,
      sequence: '3',
      traceId: 'trace-stream',
      payload: {
        oneofKind: 'delta',
        delta: {
          delta: {
            oneofKind: 'text',
            text: { text: 'hello ' },
          },
        },
      },
    };
    yield {
      eventType: 2,
      sequence: '4',
      traceId: 'trace-stream',
      payload: {
        oneofKind: 'delta',
        delta: {
          delta: {
            oneofKind: 'artifact',
            artifact: { chunk: new Uint8Array([1, 2, 3]), mimeType: 'application/octet-stream' },
          },
        },
      },
    };
    yield {
      eventType: 5,
      sequence: '5',
      traceId: 'trace-stream',
      payload: {
        oneofKind: 'usage',
        usage: { inputTokens: '7', outputTokens: '3', computeMs: '20' },
      },
    };
    yield {
      eventType: 6,
      sequence: '6',
      traceId: 'trace-stream',
      payload: {
        oneofKind: 'completed',
        completed: {
          finishReason: FinishReason.STOP,
          usage: { inputTokens: '99', outputTokens: '99', computeMs: '99' },
          streamSimulated: false,
        },
      },
    };
  }
}

test('Runtime-backed Nimi AI maps generateText to Runtime Scenario text_generate', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: { ai: client },
    appId: 'app-runtime-ai',
    model: { providerId: 'connector-1', modelId: 'model-chat' },
    routePolicy: 'local',
    reasoning: { mode: 'on', traceMode: 'separate', budgetTokens: 128 },
  });

  const result = await model.generateText({
    model: model.model,
    messages: [
      { role: 'system', content: [textPart('You are precise.')] },
      { role: 'user', content: [textPart('Say hello.')] },
    ],
    parameters: { temperature: 0.1, topP: 0.8, maxTokens: 64 },
  });

  assert.equal(result.text, 'hello runtime');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.usage, { promptTokens: 4, completionTokens: 2, totalTokens: 6 });
  const request = client.executeRequests[0];
  assert.equal(request?.scenarioType, ScenarioType.TEXT_GENERATE);
  assert.equal(request?.executionMode, ExecutionMode.SYNC);
  assert.equal(request?.head?.fallback, FallbackPolicy.DENY);
  assert.equal(request?.head?.routePolicy, RoutePolicy.LOCAL);
  assert.equal(request?.head?.connectorId, 'connector-1');
  assert.match(client.executeOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-ai-/);
  assert.equal(request?.spec?.spec.oneofKind, 'textGenerate');
  assert.equal(request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.systemPrompt : '', 'You are precise.');
  assert.equal(request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.input[0]?.content : '', 'Say hello.');
});

test('Runtime-backed Nimi AI maps streamScenario to Nimi run events', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    routePolicy: 'cloud',
  });

  const events = await model.streamText?.({
    model: model.model,
    messages: [{ role: 'user', content: [textPart('Stream hello.')] }],
  });
  assert.ok(events);
  const collected = await collectNimiTextStream(events);

  assert.equal(client.streamRequests[0]?.executionMode, ExecutionMode.STREAM);
  assert.equal(client.streamRequests[0]?.head?.routePolicy, RoutePolicy.CLOUD);
  assert.match(client.streamOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-ai-/);
  assert.equal(collected.text, 'hello ');
  assert.equal(collected.finishReason, 'stop');
  assert.deepEqual(collected.usage, { promptTokens: 7, completionTokens: 3, totalTokens: 10 });
  assert.deepEqual(collected.raw, {
    reasoning: 'think ',
    artifacts: [{ mimeType: 'application/octet-stream', sizeBytes: 3 }],
  });
});

test('Runtime-backed Nimi AI fails closed for unsupported tool-call parity', async () => {
  const model = createNimiRuntimeAIModel({
    runtime: new FakeScenarioClient(),
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
  });

  await assert.rejects(
    () => model.generateText({
      model: model.model,
      messages: [{ role: 'user', content: [textPart('Use tool.')] }],
      tools: [{
        name: 'lookup',
        inputSchema: {},
      }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_RUNTIME_FEATURE_UNSUPPORTED',
  );
});

test('Runtime-backed Nimi AI fails closed for unsupported params and model mismatch', async () => {
  const model = createNimiRuntimeAIModel({
    runtime: new FakeScenarioClient(),
    appId: 'app-runtime-ai',
    model: { providerId: 'connector-1', modelId: 'model-chat' },
  });

  await assert.rejects(
    () => model.generateText({
      model: model.model,
      messages: [{ role: 'user', content: [textPart('Stop.')] }],
      parameters: { stop: '\n' },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_RUNTIME_FEATURE_UNSUPPORTED',
  );

  await assert.rejects(
    () => model.generateText({
      model: { modelId: 'other-model' },
      messages: [{ role: 'user', content: [textPart('Mismatch.')] }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_INPUT_INVALID',
  );

  await assert.rejects(
    () => model.generateText({
      model: model.model,
      messages: [{ role: 'user', content: [textPart('')] }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_INPUT_INVALID',
  );
});
