import {
  ExecutionMode,
  ExecutionInterruptionCause,
  ExecutionResubmitDisposition,
  FinishReason,
  ReasoningActivation,
  ReasoningEffort,
  ReasoningPresentation,
  ResponseFormatKind,
  RoutePolicy,
  ScenarioType,
  type ExecuteScenarioRequest,
  type ExecuteScenarioResponse,
  type ExecutionInterruption,
  type ReasoningConfig,
  type ResponseFormat,
  type StreamScenarioEvent,
  type StreamScenarioRequest,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import {
  ReasonCode as RuntimeGeneratedReasonCode,
  TextBehaviorKind,
  ToolChoiceMode,
  type UsageStats,
} from '../../core-generated/runtime-protobuf/runtime/v1/common';
import type { LoadoutEffectiveInputIdentity } from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { withNimiRuntimeIdempotencyMetadata } from '../../runtime/scenario-jobs';
import { ReasonCode, createNimiClientId, createNimiError } from '../../types';
import type {
  NimiFinishReason,
  NimiAIExecutionAdmission,
  NimiExecutionInterruption,
  NimiJsonObject,
  NimiJsonValue,
  NimiRunEvent,
  NimiUsage,
} from '../contracts';
import type {
  NimiAiModel,
  NimiGenerateTextContent,
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
  NimiTextGenerationCapabilityRef,
} from './index';
import {
  toNimiRawChunk,
  toNimiRawChunks,
  toNimiReasoningContinuityCarrier,
  toNimiSource,
  toNimiSources,
  toNimiTextOutputItems,
  toNimiToolCall,
  toRuntimeMessages,
  toRuntimeStruct,
  toRuntimeTools,
} from './runtime-model-text-projection';

export type NimiRuntimeAIReasoningActivation = 'disabled' | 'adaptive' | 'required';
export type NimiRuntimeAIReasoningPresentation = 'hidden' | 'summary';
export type NimiRuntimeAIReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'maximum';

export type NimiRuntimeAIReasoningOptions =
  | {
      readonly activation?: 'disabled';
      readonly presentation?: 'hidden';
      readonly effort?: never;
      readonly exactBudgetTokens?: never;
    }
  | {
      readonly activation: 'adaptive' | 'required';
      readonly presentation?: NimiRuntimeAIReasoningPresentation;
      readonly effort: NimiRuntimeAIReasoningEffort;
      readonly exactBudgetTokens?: never;
    }
  | {
      readonly activation: 'adaptive' | 'required';
      readonly presentation?: NimiRuntimeAIReasoningPresentation;
      readonly effort?: never;
      readonly exactBudgetTokens: number;
    };

export interface NimiRuntimeAIScenarioClient {
  executeScenario(request: ExecuteScenarioRequest, options?: RuntimeTypedCallOptions): Promise<ExecuteScenarioResponse>;
  streamScenario(request: StreamScenarioRequest, options?: RuntimeTypedCallOptions): AsyncIterable<StreamScenarioEvent>;
}

export interface NimiRuntimeAIModelOptions {
  readonly runtime: { readonly ai: NimiRuntimeAIScenarioClient } | NimiRuntimeAIScenarioClient;
  readonly appId: string;
  readonly subjectUserId?: string;
  readonly getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
  readonly timeoutMs?: number;
  readonly metadata?: NimiJsonObject;
  readonly reasoning?: NimiRuntimeAIReasoningOptions;
}

const RUNTIME_TEXT_GENERATION_MODEL: NimiTextGenerationCapabilityRef = Object.freeze({
  modelId: 'text.generate',
});

// @nimi-authority: definition.nimi.sdks.feature-clients.ai-adapter-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r001
// @nimi-authority: rule.nimi.runtime.ai-provider.r081
// @nimi-authority: rule.nimi.runtime.ai-provider.r087
// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// @nimi-authority: rule.nimi.runtime.ai-provider.r119
// @nimi-authority: rule.nimi.runtime.ai-provider.r122
// @nimi-authority: rule.nimi.runtime.ai-provider.r123
export function createNimiRuntimeAIModel(options: NimiRuntimeAIModelOptions): NimiAiModel {
  const scenarioClient = getScenarioClient(options.runtime);
  const model = RUNTIME_TEXT_GENERATION_MODEL;
  const appId = requireText(options.appId, 'Runtime AI model requires appId', 'provide_runtime_ai_app_id');
  return {
    model,
    async generateText(request) {
      assertRuntimeSupportedTextRequest(request);
      const requestOptions = await runtimeModelOptionsWithSubject(options);
      const response = await scenarioClient.executeScenario(
        buildRuntimeTextScenarioRequest({
          request,
          options: requestOptions,
          appId,
          executionMode: ExecutionMode.SYNC,
        }),
        toRuntimeScenarioWriteCallOptions(request, options),
      );
      return toGenerateTextResult(response);
    },
    async *streamText(request) {
      assertRuntimeSupportedTextRequest(request);
      const requestOptions = await runtimeModelOptionsWithSubject(options);
      const stream = scenarioClient.streamScenario(
        buildRuntimeTextScenarioRequest({
          request,
          options: requestOptions,
          appId,
          executionMode: ExecutionMode.STREAM,
        }),
        toRuntimeScenarioWriteCallOptions(request, options),
      );
      yield* runtimeScenarioStreamToNimiEvents(stream, model);
    },
  };
}

async function runtimeModelOptionsWithSubject(
  options: NimiRuntimeAIModelOptions,
): Promise<NimiRuntimeAIModelOptions> {
  if (normalizeText(options.subjectUserId)) return options;
  const subjectUserId = normalizeText(await options.getSubjectUserId?.());
  return subjectUserId ? { ...options, subjectUserId } : options;
}

export function buildRuntimeTextScenarioRequest(input: {
  readonly request: NimiGenerateTextRequest;
  readonly options: NimiRuntimeAIModelOptions;
  readonly appId: string;
  readonly executionMode: ExecutionMode.SYNC | ExecutionMode.STREAM;
}): ExecuteScenarioRequest {
  const messages = toRuntimeMessages(input.request.messages);
  const systemPrompt = messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n\n');
  const conversation = messages.filter((message) => message.role !== 'system' && message.role !== 'developer');
  if (conversation.length === 0) {
    runtimeInputInvalid('Runtime text.generate requires at least one non-system input message');
  }
  return {
    head: {
      appId: input.appId,
      subjectUserId: normalizeText(input.options.subjectUserId),
      timeoutMs: Number(input.options.timeoutMs ?? 0),
    },
    scenarioType: ScenarioType.TEXT_GENERATE,
    executionMode: input.executionMode,
    spec: {
      spec: {
        oneofKind: 'textGenerate',
        textGenerate: {
          input: conversation,
          systemPrompt,
          tools: toRuntimeTools(input.request.tools),
          temperature: input.request.parameters?.temperature,
          topP: input.request.parameters?.topP,
          maxTokens: input.request.parameters?.maxTokens,
          reasoning: toRuntimeReasoningConfig(input.options.reasoning),
          toolChoice: toRuntimeToolChoiceMode(input.request.toolChoice),
          toolChoiceName: toRuntimeToolChoiceName(input.request.toolChoice),
          responseFormat: toRuntimeResponseFormat(input.request.responseFormat),
          topK: input.request.parameters?.topK,
          presencePenalty: input.request.parameters?.presencePenalty,
          frequencyPenalty: input.request.parameters?.frequencyPenalty,
          stop: toRuntimeStop(input.request.parameters?.stop),
          seed: input.request.parameters?.seed !== undefined ? String(input.request.parameters.seed) : undefined,
          includeRawChunks: input.request.parameters?.includeRawChunks ?? false,
        },
      },
    },
    extensions: [],
  };
}

export async function* runtimeScenarioStreamToNimiEvents(
  stream: AsyncIterable<StreamScenarioEvent>,
  model: NimiTextGenerationCapabilityRef,
): AsyncIterable<NimiRunEvent> {
  let started = false;
  let usage: NimiUsage | undefined;
  const outputItems = new Map<number, {
    readonly kind: 'text' | 'reasoning-summary' | 'tool-call' | 'reasoning-continuity';
    readonly completed: boolean;
    readonly hasContent: boolean;
  }>();
  const seenToolCallIds = new Set<string>();
  let nextItemIndex = 0;
  for await (const event of stream) {
    if (event.payload.oneofKind === 'started') {
      if (started) {
        runtimeStreamOutputInvalid('Runtime Scenario stream emitted started more than once');
      }
      started = true;
      yield {
        type: 'start',
        traceId: normalizeText(event.traceId) || undefined,
        model,
        admission: toNimiExecutionAdmission(event.payload.started.effectiveInputIdentity),
      };
      continue;
    }
    if (!started) {
      started = true;
      yield { type: 'start', model };
    }
    if (event.payload.oneofKind === 'delta') {
      const delta = event.payload.delta.delta;
      if (delta.oneofKind === 'textOutputItem') {
        const item = delta.textOutputItem;
        const itemDelta = item.delta;
        if (itemDelta.oneofKind === undefined) {
          const current = outputItems.get(item.itemIndex);
          if (!item.itemCompleted || !current || current.completed
            || (current.kind !== 'text' && current.kind !== 'reasoning-summary')) {
            runtimeStreamOutputInvalid('Runtime text output item used an invalid completion-only seal');
          }
          outputItems.set(item.itemIndex, { ...current, completed: true });
          continue;
        }
        const kind = itemDelta.oneofKind === 'text'
          ? 'text'
          : itemDelta.oneofKind === 'reasoningSummary'
            ? 'reasoning-summary'
            : itemDelta.oneofKind === 'toolCall'
              ? 'tool-call'
              : itemDelta.oneofKind === 'reasoningContinuity'
                ? 'reasoning-continuity'
                : runtimeStreamOutputInvalid('Runtime text output delta used an unknown typed item');
        admitRuntimeStreamOutputItem(outputItems, item.itemIndex, kind, nextItemIndex);
        if (!outputItems.has(item.itemIndex)) {
          nextItemIndex += 1;
        }
        const current = outputItems.get(item.itemIndex);
        const hasContent = current?.hasContent === true
          || itemDelta.oneofKind === 'text' && itemDelta.text.text.length > 0
          || itemDelta.oneofKind === 'reasoningSummary' && itemDelta.reasoningSummary.text.length > 0
          || itemDelta.oneofKind === 'toolCall'
          || itemDelta.oneofKind === 'reasoningContinuity';
        outputItems.set(item.itemIndex, { kind, completed: item.itemCompleted, hasContent });
        if (itemDelta.oneofKind === 'text') {
          yield {
            type: 'text-delta',
            text: itemDelta.text.text,
            itemIndex: item.itemIndex,
            itemCompleted: item.itemCompleted,
          };
        } else if (itemDelta.oneofKind === 'reasoningSummary') {
          yield {
            type: 'reasoning-summary-delta',
            text: itemDelta.reasoningSummary.text,
            itemIndex: item.itemIndex,
            itemCompleted: item.itemCompleted,
          };
        } else if (itemDelta.oneofKind === 'toolCall') {
          if (!item.itemCompleted) {
            runtimeStreamOutputInvalid('Runtime published an incomplete public ToolCall');
          }
          const toolCall = toNimiToolCall(itemDelta.toolCall);
          if (seenToolCallIds.has(toolCall.id)) {
            runtimeStreamOutputInvalid('Runtime text stream contained a duplicate ToolCall id');
          }
          seenToolCallIds.add(toolCall.id);
          yield {
            type: 'tool-call',
            toolCall,
            itemIndex: item.itemIndex,
            itemCompleted: true,
          };
        } else if (itemDelta.oneofKind === 'reasoningContinuity') {
          if (!item.itemCompleted) {
            runtimeStreamOutputInvalid('Runtime published an incomplete reasoning continuity carrier');
          }
          yield {
            type: 'reasoning-continuity',
            carrier: toNimiReasoningContinuityCarrier(itemDelta.reasoningContinuity),
            itemIndex: item.itemIndex,
            itemCompleted: true,
          };
        }
      } else if (delta.oneofKind === 'artifact') {
        runtimeStreamOutputInvalid('Runtime text.generate stream returned media output');
      } else if (delta.oneofKind === 'source') {
        yield toNimiSource(delta.source);
      } else if (delta.oneofKind === 'raw') {
        yield toNimiRawChunk(delta.raw);
      } else {
        runtimeStreamOutputInvalid('Runtime Scenario stream delta omitted its typed payload');
      }
      continue;
    }
    if (event.payload.oneofKind === 'usage') {
      usage = toNimiUsage(event.payload.usage);
      continue;
    }
    if (event.payload.oneofKind === 'completed') {
      for (const item of outputItems.values()) {
        if (!item.completed || !item.hasContent) {
          runtimeStreamOutputInvalid('Runtime text stream completed with an open or empty output item');
        }
      }
      if (![...outputItems.values()].some((item) => item.kind === 'tool-call' || item.kind === 'text')) {
        runtimeStreamOutputInvalid('Runtime text stream completed without final text or a complete ToolCall item');
      }
      yield {
        type: 'done',
        finishReason: toNimiFinishReason(event.payload.completed.finishReason),
        usage: usage ?? toNimiUsage(event.payload.completed.usage),
      };
      return;
    }
    if (event.payload.oneofKind === 'failed') {
      const interruption = toNimiExecutionInterruption(
        event.payload.failed.reasonCode,
        event.payload.failed.interruption,
      );
      yield {
        type: 'error',
        code: runtimeReasonCodeName(event.payload.failed.reasonCode),
        message: normalizeText(event.payload.failed.actionHint) || 'Runtime Scenario stream failed',
        ...(interruption ? { interruption } : {}),
      };
      return;
    }
    runtimeStreamOutputInvalid('Runtime Scenario stream event omitted its typed payload');
  }
}

function admitRuntimeStreamOutputItem(
  items: ReadonlyMap<number, { readonly kind: string; readonly completed: boolean; readonly hasContent: boolean }>,
  itemIndex: number,
  kind: 'text' | 'reasoning-summary' | 'tool-call' | 'reasoning-continuity',
  nextItemIndex: number,
): void {
  if (!Number.isSafeInteger(itemIndex) || itemIndex < 0) {
    runtimeStreamOutputInvalid('Runtime text output item index is invalid');
  }
  const current = items.get(itemIndex);
  if (!current) {
    if (itemIndex !== nextItemIndex) {
      runtimeStreamOutputInvalid('Runtime text output item indices are not in zero-based first-seen order');
    }
    return;
  }
  if (current.completed) {
    runtimeStreamOutputInvalid('Runtime text output item received a delta after completion');
  }
  if (current.kind !== kind || (kind !== 'text' && kind !== 'reasoning-summary')) {
    runtimeStreamOutputInvalid('Runtime text output item repeated with an illegal or conflicting kind');
  }
}

function toNimiExecutionInterruption(
  reasonCode: RuntimeGeneratedReasonCode,
  interruption: ExecutionInterruption | undefined,
): NimiExecutionInterruption | undefined {
  if (reasonCode !== RuntimeGeneratedReasonCode.AI_EXECUTION_INTERRUPTED) {
    if (interruption) {
      runtimeStreamOutputInvalid('Runtime stream attached interruption detail to a non-interruption failure');
    }
    return undefined;
  }
  if (interruption?.cause !== ExecutionInterruptionCause.RUNTIME_RESTART
    || interruption.resubmitDisposition !== ExecutionResubmitDisposition.CALLER_MAY_RESUBMIT) {
    runtimeStreamOutputInvalid('Runtime interruption failure omitted its typed restart/resubmit disposition');
  }
  return {
    cause: 'runtime-restart',
    resubmitDisposition: 'caller-may-resubmit',
  };
}

function toNimiExecutionAdmission(
  identity: LoadoutEffectiveInputIdentity | undefined,
): NimiAIExecutionAdmission | undefined {
  if (!identity) {
    return undefined;
  }
  if (!identity.implementation) {
    runtimeOutputInvalid('Runtime Local execution admission omitted its implementation identity');
  }
  return Object.freeze({
    loadoutId: requireRuntimeOutputText(identity.loadoutId, 'loadoutId'),
    capabilityContract: requireRuntimeOutputText(identity.capabilityContract, 'capabilityContract'),
    implementation: Object.freeze({
      implementationId: requireRuntimeOutputText(identity.implementation.implementationId, 'implementationId'),
      driverId: requireRuntimeOutputText(identity.implementation.driverId, 'driverId'),
      driverDialect: requireRuntimeOutputText(identity.implementation.driverDialect, 'driverDialect'),
    }),
    recipeId: requireRuntimeOutputText(identity.recipeId, 'recipeId'),
    recipeRevision: requireRuntimeOutputText(identity.recipeRevision, 'recipeRevision'),
    admittedFeatures: Object.freeze([...identity.admittedFeatures]),
    admittedTextBehaviors: Object.freeze(identity.admittedTextBehaviors.map(toNimiTextBehaviorKind)),
  });
}

function toNimiTextBehaviorKind(kind: TextBehaviorKind): NimiAIExecutionAdmission['admittedTextBehaviors'][number] {
  switch (kind) {
    case TextBehaviorKind.TOOL_USE: return 'tool-use';
    case TextBehaviorKind.REASONING: return 'reasoning';
    case TextBehaviorKind.STRUCTURED_OUTPUT: return 'structured-output';
    default: return runtimeOutputInvalid('Runtime text behavior admission kind is unspecified');
  }
}

function requireRuntimeOutputText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    runtimeOutputInvalid(`Runtime Local execution admission omitted ${field}`);
  }
  return normalized;
}

