import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ExecutionMode,
  FinishReason,
  ChatContentPartType,
  ExecutionInterruptionCause,
  ExecutionResubmitDisposition,
  ReasoningActivation,
  ReasoningEffort,
  ReasoningPresentation,
  ResponseFormatKind,
  RoutePolicy,
  ScenarioType,
  TextGenerateScenarioSpec,
  type ExecuteScenarioRequest,
  type ExecuteScenarioResponse,
  type StreamScenarioEvent,
  type StreamScenarioRequest,
  type TextOutputItem,
  type ToolCall,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import {
  ReasonCode as RuntimeProtoReasonCode,
  TextBehaviorKind,
  ToolChoiceMode,
} from '../../core-generated/runtime-protobuf/runtime/v1/common';
import type { LoadoutEffectiveInputIdentity } from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import {
  collectNimiTextStream,
  createNimiRuntimeAIModel,
  runtimeScenarioStreamToNimiEvents,
  type NimiRuntimeAIScenarioClient,
} from './index';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { ReasonCode } from '../../types';
import { artifactRefPart, filePart, textPart } from '../contracts';

class FakeScenarioClient implements NimiRuntimeAIScenarioClient {
  executeRequests: ExecuteScenarioRequest[] = [];
  streamRequests: StreamScenarioRequest[] = [];
  executeOptions: RuntimeTypedCallOptions[] = [];
  streamOptions: RuntimeTypedCallOptions[] = [];
  toolCalls: ToolCall[] = [];
  outputItems?: TextOutputItem[];
  effectiveInputIdentity?: LoadoutEffectiveInputIdentity;
  streamToolCall?: ToolCall;
  finishReason: FinishReason = FinishReason.STOP;

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
          textGenerate: {
            text: 'hello runtime',
            toolCalls: this.toolCalls,
            sources: [],
            rawChunks: [],
            items: this.outputItems ?? [
              { item: { oneofKind: 'text', text: { text: 'hello runtime' } } },
              ...this.toolCalls.map((toolCall) => ({ item: { oneofKind: 'toolCall' as const, toolCall } })),
            ],
            reasoningSummary: '',
          },
        },
      },
      finishReason: this.finishReason,
      usage: { inputTokens: '4', outputTokens: '2', computeMs: '9' },
      routeDecision: RoutePolicy.LOCAL,
      modelResolved: 'runtime-model-resolved',
      traceId: 'trace-runtime-ai',
      ignoredExtensions: [],
      effectiveInputIdentity: this.effectiveInputIdentity,
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
          voiceOutputMode: 0,
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
            oneofKind: 'textOutputItem',
            textOutputItem: {
              itemIndex: 0,
              delta: { oneofKind: 'reasoningSummary', reasoningSummary: { text: 'think ' } },
              itemCompleted: true,
            },
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
            oneofKind: 'textOutputItem',
            textOutputItem: {
              itemIndex: 1,
              delta: { oneofKind: 'text', text: { text: 'hello ' } },
              itemCompleted: true,
            },
          },
        },
      },
    };
    yield {
      eventType: 5,
      sequence: '4',
      traceId: 'trace-stream',
      payload: {
        oneofKind: 'usage',
        usage: { inputTokens: '7', outputTokens: '3', computeMs: '20' },
      },
    };
    if (this.streamToolCall) {
      yield {
        eventType: 3,
        sequence: '5',
        traceId: 'trace-stream',
        payload: {
          oneofKind: 'delta',
          delta: {
            delta: {
              oneofKind: 'textOutputItem',
              textOutputItem: {
                itemIndex: 2,
                delta: { oneofKind: 'toolCall', toolCall: this.streamToolCall },
                itemCompleted: true,
              },
            },
          },
        },
      };
    }
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
    reasoning: { activation: 'required', presentation: 'summary', exactBudgetTokens: 128 },
  });

  assert.deepEqual(model.model, { modelId: 'text.generate' });
  const result = await model.generateText({
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
  assert.deepEqual(request?.head, {
    appId: 'app-runtime-ai',
    subjectUserId: '',
    timeoutMs: 0,
  });
  assert.match(client.executeOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-ai-/);
  assert.equal(request?.spec?.spec.oneofKind, 'textGenerate');
  assert.equal(request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.systemPrompt : '', 'You are precise.');
  assert.equal(request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.input[0]?.content : '', 'Say hello.');
  assert.equal(request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.topK : 0, 32);
  const reasoning = request?.spec?.spec.oneofKind === 'textGenerate'
    ? request.spec.spec.textGenerate.reasoning
    : undefined;
  assert.equal(reasoning?.activation, ReasoningActivation.REQUIRED);
  assert.equal(reasoning?.presentation, ReasoningPresentation.SUMMARY);
  assert.equal(reasoning?.intensity.oneofKind, 'exactBudgetTokens');
  assert.equal(reasoning?.intensity.oneofKind === 'exactBudgetTokens' ? reasoning.intensity.exactBudgetTokens : 0, 128);
});

test('Runtime-backed Nimi AI projects exact admitted Loadout features and behaviors', async () => {
  const client = new FakeScenarioClient();
  client.effectiveInputIdentity = {
    loadoutId: 'loadout-1',
    capabilityContract: 'text.generate',
    implementation: {
      implementationId: 'local.text.generate',
      driverId: 'nimi.runtime.driver',
      driverDialect: 'text/v1',
    },
    recipeId: 'recipe-1',
    recipeRevision: '7',
    options: undefined,
    modelAxes: [],
    recipeCustody: [],
    admittedFeatures: ['input.image'],
    admittedTextBehaviors: [TextBehaviorKind.TOOL_USE, TextBehaviorKind.REASONING],
  };
  const result = await createNimiRuntimeAIModel({ runtime: client, appId: 'app-runtime-ai' }).generateText({
    messages: [{ role: 'user', content: [textPart('admission')] }],
  });
  assert.deepEqual(result.admission, {
    loadoutId: 'loadout-1',
    capabilityContract: 'text.generate',
    implementation: {
      implementationId: 'local.text.generate',
      driverId: 'nimi.runtime.driver',
      driverDialect: 'text/v1',
    },
    recipeId: 'recipe-1',
    recipeRevision: '7',
    admittedFeatures: ['input.image'],
    admittedTextBehaviors: ['tool-use', 'reasoning'],
  });
});

