const RETRYABLE_SOURCE_RUNTIME_REASONS = new Set([
  'process-replaced',
  'runtime-restarted',
  'runtime-service-unavailable',
]);

export const DEFAULT_SOURCE_RUNTIME_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

export type SourceRuntimeRetryEvent = {
  readonly attempt: number;
  readonly reasonCode: string;
  readonly retryDelayMs: number;
};

export type SourceRuntimeRetryOptions = {
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly onRetry?: (event: SourceRuntimeRetryEvent) => void;
};

// @nimi-authority: rule.nimi.desktop.shell-runtime.r011
export async function retrySourceRuntimeTransport<T>(
  operation: () => Promise<T>,
  options: SourceRuntimeRetryOptions = {},
): Promise<T> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_SOURCE_RUNTIME_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? wait;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      const retryDelayMs = retryDelaysMs[attempt - 1];
      const reasonCode = sourceRuntimeFailureReason(error);
      if (retryDelayMs === undefined || !isRetryableSourceRuntimeTransportFailure(error)) {
        throw error;
      }
      options.onRetry?.({ attempt, reasonCode, retryDelayMs });
      await sleep(retryDelayMs);
    }
  }
}

export function isRetryableSourceRuntimeTransportFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Readonly<Record<string, unknown>>;
  const details = asRecord(record.details) ?? asRecord(asRecord(record.envelope)?.details);
  return RETRYABLE_SOURCE_RUNTIME_REASONS.has(sourceRuntimeFailureReason(error))
    && (record.retryable === true || details?.retryable === true);
}

export function sourceRuntimeFailureReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'runtime-service-error-unclassified';
  const record = error as Readonly<Record<string, unknown>>;
  const envelope = asRecord(record.envelope);
  for (const value of [
    record.reasonCode,
    record.code,
    envelope?.reasonCode,
    envelope?.code,
    record.message,
  ]) {
    if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value)) {
      return value;
    }
  }
  return 'runtime-service-error-unclassified';
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