function runtimeReasonCodeName(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    const name = RuntimeGeneratedReasonCode[numeric as RuntimeGeneratedReasonCode];
    if (typeof name === 'string' && name.trim()) {
      return name;
    }
  }
  const normalized = normalizeText(value);
  return normalized || 'RUNTIME_SCENARIO_FAILED';
}

function toGenerateTextResult(response: ExecuteScenarioResponse): NimiGenerateTextResult {
  const textOutput = response.output?.output;
  if (textOutput?.oneofKind !== 'textGenerate') {
    throw createNimiError({
      message: 'Runtime Scenario response did not contain textGenerate output',
      code: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
      actionHint: 'check_runtime_text_scenario_output',
      source: 'sdk',
    });
  }
  const output = textOutput.textGenerate;
  const outputItems = toNimiTextOutputItems(output.items);
  const text = outputItems
    .filter((item): item is Extract<(typeof outputItems)[number], { readonly type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('');
  const reasoningSummary = outputItems
    .filter((item): item is Extract<(typeof outputItems)[number], { readonly type: 'reasoning-summary' }> => (
      item.type === 'reasoning-summary'
    ))
    .map((item) => item.text)
    .join('');
  const toolCalls = outputItems
    .filter((item): item is Extract<(typeof outputItems)[number], { readonly type: 'tool-call' }> => (
      item.type === 'tool-call'
    ))
    .map((item) => item.toolCall);
  if (!outputItems.some((item) => (item.type === 'text' && item.text.length > 0) || item.type === 'tool-call')) {
    runtimeOutputInvalid('Runtime text.generate output contained no final text or complete ToolCall item');
  }
  const sources = toNimiSources(output.sources);
  const rawChunks = toNimiRawChunks(output.rawChunks);
  const content: NimiGenerateTextContent[] = [
    ...outputItems,
    ...(sources ?? []),
    ...(rawChunks ?? []),
  ];
  return {
    text,
    finishReason: toNimiFinishReason(response.finishReason),
    usage: toNimiUsage(response.usage),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    outputItems,
    reasoningSummary: reasoningSummary || undefined,
    admission: toNimiExecutionAdmission(response.effectiveInputIdentity),
    sources,
    rawChunks,
    content: content.length > 0 ? content : undefined,
    raw: {
      traceId: response.traceId,
      modelResolved: response.modelResolved,
      routeDecision: routePolicyName(response.routeDecision),
      ignoredExtensions: response.ignoredExtensions.map((extension) => ({
        namespace: extension.namespace,
        reason: extension.reason,
      })),
    },
  };
}

function assertRuntimeSupportedTextRequest(request: NimiGenerateTextRequest): void {
  for (const field of ['model', 'modelId', 'route', 'routePolicy', 'connectorId', 'targetRef', 'fallbackPolicy']) {
    if (Object.hasOwn(request, field)) {
      unsupportedRuntimeAI(field, 'Runtime owns implementation selection');
    }
  }
  const parameters = request.parameters;
  if (parameters?.user !== undefined) {
    unsupportedRuntimeAI('parameters.user', 'subject identity must be supplied through Runtime AI client options');
  }
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type !== 'text' && part.type !== 'file' && part.type !== 'artifact-ref') {
        unsupportedRuntimeAI(
          'message.content.data',
          'Runtime-backed text model accepts text, media URL, and artifact-ref message parts only',
        );
      }
    }
  }
}