test('Runtime-backed Nimi AI preserves optional sampling presence and explicit zero values', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({ runtime: client, appId: 'app-runtime-ai' });

  await model.generateText({
    messages: [{ role: 'user', content: [textPart('Use defaults.')] }],
  });
  await model.generateText({
    messages: [{ role: 'user', content: [textPart('Use zero values.')] }],
    parameters: {
      temperature: 0,
      topP: 0,
      maxTokens: 0,
      topK: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      seed: 0,
    },
  });

  const absent = client.executeRequests[0]?.spec?.spec;
  const explicit = client.executeRequests[1]?.spec?.spec;
  assert.equal(absent?.oneofKind, 'textGenerate');
  assert.equal(explicit?.oneofKind, 'textGenerate');
  if (absent?.oneofKind !== 'textGenerate' || explicit?.oneofKind !== 'textGenerate') {
    throw new Error('expected textGenerate specs');
  }
  for (const field of [
    'temperature', 'topP', 'maxTokens', 'topK', 'presencePenalty', 'frequencyPenalty', 'seed',
  ] as const) {
    assert.equal(absent.textGenerate[field], undefined);
  }
  assert.equal(explicit.textGenerate.temperature, 0);
  assert.equal(explicit.textGenerate.topP, 0);
  assert.equal(explicit.textGenerate.maxTokens, 0);
  assert.equal(explicit.textGenerate.topK, 0);
  assert.equal(explicit.textGenerate.presencePenalty, 0);
  assert.equal(explicit.textGenerate.frequencyPenalty, 0);
  assert.equal(explicit.textGenerate.seed, '0');

  const decoded = TextGenerateScenarioSpec.fromBinary(
    TextGenerateScenarioSpec.toBinary(explicit.textGenerate),
  );
  assert.equal(decoded.temperature, 0);
  assert.equal(decoded.topP, 0);
  assert.equal(decoded.maxTokens, 0);
  assert.equal(decoded.topK, 0);
  assert.equal(decoded.presencePenalty, 0);
  assert.equal(decoded.frequencyPenalty, 0);
  assert.equal(decoded.seed, '0');
  assert.equal(absent.textGenerate.reasoning, undefined);
});

test('Runtime-backed Nimi AI maps effort intensity and rejects invalid reasoning algebra', async () => {
  const defaultClient = new FakeScenarioClient();
  await createNimiRuntimeAIModel({ runtime: defaultClient, appId: 'app-native-default', reasoning: { activation: 'adaptive', effort: 'model-default' } }).generateText({ messages: [{ role: 'user', content: [textPart('Reason.')] }] });
  const nativeSpec = defaultClient.executeRequests[0]?.spec?.spec;
  const nativeReasoning = nativeSpec?.oneofKind === 'textGenerate' ? nativeSpec.textGenerate.reasoning : undefined;
  assert.equal(nativeReasoning?.activation, ReasoningActivation.ADAPTIVE);
  assert.deepEqual(nativeReasoning?.intensity, { oneofKind: 'effort', effort: ReasoningEffort.MODEL_DEFAULT });
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
    reasoning: { activation: 'adaptive', presentation: 'hidden', effort: 'high' },
  });
  await model.generateText({ messages: [{ role: 'user', content: [textPart('Reason.')] }] });
  const spec = client.executeRequests[0]?.spec?.spec;
  assert.equal(spec?.oneofKind, 'textGenerate');
  const reasoning = spec?.oneofKind === 'textGenerate' ? spec.textGenerate.reasoning : undefined;
  assert.equal(reasoning?.activation, ReasoningActivation.ADAPTIVE);
  assert.equal(reasoning?.intensity.oneofKind, 'effort');
  assert.equal(reasoning?.intensity.oneofKind === 'effort' ? reasoning.intensity.effort : 0, ReasoningEffort.HIGH);

  for (const invalid of [
    { activation: 'required', effort: 'low', exactBudgetTokens: 64 },
    { activation: 'adaptive' },
    { activation: 'required', exactBudgetTokens: 0 },
    { activation: 'disabled', presentation: 'summary' },
  ]) {
    const invalidModel = createNimiRuntimeAIModel({
      runtime: new FakeScenarioClient(),
      appId: 'app-runtime-ai',
      reasoning: invalid as never,
    });
    await assert.rejects(
      () => invalidModel.generateText({ messages: [{ role: 'user', content: [textPart('Reason.')] }] }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_INPUT_INVALID,
    );
  }
});

test('Runtime-backed Nimi AI maps streamScenario to Nimi run events', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
  });

  const events = await model.streamText?.({
    messages: [{ role: 'user', content: [textPart('Stream hello.')] }],
  });
  assert.ok(events);
  const collected = await collectNimiTextStream(events);

  assert.equal(client.streamRequests[0]?.executionMode, ExecutionMode.STREAM);
  assert.deepEqual(client.streamRequests[0]?.head, {
    appId: 'app-runtime-ai',
    subjectUserId: '',
    timeoutMs: 0,
  });
  assert.match(client.streamOptions[0]?.metadata?.idempotencyKey ?? '', /^runtime-ai-/);
  assert.equal(collected.text, 'hello ');
  assert.equal(collected.reasoningSummary, 'think ');
  assert.equal(collected.finishReason, 'stop');
  assert.deepEqual(collected.usage, { promptTokens: 7, completionTokens: 3, totalTokens: 10 });
  assert.deepEqual(collected.outputItems, [
    { type: 'reasoning-summary', text: 'think ' },
    { type: 'text', text: 'hello ' },
  ]);
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

  const events = runtimeScenarioStreamToNimiEvents(failedStream(), { modelId: 'text.generate' });

  await assert.rejects(
    collectNimiTextStream(events),
    (error: unknown) => {
      const nimiError = error as {
        readonly code?: string;
        readonly reasonCode?: string;
        readonly actionHint?: string;
      };
      assert.equal(nimiError.code, ReasonCode.AI_MODEL_NOT_FOUND);
      assert.equal(nimiError.reasonCode, ReasonCode.AI_MODEL_NOT_FOUND);
      assert.equal(nimiError.actionHint, 'check_ai_stream_event');
      return true;
    },
  );
});

