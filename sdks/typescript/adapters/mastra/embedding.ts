import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
} from '@ai-sdk/provider';
import {
  createNimiRuntimeEmbeddingClient,
  type NimiEmbedTextResult,
  type NimiRuntimeEmbeddingClientOptions,
  type NimiRuntimeEmbeddingSurface,
} from '@nimiplatform/sdk/ai';
import type { NimiJsonObject, NimiJsonValue, NimiModelRef } from '@nimiplatform/sdk/contracts';

import { throwUnsupportedMastraFeature } from './errors';

export type NimiMastraEmbeddingModel = EmbeddingModelV3;

export interface NimiMastraEmbeddingModelOptions {
  readonly model: NimiModelRef;
  readonly embedding?: NimiRuntimeEmbeddingSurface;
  readonly runtime?: NimiRuntimeEmbeddingClientOptions['runtime'];
  readonly appId?: string;
  readonly routePolicy?: NimiRuntimeEmbeddingClientOptions['routePolicy'];
  readonly connectorId?: string;
  readonly subjectUserId?: string;
  readonly timeoutMs?: number;
  readonly metadata?: NimiJsonObject;
  readonly maxEmbeddingsPerCall?: number;
  readonly supportsParallelCalls?: boolean;
}

export function createNimiMastraEmbeddingModel(
  options: NimiMastraEmbeddingModelOptions,
): NimiMastraEmbeddingModel {
  const model = normalizeModelRef(options.model);
  const embedding = resolveEmbeddingSurface(options, model);
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId: model.modelId,
    maxEmbeddingsPerCall: options.maxEmbeddingsPerCall ?? Infinity,
    supportsParallelCalls: options.supportsParallelCalls ?? true,
    async doEmbed(callOptions) {
      throwIfAborted(callOptions.abortSignal);
      const result = await embedding.embedText({
        values: callOptions.values,
        metadata: buildEmbeddingMetadata(options.metadata, callOptions),
      });
      throwIfAborted(callOptions.abortSignal);
      return toMastraEmbeddingResult(result);
    },
  };
}

function resolveEmbeddingSurface(
  options: NimiMastraEmbeddingModelOptions,
  model: NimiModelRef,
): NimiRuntimeEmbeddingSurface {
  if (options.embedding) {
    return options.embedding;
  }
  if (!options.runtime) {
    throwUnsupportedMastraFeature('embeddingModel.config', 'runtime or embedding surface is required');
  }
  const appId = normalizeText(options.appId);
  if (!appId) {
    throwUnsupportedMastraFeature('embeddingModel.config', 'appId is required for Runtime-routed embedding');
  }
  return createNimiRuntimeEmbeddingClient({
    runtime: options.runtime,
    model,
    appId,
    routePolicy: options.routePolicy,
    connectorId: options.connectorId,
    subjectUserId: options.subjectUserId,
    timeoutMs: options.timeoutMs,
    metadata: options.metadata,
  });
}

function toMastraEmbeddingResult(result: NimiEmbedTextResult): EmbeddingModelV3Result {
  const tokens = Number(result.usage?.promptTokens ?? result.usage?.totalTokens ?? 0);
  return {
    embeddings: result.embeddings.map((embedding) => [...embedding]),
    ...(tokens > 0 ? { usage: { tokens } } : {}),
    providerMetadata: {
      nimi: {
        traceId: result.raw.traceId,
        modelResolved: result.raw.modelResolved,
        routeDecision: result.raw.routeDecision,
        ignoredExtensions: result.raw.ignoredExtensions.map((extension) => ({
          namespace: extension.namespace,
          reason: extension.reason,
        })),
      },
    } satisfies SharedV3ProviderMetadata,
    warnings: [],
  };
}

function buildEmbeddingMetadata(
  metadata: NimiJsonObject | undefined,
  callOptions: EmbeddingModelV3CallOptions,
): NimiJsonObject | undefined {
  const merged: Record<string, NimiJsonValue> = {
    ...(metadata ?? {}),
  };
  const providerOptions = toNimiJsonObject(callOptions.providerOptions);
  if (providerOptions) {
    merged.providerOptions = providerOptions;
  }
  const headers = toNimiJsonObject(callOptions.headers);
  if (headers) {
    merged.headers = headers;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeModelRef(model: NimiModelRef): NimiModelRef {
  const modelId = normalizeText(model?.modelId);
  if (!modelId) {
    throwUnsupportedMastraFeature('embeddingModel.config', 'model.modelId is required');
  }
  return {
    modelId,
    providerId: normalizeText(model?.providerId),
  };
}

function toNimiJsonObject(value: SharedV3ProviderOptions | Record<string, string> | undefined): NimiJsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const normalized: Record<string, NimiJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey || item === undefined || item === null) {
      continue;
    }
    normalized[normalizedKey] = isNimiJsonValue(item) ? item : JSON.stringify(item);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isNimiJsonValue(value: unknown): value is NimiJsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) {
    return value.every(isNimiJsonValue);
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((item) => item === undefined || isNimiJsonValue(item));
  }
  return false;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error('Mastra embedding call was aborted.');
  error.name = 'AbortError';
  throw error;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
