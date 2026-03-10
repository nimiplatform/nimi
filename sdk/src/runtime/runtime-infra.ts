import { type NimiError, ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_WAIT_FOR_READY_TIMEOUT_MS,
  MAX_RETRY_BACKOFF_MS,
  RETRYABLE_RUNTIME_REASON_CODES,
  normalizeText,
  sleep,
} from './helpers.js';
import type {
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeConnectionState,
  RuntimeOptions,
  RuntimeStreamCallOptions,
} from './types.js';

export function resolveRetryConfig(options: RuntimeOptions): { maxAttempts: number; backoffMs: number } {
  const maxAttemptsRaw = options.retry?.maxAttempts;
  const backoffMsRaw = options.retry?.backoffMs;

  const maxAttempts = Number.isFinite(maxAttemptsRaw) && Number(maxAttemptsRaw) > 0
    ? Math.max(1, Math.floor(Number(maxAttemptsRaw)))
    : DEFAULT_RETRY_MAX_ATTEMPTS;
  const backoffMs = Number.isFinite(backoffMsRaw) && Number(backoffMsRaw) > 0
    ? Math.floor(Number(backoffMsRaw))
    : DEFAULT_RETRY_BACKOFF_MS;

  return {
    maxAttempts,
    backoffMs,
  };
}

export function resolveReadyTimeout(options: RuntimeOptions, timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  const configured = options.connection?.waitForReadyTimeoutMs;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_WAIT_FOR_READY_TIMEOUT_MS;
}

export async function waitForRuntimeReady(input: {
  stateStatus: RuntimeConnectionState['status'];
  connectPromise: Promise<void> | null;
  connect: () => Promise<void>;
  timeoutMs: number;
}): Promise<void> {
  if (input.stateStatus === 'ready') {
    return;
  }
  if (!input.connectPromise) {
    await input.connect();
    return;
  }
  await withTimeout(input.connectPromise, input.timeoutMs, {
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'retry_or_check_runtime_daemon',
    source: 'runtime',
  });
}

export async function ensureRuntimeClientForCall(input: {
  options: RuntimeOptions;
  stateStatus: RuntimeConnectionState['status'];
  client: RuntimeClient | null;
  waitForReady: (timeoutMs: number) => Promise<void>;
  getClient: () => RuntimeClient | null;
}): Promise<RuntimeClient> {
  const timeoutMs = resolveReadyTimeout(input.options);

  if (!input.client || input.stateStatus !== 'ready') {
    await input.waitForReady(timeoutMs);
  }

  const resolvedClient = input.getClient();
  if (!resolvedClient) {
    throw createNimiError({
      message: 'runtime client is unavailable',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'retry_or_check_runtime_daemon',
      source: 'runtime',
    });
  }

  return resolvedClient;
}

export async function invokeWithRuntimeRetry<T>(input: {
  operation: () => Promise<T>;
  options: RuntimeOptions;
  normalizeError: (error: unknown) => NimiError;
  onRecovered: (attempt: number) => void;
  onRetry: (error: NimiError, attempt: number, backoffMs: number, maxAttempts: number) => void;
  onTerminalError: (error: NimiError) => void;
}): Promise<T> {
  const retry = resolveRetryConfig(input.options);

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    try {
      const value = await input.operation();
      if (attempt > 1) {
        input.onRecovered(attempt);
      }
      return value;
    } catch (error) {
      const normalized = input.normalizeError(error);
      if (shouldRetryRuntimeCall(normalized, attempt, retry.maxAttempts)) {
        const backoffMs = computeRetryBackoffMs(retry.backoffMs, attempt);
        input.onRetry(normalized, attempt, backoffMs, retry.maxAttempts);
        await sleep(backoffMs);
        continue;
      }
      input.onTerminalError(normalized);
      throw normalized;
    }
  }

  throw createNimiError({
    message: 'runtime invoke exhausted retry attempts',
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'check_runtime_daemon_and_retry',
    source: 'runtime',
  });
}

