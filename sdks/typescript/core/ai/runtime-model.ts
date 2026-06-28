import {
  ExecutionMode,
  FallbackPolicy,
  FinishReason,
  ReasoningMode,
  ReasoningTraceMode,
  ResponseFormatKind,
  RoutePolicy,
  ScenarioType,
  ToolChoiceMode,
  type ExecuteScenarioRequest,
  type ExecuteScenarioResponse,
  type ResponseFormat,
  type StreamScenarioEvent,
  type StreamScenarioRequest,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import { ReasonCode as RuntimeGeneratedReasonCode, type UsageStats } from '../../core-generated/runtime-protobuf/runtime/v1/common';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { withNimiRuntimeIdempotencyMetadata } from '../../runtime/scenario-jobs';
import { ReasonCode, createNimiClientId, createNimiError } from '../../types';
import type {
  NimiFinishReason,
  NimiJsonObject,
  NimiJsonValue,
  NimiModelRef,
  NimiRunEvent,
  NimiUsage,
} from '../contracts';
import type { NimiAIConfigTargetRef } from './config-types';
import type { NimiAiModel, NimiGenerateTextContent, NimiGenerateTextRequest, NimiGenerateTextResult } from './index';
import { toRuntimeDurableTargetRef } from './runtime-target-ref';
import {
  toNimiRawChunk,
  toNimiRawChunks,
  toNimiSource,
  toNimiSources,
  toNimiToolApprovalRequest,
  toNimiToolApprovalRequests,
  toNimiToolCall,
  toNimiToolCalls,
  toNimiToolResult,
  toNimiToolResults,
  toRuntimeMessages,
  toRuntimeStruct,
  toRuntimeTools,
} from './runtime-model-text-projection';

export type NimiRuntimeAIRoutePolicy = 'local' | 'cloud' | 'unspecified';
export type NimiRuntimeAIReasoningMode = 'off' | 'on';
export type NimiRuntimeAIReasoningTraceMode = 'hide' | 'separate';

export interface NimiRuntimeAIReasoningOptions {
  readonly mode?: NimiRuntimeAIReasoningMode;
  readonly traceMode?: NimiRuntimeAIReasoningTraceMode;
  readonly budgetTokens?: number;
}

export interface NimiRuntimeAIScenarioClient {
  executeScenario(request: ExecuteScenarioRequest, options?: RuntimeTypedCallOptions): Promise<ExecuteScenarioResponse>;
  streamScenario(request: StreamScenarioRequest, options?: RuntimeTypedCallOptions): AsyncIterable<StreamScenarioEvent>;
}

export interface NimiRuntimeAIModelOptions {
  readonly runtime: { readonly ai: NimiRuntimeAIScenarioClient } | NimiRuntimeAIScenarioClient;
  readonly model: NimiModelRef;
  readonly appId: string;
  readonly routePolicy?: NimiRuntimeAIRoutePolicy;
  readonly connectorId?: string;
  readonly subjectUserId?: string;
  readonly timeoutMs?: number;
  readonly metadata?: NimiJsonObject;
  readonly reasoning?: NimiRuntimeAIReasoningOptions;
  readonly targetRef?: NimiAIConfigTargetRef;
}

export function createNimiRuntimeAIModel(options: NimiRuntimeAIModelOptions): NimiAiModel {
  const scenarioClient = getScenarioClient(options.runtime);
  const model = normalizeModelRef(options.model);
  const appId = requireText(options.appId, 'Runtime AI model requires appId', 'provide_runtime_ai_app_id');
  return {
    model,
    async generateText(request) {
      assertRuntimeSupportedTextRequest(request);
      assertRequestModelMatches(request.model, model);
      const response = await scenarioClient.executeScenario(
        buildRuntimeTextScenarioRequest({
          request,
          options,
          model,
          appId,
          executionMode: ExecutionMode.SYNC,
        }),
        toRuntimeScenarioWriteCallOptions(request, options),
      );
      return toGenerateTextResult(response);
    },
    async *streamText(request) {
      assertRuntimeSupportedTextRequest(request);
      assertRequestModelMatches(request.model, model);
      const stream = scenarioClient.streamScenario(
        buildRuntimeTextScenarioRequest({
          request,
          options,
          model,
          appId,
          executionMode: ExecutionMode.STREAM,
        }),
        toRuntimeScenarioWriteCallOptions(request, options),
      );
      yield* runtimeScenarioStreamToNimiEvents(stream, model);
    },
  };
}

export function buildRuntimeTextScenarioRequest(input: {
  readonly request: NimiGenerateTextRequest;
  readonly options: NimiRuntimeAIModelOptions;
  readonly model: NimiModelRef;
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
  return {
    head: {
      appId: input.appId,
      subjectUserId: normalizeText(input.options.subjectUserId),
      modelId: input.model.modelId,
      routePolicy: toRuntimeRoutePolicy(input.options.routePolicy),
      fallback: FallbackPolicy.DENY,
      timeoutMs: Number(input.options.timeoutMs ?? 0),
      connectorId: normalizeText(input.options.connectorId ?? input.model.providerId),
      targetRef: toRuntimeDurableTargetRef(input.options.targetRef),
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
          temperature: Number(input.request.parameters?.temperature ?? 0),
          topP: Number(input.request.parameters?.topP ?? 0),
          maxTokens: Number(input.request.parameters?.maxTokens ?? 0),
          reasoning: toRuntimeReasoningConfig(input.options.reasoning),
          toolChoice: toRuntimeToolChoiceMode(input.request.toolChoice),
          toolChoiceName: toRuntimeToolChoiceName(input.request.toolChoice),
          responseFormat: toRuntimeResponseFormat(input.request.responseFormat),
          topK: Number(input.request.parameters?.topK ?? 0),
          presencePenalty: Number(input.request.parameters?.presencePenalty ?? 0),
          frequencyPenalty: Number(input.request.parameters?.frequencyPenalty ?? 0),
          stop: toRuntimeStop(input.request.parameters?.stop),
          seed: input.request.parameters?.seed !== undefined ? String(input.request.parameters.seed) : '0',
          includeRawChunks: input.request.parameters?.includeRawChunks ?? false,
        },
      },
    },
    extensions: [],
  };
}