test('Runtime-backed Nimi AI preserves typed Runtime-restart interruption disposition', async () => {
  async function* interruptedStream(): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 7,
      sequence: '1',
      traceId: 'trace-stream-interrupted',
      payload: {
        oneofKind: 'failed',
        failed: {
          reasonCode: RuntimeProtoReasonCode.AI_EXECUTION_INTERRUPTED,
          actionHint: 'resubmit_when_ready',
          interruption: {
            cause: ExecutionInterruptionCause.RUNTIME_RESTART,
            resubmitDisposition: ExecutionResubmitDisposition.CALLER_MAY_RESUBMIT,
          },
        },
      },
    };
  }
  await assert.rejects(
    collectNimiTextStream(runtimeScenarioStreamToNimiEvents(
      interruptedStream(),
      { modelId: 'text.generate' },
    )),
    (error: unknown) => {
      const nimiError = error as {
        readonly reasonCode?: string;
        readonly retryable?: boolean;
        readonly details?: { readonly interruption?: unknown };
      };
      assert.equal(nimiError.reasonCode, ReasonCode.AI_EXECUTION_INTERRUPTED);
      assert.equal(nimiError.retryable, true);
      assert.deepEqual(nimiError.details?.interruption, {
        cause: 'runtime-restart',
        resubmitDisposition: 'caller-may-resubmit',
      });
      return true;
    },
  );
});

test('Runtime-backed Nimi AI never publishes an incomplete streamed ToolCall', async () => {
  async function* partialToolStream(): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 2,
      sequence: '1',
      traceId: 'trace-partial-tool',
      payload: {
        oneofKind: 'delta',
        delta: {
          delta: {
            oneofKind: 'textOutputItem',
            textOutputItem: {
              itemIndex: 0,
              delta: {
                oneofKind: 'toolCall',
                toolCall: { id: 'partial', name: 'lookup', argumentsJson: '{}', dynamic: false },
              },
              itemCompleted: false,
            },
          },
        },
      },
    };
  }
  await assert.rejects(
    collectNimiTextStream(runtimeScenarioStreamToNimiEvents(
      partialToolStream(),
      { modelId: 'text.generate' },
    )),
    (error: unknown) => (
      (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID
    ),
  );
});

test('Runtime-backed Nimi AI rejects open and summary-only stream terminals', async () => {
  async function* terminalStream(kind: 'open-text' | 'summary-only'): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 2,
      sequence: '1',
      traceId: 'trace-invalid-terminal',
      payload: {
        oneofKind: 'delta',
        delta: {
          delta: {
            oneofKind: 'textOutputItem',
            textOutputItem: kind === 'open-text'
              ? {
                itemIndex: 0,
                delta: { oneofKind: 'text', text: { text: 'partial' } },
                itemCompleted: false,
              }
              : {
                itemIndex: 0,
                delta: { oneofKind: 'reasoningSummary', reasoningSummary: { text: 'summary' } },
                itemCompleted: true,
              },
          },
        },
      },
    };
    yield {
      eventType: 3,
      sequence: '2',
      traceId: 'trace-invalid-terminal',
      payload: {
        oneofKind: 'completed',
        completed: { finishReason: FinishReason.STOP, streamSimulated: false },
      },
    };
  }
  for (const kind of ['open-text', 'summary-only'] as const) {
    await assert.rejects(
      collectNimiTextStream(runtimeScenarioStreamToNimiEvents(
        terminalStream(kind),
        { modelId: 'text.generate' },
      )),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    );
  }
});

test('Runtime-backed Nimi AI preserves valid opaque continuity in canonical stream order', async () => {
  const continuityPayload = new Uint8Array([7, 8, 9]);
  async function* continuityStream(): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 2,
      sequence: '1',
      traceId: 'trace-continuity',
      payload: {
        oneofKind: 'delta',
        delta: { delta: { oneofKind: 'textOutputItem', textOutputItem: {
          itemIndex: 0,
          delta: { oneofKind: 'text', text: { text: 'answer' } },
          itemCompleted: false,
        } } },
      },
    };
    yield {
      eventType: 2,
      sequence: '2',
      traceId: 'trace-continuity',
      payload: {
        oneofKind: 'delta',
        delta: { delta: { oneofKind: 'textOutputItem', textOutputItem: {
          itemIndex: 0,
          delta: { oneofKind: undefined },
          itemCompleted: true,
        } } },
      },
    };
    yield {
      eventType: 2,
      sequence: '3',
      traceId: 'trace-continuity',
      payload: {
        oneofKind: 'delta',
        delta: { delta: { oneofKind: 'textOutputItem', textOutputItem: {
          itemIndex: 1,
          delta: { oneofKind: 'reasoningContinuity', reasoningContinuity: {
            kind: 'native', version: 1, payload: continuityPayload,
          } },
          itemCompleted: true,
        } } },
      },
    };
    yield {
      eventType: 3,
      sequence: '4',
      traceId: 'trace-continuity',
      payload: {
        oneofKind: 'completed',
        completed: { finishReason: FinishReason.STOP, streamSimulated: false },
      },
    };
  }
  const result = await collectNimiTextStream(runtimeScenarioStreamToNimiEvents(
    continuityStream(),
    { modelId: 'text.generate' },
  ));
  assert.deepEqual(result.outputItems?.map((item) => item.type), ['text', 'reasoning-continuity']);
  const continuity = result.outputItems?.[1];
  assert.equal(continuity?.type, 'reasoning-continuity');
  if (continuity?.type === 'reasoning-continuity') {
    assert.deepEqual([...continuity.carrier.payload], [7, 8, 9]);
    assert.notEqual(continuity.carrier.payload, continuityPayload);
  }
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
  });

  const result = await model.generateText({
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
    metadata: {
      static: { z: 2, a: 1 },
      direct: 'left',
    },
  });

  await model.generateText({
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
  });

  const result = await model.generateText({
    messages: [{ role: 'user', content: [textPart('Use tool.')] }],
    tools: [{ name: 'lookup', inputSchema: { type: 'object' } }],
  });

  assert.equal(result.toolCalls?.length, 1);
  assert.equal(result.toolCalls?.[0]?.name, 'lookup');
  assert.deepEqual(result.toolCalls?.[0]?.arguments, { query: 'nimi' });
});