function toRuntimeToolChoiceMode(toolChoice: NimiGenerateTextRequest['toolChoice']): ToolChoiceMode {
  if (toolChoice === undefined) {
    return ToolChoiceMode.UNSPECIFIED;
  }
  if (toolChoice === 'none') {
    return ToolChoiceMode.NONE;
  }
  if (toolChoice === 'auto') {
    return ToolChoiceMode.AUTO;
  }
  if (toolChoice === 'required') {
    return ToolChoiceMode.REQUIRED;
  }
  return ToolChoiceMode.TOOL;
}

function toRuntimeToolChoiceName(toolChoice: NimiGenerateTextRequest['toolChoice']): string {
  if (toolChoice && typeof toolChoice === 'object' && toolChoice.type === 'tool') {
    return toolChoice.name;
  }
  return '';
}

function toRuntimeResponseFormat(
  responseFormat: NimiGenerateTextRequest['responseFormat'],
): ResponseFormat | undefined {
  if (!responseFormat || responseFormat.type === 'text') {
    return undefined;
  }
  if (responseFormat.type === 'json-object') {
    return {
      kind: ResponseFormatKind.JSON_OBJECT,
      schemaName: responseFormat.name ?? '',
      schemaDescription: responseFormat.description ?? '',
      strict: responseFormat.strict ?? false,
    };
  }
  return {
    kind: ResponseFormatKind.JSON_SCHEMA,
    jsonSchema: responseFormat.schema ? toRuntimeStruct(responseFormat.schema) : undefined,
    schemaName: responseFormat.name ?? '',
    schemaDescription: responseFormat.description ?? '',
    strict: responseFormat.strict ?? false,
  };
}

