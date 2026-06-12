import {
  ExecutionMode,
  FallbackPolicy,
  RoutePolicy,
  ScenarioType,
  type ExecuteScenarioRequest,
  type ExecuteScenarioResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import type { UsageStats } from '../../core-generated/runtime-protobuf/runtime/v1/common';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { withNimiRuntimeIdempotencyMetadata } from '../../runtime/scenario-jobs';
import type { CoreMetadata } from '../../types';
import { ReasonCode, createNimiClientId, createNimiError } from '../../types';
import type { NimiJsonObject, NimiModelRef, NimiUsage } from '../contracts';

export type NimiRuntimeEmbeddingRoutePolicy = 'local' | 'cloud' | 'unspecified';

export interface NimiRuntimeEmbeddingScenarioClient {
  executeScenario(request: ExecuteScenarioRequest, options?: RuntimeTypedCallOptions): Promise<ExecuteScenarioResponse>;
}

export interface NimiRuntimeEmbeddingClientOptions {
  readonly runtime: { readonly ai: NimiRuntimeEmbeddingScenarioClient } | NimiRuntimeEmbeddingScenarioClient;
  readonly model: NimiModelRef;
  readonly appId: string;
  readonly routePolicy?: NimiRuntimeEmbeddingRoutePolicy;
  readonly connectorId?: string;
  readonly subjectUserId?: string;
  readonly timeoutMs?: number;
  readonly metadata?: NimiJsonObject;
}

export interface NimiEmbedTextRequest {
  readonly values: readonly string[];
  readonly metadata?: NimiJsonObject;
}

export interface NimiEmbedTextResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly usage?: NimiUsage;
  readonly raw: {
    readonly traceId: string;
    readonly modelResolved: string;
    readonly routeDecision: string;
    readonly ignoredExtensions: readonly { readonly namespace: string; readonly reason: string }[];
  };
}

export interface NimiRuntimeEmbeddingSurface {
  embedText(request: NimiEmbedTextRequest): Promise<NimiEmbedTextResult>;
}

export function createNimiRuntimeEmbeddingClient(
  options: NimiRuntimeEmbeddingClientOptions,
): NimiRuntimeEmbeddingSurface {
  const scenarioClient = getScenarioClient(options.runtime);
  const model = normalizeModelRef(options.model);
  const appId = requireText(options.appId, 'Runtime embedding client requires appId', 'provide_embedding_app_id');
  return {
    async embedText(request) {
      const values = normalizeEmbeddingInputs(request.values);
      const response = await scenarioClient.executeScenario(
        buildRuntimeTextEmbeddingRequest({ values, options, model, appId }),
        withNimiRuntimeIdempotencyMetadata({
          metadata: mergeMetadata(options.metadata, request.metadata),
          timeoutMs: Number(options.timeoutMs ?? 0) || undefined,
        }, createNimiClientId('runtime-embed')),
      );
      return toEmbedTextResult(response);
    },
  };
}

export function buildRuntimeTextEmbeddingRequest(input: {
  readonly values: readonly string[];
  readonly options: NimiRuntimeEmbeddingClientOptions;
  readonly model: NimiModelRef;
  readonly appId: string;
}): ExecuteScenarioRequest {
  return {
    head: {
      appId: input.appId,
      subjectUserId: normalizeText(input.options.subjectUserId),
      modelId: input.model.modelId,
      routePolicy: toRuntimeRoutePolicy(input.options.routePolicy),
      fallback: FallbackPolicy.DENY,
      timeoutMs: Number(input.options.timeoutMs ?? 0),
      connectorId: normalizeText(input.options.connectorId ?? input.model.providerId),
    },
    scenarioType: ScenarioType.TEXT_EMBED,
    executionMode: ExecutionMode.SYNC,
    spec: {
      spec: {
        oneofKind: 'textEmbed',
        textEmbed: {
          inputs: [...input.values],
        },
      },
    },
    extensions: [],
  };
}

function toEmbedTextResult(response: ExecuteScenarioResponse): NimiEmbedTextResult {
  const output = response.output?.output;
  if (output?.oneofKind !== 'textEmbed') {
    throw createNimiError({
      message: 'Runtime Scenario response did not contain textEmbed output',
      code: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
      actionHint: 'check_runtime_embedding_scenario_output',
      source: 'sdk',
    });
  }
  return {
    embeddings: output.textEmbed.vectors.map((row) => row.values.map((value) => Number(value))),
    usage: toNimiUsage(response.usage),
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

function getScenarioClient(
  runtime: NimiRuntimeEmbeddingClientOptions['runtime'],
): NimiRuntimeEmbeddingScenarioClient {
  if ('ai' in runtime) {
    return runtime.ai;
  }
  return runtime;
}

function normalizeModelRef(model: NimiModelRef): NimiModelRef {
  return {
    providerId: normalizeText(model.providerId),
    modelId: requireText(model.modelId, 'Runtime embedding client requires model.modelId', 'provide_embedding_model_id'),
  };
}

function normalizeEmbeddingInputs(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw createNimiError({
      message: 'Runtime embedding requires at least one input value',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'provide_embedding_values',
      source: 'sdk',
    });
  }
  const normalized = values.map(normalizeText);
  if (normalized.some((value) => !value)) {
    throw createNimiError({
      message: 'Runtime embedding input values must be non-empty strings',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'remove_empty_embedding_values',
      source: 'sdk',
    });
  }
  return normalized;
}

function toRuntimeRoutePolicy(policy: NimiRuntimeEmbeddingRoutePolicy | undefined): RoutePolicy {
  if (policy === 'local') return RoutePolicy.LOCAL;
  if (policy === 'cloud') return RoutePolicy.CLOUD;
  return RoutePolicy.UNSPECIFIED;
}

function routePolicyName(policy: RoutePolicy): string {
  if (policy === RoutePolicy.LOCAL) return 'local';
  if (policy === RoutePolicy.CLOUD) return 'cloud';
  return 'unspecified';
}

function toNimiUsage(usage: UsageStats | undefined): NimiUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    promptTokens: Number(usage.inputTokens || 0),
    completionTokens: Number(usage.outputTokens || 0),
    totalTokens: Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0),
  };
}

function mergeMetadata(...items: readonly (NimiJsonObject | undefined)[]): CoreMetadata | undefined {
  const merged: Record<string, string> = {};
  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [key, value] of Object.entries(item)) {
        const normalizedKey = normalizeText(key);
        if (normalizedKey && value !== undefined && value !== null) {
          merged[normalizedKey] = typeof value === 'string' ? value : JSON.stringify(value);
        }
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw createNimiError({
      message,
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint,
      source: 'sdk',
    });
  }
  return text;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