test('Runtime-backed Nimi AI derives every sync convenience view from ordered output items', async () => {
  const client = new FakeScenarioClient();
  client.outputItems = [
    { item: { oneofKind: 'reasoningSummary', reasoningSummary: { text: 'summary' } } },
    { item: { oneofKind: 'text', text: { text: 'before ' } } },
    {
      item: {
        oneofKind: 'toolCall',
        toolCall: { id: 'call-ordered', name: 'lookup', argumentsJson: '{"query":"nimi"}', dynamic: false },
      },
    },
    {
      item: {
        oneofKind: 'reasoningContinuity',
        reasoningContinuity: { kind: 'native', version: 1, payload: new Uint8Array([1, 2]) },
      },
    },
    { item: { oneofKind: 'text', text: { text: 'after' } } },
  ];
  const result = await createNimiRuntimeAIModel({ runtime: client, appId: 'app-runtime-ai' }).generateText({
    messages: [{ role: 'user', content: [textPart('ordered')] }],
  });

  assert.equal(result.text, 'before after');
  assert.equal(result.reasoningSummary, 'summary');
  assert.deepEqual(result.outputItems?.map((item) => item.type), [
    'reasoning-summary', 'text', 'tool-call', 'reasoning-continuity', 'text',
  ]);
  assert.deepEqual(result.content?.map((item) => item.type), [
    'reasoning-summary', 'text', 'tool-call', 'reasoning-continuity', 'text',
  ]);
  assert.equal(result.toolCalls?.[0]?.id, 'call-ordered');
});