function toRuntimeStop(stop: string | readonly string[] | undefined): string[] {
  if (stop === undefined) {
    return [];
  }
  return Array.isArray(stop) ? [...stop] : [stop as string];
}

function toRuntimeReasoningConfig(reasoning: NimiRuntimeAIReasoningOptions | undefined): ReasoningConfig {
  const activation = reasoning?.activation ?? 'disabled';
  const presentation = reasoning?.presentation ?? 'hidden';
  if (activation === 'disabled') {
    if (presentation !== 'hidden' || reasoning?.effort !== undefined || reasoning?.exactBudgetTokens !== undefined) {
      runtimeInputInvalid('Disabled Runtime reasoning admits no intensity and must remain hidden');
    }
    return {
      activation: ReasoningActivation.DISABLED,
      intensity: { oneofKind: undefined },
      presentation: ReasoningPresentation.HIDDEN,
    };
  }
  const hasEffort = reasoning?.effort !== undefined;
  const hasExactBudget = reasoning?.exactBudgetTokens !== undefined;
  if (hasEffort === hasExactBudget) {
    runtimeInputInvalid('Adaptive or required Runtime reasoning requires exactly one effort or exactBudgetTokens intensity');
  }
  if (hasExactBudget) {
    const exactBudgetTokens = Number(reasoning.exactBudgetTokens);
    if (!Number.isSafeInteger(exactBudgetTokens) || exactBudgetTokens <= 0) {
      runtimeInputInvalid('Runtime reasoning exactBudgetTokens must be a positive safe integer');
    }
    return {
      activation: activation === 'adaptive' ? ReasoningActivation.ADAPTIVE : ReasoningActivation.REQUIRED,
      intensity: { oneofKind: 'exactBudgetTokens', exactBudgetTokens },
      presentation: presentation === 'summary' ? ReasoningPresentation.SUMMARY : ReasoningPresentation.HIDDEN,
    };
  }
  return {
    activation: activation === 'adaptive' ? ReasoningActivation.ADAPTIVE : ReasoningActivation.REQUIRED,
    intensity: { oneofKind: 'effort', effort: toRuntimeReasoningEffort(reasoning?.effort) },
    presentation: presentation === 'summary' ? ReasoningPresentation.SUMMARY : ReasoningPresentation.HIDDEN,
  };
}

