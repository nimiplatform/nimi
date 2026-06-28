import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecutionMode,
  FallbackPolicy,
  FinishReason,
  ChatContentPartType,
  ResponseFormatKind,
  RoutePolicy,
  ScenarioType,
  ToolChoiceMode,
  type ExecuteScenarioRequest,
  type ExecuteScenarioResponse,
  type StreamScenarioEvent,
  type StreamScenarioRequest,
  type ToolCall,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import { ReasonCode as RuntimeProtoReasonCode } from '../../core-generated/runtime-protobuf/runtime/v1/common';
import {
  collectNimiTextStream,
  createNimiRuntimeAIModel,
  runtimeScenarioStreamToNimiEvents,
  type NimiRuntimeAIScenarioClient,
} from './index';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { ReasonCode } from '../../types';
import { filePart, textPart } from '../contracts';

const localRuntimeTargetRef = {
  kind: 'local-runtime' as const,
  version: 'v2' as const,
  profileBindingId: 'local-runtime:model-chat',
};

const cloudRuntimeTargetRef = {
  kind: 'cloud-connector' as const,
  connectorId: 'connector-openrouter',
  remoteModelCatalogId: 'remote-catalog:connector-openrouter:openai/gpt-5',
  providerModelId: 'openai/gpt-5',
  provider: 'openrouter',
};

class FakeScenarioClient implements NimiRuntimeAIScenarioClient {
  executeRequests: ExecuteScenarioRequest[] = [];
  streamRequests: StreamScenarioRequest[] = [];
  executeOptions: RuntimeTypedCallOptions[] = [];
  streamOptions: RuntimeTypedCallOptions[] = [];
  toolCalls: ToolCall[] = [];
  streamToolCall?: ToolCall;

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
          textGenerate: { text: 'hello runtime', toolCalls: this.toolCalls },
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
    if (this.streamToolCall) {
      yield {
        eventType: 3,
        sequence: '6',
        traceId: 'trace-stream',
        payload: {
          oneofKind: 'toolCall',
          toolCall: this.streamToolCall,
        },
      };
    }
    yield {
      eventType: 6,
      sequence: '7',
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
    targetRef: localRuntimeTargetRef,
    reasoning: { mode: 'on', traceMode: 'separate', budgetTokens: 128 },
  });

  const result = await model.generateText({
    model: model.model,
    messages: [
      { role: 'system', content: [textPart('You are precise.')] },
      { role: 'user', content: [textPart('Say hello.')] },
    ],
    parameters: { temperature: 0.1, topP: 0.8, topK: 32, maxTokens: 64 },
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
  assert.deepEqual(request?.head?.targetRef, {
    target: {
      oneofKind: 'localRuntime',
      localRuntime: {
        version: 'v2',
        ref: { oneofKind: 'profileBindingId', profileBindingId: 'local-runtime:model-chat' },
      },
    },
  });
  assert.match(client.executeOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-ai-/);
  assert.equal(request?.spec?.spec.oneofKind, 'textGenerate');
  assert.equal(request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.systemPrompt : '', 'You are precise.');
  assert.equal(request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.input[0]?.content : '', 'Say hello.');
  assert.equal(request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.topK : 0, 32);
});

test('Runtime-backed Nimi AI maps streamScenario to Nimi run events', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    routePolicy: 'cloud',
    targetRef: localRuntimeTargetRef,
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

test('Runtime-backed Nimi AI derives cloud scenario identity from targetRef', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: { ai: client },
    appId: 'app-runtime-ai',
    model: { providerId: 'openrouter', modelId: 'openai/gpt-5' },
    routePolicy: 'cloud',
    targetRef: cloudRuntimeTargetRef,
  });

  await model.generateText({
    model: model.model,
    messages: [{ role: 'user', content: [textPart('Use cloud target.')] }],
  });

  const head = client.executeRequests[0]?.head;
  assert.equal(head?.modelId, 'openai/gpt-5');
  assert.equal(head?.connectorId, 'connector-openrouter');
  assert.deepEqual(head?.targetRef, {
    target: {
      oneofKind: 'cloud',
      cloud: {
        version: 'v2',
        connectorId: 'connector-openrouter',
        remoteModelCatalogId: 'remote-catalog:connector-openrouter:openai/gpt-5',
        providerModelId: 'openai/gpt-5',
        provider: 'openrouter',
      },
    },
  });
});

test('Runtime-backed Nimi AI maps numeric stream failure reason codes to names', async () => {
  async function* failedStream(): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 7,
      sequence: '1',
      traceId: 'trace-stream-failed',
      payload: {
        oneofKind: 'failed',
        failed: {
          reasonCode: RuntimeProtoReasonCode.AI_MODEL_NOT_FOUND,
          actionHint: 'retry stream request',
        },
      },
    };
  }

  const events = runtimeScenarioStreamToNimiEvents(failedStream(), { modelId: 'missing-model' });

  await assert.rejects(
    collectNimiTextStream(events),
    (error: unknown) => (
      (error as { reasonCode?: string; message?: string }).reasonCode === ReasonCode.AI_MODEL_NOT_FOUND
      && /retry stream request/u.test((error as { message?: string }).message || '')
    ),
  );
});

