import assert from 'node:assert/strict';
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
  assert.equal(absent.textGenerate.reasoning?.activation, ReasoningActivation.DISABLED);
  assert.equal(absent.textGenerate.reasoning?.presentation, ReasoningPresentation.HIDDEN);
  assert.equal(absent.textGenerate.reasoning?.intensity.oneofKind, undefined);
});

test('Runtime-backed Nimi AI maps effort intensity and rejects invalid reasoning algebra', async () => {
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
