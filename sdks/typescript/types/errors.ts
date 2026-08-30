import type { JsonObject } from './json';

export type NimiErrorSource = 'realm' | 'runtime' | 'sdk';

export interface NimiExecutionInterruption {
  readonly cause: 'runtime-restart';
  readonly resubmitDisposition: 'caller-may-resubmit';
}

export type NimiError = Error & {
  code: string;
  reasonCode: string;
  actionHint: string;
  traceId: string;
  retryable: boolean;
  source: NimiErrorSource;
  details?: JsonObject;
  interruption?: NimiExecutionInterruption;
};

export interface CreateNimiErrorInput {
  readonly message: string;
  readonly code?: string;
  readonly reasonCode: string;
  readonly actionHint?: string;
  readonly traceId?: string;
  readonly retryable?: boolean;
  readonly source?: NimiErrorSource;
  readonly details?: JsonObject;
  readonly interruption?: NimiExecutionInterruption;
}

type ExtractedNimiErrorFields = {
  code?: string;
  reasonCode?: string;
  actionHint?: string;
  traceId?: string;
  retryable?: boolean;
  message?: string;
  details?: JsonObject;
  interruption?: NimiExecutionInterruption;
};

export type NimiErrorFields = Omit<ExtractedNimiErrorFields, 'details'>;

export type CreateOfflineNimiErrorInput = {
  source: NimiErrorSource;
  reasonCode: string;
  message: string;
  actionHint: string;
  retryable?: boolean;
  traceId?: string;
  details?: JsonObject;
  interruption?: NimiExecutionInterruption;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = normalizeText(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function readBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function readExecutionInterruption(value: unknown): NimiExecutionInterruption | undefined {
  const record = asRecord(value);
  return record.cause === 'runtime-restart' && record.resubmitDisposition === 'caller-may-resubmit'
    ? { cause: 'runtime-restart', resubmitDisposition: 'caller-may-resubmit' }
    : undefined;
}

function parseJsonObject(input: unknown): Record<string, unknown> {
  const text = normalizeText(input);
  if (!text) {
    return {};
  }
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
}

function parseEmbeddedJsonObject(input: unknown): Record<string, unknown> {
  const text = normalizeText(input);
  if (!text) {
    return {};
  }
  const direct = parseJsonObject(text);
  if (Object.keys(direct).length > 0) {
    return direct;
  }
  const firstBraceIndex = text.indexOf('{');
  const lastBraceIndex = text.lastIndexOf('}');
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return parseJsonObject(text.slice(firstBraceIndex, lastBraceIndex + 1));
  }
  return {};
}

function parseReasonCodePrefix(input: unknown): string {
  return normalizeText(input).match(/^([A-Z0-9_]+):/)?.[1] ?? '';
}

function collectErrorCandidates(error: unknown): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  const direct = asRecord(error);
  if (Object.keys(direct).length > 0) {
    candidates.push(direct);
    const details = asRecord(direct.details);
    if (Object.keys(details).length > 0) {
      candidates.push(details);
    }
    const parsedDetails = parseEmbeddedJsonObject(direct.details);
    if (Object.keys(parsedDetails).length > 0) {
      candidates.push(parsedDetails);
    }
    const nestedError = asRecord(direct.error);
    if (Object.keys(nestedError).length > 0) {
      candidates.push(nestedError);
    }
  }
  const parsedString = parseEmbeddedJsonObject(error);
  if (Object.keys(parsedString).length > 0) {
    candidates.push(parsedString);
  }
  if (error instanceof Error) {
    const cause = asRecord(error.cause);
    if (Object.keys(cause).length > 0) {
      candidates.push(cause);
    }
    const parsedMessage = parseEmbeddedJsonObject(error.message);
    if (Object.keys(parsedMessage).length > 0) {
      candidates.push(parsedMessage);
    }
  }
  return candidates;
}

