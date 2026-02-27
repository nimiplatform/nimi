import type { NimiError, NimiErrorSource } from '../types/index.js';
import { ReasonCode } from '../types/index.js';

export type CreateNimiErrorInput = {
  message: string;
  code?: string;
  reasonCode: string;
  actionHint?: string;
  traceId?: string;
  retryable?: boolean;
  source?: NimiErrorSource;
  details?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function parseEmbeddedRuntimeError(error: unknown): Partial<CreateNimiErrorInput> | null {
  if (typeof error === 'string') {
    const text = error.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      return parseEmbeddedRuntimeError(parsed);
    } catch {
      return null;
    }
  }

  const record = asRecord(error);
  if (Object.keys(record).length === 0) {
    return null;
  }

  const reasonCode = readString(record, ['reasonCode', 'reason_code']);
  const code = readString(record, ['code']);
  const actionHint = readString(record, ['actionHint', 'action_hint']);
  const traceId = readString(record, ['traceId', 'trace_id']);
  const message = readString(record, ['message']);
  const retryable = readBoolean(record, ['retryable']);
  const details = asRecord(record.details);
  const normalizedDetails = Object.keys(details).length > 0 ? details : undefined;

  const hasStructuredRuntimeFields = Boolean(
    code
    || reasonCode
    || actionHint
    || traceId
    || typeof retryable === 'boolean'
    || normalizedDetails,
  );
  if (!hasStructuredRuntimeFields) {
    return null;
  }

  return {
    code: code || reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
    reasonCode: reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: actionHint || 'retry_or_check_runtime_status',
    traceId,
    retryable,
    message: message || 'Runtime call failed',
    details: normalizedDetails,
  };
}

export function createNimiError(input: CreateNimiErrorInput): NimiError {
  const error = new Error(input.message) as NimiError;
  error.name = 'NimiError';
  error.code = String(input.code || input.reasonCode || ReasonCode.RUNTIME_UNSPECIFIED_ERROR).trim()
    || ReasonCode.RUNTIME_UNSPECIFIED_ERROR;
  error.reasonCode = String(input.reasonCode || ReasonCode.RUNTIME_UNSPECIFIED_ERROR).trim() || ReasonCode.RUNTIME_UNSPECIFIED_ERROR;
  error.actionHint = String(input.actionHint || 'check_runtime_logs').trim() || 'check_runtime_logs';
  error.traceId = String(input.traceId || '').trim();
  error.retryable = Boolean(input.retryable);
  error.source = input.source || 'runtime';
  if (input.details && typeof input.details === 'object') {
    error.details = { ...input.details };
  }
  return error;
}

export function asNimiError(error: unknown, defaults?: Partial<CreateNimiErrorInput>): NimiError {
  if (
    error instanceof Error
    && typeof (error as Partial<NimiError>).reasonCode === 'string'
    && typeof (error as Partial<NimiError>).actionHint === 'string'
  ) {
    return error as NimiError;
  }

  const embedded = parseEmbeddedRuntimeError(error);
  if (embedded) {
    return createNimiError({
      message: embedded.message || defaults?.message || 'Runtime call failed',
      code: embedded.code || defaults?.code || embedded.reasonCode || defaults?.reasonCode,
      reasonCode: embedded.reasonCode || defaults?.reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: embedded.actionHint || defaults?.actionHint || 'retry_or_check_runtime_status',
      traceId: embedded.traceId || defaults?.traceId,
      retryable: embedded.retryable ?? defaults?.retryable,
      source: defaults?.source || 'runtime',
      details: embedded.details || defaults?.details,
    });
  }

  const message = error instanceof Error ? error.message : String(error || defaults?.message || 'Runtime call failed');
  return createNimiError({
    message,
    code: defaults?.code || defaults?.reasonCode,
    reasonCode: defaults?.reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: defaults?.actionHint || 'retry_or_check_runtime_status',
    traceId: defaults?.traceId,
    retryable: defaults?.retryable,
    source: defaults?.source || 'runtime',
    details: defaults?.details,
  });
}