function toRuntimeReasoningEffort(effort: NimiRuntimeAIReasoningEffort | undefined): ReasoningEffort {
  switch (effort) {
    case 'minimal': return ReasoningEffort.MINIMAL;
    case 'low': return ReasoningEffort.LOW;
    case 'medium': return ReasoningEffort.MEDIUM;
    case 'high': return ReasoningEffort.HIGH;
    case 'maximum': return ReasoningEffort.MAXIMUM;
    default: return runtimeInputInvalid('Runtime reasoning effort is invalid');
  }
}

function toRuntimeCallOptions(
  request: NimiGenerateTextRequest,
  options: NimiRuntimeAIModelOptions,
): RuntimeTypedCallOptions {
  return {
    metadata: mergeJsonObjects(options.metadata, request.parameters?.metadata),
    timeoutMs: Number(options.timeoutMs ?? 0) || undefined,
    signal: request.signal,
  };
}

function toRuntimeScenarioWriteCallOptions(
  request: NimiGenerateTextRequest,
  options: NimiRuntimeAIModelOptions,
): RuntimeTypedCallOptions {
  return withNimiRuntimeIdempotencyMetadata(
    toRuntimeCallOptions(request, options),
    createNimiClientId('runtime-ai'),
  );
}

function toNimiFinishReason(reason: FinishReason): NimiFinishReason {
  if (reason === FinishReason.STOP) return 'stop';
  if (reason === FinishReason.LENGTH) return 'length';
  if (reason === FinishReason.TOOL_CALL) return 'tool-calls';
  if (reason === FinishReason.CONTENT_FILTER) return 'content-filter';
  if (reason === FinishReason.ERROR) return 'error';
  return runtimeOutputInvalid('Runtime text Scenario used an unknown finish reason');
}

