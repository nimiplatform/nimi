import type {
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
} from '@ai-sdk/provider';
import {
  asNimiError,
  createNimiError,
  Runtime,
  type RuntimeCallOptions,
  type RuntimeStreamCallOptions,
} from '../runtime/index.js';
import { Struct } from '../runtime/generated/google/protobuf/struct.js';
import { ReasonCode, type AiFallbackPolicy, type AiRoutePolicy } from '../types/index.js';
import {
  FALLBACK_POLICY_ALLOW,
  FALLBACK_POLICY_DENY,
  MEDIA_JOB_STATUS_CANCELED,
  MEDIA_JOB_STATUS_COMPLETED,
  MEDIA_JOB_STATUS_FAILED,
  MEDIA_JOB_STATUS_TIMEOUT,
  ROUTE_POLICY_LOCAL_RUNTIME,
  ROUTE_POLICY_TOKEN_API,
  type NimiAiProviderConfig,
  type NimiArtifact,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

export function parseCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return undefined;
}

export function resolveRoutePolicy(value: AiRoutePolicy | undefined): number {
  return value === 'token-api'
    ? ROUTE_POLICY_TOKEN_API
    : ROUTE_POLICY_LOCAL_RUNTIME;
}

export function resolveFallbackPolicy(value: AiFallbackPolicy | undefined): number {
  return value === 'allow'
    ? FALLBACK_POLICY_ALLOW
    : FALLBACK_POLICY_DENY;
}

export function fromRouteDecision(value: unknown): AiRoutePolicy {
  return Number(value) === ROUTE_POLICY_TOKEN_API ? 'token-api' : 'local-runtime';
}

export function toProviderMetadata(input: {
  traceId?: string;
  routeDecision?: unknown;
  modelResolved?: string;
}): SharedV3ProviderMetadata {
  return {
    nimi: {
      traceId: normalizeText(input.traceId) || undefined,
      routeDecision: fromRouteDecision(input.routeDecision),
      modelResolved: normalizeText(input.modelResolved) || undefined,
    },
  };
}

export function toUsage(value: unknown): LanguageModelV3Usage {
  const usage = (value && typeof value === 'object')
    ? value as { inputTokens?: unknown; outputTokens?: unknown }
    : {};
  const inputTokens = parseCount(usage.inputTokens);
  const outputTokens = parseCount(usage.outputTokens);
  return {
    inputTokens: {
      total: inputTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: undefined,
    },
  };
}

export function toFinishReason(value: unknown): LanguageModelV3FinishReason {
  const reason = Number(value);
  switch (reason) {
    case 1:
      return { unified: 'stop', raw: 'STOP' };
    case 2:
      return { unified: 'length', raw: 'LENGTH' };
    case 3:
      return { unified: 'tool-calls', raw: 'TOOL_CALL' };
    case 4:
      return { unified: 'content-filter', raw: 'CONTENT_FILTER' };
    case 5:
      return { unified: 'error', raw: 'ERROR' };
    default:
      return { unified: 'other', raw: undefined };
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function extractTextValue(part: unknown): string {
  const record = asRecord(part);
  if (record.type === 'text') {
    return normalizeText(record.text);
  }
  if (record.type === 'reasoning') {
    return normalizeText(record.text);
  }
  if (record.type === 'tool-result') {
    return normalizeText(JSON.stringify(record.result || null));
  }
  return '';
}

export function toRuntimePrompt(prompt: LanguageModelV3Prompt): {
  systemPrompt: string;
  input: Array<{
    role: string;
    content: string;
    name: string;
  }>;
} {
  const system: string[] = [];
  const input: Array<{
    role: string;
    content: string;
    name: string;
  }> = [];

  for (const message of prompt) {
    if (message.role === 'system') {
      const text = normalizeText(message.content);
      if (text) {
        system.push(text);
      }
      continue;
    }

    const content = Array.isArray(message.content)
      ? message.content.map(extractTextValue).filter((text: string) => text.length > 0).join('\n')
      : '';
    if (!content) {
      continue;
    }

    input.push({
      role: message.role,
      content,
      name: '',
    });
  }

  return {
    systemPrompt: system.join('\n\n'),
    input,
  };
}

export function extractGenerateText(output: unknown): string {
  const fields = asRecord(asRecord(output).fields);
  const text = asRecord(fields.text);
  const kind = asRecord(text.kind);

  if (kind.oneofKind === 'stringValue') {
    return normalizeText(kind.stringValue);
  }
  if (typeof text.stringValue === 'string') {
    return normalizeText(text.stringValue);
  }
  return '';
}

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function toBase64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64');
  }
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    output += String.fromCharCode(value[index] || 0);
  }
  if (typeof btoa === 'function') {
    return btoa(output);
  }
  throw createNimiError({
    message: 'base64 encoder unavailable',
    reasonCode: ReasonCode.SDK_AI_PROVIDER_BASE64_UNAVAILABLE,
    actionHint: 'use_node_or_tauri_runtime',
    source: 'sdk',
  });
}