function extractErrorFields(error: unknown): ExtractedNimiErrorFields {
  const result: ExtractedNimiErrorFields = {};
  const direct = asRecord(error);
  if (error instanceof Error) {
    result.message = normalizeText(error.message) || undefined;
  } else if (Object.keys(direct).length > 0) {
    result.message = readString(direct, ['message']) || undefined;
  } else {
    result.message = normalizeText(error) || undefined;
  }

  for (const candidate of collectErrorCandidates(error)) {
    result.code ||= readString(candidate, ['code']);
    result.reasonCode ||= readString(candidate, ['reasonCode', 'reason_code', 'reason']);
    result.actionHint ||= readString(candidate, ['actionHint', 'action_hint']);
    result.traceId ||= readString(candidate, ['traceId', 'trace_id']);
    result.retryable ??= readBoolean(candidate, ['retryable']);
    result.interruption ??= readExecutionInterruption(candidate.interruption);
    result.message ||= readString(candidate, ['message']);
    const details = asRecord(candidate.details);
    if (!result.details && Object.keys(details).length > 0) {
      result.details = details as JsonObject;
    }
  }

  result.reasonCode ||= parseReasonCodePrefix(result.message);
  return result;
}

// @nimi-authority: definition.nimi.sdks.client-core.error-projection-plane
// @nimi-authority: rule.nimi.sdks.client-core.r021
export function createNimiError(input: CreateNimiErrorInput): NimiError {
  const reasonCode = normalizeText(input.reasonCode) || 'RUNTIME_CALL_FAILED';
  const error = new Error(normalizeText(input.message) || reasonCode) as NimiError;
  error.name = 'NimiError';
  error.code = normalizeText(input.code) || reasonCode;
  error.reasonCode = reasonCode;
  error.actionHint = normalizeText(input.actionHint) || 'check_runtime_logs';
  error.traceId = normalizeText(input.traceId);
  error.retryable = Boolean(input.retryable);
  error.source = input.source || 'runtime';
  if (input.details && Object.keys(input.details).length > 0) {
    error.details = { ...input.details };
  }
  if (input.interruption) {
    error.interruption = { ...input.interruption };
  }
  return error;
}

export function isNimiError(error: unknown): error is NimiError {
  const record = asRecord(error);
  return typeof record.code === 'string'
    && typeof record.reasonCode === 'string'
    && typeof record.actionHint === 'string'
    && typeof record.traceId === 'string'
    && typeof record.retryable === 'boolean'
    && typeof record.source === 'string';
}

export function isNimiErrorLike(error: unknown): error is NimiError {
  return isNimiError(error);
}

export function extractNimiErrorFields(error: unknown): NimiErrorFields {
  const fields = extractErrorFields(error);
  return {
    code: fields.code,
    reasonCode: fields.reasonCode,
    actionHint: fields.actionHint,
    traceId: fields.traceId,
    retryable: fields.retryable,
    message: fields.message,
  };
}

export function asNimiError(error: unknown, defaults: Partial<CreateNimiErrorInput> = {}): NimiError {
  if (isNimiError(error)) {
    return error;
  }
  const fields = extractErrorFields(error);
  return createNimiError({
    message: fields.message || defaults.message || 'Runtime call failed',
    code: fields.code || defaults.code || fields.reasonCode || defaults.reasonCode,
    reasonCode: fields.reasonCode || defaults.reasonCode || 'RUNTIME_CALL_FAILED',
    actionHint: fields.actionHint || defaults.actionHint || 'retry_or_check_runtime_status',
    traceId: fields.traceId || defaults.traceId,
    retryable: fields.retryable ?? defaults.retryable,
    source: defaults.source || 'runtime',
    details: fields.details || defaults.details,
    interruption: fields.interruption || defaults.interruption,
  });
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
  return createNimiError({
    message: input.message,
    code: input.reasonCode,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    traceId: input.traceId || createOfflineTraceId(),
    retryable: input.retryable !== false,
    source: input.source,
    details: input.details,
    interruption: input.interruption,
  });
}
