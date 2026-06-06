import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import type { RealmRetryOptions } from './client-types.js';
import { normalizeText } from './client-helpers.js';

const DEFAULT_RETRY_STATUSES = [429, 502, 503, 504];
const DEFAULT_RETRY_MAX_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 1000;
const DEFAULT_RETRY_MAX_BACKOFF_MS = 10000;

function resolveRealmRetryConfig(input?: RealmRetryOptions): Required<RealmRetryOptions> {
  return {
    maxRetries: Number(input?.maxRetries ?? DEFAULT_RETRY_MAX_RETRIES),
    retryableStatuses: input?.retryableStatuses ?? DEFAULT_RETRY_STATUSES,
    backoffMs: Number(input?.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS),
    maxBackoffMs: Number(input?.maxBackoffMs ?? DEFAULT_RETRY_MAX_BACKOFF_MS),
  };
}

function parseRetryAfterMs(value: string | null): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const retryAt = Date.parse(normalized);
  if (Number.isNaN(retryAt)) {
    return null;
  }
  return Math.max(retryAt - Date.now(), 0);
}

export function resolveRealmRetryDelay(
  response: Response,
  attempt: number,
  input?: RealmRetryOptions,
): number | null {
  const config = resolveRealmRetryConfig(input);
  if (attempt >= config.maxRetries) {
    return null;
  }
  if (!config.retryableStatuses.includes(response.status)) {
    return null;
  }
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    if (retryAfterMs !== null) {
      return retryAfterMs;
    }
  }
  const backoff = config.backoffMs * (2 ** attempt);
  return Math.min(backoff, config.maxBackoffMs);
}

export async function sleepForRealmRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createRealmRequestAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(createRealmRequestAbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function createRealmRequestAbortedError(): Error {
  return createNimiError({
    message: 'realm request aborted',
    code: ReasonCode.OPERATION_ABORTED,
    reasonCode: ReasonCode.OPERATION_ABORTED,
    actionHint: 'retry_if_needed',
    source: 'realm',
    retryable: false,
  });
}
