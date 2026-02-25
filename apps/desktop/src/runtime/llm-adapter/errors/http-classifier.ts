import type { ProviderType } from '../types';
import type { LlmAdapterError } from './codes';

export function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function getStatus(error: unknown): number | undefined {
  const rec = toRecord(error);
  if (!rec) return undefined;

  if (typeof rec.status === 'number') {
    return rec.status;
  }
  if (typeof rec.statusCode === 'number') {
    return rec.statusCode;
  }

  const response = toRecord(rec.response);
  if (response && typeof response.status === 'number') {
    return response.status;
  }

  const cause = toRecord(rec.cause);
  if (cause && typeof cause.status === 'number') {
    return cause.status;
  }

  return undefined;
}

function headerValue(headers: unknown, key: string): string | undefined {
  if (!headers) return undefined;

  if (headers instanceof Headers) {
    return headers.get(key) ?? headers.get(key.toLowerCase()) ?? undefined;
  }

  if (typeof headers === 'object') {
    const rec = headers as Record<string, unknown>;
    const exact = rec[key];
    if (typeof exact === 'string') return exact;
    const lower = rec[key.toLowerCase()];
    if (typeof lower === 'string') return lower;
  }
  return undefined;
}

function getHeaders(error: unknown): unknown {
  const rec = toRecord(error);
  if (!rec) return undefined;
  return rec.responseHeaders ?? rec.headers ?? toRecord(rec.response)?.headers;
}

export function parseRetryAfterHeader(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    if (numeric > 1000) return Math.ceil(numeric);
    return Math.ceil(numeric * 1000);
  }

  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    const delta = ts - Date.now();
    if (delta > 0) return Math.ceil(delta);
  }
  return undefined;
}

export function classifyHttpStatusError(input: {
  error: unknown;
  message: string;
  provider?: ProviderType | string;
  model?: string;
}): LlmAdapterError | null {
  const status = getStatus(input.error);
  if (status === undefined) {
    return null;
  }

  if (status === 401 || status === 403 || status === 402) {
    return {
      code: 'AUTH_FAILED',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  if (status === 429) {
    const headers = getHeaders(input.error);
    const retryAfterMsRaw =
      headerValue(headers, 'retry-after-ms') ?? headerValue(headers, 'Retry-After-Ms');
    const retryAfterRaw =
      headerValue(headers, 'retry-after') ?? headerValue(headers, 'Retry-After');

    let retryAfterMs: number | undefined;
    if (retryAfterMsRaw) {
      const numeric = Number(retryAfterMsRaw.trim());
      if (!Number.isNaN(numeric) && numeric >= 0) {
        retryAfterMs = Math.ceil(numeric);
      }
    }
    if (retryAfterMs === undefined) {
      retryAfterMs = parseRetryAfterHeader(retryAfterRaw);
    }

    return {
      code: 'RATE_LIMITED',
      message: input.message,
      status,
      retryAfterMs,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  if (status === 408) {
    return {
      code: 'TIMEOUT',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  if (status === 404) {
    return {
      code: 'MODEL_NOT_FOUND',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  if (status >= 500) {
    return {
      code: 'PROVIDER_UNREACHABLE',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  return null;
}
