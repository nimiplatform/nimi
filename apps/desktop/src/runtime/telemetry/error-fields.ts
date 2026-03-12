import { tryParseJsonLike } from '../net/json';

export type RuntimeErrorFields = {
  traceId?: string;
  reasonCode?: string;
  actionHint?: string;
  retryable?: boolean;
  message?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parseJsonLikeString(value: unknown): Record<string, unknown> | null {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = tryParseJsonLike(normalized);
  return asRecord(parsed);
}

function collectCandidates(error: unknown): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  const direct = asRecord(error);
  if (direct) {
    candidates.push(direct);
  }
  const parsedString = parseJsonLikeString(error);
  if (parsedString) {
    candidates.push(parsedString);
  }
  if (error instanceof Error) {
    const cause = asRecord(error.cause);
    if (cause) {
      candidates.push(cause);
    }
    const parsedCause = parseJsonLikeString(error.cause);
    if (parsedCause) {
      candidates.push(parsedCause);
    }
  }
  return candidates;
}

export function extractRuntimeErrorFields(error: unknown): RuntimeErrorFields {
  const result: RuntimeErrorFields = {};
  const message = error instanceof Error
    ? asString(error.message)
    : asString(error);
  if (message) {
    result.message = message;
  }

  for (const candidate of collectCandidates(error)) {
    if (!result.traceId) {
      result.traceId = asString(candidate.traceId) || asString(candidate.trace_id);
    }
    if (!result.reasonCode) {
      result.reasonCode = asString(candidate.reasonCode) || asString(candidate.reason_code);
    }
    if (!result.actionHint) {
      result.actionHint = asString(candidate.actionHint) || asString(candidate.action_hint);
    }
    if (result.retryable === undefined) {
      result.retryable = asBoolean(candidate.retryable);
    }
  }

  return result;
}