function toNimiUsage(usage: UsageStats | undefined): NimiUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = Number(usage.inputTokens || 0);
  const completionTokens = Number(usage.outputTokens || 0);
  const cachedInputTokens = Number(usage.cachedInputTokens || 0);
  const reasoningOutputTokens = Number(usage.reasoningOutputTokens || 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
    ...(reasoningOutputTokens > 0 ? { reasoningOutputTokens } : {}),
  };
}

function routePolicyName(routePolicy: RoutePolicy): string {
  if (routePolicy === RoutePolicy.LOCAL) return 'local';
  if (routePolicy === RoutePolicy.CLOUD) return 'cloud';
  return 'unspecified';
}

function getScenarioClient(
  runtime: { readonly ai: NimiRuntimeAIScenarioClient } | NimiRuntimeAIScenarioClient,
): NimiRuntimeAIScenarioClient {
  const candidate = 'ai' in runtime ? runtime.ai : runtime;
  if (typeof candidate.executeScenario !== 'function' || typeof candidate.streamScenario !== 'function') {
    throw createNimiError({
      message: 'Runtime-backed Nimi AI requires Runtime Scenario executeScenario and streamScenario methods',
      code: 'SDK_AI_RUNTIME_REQUIRED',
      reasonCode: 'SDK_AI_RUNTIME_REQUIRED',
      actionHint: 'provide_vnext_runtime_ai_module',
      source: 'sdk',
    });
  }
  return candidate;
}