test('Runtime-backed Nimi AI fails closed on unknown sync finish reason', async () => {
  const client = new FakeScenarioClient();
  client.finishReason = 999 as FinishReason;
  await assert.rejects(
    () => createNimiRuntimeAIModel({ runtime: client, appId: 'app-runtime-ai' }).generateText({
      messages: [{ role: 'user', content: [textPart('unknown finish')] }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
  );
});

test('Runtime-backed Nimi AI validates opaque continuity identity and bounded bytes', async () => {
  for (const continuity of [
    { kind: '', version: 1, payload: new Uint8Array([1]) },
    { kind: 'native', version: 0, payload: new Uint8Array([1]) },
    { kind: 'native', version: 1, payload: new Uint8Array() },
    { kind: 'native', version: 1, payload: new Uint8Array(64 * 1024 + 1) },
  ]) {
    const client = new FakeScenarioClient();
    client.outputItems = [
      { item: { oneofKind: 'text', text: { text: 'answer' } } },
      { item: { oneofKind: 'reasoningContinuity', reasoningContinuity: continuity } },
    ];
    await assert.rejects(
      () => createNimiRuntimeAIModel({ runtime: client, appId: 'app-runtime-ai' }).generateText({
        messages: [{ role: 'user', content: [textPart('continuity')] }],
      }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    );
  }
});

test('Runtime-backed Nimi AI fails closed on malformed tool call arguments', async () => {
  const client = new FakeScenarioClient();
  client.toolCalls = [{ id: 'call-1', name: 'lookup', argumentsJson: '{"query":' }];
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
  });

  await assert.rejects(
    () => model.generateText({
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
  });

  await model.generateText({
    messages: [
      { role: 'user', content: [textPart('Weather in Paris?')] },
      {
        role: 'assistant',
        content: [],
        turnItems: [{
          type: 'output',
          output: { type: 'tool-call', toolCall: { id: 'call-1', name: 'weather', arguments: { city: 'Paris' } } },
        }],
      },
      {
        role: 'tool',
        content: [],
        turnItems: [{
          type: 'tool-result',
          toolResult: { toolCallId: 'call-1', toolName: 'weather', result: { temp: 18 } },
        }],
      },
    ],
    tools: [{ name: 'weather', inputSchema: { type: 'object' } }],
  });

  const spec = client.executeRequests[0]?.spec?.spec;
  if (spec?.oneofKind !== 'textGenerate') {
    throw new Error('expected textGenerate spec');
  }
  const assistant = spec.textGenerate.input.find((message) => message.role === 'assistant');
  assert.equal(assistant?.content, '');
  assert.deepEqual(assistant?.parts, []);
  const assistantOutput = assistant?.turnItems[0]?.item;
  assert.equal(assistantOutput?.oneofKind, 'output');
  const assistantToolCall = assistantOutput?.oneofKind === 'output'
    && assistantOutput.output.item.oneofKind === 'toolCall'
    ? assistantOutput.output.item.toolCall
    : undefined;
  assert.equal(assistantToolCall?.name, 'weather');
  assert.equal(assistantToolCall?.argumentsJson, '{"city":"Paris"}');
  const toolMessage = spec.textGenerate.input.find((message) => message.role === 'tool');
  const toolResult = toolMessage?.turnItems[0]?.item;
  assert.equal(toolResult?.oneofKind, 'toolResult');
  assert.equal(toolResult?.oneofKind === 'toolResult' ? toolResult.toolResult.toolCallId : '', 'call-1');
});

test('Runtime-backed Nimi AI rejects legacy approval and provider-executed workflow fields', async () => {
  const model = createNimiRuntimeAIModel({ runtime: new FakeScenarioClient(), appId: 'app-runtime-ai' });
  const messages = [
    {
      role: 'assistant' as const,
      content: [],
      toolCalls: [{ id: 'legacy', name: 'lookup', arguments: {} }],
    },
    {
      role: 'tool' as const,
      content: [],
      toolApprovalResponses: [{ approvalId: 'approval-1', approved: true }],
    },
    {
      role: 'assistant' as const,
      content: [],
      turnItems: [{
        type: 'output' as const,
        output: {
          type: 'tool-call' as const,
          toolCall: { id: 'provider-call', name: 'lookup', arguments: {}, providerExecuted: true },
        },
      }],
    },
  ];
  for (const message of messages) {
    await assert.rejects(
      () => model.generateText({ messages: [message] }),
      (error: unknown) => (
        (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED
      ),
    );
  }
});

test('Runtime-backed Nimi AI maps a streamed tool call into a run event', async () => {
  const client = new FakeScenarioClient();
  client.streamToolCall = { id: 'call-stream', name: 'weather', argumentsJson: '{"city":"Paris"}' };
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
  });

  const events = await model.streamText!({
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
  });

  await model.generateText({
    messages: [
      {
        role: 'user',
        content: [
          textPart('Describe these.'),
          filePart('image/jpeg', 'https://example.com/photo.jpg'),
          filePart('audio/wav', 'https://example.com/audio.wav'),
          filePart('video/mp4', 'https://example.com/video.mp4'),
          artifactRefPart({ localArtifactId: 'local-artifact-1', mediaType: 'image/png', displayName: 'image' }),
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

  assert.equal(parts[1]?.type, ChatContentPartType.IMAGE_URL);
  assert.equal(
    parts[1]?.content.oneofKind === 'imageUrl' ? parts[1].content.imageUrl.url : '',
    'https://example.com/photo.jpg',
  );

  assert.equal(parts[2]?.type, ChatContentPartType.AUDIO_URL);
  assert.equal(
    parts[2]?.content.oneofKind === 'audioUrl' ? parts[2].content.audioUrl : '',
    'https://example.com/audio.wav',
  );

  assert.equal(parts[3]?.type, ChatContentPartType.VIDEO_URL);
  assert.equal(
    parts[3]?.content.oneofKind === 'videoUrl' ? parts[3].content.videoUrl : '',
    'https://example.com/video.mp4',
  );
  assert.equal(parts[4]?.type, ChatContentPartType.ARTIFACT_REF);
  assert.equal(
    parts[4]?.content.oneofKind === 'artifactRef' ? parts[4].content.artifactRef.localArtifactId : '',
    'local-artifact-1',
  );
});

test('Runtime-backed Nimi AI accepts a file-only message with no text part', async () => {
  const client = new FakeScenarioClient();
  const model = createNimiRuntimeAIModel({
    runtime: client,
    appId: 'app-runtime-ai',
  });

  const result = await model.generateText({
    messages: [{ role: 'user', content: [filePart('image/png', 'https://example.com/image.png')] }],
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
  });

  await assert.rejects(
    () => model.generateText({
      messages: [{ role: 'user', content: [textPart('read this'), filePart('application/pdf', 'JVBER')] }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
  );
});

test('Runtime-backed Nimi AI rejects inline binary and data URI media', async () => {
  const model = createNimiRuntimeAIModel({ runtime: new FakeScenarioClient(), appId: 'app-runtime-ai' });
  for (const data of ['aW1n', 'data:image/png;base64,aW1n']) {
    await assert.rejects(
      () => model.generateText({ messages: [{ role: 'user', content: [filePart('image/png', data)] }] }),
      (error: unknown) => (
        (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED
      ),
    );
  }
});

test('Runtime-backed Nimi AI fails closed for subject identity and invalid input', async () => {
  const model = createNimiRuntimeAIModel({
    runtime: new FakeScenarioClient(),
    appId: 'app-runtime-ai',
  });

  // Subject identity must be supplied through Runtime client options, not request params.
  await assert.rejects(
    () => model.generateText({
      messages: [{ role: 'user', content: [textPart('Hi.')] }],
      parameters: { user: 'user-x' },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
  );

  await assert.rejects(
    () => model.generateText({
      model: { modelId: 'other-model' },
      messages: [{ role: 'user', content: [textPart('Mismatch.')] }],
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
  );

  await assert.rejects(
    () => model.generateText({
      messages: [{ role: 'user', content: [textPart('')] }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_INPUT_INVALID,
  );
});

test('Runtime-backed Nimi AI preserves OUTCOME_UNCERTAIN on restart, non-restart partial stream, and premature close', async () => {
  // 1) Cloud restart after dispatch emits OUTCOME_UNCERTAIN with retryable=false and billing notice.
  async function* restartUncertainStream(): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 7,
      sequence: '1',
      traceId: 'trace-cloud-restart-uncertain',
      payload: {
        oneofKind: 'failed',
        failed: {
          reasonCode: RuntimeProtoReasonCode.AI_EXECUTION_INTERRUPTED,
          actionHint: 'confirm_outcome_and_charges_before_new_request',
          interruption: {
            cause: ExecutionInterruptionCause.RUNTIME_RESTART,
            resubmitDisposition: ExecutionResubmitDisposition.OUTCOME_UNCERTAIN,
          },
        },
      },
    };
  }
  await assert.rejects(
    collectNimiTextStream(runtimeScenarioStreamToNimiEvents(restartUncertainStream(), { modelId: 'text.generate' })),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        message?: string;
        interruption?: { cause?: string; resubmitDisposition?: string };
      };
      assert.equal(shaped.reasonCode, ReasonCode.AI_EXECUTION_INTERRUPTED);
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_outcome_and_charges_before_new_request');
      assert.deepEqual(shaped.interruption, { cause: 'runtime-restart', resubmitDisposition: 'outcome-uncertain' });
      assert.match(String(shaped.message), /unknown/i);
      assert.match(String(shaped.message), /charges/i);
      return true;
    },
  );

  // 2) Runtime stays running and partial stream breaks -> actual reason + UNSPECIFIED + OUTCOME_UNCERTAIN.
  async function* partialBrokenStream(): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 2,
      sequence: '1',
      traceId: 'trace-partial-broken',
      payload: {
        oneofKind: 'delta',
        delta: {
          delta: {
            oneofKind: 'textOutputItem',
            textOutputItem: {
              itemIndex: 0,
              delta: { oneofKind: 'text', text: { text: 'partial' } },
              itemCompleted: false,
            },
          },
        },
      },
    };
    yield {
      eventType: 7,
      sequence: '2',
      traceId: 'trace-partial-broken',
      payload: {
        oneofKind: 'failed',
        failed: {
          reasonCode: RuntimeProtoReasonCode.AI_STREAM_BROKEN,
          actionHint: 'confirm_outcome_and_charges_before_new_request',
          interruption: {
            cause: ExecutionInterruptionCause.UNSPECIFIED,
            resubmitDisposition: ExecutionResubmitDisposition.OUTCOME_UNCERTAIN,
          },
        },
      },
    };
  }
  await assert.rejects(
    collectNimiTextStream(runtimeScenarioStreamToNimiEvents(partialBrokenStream(), { modelId: 'text.generate' })),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        interruption?: { cause?: string; resubmitDisposition?: string };
      };
      assert.equal(shaped.reasonCode, ReasonCode.AI_STREAM_BROKEN);
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_outcome_and_charges_before_new_request');
      assert.deepEqual(shaped.interruption, { cause: 'unspecified', resubmitDisposition: 'outcome-uncertain' });
      return true;
    },
  );

  // 3) Premature silent close without completed/failed emits OUTCOME_UNCERTAIN without inferring restart.
  async function* prematureCloseStream(): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 2,
      sequence: '1',
      traceId: 'trace-premature',
      payload: {
        oneofKind: 'delta',
        delta: {
          delta: {
            oneofKind: 'textOutputItem',
            textOutputItem: {
              itemIndex: 0,
              delta: { oneofKind: 'text', text: { text: 'halfway' } },
              itemCompleted: false,
            },
          },
        },
      },
    };
  }
  await assert.rejects(
    collectNimiTextStream(runtimeScenarioStreamToNimiEvents(prematureCloseStream(), { modelId: 'text.generate' })),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        message?: string;
        interruption?: { cause?: string; resubmitDisposition?: string };
      };
      assert.equal(shaped.reasonCode, 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_outcome_and_charges_before_new_request');
      assert.deepEqual(shaped.interruption, { cause: 'unspecified', resubmitDisposition: 'outcome-uncertain' });
      assert.match(String(shaped.message), /charges/i);
      return true;
    },
  );
});

test('Runtime-backed Nimi AI confirmed LOCAL premature close and cancel omit cloud billing without claiming definite stop', async () => {
  // 1) Confirmed LOCAL stream ending prematurely reports missing terminal outcome,
  //    retryable=false, NO cloud charges, and NO caller-may-resubmit claim.
  async function* localPrematureStream(): AsyncIterable<StreamScenarioEvent> {
    yield {
      eventType: 1,
      sequence: '1',
      traceId: 'trace-local-premature',
      payload: {
        oneofKind: 'started',
        started: {
          modelResolved: 'qwen3-local',
          routeDecision: RoutePolicy.LOCAL,
          voiceOutputMode: 0,
        },
      },
    };
    yield {
      eventType: 2,
      sequence: '2',
      traceId: 'trace-local-premature',
      payload: {
        oneofKind: 'delta',
        delta: {
          delta: {
            oneofKind: 'textOutputItem',
            textOutputItem: {
              itemIndex: 0,
              delta: { oneofKind: 'text', text: { text: 'local partial' } },
              itemCompleted: false,
            },
          },
        },
      },
    };
  }
  await assert.rejects(
    collectNimiTextStream(runtimeScenarioStreamToNimiEvents(localPrematureStream(), { modelId: 'text.generate' })),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        message?: string;
        interruption?: { cause?: string; resubmitDisposition?: string };
        details?: { route?: string; outcomeStatus?: string };
      };
      assert.equal(shaped.reasonCode, 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_local_execution_before_new_request');
      assert.equal(shaped.interruption, undefined);
      assert.equal(shaped.details?.route, 'local');
      assert.equal(shaped.details?.outcomeStatus, 'unknown');
      assert.doesNotMatch(String(shaped.message), /cloud|charges|bill/i);
      assert.match(String(shaped.message), /do not assume local execution has already stopped/i);
      return true;
    },
  );

  // 2) Confirmed LOCAL stream canceled after first chunk via public createNimiRuntimeAIModel.
  let streamCalls = 0;
  const controller = new AbortController();
  const cancelReason = new Error('User stopped local run');
  const localCancelModel = createNimiRuntimeAIModel({
    appId: 'app-local-cancel',
    runtime: {
      executeScenario: async () => { throw new Error('unused'); },
      async *streamScenario() {
        streamCalls++;
        yield {
          eventType: 1,
          sequence: '1',
          traceId: 'trace-local-cancel',
          payload: {
            oneofKind: 'started',
            started: { modelResolved: 'qwen3-local', routeDecision: RoutePolicy.LOCAL, voiceOutputMode: 0 },
          },
        };
        yield {
          eventType: 2,
          sequence: '2',
          traceId: 'trace-local-cancel',
          payload: {
            oneofKind: 'delta',
            delta: {
              delta: {
                oneofKind: 'textOutputItem',
                textOutputItem: {
                  itemIndex: 0,
                  delta: { oneofKind: 'text', text: { text: 'first' } },
                  itemCompleted: false,
                },
              },
            },
          },
        };
        controller.abort(cancelReason);
        throw cancelReason;
      },
    },
  });
  await assert.rejects(
    collectNimiTextStream(await localCancelModel.streamText!({
      messages: [{ role: 'user', content: [textPart('Local cancel.')] }],
      signal: controller.signal,
    })),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        message?: string;
        cause?: unknown;
        interruption?: unknown;
        details?: { route?: string; canceled?: boolean; cancelReason?: string };
      };
      assert.equal(shaped.reasonCode, 'OPERATION_ABORTED');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_local_execution_before_new_request');
      assert.equal(shaped.interruption, undefined);
      assert.equal(shaped.details?.route, 'local');
      assert.equal(shaped.details?.canceled, true);
      assert.equal(shaped.details?.cancelReason, 'User stopped local run');
      assert.equal(shaped.cause, cancelReason);
      assert.doesNotMatch(String(shaped.message), /cloud|charges|bill/i);
      return true;
    },
  );
  assert.equal(streamCalls, 1);
});

test('Runtime-backed Nimi AI distinguishes pre-dispatch cancel from post-dispatch Cloud/unknown cancel across sync and stream', async () => {
  // 1) Pre-dispatch cancel in both sync and stream -> 0 transport calls, no billing notice, no OUTCOME_UNCERTAIN.
  let syncCalls = 0;
  let streamCalls = 0;
  const preModel = createNimiRuntimeAIModel({
    appId: 'app-pre-cancel',
    runtime: {
      executeScenario: async () => { syncCalls++; throw new Error('must not dispatch'); },
      async *streamScenario() { streamCalls++; throw new Error('must not dispatch'); },
    },
  });
  const preAbort = new AbortController();
  const preReason = new Error('Aborted before dispatch');
  preAbort.abort(preReason);

  await assert.rejects(
    preModel.generateText({ messages: [{ role: 'user', content: [textPart('Sync pre-cancel')] }], signal: preAbort.signal }),
    (error: unknown) => {
      const shaped = error as { reasonCode?: string; retryable?: boolean; interruption?: unknown; message?: string; cause?: unknown };
      assert.equal(shaped.reasonCode, 'OPERATION_ABORTED');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.interruption, undefined);
      assert.equal(shaped.cause, preReason);
      assert.doesNotMatch(String(shaped.message), /charges|cloud/i);
      return true;
    },
  );
  await assert.rejects(
    collectNimiTextStream(await preModel.streamText!({
      messages: [{ role: 'user', content: [textPart('Stream pre-cancel')] }],
      signal: preAbort.signal,
    })),
    (error: unknown) => {
      const shaped = error as { reasonCode?: string; retryable?: boolean; interruption?: unknown; message?: string; cause?: unknown };
      assert.equal(shaped.reasonCode, 'OPERATION_ABORTED');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.interruption, undefined);
      assert.equal(shaped.cause, preReason);
      assert.doesNotMatch(String(shaped.message), /charges|cloud/i);
      return true;
    },
  );
  assert.equal(syncCalls, 0);
  assert.equal(streamCalls, 0);

  // 2) Post-dispatch Cloud stream cancel after first chunk -> preserves cancel cause AND OUTCOME_UNCERTAIN + billing notice.
  let cloudStreamCalls = 0;
  const cloudAbort = new AbortController();
  const cloudCancelReason = new Error('User canceled cloud stream');
  const cloudModel = createNimiRuntimeAIModel({
    appId: 'app-cloud-cancel',
    runtime: {
      executeScenario: async () => {
        cloudAbort.abort(cloudCancelReason);
        throw cloudCancelReason;
      },
      async *streamScenario() {
        cloudStreamCalls++;
        yield {
          eventType: 1,
          sequence: '1',
          traceId: 'trace-cloud-cancel',
          payload: {
            oneofKind: 'started',
            started: { modelResolved: 'gpt-5', routeDecision: RoutePolicy.CLOUD, voiceOutputMode: 0 },
          },
        };
        yield {
          eventType: 2,
          sequence: '2',
          traceId: 'trace-cloud-cancel',
          payload: {
            oneofKind: 'delta',
            delta: {
              delta: {
                oneofKind: 'textOutputItem',
                textOutputItem: {
                  itemIndex: 0,
                  delta: { oneofKind: 'text', text: { text: 'cloud first' } },
                  itemCompleted: false,
                },
              },
            },
          },
        };
        cloudAbort.abort(cloudCancelReason);
        throw cloudCancelReason;
      },
    },
  });
  await assert.rejects(
    collectNimiTextStream(await cloudModel.streamText!({
      messages: [{ role: 'user', content: [textPart('Cloud stream cancel')] }],
      signal: cloudAbort.signal,
    })),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        message?: string;
        cause?: unknown;
        interruption?: { cause?: string; resubmitDisposition?: string };
        details?: { route?: string; canceled?: boolean; cancelReason?: string };
      };
      assert.equal(shaped.reasonCode, 'OPERATION_ABORTED');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_outcome_and_charges_before_new_request');
      assert.deepEqual(shaped.interruption, { cause: 'unspecified', resubmitDisposition: 'outcome-uncertain' });
      assert.equal(shaped.details?.route, 'cloud');
      assert.equal(shaped.details?.canceled, true);
      assert.equal(shaped.details?.cancelReason, 'User canceled cloud stream');
      assert.equal(shaped.cause, cloudCancelReason);
      assert.match(String(shaped.message), /charges/i);
      return true;
    },
  );
  assert.equal(cloudStreamCalls, 1);

  // 3) Sync post-dispatch unknown-route cancel -> OUTCOME_UNCERTAIN + billing notice + cancel cause.
  const syncAbort = new AbortController();
  const syncReason = new Error('User canceled sync call');
  let unknownSyncCalls = 0;
  const syncModel = createNimiRuntimeAIModel({
    appId: 'app-sync-cancel',
    runtime: {
      executeScenario: async () => {
        unknownSyncCalls++;
        syncAbort.abort(syncReason);
        throw syncReason;
      },
      async *streamScenario() { throw new Error('unused'); },
    },
  });
  await assert.rejects(
    syncModel.generateText({ messages: [{ role: 'user', content: [textPart('Sync post cancel')] }], signal: syncAbort.signal }),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        message?: string;
        cause?: unknown;
        interruption?: { cause?: string; resubmitDisposition?: string };
      };
      assert.equal(shaped.reasonCode, 'OPERATION_ABORTED');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_outcome_and_charges_before_new_request');
      assert.deepEqual(shaped.interruption, { cause: 'unspecified', resubmitDisposition: 'outcome-uncertain' });
      assert.equal(shaped.cause, syncReason);
      assert.match(String(shaped.message), /charges/i);
      return true;
    },
  );
  assert.equal(unknownSyncCalls, 1);
});

