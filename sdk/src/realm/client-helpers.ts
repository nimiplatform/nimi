import { ReasonCode } from '../types/index.js';
import { asNimiError, createNimiError } from '../runtime/errors.js';
import type { NimiError } from '../types/index.js';

type MergeHandleSource = Record<string, unknown>;

type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

type MergedHandle<Handles extends Array<MergeHandleSource | undefined>> = UnionToIntersection<
  Exclude<Handles[number], undefined>
>;

export const DEFAULT_REALM_TIMEOUT_MS = 10000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function resolveBaseUrl(value: unknown): string {
  const baseUrl = normalizeText(value);
  if (!baseUrl) {
    throw createNimiError({
      message: 'realm endpoint (baseUrl) is required',
      reasonCode: ReasonCode.SDK_REALM_ENDPOINT_REQUIRED,
      actionHint: 'set_realm_base_url',
      source: 'sdk',
    });
  }
  return baseUrl.replace(/\/+$/, '');
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  const record = asRecord(error);
  const name = normalizeText(record.name);
  const code = normalizeText(record.code);
  if (name === 'AbortError' || code === 'ABORT_ERR') {
    return true;
  }
  const message = normalizeText(record.message).toLowerCase();
  return message.includes('aborted');
}

function mapRealmStatusReasonCode(status: number): string {
  if (status === 401 || status === 403) {
    return ReasonCode.AUTH_DENIED;
  }
  if (status === 404) {
    return ReasonCode.REALM_NOT_FOUND;
  }
  if (status === 409) {
    return ReasonCode.REALM_CONFLICT;
  }
  if (status === 429) {
    return ReasonCode.REALM_RATE_LIMITED;
  }
  if (status === 400 || status === 422) {
    return ReasonCode.CONFIG_INVALID;
  }
  if (status >= 500) {
    return ReasonCode.REALM_UNAVAILABLE;
  }
  return ReasonCode.ACTION_INPUT_INVALID;
}

function mapRealmStatusActionHint(status: number): string {
  if (status === 401 || status === 403) {
    return 'refresh_realm_token_or_reauthenticate';
  }
  if (status === 404) {
    return 'check_realm_path_or_resource_id';
  }
  if (status === 409) {
    return 'resolve_realm_conflict_then_retry';
  }
  if (status === 429) {
    return 'retry_after_backoff';
  }
  if (status === 400 || status === 422) {
    return 'fix_realm_config_or_request_payload';
  }
  if (status >= 500) {
    return 'retry_or_check_realm_status';
  }
  return 'check_realm_request_payload';
}

export function mergeHandles<Handles extends Array<MergeHandleSource | undefined>>(
  ...handles: Handles
): MergedHandle<Handles> {
  const merged: Record<string, unknown> = {};
  for (const handle of handles) {
    if (!handle) {
      continue;
    }
    for (const [methodName, method] of Object.entries(handle)) {
      merged[methodName] = method;
    }
  }
  return merged as MergedHandle<Handles>;
}

export function isResponse(value: unknown): value is Response {
  return typeof Response !== 'undefined' && value instanceof Response;
}

export async function readErrorBody(value: unknown): Promise<Record<string, unknown>> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed);
    } catch {
      return { message: value };
    }
  }
  if (typeof value === 'object') {
    return asRecord(value);
  }
  return {};
}

export function extractResponseReasonCode(
  body: Record<string, unknown>,
  response: Response,
): {
  rawReasonCode: string;
  reasonCode: string;
  code: string;
  actionHint: string;
  traceId: string;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
} {
  const nestedError = asRecord(body.error);
  const rawReasonCode = pickString(body, ['reasonCode', 'reason_code'])
    || pickString(nestedError, ['reasonCode', 'reason_code'])
    || normalizeText(response.headers.get('x-reason-code'));

  const reasonCode = rawReasonCode || mapRealmStatusReasonCode(response.status);
  const code = mapRealmStatusReasonCode(response.status);

  const actionHint = pickString(body, ['actionHint', 'action_hint'])
    || pickString(nestedError, ['actionHint', 'action_hint'])
    || normalizeText(response.headers.get('x-action-hint'))
    || mapRealmStatusActionHint(response.status);

  const traceId = pickString(body, ['traceId', 'trace_id'])
    || pickString(nestedError, ['traceId', 'trace_id'])
    || normalizeText(response.headers.get('x-trace-id'));

  const message = pickString(body, ['message'])
    || pickString(nestedError, ['message'])
    || `${response.status} ${response.statusText}`;

  const retryable = response.status === 429 || response.status >= 500;
  const details: Record<string, unknown> = {
    httpStatus: response.status,
  };
  if (rawReasonCode) {
    details.rawReasonCode = rawReasonCode;
  }

  return {
    rawReasonCode,
    reasonCode,
    code,
    actionHint,
    traceId,
    message,
    retryable,
    details,
  };
}

export function mapRealmError(error: unknown): NimiError {
  if (isAbortLikeError(error)) {
    return createNimiError({
      message: normalizeText(asRecord(error).message) || 'realm request aborted',
      code: ReasonCode.OPERATION_ABORTED,
      reasonCode: ReasonCode.OPERATION_ABORTED,
      actionHint: 'retry_if_needed',
      source: 'realm',
    });
  }

  const normalized = asNimiError(error, {
    code: ReasonCode.REALM_UNAVAILABLE,
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    actionHint: 'retry_or_check_realm_network',
    source: 'realm',
  });

  const message = normalizeText(normalized.message).toLowerCase();
  if (message.includes('aborted')) {
    return createNimiError({
      message: normalized.message,
      code: ReasonCode.OPERATION_ABORTED,
      reasonCode: ReasonCode.OPERATION_ABORTED,
      actionHint: 'retry_if_needed',
      traceId: normalized.traceId || undefined,
      source: 'realm',
      retryable: false,
    });
  }

  return normalized;
}