export async function* runtimeScenarioStreamToNimiEvents(
  stream: AsyncIterable<StreamScenarioEvent>,
  model: NimiModelRef,
): AsyncIterable<NimiRunEvent> {
  let started = false;
  let usage: NimiUsage | undefined;
  for await (const event of stream) {
    if (event.payload.oneofKind === 'started') {
      started = true;
      yield {
        type: 'start',
        traceId: normalizeText(event.traceId) || undefined,
        model: {
          ...model,
          modelId: normalizeText(event.payload.started.modelResolved) || model.modelId,
        },
      };
      continue;
    }
    if (!started) {
      started = true;
      yield { type: 'start', model };
    }
    if (event.payload.oneofKind === 'delta') {
      const delta = event.payload.delta.delta;
      if (delta.oneofKind === 'text' && delta.text.text) {
        yield { type: 'text-delta', text: delta.text.text };
      } else if (delta.oneofKind === 'reasoning' && delta.reasoning.text) {
        yield { type: 'reasoning-delta', text: delta.reasoning.text };
      } else if (delta.oneofKind === 'artifact') {
        yield {
          type: 'artifact',
          chunk: delta.artifact.chunk,
          mimeType: requireRuntimeArtifactMimeType(delta.artifact.mimeType),
        };
      } else if (delta.oneofKind === 'source') {
        yield toNimiSource(delta.source);
      } else if (delta.oneofKind === 'raw') {
        yield toNimiRawChunk(delta.raw);
      }
      continue;
    }
    if (event.payload.oneofKind === 'usage') {
      usage = toNimiUsage(event.payload.usage);
      continue;
    }
    if (event.payload.oneofKind === 'toolCall') {
      yield { type: 'tool-call', toolCall: toNimiToolCall(event.payload.toolCall) };
      continue;
    }
    if (event.payload.oneofKind === 'toolResult') {
      yield { type: 'tool-result', toolResult: toNimiToolResult(event.payload.toolResult) };
      continue;
    }
    if (event.payload.oneofKind === 'toolApprovalRequest') {
      yield {
        type: 'tool-approval-request',
        toolApprovalRequest: toNimiToolApprovalRequest(event.payload.toolApprovalRequest),
      };
      continue;
    }
    if (event.payload.oneofKind === 'completed') {
      yield {
        type: 'done',
        finishReason: toNimiFinishReason(event.payload.completed.finishReason),
        usage: usage ?? toNimiUsage(event.payload.completed.usage),
      };
      continue;
    }
    if (event.payload.oneofKind === 'failed') {
      yield {
        type: 'error',
        code: runtimeReasonCodeName(event.payload.failed.reasonCode),
        message: normalizeText(event.payload.failed.actionHint) || 'Runtime Scenario stream failed',
      };
    }
  }
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

function requireRuntimeArtifactMimeType(value: string): string {
  const mimeType = normalizeText(value);
  if (!mimeType) {
    throw createNimiError({
      message: 'Runtime Scenario artifact delta did not include mimeType',
      code: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
      actionHint: 'check_runtime_artifact_mime_type',
      source: 'sdk',
    });
  }
  return mimeType;
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
  const toolCalls = toNimiToolCalls(output.toolCalls);
  const toolResults = toNimiToolResults(output.toolResults);
  const toolApprovalRequests = toNimiToolApprovalRequests(output.toolApprovalRequests);
  const sources = toNimiSources(output.sources);
  const rawChunks = toNimiRawChunks(output.rawChunks);
  const content: NimiGenerateTextContent[] = [
    ...(output.text ? [{ type: 'text' as const, text: output.text }] : []),
    ...(sources ?? []),
    ...(toolCalls ?? []).map((toolCall) => ({ type: 'tool-call' as const, toolCall })),
    ...(toolResults ?? []).map((toolResult) => ({ type: 'tool-result' as const, toolResult })),
    ...(toolApprovalRequests ?? []).map((toolApprovalRequest) => ({
      type: 'tool-approval-request' as const,
      toolApprovalRequest,
    })),
    ...(rawChunks ?? []),
  ];
  return {
    text: output.text,
    finishReason: toNimiFinishReason(response.finishReason),
    usage: toNimiUsage(response.usage),
    toolCalls,
    toolResults,
    toolApprovalRequests,
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
  const parameters = request.parameters;
  if (parameters?.user !== undefined) {
    unsupportedRuntimeAI('parameters.user', 'subject identity must be supplied through Runtime AI model options');
  }
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type !== 'text' && part.type !== 'file') {
        unsupportedRuntimeAI('message.content.data', 'Runtime-backed text model accepts text and file message parts only');
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

function toRuntimeReasoningConfig(reasoning: NimiRuntimeAIReasoningOptions | undefined) {
  return {
    mode: reasoning?.mode === 'on' ? ReasoningMode.ON : reasoning?.mode === 'off' ? ReasoningMode.OFF : ReasoningMode.UNSPECIFIED,
    traceMode: reasoning?.traceMode === 'separate'
      ? ReasoningTraceMode.SEPARATE
      : reasoning?.traceMode === 'hide'
        ? ReasoningTraceMode.HIDE
        : ReasoningTraceMode.UNSPECIFIED,
    budgetTokens: Number(reasoning?.budgetTokens ?? 0),
  };
}

function toRuntimeRoutePolicy(routePolicy: NimiRuntimeAIRoutePolicy | undefined): RoutePolicy {
  if (routePolicy === 'local') return RoutePolicy.LOCAL;
  if (routePolicy === 'cloud') return RoutePolicy.CLOUD;
  return RoutePolicy.UNSPECIFIED;
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
  return 'unknown';
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

function normalizeModelRef(model: NimiModelRef): NimiModelRef {
  const modelId = requireText(model.modelId, 'Runtime AI model requires model.modelId', 'provide_model_id');
  return {
    ...model,
    modelId,
    providerId: normalizeText(model.providerId) || undefined,
  };
}

function assertRequestModelMatches(requestModel: NimiModelRef, boundModel: NimiModelRef): void {
  if (normalizeText(requestModel.modelId) !== boundModel.modelId) {
    throw createNimiError({
      message: 'Runtime-backed Nimi AI request.model must match the bound model',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'call_generate_or_stream_with_model_returned_by_createNimiRuntimeAIModel',
      source: 'sdk',
    });
  }
  const requestProvider = normalizeText(requestModel.providerId);
  if (requestProvider && boundModel.providerId && requestProvider !== boundModel.providerId) {
    throw createNimiError({
      message: 'Runtime-backed Nimi AI request.model providerId must match the bound model providerId',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'call_generate_or_stream_with_model_returned_by_createNimiRuntimeAIModel',
      source: 'sdk',
    });
  }
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