test('Runtime-backed Nimi AI stream cleanup failure after emitted done and usage stays distinct from OUTCOME_UNCERTAIN and never triggers replay', async () => {
  const cleanupError = new Error('Underlying gRPC stream teardown failed');
  let streamCalls = 0;
  const model = createNimiRuntimeAIModel({
    appId: 'app-post-done-cleanup',
    runtime: {
      executeScenario: async () => { throw new Error('unused'); },
      streamScenario() {
        streamCalls += 1;
        const events = [
          {
            eventType: 1,
            sequence: '1',
            traceId: 'trace-done-cleanup',
            payload: {
              oneofKind: 'started' as const,
              started: { modelResolved: 'gpt-5', routeDecision: RoutePolicy.CLOUD, voiceOutputMode: 0 },
            },
          },
          {
            eventType: 2,
            sequence: '2',
            traceId: 'trace-done-cleanup',
            payload: {
              oneofKind: 'delta' as const,
              delta: {
                delta: {
                  oneofKind: 'textOutputItem' as const,
                  textOutputItem: {
                    itemIndex: 0,
                    delta: { oneofKind: 'text' as const, text: { text: 'Completed answer.' } },
                    itemCompleted: true,
                  },
                },
              },
            },
          },
          {
            eventType: 3,
            sequence: '3',
            traceId: 'trace-done-cleanup',
            payload: {
              oneofKind: 'usage' as const,
              usage: { inputTokens: '12', outputTokens: '8', computeMs: '45' },
            },
          },
          {
            eventType: 4,
            sequence: '4',
            traceId: 'trace-done-cleanup',
            payload: {
              oneofKind: 'completed' as const,
              completed: { finishReason: FinishReason.STOP },
            },
          },
        ];
        return {
          [Symbol.asyncIterator]() {
            let index = 0;
            return {
              async next() {
                if (index < events.length) {
                  return { value: events[index++]!, done: false as const };
                }
                return { value: undefined, done: true as const };
              },
              async return() {
                throw cleanupError;
              },
            };
          },
        };
      },
    },
  });

  const observed: unknown[] = [];
  await assert.rejects(async () => {
    for await (const event of await model.streamText!({
      messages: [{ role: 'user', content: [textPart('Complete then fail cleanup')] }],
    })) {
      observed.push(event);
    }
  }, (error: unknown) => {
    const shaped = error as {
      reasonCode?: string;
      actionHint?: string;
      retryable?: boolean;
      traceId?: string;
      message?: string;
      cause?: unknown;
      interruption?: unknown;
      details?: {
        phase?: string;
        terminalObserved?: boolean;
        terminalOutcome?: string;
        finishReason?: string;
        route?: string;
        usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      };
    };
    assert.equal(shaped.reasonCode, 'SDK_AI_STREAM_CLEANUP_FAILED');
    for (const manifestRelativePath of [
      '../../core-generated/error-codes.manifest.json',
      '../../../generators/shared/generated/error-codes.manifest.json',
    ]) {
      const manifest = JSON.parse(
        readFileSync(new URL(manifestRelativePath, import.meta.url), 'utf8'),
      ) as {
        values: string[];
        codes: Array<{ name: string; family: string; source_rule: string }>;
      };
      assert.ok(
        manifest.values.includes(shaped.reasonCode!),
        `${manifestRelativePath} values must include ${shaped.reasonCode}`,
      );
      assert.deepEqual(
        manifest.codes.find((entry) => entry.name === shaped.reasonCode),
        {
          name: 'SDK_AI_STREAM_CLEANUP_FAILED',
          family: 'SDK_AI',
          source_rule: 'S-ERROR-003',
        },
        `${manifestRelativePath} codes must classify ${shaped.reasonCode}`,
      );
    }
    assert.equal(shaped.retryable, false);
    assert.equal(shaped.traceId, 'trace-done-cleanup');
    assert.equal(shaped.actionHint, 'inspect_stream_cleanup_without_replaying_completed_request');
    assert.notEqual(shaped.actionHint, 'confirm_outcome_and_charges_before_new_request');
    assert.notEqual(shaped.actionHint, 'resubmit_request');
    assert.equal(shaped.interruption, undefined);
    assert.equal(shaped.cause, cleanupError);
    assert.doesNotMatch(String(shaped.message), /outcome is unknown|charges may already have accrued/i);
    assert.equal(shaped.details?.phase, 'stream-cleanup');
    assert.equal(shaped.details?.terminalObserved, true);
    assert.equal(shaped.details?.terminalOutcome, 'done');
    assert.equal(shaped.details?.finishReason, 'stop');
    assert.equal(shaped.details?.route, 'cloud');
    assert.deepEqual(shaped.details?.usage, { promptTokens: 12, completionTokens: 8, totalTokens: 20 });
    return true;
  });

  assert.equal(streamCalls, 1);
  // Caller observed the complete done event and usage, and no contradictory second error event was emitted.
  const doneEvents = observed.filter((event) => (event as { type?: string }).type === 'done');
  const errorEvents = observed.filter((event) => (event as { type?: string }).type === 'error');
  assert.equal(doneEvents.length, 1);
  assert.equal(errorEvents.length, 0);
  assert.deepEqual(doneEvents[0], {
    type: 'done',
    finishReason: 'stop',
    usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
  });
});