test('collectNimiTextStream fails closed without terminal evidence', async () => {
  async function* missingDone() {
    yield { type: 'text-delta' as const, text: 'partial' };
  }
  await assert.rejects(
    collectNimiTextStream(missingDone()),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING',
  );
});

test('collectNimiTextStream fails closed on unknown terminal finish reason', async () => {
  async function* unknownFinish() {
    yield { type: 'text-delta' as const, text: 'partial' };
    yield { type: 'done' as const, finishReason: 'unknown' as const };
  }
  await assert.rejects(
    collectNimiTextStream(unknownFinish()),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN',
  );
});

test('Runtime-backed Nimi AI maps single-turn tools, tool choice, structured output, and sampling', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  const result = await model.generateText({
    model: model.model,
    messages: [{ role: 'user', content: [textPart('Use tool.')] }],
    tools: [{ name: 'lookup', description: 'look things up', inputSchema: { type: 'object' } }],
    toolChoice: { type: 'tool', name: 'lookup' },
    responseFormat: { type: 'json-object' },
    parameters: { presencePenalty: 0.5, frequencyPenalty: 0.2, stop: ['\n'], seed: 7 },
  });

  assert.equal(result.text, 'hello runtime');
  const spec = client.executeRequests[0]?.spec?.spec;
  assert.equal(spec?.oneofKind, 'textGenerate');
  if (spec?.oneofKind !== 'textGenerate') {
    throw new Error('expected textGenerate spec');
  }
  assert.equal(spec.textGenerate.tools[0]?.name, 'lookup');
  assert.equal(spec.textGenerate.tools[0]?.description, 'look things up');
  assert.equal(spec.textGenerate.toolChoice, ToolChoiceMode.TOOL);
  assert.equal(spec.textGenerate.toolChoiceName, 'lookup');
  assert.equal(spec.textGenerate.responseFormat?.kind, ResponseFormatKind.JSON_OBJECT);
  assert.deepEqual(spec.textGenerate.stop, ['\n']);
  assert.equal(spec.textGenerate.seed, '7');
});

test('Runtime-backed Nimi AI serializes structured request metadata without object loss', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
    metadata: {
      static: { z: 2, a: 1 },
      direct: 'left',
    },
  });

  await model.generateText({
    model: model.model,
    messages: [{ role: 'user', content: [textPart('metadata')] }],
    parameters: {
      metadata: {
        static: { nested: ['b', 'a'] },
        direct: 'right',
      },
    },
  });

  assert.equal(client.executeOptions[0]?.metadata?.direct, 'right');
  assert.equal(client.executeOptions[0]?.metadata?.static, '{"nested":["b","a"]}');
});

test('Runtime-backed Nimi AI returns model tool calls from the scenario output', async () => {
  const client = new FakeScenarioClient();
  client.toolCalls = [{ id: 'call-1', name: 'lookup', argumentsJson: '{"query":"nimi"}' }];
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  const result = await model.generateText({
    model: model.model,
    messages: [{ role: 'user', content: [textPart('Use tool.')] }],
    tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
  });

  assert.equal(result.toolCalls?.length, 1);
  assert.equal(result.toolCalls?.[0]?.name, 'lookup');
  assert.deepEqual(result.toolCalls?.[0]?.arguments, { query: 'nimi' });
});