function mergeJsonObjects(
  left: NimiJsonObject | undefined,
  right: NimiJsonObject | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(left ?? {})) {
    merged[key] = metadataValueToString(value);
  }
  for (const [key, value] of Object.entries(right ?? {})) {
    merged[key] = metadataValueToString(value);
  }
  return merged;
}

function metadataValueToString(value: NimiJsonValue): string {
  if (typeof value === 'string') {
    return value;
  }
  return stableJsonStringify(value);
}

function stableJsonStringify(value: NimiJsonValue): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: NimiJsonValue): NimiJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]),
    );
  }
  return value;
}

function unsupportedRuntimeAI(feature: string, detail: string): never {
  throw createNimiError({
    message: `Runtime-backed Nimi AI does not support ${feature}: ${detail}`,
    code: ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
    reasonCode: ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
    actionHint: 'use_agent_or_feature_layer_for_unsupported_ai_semantics',
    source: 'sdk',
    details: { feature },
  });
}

function runtimeInputInvalid(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_INPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'provide_valid_runtime_text_behavior',
    source: 'sdk',
  });
}

function runtimeOutputInvalid(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    actionHint: 'check_runtime_text_scenario_output',
    source: 'sdk',
  });
}

function runtimeStreamOutputInvalid(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    actionHint: 'check_runtime_text_stream_output',
    source: 'sdk',
  });
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message,
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint,
      source: 'sdk',
    });
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