export function computeRetryBackoffMs(baseBackoffMs: number, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  const exponential = baseBackoffMs * (2 ** exponent);
  const jitter = Math.floor(Math.random() * (baseBackoffMs / 2));
  return Math.min(exponential + jitter, MAX_RETRY_BACKOFF_MS);
}

export function shouldRetryRuntimeCall(
  error: NimiError,
  attempt: number,
  maxAttempts: number,
): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }

  if (error.reasonCode === ReasonCode.OPERATION_ABORTED) {
    return false;
  }

  if (error.retryable) {
    return true;
  }

  return RETRYABLE_RUNTIME_REASON_CODES.has(error.reasonCode);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: {
    reasonCode: string;
    actionHint: string;
    source: 'sdk' | 'runtime' | 'realm';
  },
): Promise<T> {
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(createNimiError({
            message: `operation timed out after ${timeoutMs}ms`,
            reasonCode: fallback.reasonCode,
            actionHint: fallback.actionHint,
            source: fallback.source,
          }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function resolveRuntimeCallOptions(
  options: RuntimeOptions,
  input: {
    timeoutMs?: number;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
    _responseMetadataObserver?: (metadata: Record<string, string>) => void;
  },
): RuntimeCallOptions {
  const timeoutMs = typeof input.timeoutMs === 'number'
    ? input.timeoutMs
    : options.timeoutMs;

  const metadataInput = input.metadata || {};
  const traceId = normalizeText(
    metadataInput['x-nimi-trace-id'] || metadataInput.traceId,
  ) || undefined;
  const keySourceRaw = normalizeText(
    metadataInput['x-nimi-key-source'] || metadataInput.keySource,
  ).toLowerCase();
  const keySource: 'inline' | 'managed' | undefined = keySourceRaw === 'inline' || keySourceRaw === 'managed'
    ? keySourceRaw
    : undefined;
  const providerType = normalizeText(
    metadataInput['x-nimi-provider-type'] || metadataInput.providerType,
  ) || undefined;
  const providerEndpoint = normalizeText(
    metadataInput['x-nimi-provider-endpoint'] || metadataInput.providerEndpoint,
  ) || undefined;
  const providerApiKey = normalizeText(
    metadataInput['x-nimi-provider-api-key'] || metadataInput.providerApiKey,
  ) || undefined;

  const metadataExtraEntries = Object.entries(metadataInput)
    .filter(([key]) => {
      const normalizedKey = normalizeText(key).toLowerCase();
      return normalizedKey !== 'x-nimi-key-source'
        && normalizedKey !== 'keysource'
        && normalizedKey !== 'x-nimi-trace-id'
        && normalizedKey !== 'traceid'
        && normalizedKey !== 'x-nimi-provider-type'
        && normalizedKey !== 'providertype'
        && normalizedKey !== 'x-nimi-provider-endpoint'
        && normalizedKey !== 'providerendpoint'
        && normalizedKey !== 'x-nimi-provider-api-key'
        && normalizedKey !== 'providerapikey';
    });
  const metadataExtra = metadataExtraEntries.length > 0
    ? Object.fromEntries(metadataExtraEntries)
    : undefined;

  return {
    timeoutMs,
    metadata: {
      traceId,
      keySource,
      providerType,
      providerEndpoint,
      providerApiKey,
      extra: metadataExtra,
    },
    idempotencyKey: normalizeText(input.idempotencyKey) || undefined,
    _responseMetadataObserver: input._responseMetadataObserver,
  };
}

export function resolveRuntimeStreamOptions(
  options: RuntimeOptions,
  input: {
    timeoutMs?: number;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
    signal?: AbortSignal;
  },
): RuntimeStreamCallOptions {
  return {
    ...resolveRuntimeCallOptions(options, input),
    signal: input.signal,
  };
}