test('Runtime-backed Nimi AI fails closed on malformed tool call arguments', async () => {
  const client = new FakeScenarioClient();
  client.toolCalls = [{ id: 'call-1', name: 'lookup', argumentsJson: '{"query":' }];
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  await assert.rejects(
    () => model.generateText({
      model: model.model,
      messages: [{ role: 'user', content: [textPart('Use tool.')] }],
      tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
  );
});

test('Runtime-backed Nimi AI maps a multi-step tool round-trip into the scenario request', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  await model.generateText({
    model: model.model,
    messages: [
      { role: 'user', content: [textPart('Weather in Paris?')] },
      {
        role: 'assistant',
        content: [textPart('')],
        toolCalls: [{ id: 'call-1', name: 'weather', arguments: { city: 'Paris' } }],
      },
      { role: 'tool', content: [textPart('{"temp":18}')], toolCallId: 'call-1' },
    ],
    tools: [{ name: 'weather', inputSchema: { type: 'object' } }],
  });

  const spec = client.executeRequests[0]?.spec?.spec;
  if (spec?.oneofKind !== 'textGenerate') {
    throw new Error('expected textGenerate spec');
  }
  const assistant = spec.textGenerate.input.find((message) => message.role === 'assistant');
  assert.equal(assistant?.toolCalls[0]?.name, 'weather');
  assert.equal(assistant?.toolCalls[0]?.argumentsJson, '{"city":"Paris"}');
  const toolMessage = spec.textGenerate.input.find((message) => message.role === 'tool');
  assert.equal(toolMessage?.toolCallId, 'call-1');
});

test('Runtime-backed Nimi AI maps a streamed tool call into a run event', async () => {
  const client = new FakeScenarioClient();
  client.streamToolCall = { id: 'call-stream', name: 'weather', argumentsJson: '{"city":"Paris"}' };
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  const events = await model.streamText!({
    model: model.model,
    messages: [{ role: 'user', content: [textPart('weather?')] }],
    tools: [{ name: 'weather', inputSchema: { type: 'object' } }],
  });
  const collected = await collectNimiTextStream(events);

  assert.equal(collected.toolCalls?.length, 1);
  assert.equal(collected.toolCalls?.[0]?.name, 'weather');
  assert.deepEqual(collected.toolCalls?.[0]?.arguments, { city: 'Paris' });
});

test('Runtime-backed Nimi AI maps file message parts onto Runtime content parts', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  await model.generateText({
    model: model.model,
    messages: [
      {
        role: 'user',
        content: [
          textPart('Describe these.'),
          filePart('image/png', 'aW1hZ2UtYnl0ZXM='),
          filePart('image/jpeg', 'https://example.com/photo.jpg'),
          filePart('audio/wav', 'YXVkaW8='),
          filePart('video/mp4', 'data:video/mp4;base64,dmlkZW8='),
        ],
      },
    ],
  });

  const spec = client.executeRequests[0]?.spec?.spec;
  if (spec?.oneofKind !== 'textGenerate') {
    throw new Error('expected textGenerate spec');
  }
  const userMessage = spec.textGenerate.input.find((message) => message.role === 'user');
  assert.ok(userMessage);
  const parts = userMessage.parts;
  assert.equal(parts.length, 5);

  assert.equal(parts[0]?.type, ChatContentPartType.TEXT);
  assert.equal(parts[0]?.content.oneofKind === 'text' ? parts[0].content.text : '', 'Describe these.');

  // Raw base64 image is wrapped into a data: URI; the Runtime owns decode.
  assert.equal(parts[1]?.type, ChatContentPartType.IMAGE_URL);
  assert.equal(
    parts[1]?.content.oneofKind === 'imageUrl' ? parts[1].content.imageUrl.url : '',
    'data:image/png;base64,aW1hZ2UtYnl0ZXM=',
  );

  // An http(s) URL passes through untouched.
  assert.equal(
    parts[2]?.content.oneofKind === 'imageUrl' ? parts[2].content.imageUrl.url : '',
    'https://example.com/photo.jpg',
  );

  assert.equal(parts[3]?.type, ChatContentPartType.AUDIO_URL);
  assert.equal(
    parts[3]?.content.oneofKind === 'audioUrl' ? parts[3].content.audioUrl : '',
    'data:audio/wav;base64,YXVkaW8=',
  );

  // A pre-formed data: URI passes through untouched.
  assert.equal(parts[4]?.type, ChatContentPartType.VIDEO_URL);
  assert.equal(
    parts[4]?.content.oneofKind === 'videoUrl' ? parts[4].content.videoUrl : '',
    'data:video/mp4;base64,dmlkZW8=',
  );
});

test('Runtime-backed Nimi AI accepts a file-only message with no text part', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  const result = await model.generateText({
    model: model.model,
    messages: [{ role: 'user', content: [filePart('image/png', 'aW1n')] }],
  });

  assert.equal(result.text, 'hello runtime');
  const spec = client.executeRequests[0]?.spec?.spec;
  if (spec?.oneofKind !== 'textGenerate') {
    throw new Error('expected textGenerate spec');
  }
  assert.equal(spec.textGenerate.input[0]?.parts[0]?.type, ChatContentPartType.IMAGE_URL);
});

test('Runtime-backed Nimi AI fails closed for unsupported file media types', async () => {
  const model = createNimiRuntimeAIModel({
    runtime: new FakeScenarioClient(),
    appId: 'app-runtime-ai',
    model: { modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  await assert.rejects(
    () => model.generateText({
      model: model.model,
      messages: [{ role: 'user', content: [textPart('read this'), filePart('application/pdf', 'JVBER')] }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
  );
});

test('Runtime-backed Nimi AI fails closed for subject identity and invalid input', async () => {
  const model = createNimiRuntimeAIModel({
    runtime: new FakeScenarioClient(),
    appId: 'app-runtime-ai',
    model: { providerId: 'connector-1', modelId: 'model-chat' },
    targetRef: localRuntimeTargetRef,
  });

  // Subject identity must be supplied through model options, not request params.
  await assert.rejects(
    () => model.generateText({
      model: model.model,
      messages: [{ role: 'user', content: [textPart('Hi.')] }],
      parameters: { user: 'user-x' },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
  );

  await assert.rejects(
    () => model.generateText({
      model: { modelId: 'other-model' },
      messages: [{ role: 'user', content: [textPart('Mismatch.')] }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_INPUT_INVALID,
  );

  await assert.rejects(
    () => model.generateText({
      model: model.model,
      messages: [{ role: 'user', content: [textPart('')] }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_INPUT_INVALID,
  );
});