export function toUtf8(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('utf8');
  }
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(value);
  }
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    output += String.fromCharCode(value[index] || 0);
  }
  return output;
}

export function toProtoStruct(input: Record<string, unknown> | undefined): any {
  if (!input || Object.keys(input).length === 0) {
    return undefined;
  }
  try {
    return Struct.fromJson(input as never);
  } catch {
    return undefined;
  }
}

export function toLabels(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      continue;
    }
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      continue;
    }
    labels[normalizedKey] = normalizedValue;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type MediaJobExecution = {
  artifacts: NimiArtifact[];
  traceId: string;
  routeDecision: AiRoutePolicy;
  modelResolved: string;
};

export async function executeMediaJob(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  request: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<MediaJobExecution> {
  const submitResponse = await runtime.ai.submitMediaJob(
    request as never,
    toCallOptions(defaults, {
      timeoutMs,
      metadata: undefined,
    }),
  );
  const initialJob = asRecord(submitResponse.job);
  const jobId = ensureText(initialJob.jobId, 'jobId');
  const startedAt = Date.now();
  const maxWaitMs = timeoutMs > 0 ? timeoutMs : 120000;
  let cancelIssued = false;
  const cancelRemoteJob = async (reason: string) => {
    if (cancelIssued) {
      return;
    }
    cancelIssued = true;
    try {
      await runtime.ai.cancelMediaJob(
        {
          jobId,
          reason,
        } as never,
        toCallOptions(defaults, { timeoutMs }),
      );
    } catch {
      // ignore cancel errors and preserve original failure reason
    }
  };

  while (true) {
    if (signal?.aborted) {
      await cancelRemoteJob('aborted_by_abort_signal');
      throw createNimiError({
        message: 'media job aborted',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_media_job_request',
        source: 'sdk',
      });
    }

    const jobResponse = await runtime.ai.getMediaJob(
      { jobId } as never,
      toCallOptions(defaults, { timeoutMs }),
    );
    const job = asRecord(jobResponse.job);
    const status = Number(job.status || 0);
    if (status === MEDIA_JOB_STATUS_COMPLETED) {
      const artifactsResponse = await runtime.ai.getMediaResult(
        { jobId } as never,
        toCallOptions(defaults, { timeoutMs }),
      );
      const artifacts = Array.isArray(artifactsResponse.artifacts)
        ? artifactsResponse.artifacts
        : [];
      const traceId = normalizeText(artifactsResponse.traceId) || normalizeText(job.traceId);
      const routeDecision = fromRouteDecision(job.routeDecision);
      const modelResolved = normalizeText(job.modelResolved) || normalizeText(request.modelId);

      return {
        artifacts: artifacts.map((item) => {
          const record = asRecord(item);
          const bytes = record.bytes instanceof Uint8Array
            ? record.bytes
            : new Uint8Array(0);
          return {
            artifactId: normalizeText(record.artifactId),
            mimeType: normalizeText(record.mimeType),
            bytes,
            traceId,
            routeDecision,
            modelResolved,
          };
        }),
        traceId,
        routeDecision,
        modelResolved,
      };
    }
    if (
      status === MEDIA_JOB_STATUS_FAILED
      || status === MEDIA_JOB_STATUS_CANCELED
      || status === MEDIA_JOB_STATUS_TIMEOUT
    ) {
      const reasonCode = normalizeText(job.reasonCode) || ReasonCode.AI_PROVIDER_UNAVAILABLE;
      throw createNimiError({
        message: normalizeText(job.reasonDetail) || `media job failed: ${reasonCode}`,
        reasonCode,
        actionHint: 'retry_media_job_request',
        source: 'runtime',
      });
    }
    if ((Date.now() - startedAt) > maxWaitMs) {
      await cancelRemoteJob('aborted_by_sdk_timeout');
      throw createNimiError({
        message: 'media job timeout',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_media_job_request',
        source: 'runtime',
      });
    }
    await sleep(250);
  }
}

export function ensureRuntime(config: NimiAiProviderConfig): {
  runtime: RuntimeForAiProvider;
  defaults: RuntimeDefaults;
} {
  if (!config.runtime) {
    throw createNimiError({
      message: 'createNimiAiProvider requires runtime instance',
      reasonCode: ReasonCode.SDK_AI_PROVIDER_RUNTIME_REQUIRED,
      actionHint: 'provide_runtime_instance',
      source: 'sdk',
    });
  }

  if (!(config.runtime instanceof Runtime)) {
    throw createNimiError({
      message: 'runtime must be Runtime class instance',
      reasonCode: ReasonCode.SDK_AI_PROVIDER_RUNTIME_REQUIRED,
      actionHint: 'construct_runtime_with_new_runtime',
      source: 'sdk',
    });
  }

  const subjectUserId = normalizeText(config.subjectUserId) || undefined;

  return {
    runtime: config.runtime,
    defaults: {
      appId: ensureText(config.appId, 'appId'),
      subjectUserId,
      routePolicy: config.routePolicy || 'local-runtime',
      fallback: config.fallback || 'deny',
      timeoutMs: config.timeoutMs,
      metadata: config.metadata,
    },
  };
}

export function toCallOptions(
  defaults: RuntimeDefaults,
  input: {
    timeoutMs?: number;
    metadata?: RuntimeCallOptions['metadata'];
  },
): RuntimeCallOptions {
  const timeoutMs = typeof input.timeoutMs === 'number'
    ? input.timeoutMs
    : defaults.timeoutMs;
  const metadata = {
    ...(defaults.metadata || {}),
    ...(input.metadata || {}),
  };

  return {
    timeoutMs,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

export function toStreamOptions(
  defaults: RuntimeDefaults,
  input: {
    timeoutMs?: number;
    metadata?: RuntimeCallOptions['metadata'];
    signal?: AbortSignal;
  },
): RuntimeStreamCallOptions {
  return {
    ...toCallOptions(defaults, input),
    signal: input.signal,
  };
}

export async function collectArtifacts(stream: AsyncIterable<unknown>): Promise<NimiArtifact[]> {
  const order: string[] = [];
  const states = new Map<string, {
    artifactId: string;
    mimeType: string;
    chunks: Uint8Array[];
    traceId: string;
    routeDecision: AiRoutePolicy;
    modelResolved: string;
  }>();

  for await (const item of stream) {
    const chunk = asRecord(item);
    const artifactId = normalizeText(chunk.artifactId) || `artifact-${order.length + 1}`;
    const state = states.get(artifactId) || {
      artifactId,
      mimeType: '',
      chunks: [],
      traceId: '',
      routeDecision: 'local-runtime' as const,
      modelResolved: '',
    };

    if (!states.has(artifactId)) {
      states.set(artifactId, state);
      order.push(artifactId);
    }

    const mimeType = normalizeText(chunk.mimeType);
    if (mimeType) {
      state.mimeType = mimeType;
    }

    const traceId = normalizeText(chunk.traceId);
    if (traceId) {
      state.traceId = traceId;
    }

    const modelResolved = normalizeText(chunk.modelResolved);
    if (modelResolved) {
      state.modelResolved = modelResolved;
    }

    state.routeDecision = fromRouteDecision(chunk.routeDecision);

    const bytes = chunk.chunk;
    if (bytes instanceof Uint8Array) {
      state.chunks.push(bytes);
    } else if (bytes instanceof ArrayBuffer) {
      state.chunks.push(new Uint8Array(bytes));
    } else if (Array.isArray(bytes)) {
      state.chunks.push(Uint8Array.from(bytes.map((value) => Number(value) || 0)));
    }
  }

  return order.map((artifactId) => {
    const state = states.get(artifactId);
    if (!state) {
      return {
        artifactId,
        mimeType: '',
        bytes: new Uint8Array(0),
        traceId: '',
        routeDecision: 'local-runtime' as const,
        modelResolved: '',
      };
    }
    return {
      artifactId: state.artifactId,
      mimeType: state.mimeType,
      bytes: concatChunks(state.chunks),
      traceId: state.traceId,
      routeDecision: state.routeDecision,
      modelResolved: state.modelResolved,
    };
  });
}

export function toEmbeddingVectors(vectors: unknown): number[][] {
  const list = Array.isArray(vectors) ? vectors : [];
  return list.map((entry) => {
    const values = Array.isArray(asRecord(entry).values)
      ? asRecord(entry).values as unknown[]
      : [];
    return values
      .map((value) => {
        const kind = asRecord(asRecord(value).kind);
        if (kind.oneofKind === 'numberValue') {
          const n = Number(kind.numberValue);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      })
      .filter((value): value is number => value !== null);
  });
}

export function normalizeProviderError(error: unknown) {
  return asNimiError(error, {
    reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
    actionHint: 'check_runtime_and_route_policy',
    source: 'runtime',
  });
}
