import { tryParseJsonLike } from './json.js';

export type NimiErrorSource = 'realm' | 'runtime' | 'sdk';

export type NimiError = Error & {
  code: string;
  reasonCode: string;
  actionHint: string;
  traceId: string;
  retryable: boolean;
  source: NimiErrorSource;
  details?: Record<string, unknown>;
};

export type NimiErrorFields = {
  code?: string;
  traceId?: string;
  reasonCode?: string;
  actionHint?: string;
  retryable?: boolean;
  message?: string;
};

export type CreateOfflineNimiErrorInput = {
  source: NimiErrorSource;
  reasonCode: string;
  message: string;
  actionHint: string;
  retryable?: boolean;
  traceId?: string;
  details?: Record<string, unknown>;
};

export function isNimiErrorLike(error: unknown): error is NimiError {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as Record<string, unknown>;
  return typeof record.reasonCode === 'string'
    && typeof record.actionHint === 'string'
    && typeof record.traceId === 'string'
    && typeof record.retryable === 'boolean'
    && typeof record.source === 'string';
}

function asErrorRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asErrorFieldString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function asErrorFieldBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parseErrorJsonLikeString(value: unknown): Record<string, unknown> | null {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = tryParseJsonLike(normalized);
  return asErrorRecord(parsed);
}

function collectNimiErrorFieldCandidates(error: unknown): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  const direct = asErrorRecord(error);
  if (direct) {
    candidates.push(direct);
  }
  const parsedString = parseErrorJsonLikeString(error);
  if (parsedString) {
    candidates.push(parsedString);
  }
  if (error instanceof Error) {
    const cause = asErrorRecord(error.cause);
    if (cause) {
      candidates.push(cause);
    }
    const parsedCause = parseErrorJsonLikeString(error.cause);
    if (parsedCause) {
      candidates.push(parsedCause);
    }
  }
  return candidates;
}

export function extractNimiErrorFields(error: unknown): NimiErrorFields {
  const result: NimiErrorFields = {};
  const errorRecord = asErrorRecord(error);
  const message = error instanceof Error
    ? asErrorFieldString(error.message)
    : errorRecord
      ? asErrorFieldString(errorRecord.message)
      : asErrorFieldString(error);
  if (message) {
    result.message = message;
  }

  for (const candidate of collectNimiErrorFieldCandidates(error)) {
    if (!result.code) {
      const code = asErrorFieldString(candidate.code);
      if (code) {
        result.code = code;
      }
    }
    if (!result.traceId) {
      const traceId = asErrorFieldString(candidate.traceId) || asErrorFieldString(candidate.trace_id);
      if (traceId) {
        result.traceId = traceId;
      }
    }
    if (!result.reasonCode) {
      const reasonCode = asErrorFieldString(candidate.reasonCode) || asErrorFieldString(candidate.reason_code);
      if (reasonCode) {
        result.reasonCode = reasonCode;
      }
    }
    if (!result.actionHint) {
      const actionHint = asErrorFieldString(candidate.actionHint) || asErrorFieldString(candidate.action_hint);
      if (actionHint) {
        result.actionHint = actionHint;
      }
    }
    if (result.retryable === undefined) {
      const retryable = asErrorFieldBoolean(candidate.retryable);
      if (retryable !== undefined) {
        result.retryable = retryable;
      }
    }
  }

  return result;
}

function createOfflineTraceId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoLike?.randomUUID === 'function') {
    return `offline_${cryptoLike.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 12);
  const timestamp = Date.now().toString(36);
  return `offline_${timestamp}_${random}`;
}

export function createOfflineNimiError(input: CreateOfflineNimiErrorInput): NimiError {
  const reasonCode = String(input.reasonCode || '').trim() || 'OFFLINE_ERROR';
  const actionHint = String(input.actionHint || '').trim() || 'retry_when_online';
  const message = String(input.message || '').trim() || reasonCode;
  const error = new Error(message) as NimiError;
  error.name = 'NimiError';
  error.code = reasonCode;
  error.reasonCode = reasonCode;
  error.actionHint = actionHint;
  error.traceId = String(input.traceId || '').trim() || createOfflineTraceId();
  error.retryable = input.retryable !== false;
  error.source = input.source;
  if (input.details && typeof input.details === 'object') {
    error.details = { ...input.details };
  }
  return error;
}
