import { normalizeApiError } from './error-normalize';

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type RetryReasonKind = 'status' | 'network';

type ApiErrorLike = {
  status: number;
  message?: string;
};

export type RetryEvent =
  | {
      type: 'recovered';
      retryCount: number;
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: 'retrying';
      retryCount: number;
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      reasonKind: RetryReasonKind;
      status?: number;
      error?: string;
    }
  | {
      type: 'retry_exhausted';
      retryCount: number;
      attempt: number;
      maxAttempts: number;
      reasonKind: RetryReasonKind;
      status?: number;
      error?: string;
    };

export type RetryOptions = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
};

type SleepImpl = (ms: number) => Promise<void>;

function defaultSleepImpl(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableNetworkError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  return error.name === 'TypeError';
}

function isApiErrorLike(error: unknown): error is ApiErrorLike {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) && status > 0;
}

function isRetryableApiError(error: unknown): error is ApiErrorLike {
  return isApiErrorLike(error) && RETRYABLE_STATUS_CODES.has(error.status);
}

function getRetryDelayMs(attempt: number, initialDelayMs: number, maxDelayMs: number) {
  const base = initialDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * (initialDelayMs / 2);
  return Math.min(maxDelayMs, base + jitter);
}

export async function requestWithRetry<T>(input: {
  executor: () => Promise<T>;
  options?: Partial<RetryOptions>;
  defaultOptions?: RetryOptions;
  sleepImpl?: SleepImpl;
  onRetryEvent?: (event: RetryEvent) => void;
}): Promise<T> {
  const defaults = input.defaultOptions || {
    maxAttempts: 3,
    initialDelayMs: 120,
    maxDelayMs: 900,
  };
  const maxAttempts = Math.max(1, input.options?.maxAttempts || defaults.maxAttempts);
  const initialDelayMs = Math.max(
    0,
    input.options?.initialDelayMs || defaults.initialDelayMs,
  );
  const maxDelayMs = Math.max(0, input.options?.maxDelayMs || defaults.maxDelayMs);
  const sleepImpl = input.sleepImpl || defaultSleepImpl;
  let retryCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await input.executor();
      if (retryCount > 0 && input.onRetryEvent) {
        input.onRetryEvent({
          type: 'recovered',
          retryCount,
          attempt,
          maxAttempts,
        });
      }
      return payload;
    } catch (error: unknown) {
      const retryableByStatus = isRetryableApiError(error);
      const retryableByNetwork = isRetryableNetworkError(error);
      const isRetryable = retryableByStatus || retryableByNetwork;

      if (!isRetryable || attempt >= maxAttempts) {
        if (isRetryable && input.onRetryEvent) {
          input.onRetryEvent({
            type: 'retry_exhausted',
            retryCount,
            attempt,
            maxAttempts,
            reasonKind: retryableByStatus ? 'status' : 'network',
            status: retryableByStatus ? error.status : undefined,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw normalizeApiError(error);
      }

      const delayMs = getRetryDelayMs(attempt, initialDelayMs, maxDelayMs);
      retryCount += 1;
      if (input.onRetryEvent) {
        input.onRetryEvent({
          type: 'retrying',
          retryCount,
          attempt,
          maxAttempts,
          delayMs,
          reasonKind: retryableByStatus ? 'status' : 'network',
          status: retryableByStatus ? error.status : undefined,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (delayMs > 0) {
        await sleepImpl(delayMs);
      }
    }
  }

  throw new Error('NETWORK_RETRY_EXHAUSTED: 重试后请求仍失败');
}
