import { ReasonCode as RuntimeGeneratedReasonCode } from '../core-generated/runtime-typed-client';
import { asNimiError, type CreateNimiErrorInput } from '../types';

export interface NimiRuntimeReasonCodeMessageProjection {
  readonly reasonCode: string;
  readonly defaultMessage: string;
}

export const NIMI_RUNTIME_REASON_CODES = Object.freeze({
  AI_PROVIDER_TIMEOUT: 'AI_PROVIDER_TIMEOUT',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_PROVIDER_RATE_LIMITED: 'AI_PROVIDER_RATE_LIMITED',
  AI_PROVIDER_INTERNAL: 'AI_PROVIDER_INTERNAL',
  AI_STREAM_BROKEN: 'AI_STREAM_BROKEN',
  AI_CONNECTOR_CREDENTIAL_MISSING: 'AI_CONNECTOR_CREDENTIAL_MISSING',
  AI_CONNECTOR_DISABLED: 'AI_CONNECTOR_DISABLED',
  AI_CONNECTOR_NOT_FOUND: 'AI_CONNECTOR_NOT_FOUND',
  AI_MODEL_NOT_FOUND: 'AI_MODEL_NOT_FOUND',
  AI_MODEL_NOT_READY: 'AI_MODEL_NOT_READY',
  AI_LOCAL_MODEL_UNAVAILABLE: 'AI_LOCAL_MODEL_UNAVAILABLE',
  AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED: 'AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED',
  AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED: 'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED',
  AI_LOCAL_SPEECH_ENV_INIT_FAILED: 'AI_LOCAL_SPEECH_ENV_INIT_FAILED',
  AI_LOCAL_SPEECH_HOST_INIT_FAILED: 'AI_LOCAL_SPEECH_HOST_INIT_FAILED',
  AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED: 'AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED',
  AI_LOCAL_SPEECH_BUNDLE_DEGRADED: 'AI_LOCAL_SPEECH_BUNDLE_DEGRADED',
  AI_MODALITY_NOT_SUPPORTED: 'AI_MODALITY_NOT_SUPPORTED',
  AI_MEDIA_IDEMPOTENCY_CONFLICT: 'AI_MEDIA_IDEMPOTENCY_CONFLICT',
  RUNTIME_ROUTE_CAPABILITY_MISSING: 'RUNTIME_ROUTE_CAPABILITY_MISSING',
  RUNTIME_ROUTE_MODEL_MISSING: 'RUNTIME_ROUTE_MODEL_MISSING',
  RUNTIME_ROUTE_UNAVAILABLE: 'RUNTIME_ROUTE_UNAVAILABLE',
  RUNTIME_ROUTE_DEGRADED: 'RUNTIME_ROUTE_DEGRADED',
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  RUNTIME_CALL_FAILED: 'RUNTIME_CALL_FAILED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
} as const);

export type NimiRuntimeReasonCode =
  (typeof NIMI_RUNTIME_REASON_CODES)[keyof typeof NIMI_RUNTIME_REASON_CODES];

const RUNTIME_REASON_CODE_MESSAGE_ENTRIES = [
  [NIMI_RUNTIME_REASON_CODES.AI_PROVIDER_TIMEOUT, 'AI provider request timed out.'],
  [NIMI_RUNTIME_REASON_CODES.AI_PROVIDER_UNAVAILABLE, 'AI provider is unavailable.'],
  [NIMI_RUNTIME_REASON_CODES.AI_PROVIDER_RATE_LIMITED, 'AI provider rate limit was reached.'],
  [NIMI_RUNTIME_REASON_CODES.AI_PROVIDER_INTERNAL, 'AI provider returned an internal error.'],
  [NIMI_RUNTIME_REASON_CODES.AI_STREAM_BROKEN, 'AI streaming response was interrupted.'],
  [NIMI_RUNTIME_REASON_CODES.AI_CONNECTOR_CREDENTIAL_MISSING, 'AI connector credentials are missing.'],
  [NIMI_RUNTIME_REASON_CODES.AI_CONNECTOR_DISABLED, 'AI connector is disabled.'],
  [NIMI_RUNTIME_REASON_CODES.AI_CONNECTOR_NOT_FOUND, 'AI connector was not found.'],
  [NIMI_RUNTIME_REASON_CODES.AI_MODEL_NOT_FOUND, 'AI model was not found.'],
  [NIMI_RUNTIME_REASON_CODES.AI_MODEL_NOT_READY, 'AI model is not ready.'],
  [NIMI_RUNTIME_REASON_CODES.AI_LOCAL_MODEL_UNAVAILABLE, 'Local AI model is unavailable.'],
  [NIMI_RUNTIME_REASON_CODES.AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED, 'Local Speech preflight is blocked on this host.'],
  [NIMI_RUNTIME_REASON_CODES.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED, 'Local Speech requires explicit download confirmation before continuing.'],
  [NIMI_RUNTIME_REASON_CODES.AI_LOCAL_SPEECH_ENV_INIT_FAILED, 'Local Speech environment initialization failed. Retry or repair the local speech setup.'],
  [NIMI_RUNTIME_REASON_CODES.AI_LOCAL_SPEECH_HOST_INIT_FAILED, 'Local Speech host startup or probe failed.'],
  [NIMI_RUNTIME_REASON_CODES.AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED, 'The required Local Speech capability is missing and must be downloaded.'],
  [NIMI_RUNTIME_REASON_CODES.AI_LOCAL_SPEECH_BUNDLE_DEGRADED, 'The Local Speech bundle is degraded and needs repair.'],
  [NIMI_RUNTIME_REASON_CODES.AI_MODALITY_NOT_SUPPORTED, 'AI modality is not supported.'],
  [NIMI_RUNTIME_REASON_CODES.AI_MEDIA_IDEMPOTENCY_CONFLICT, 'Media task idempotency conflict occurred.'],
  [NIMI_RUNTIME_REASON_CODES.RUNTIME_ROUTE_CAPABILITY_MISSING, 'Runtime route capability is missing.'],
  [NIMI_RUNTIME_REASON_CODES.RUNTIME_ROUTE_MODEL_MISSING, 'Runtime route model is missing.'],
  [NIMI_RUNTIME_REASON_CODES.RUNTIME_ROUTE_UNAVAILABLE, 'Runtime route is unavailable.'],
  [NIMI_RUNTIME_REASON_CODES.RUNTIME_ROUTE_DEGRADED, 'Runtime route is degraded.'],
  [NIMI_RUNTIME_REASON_CODES.RUNTIME_UNAVAILABLE, 'Runtime is unavailable.'],
  [NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED, 'Runtime call failed.'],
  [NIMI_RUNTIME_REASON_CODES.SESSION_EXPIRED, 'Session has expired.'],
  [NIMI_RUNTIME_REASON_CODES.AUTH_TOKEN_INVALID, 'Authentication token is invalid.'],
  [NIMI_RUNTIME_REASON_CODES.AUTH_TOKEN_EXPIRED, 'Authentication token has expired.'],
] as const satisfies readonly (readonly [string, string])[];

export const NIMI_RUNTIME_REASON_CODE_MESSAGES: readonly NimiRuntimeReasonCodeMessageProjection[] = Object.freeze(
  RUNTIME_REASON_CODE_MESSAGE_ENTRIES.map(([reasonCode, defaultMessage]) => Object.freeze({
    reasonCode,
    defaultMessage,
  })),
);

export const NIMI_RUNTIME_REASON_CODE_MESSAGE_MAP: Readonly<Record<string, NimiRuntimeReasonCodeMessageProjection>> = Object.freeze(
  Object.fromEntries(NIMI_RUNTIME_REASON_CODE_MESSAGES.map((entry) => [entry.reasonCode, entry])),
);

export function normalizeNimiRuntimeReasonCode(reasonCode: unknown): string {
  if (typeof reasonCode === 'number') {
    const enumName = RuntimeGeneratedReasonCode[reasonCode] || '';
    return enumName === 'REASON_CODE_UNSPECIFIED' ? '' : enumName;
  }
  const normalized = String(reasonCode || '').trim();
  if (/^\d+$/u.test(normalized)) {
    return normalizeNimiRuntimeReasonCode(Number(normalized));
  }
  return normalized;
}

export function getNimiRuntimeReasonCodeMessage(reasonCode: unknown): NimiRuntimeReasonCodeMessageProjection | null {
  const normalized = normalizeNimiRuntimeReasonCode(reasonCode);
  if (!normalized) {
    return null;
  }
  return NIMI_RUNTIME_REASON_CODE_MESSAGE_MAP[normalized] || null;
}

export function getNimiRuntimeReasonCodeDefaultMessage(reasonCode: unknown): string | null {
  return getNimiRuntimeReasonCodeMessage(reasonCode)?.defaultMessage || null;
}

export type NimiRuntimeReasonCodeMessageResolver = (
  reasonCode: string,
  defaultMessage: string,
) => string | null | undefined;

export type NimiRuntimeUserFacingErrorProjection = {
  readonly code: string;
  readonly message: string;
};

export type NimiRuntimeUserFacingErrorOptions = {
  readonly fallbackMessage: string;
  readonly resolveReasonCodeMessage?: NimiRuntimeReasonCodeMessageResolver;
};

function normalizeRuntimeErrorText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRuntimeReasonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRuntimeReasonField(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

export function extractNimiRuntimeReasonCodeFromError(error: unknown): string | null {
  const record = asRuntimeReasonRecord(error);
  const direct = normalizeNimiRuntimeReasonCode(readRuntimeReasonField(record, [
    'reasonCode',
    'reason_code',
    'reason',
    'code',
  ]));
  if (direct) {
    return direct;
  }

  const message = String(record.message || (error instanceof Error ? error.message : '') || '').trim();
  if (!message) {
    return null;
  }
  const explicit = message.match(/\b(AI_[A-Z_]+|RUNTIME_[A-Z_]+|AUTH_[A-Z_]+|SESSION_[A-Z_]+)\b/u);
  if (explicit?.[1]) {
    return explicit[1];
  }
  const numeric = message.match(/\b(\d{3})\b/u);
  if (numeric?.[1]) {
    const mapped = normalizeNimiRuntimeReasonCode(numeric[1]);
    if (mapped) {
      return mapped;
    }
  }
  return null;
}

function resolveRuntimeErrorReasonCodeMessage(
  reasonCode: string,
  resolveReasonCodeMessage?: NimiRuntimeReasonCodeMessageResolver,
): string | null {
  const entry = getNimiRuntimeReasonCodeMessage(reasonCode);
  if (!entry) {
    return null;
  }
  const resolved = resolveReasonCodeMessage?.(entry.reasonCode, entry.defaultMessage);
  return normalizeRuntimeErrorText(resolved) || entry.defaultMessage;
}

function shouldUseRuntimeErrorRawMessage(
  rawMessage: string,
  actionHint: string,
  fallbackMessage: string,
): boolean {
  if (!rawMessage) {
    return false;
  }
  const normalizedRaw = rawMessage.toLowerCase();
  if (actionHint && normalizedRaw === actionHint.toLowerCase()) {
    return false;
  }
  return normalizedRaw !== 'runtime call failed'
    && normalizedRaw !== fallbackMessage.toLowerCase();
}

export function toNimiRuntimeUserFacingError(
  error: unknown,
  options: NimiRuntimeUserFacingErrorOptions,
): NimiRuntimeUserFacingErrorProjection {
  const normalized = asNimiError(error, {
    reasonCode: NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED,
    actionHint: 'retry_or_check_runtime_status',
    source: 'runtime',
  });
  const fallbackMessage = normalizeRuntimeErrorText(options.fallbackMessage) || 'Runtime call failed';
  const code = normalizeNimiRuntimeReasonCode(normalized.reasonCode) || NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED;
  const rawMessage = normalizeRuntimeErrorText(normalized.message);
  const actionHint = normalizeRuntimeErrorText(normalized.actionHint);
  const reasonCodeMessage = resolveRuntimeErrorReasonCodeMessage(
    code,
    options.resolveReasonCodeMessage,
  );

  return {
    code,
    message: shouldUseRuntimeErrorRawMessage(rawMessage, actionHint, fallbackMessage)
      ? rawMessage
      : (reasonCodeMessage || rawMessage || fallbackMessage),
  };
}

export function asNimiRuntimeCallError(
  error: unknown,
  defaults: Partial<CreateNimiErrorInput> = {},
) {
  return asNimiError(error, {
    reasonCode: NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED,
    actionHint: 'retry_or_check_runtime_status',
    source: 'runtime',
    ...defaults,
  });
}

export function formatNimiRuntimeErrorDetail(
  error: unknown,
  defaults: Partial<CreateNimiErrorInput> = {},
): string {
  const normalized = asNimiRuntimeCallError(error, defaults);
  const traceSuffix = normalized.traceId
    ? `, traceId=${normalized.traceId}`
    : '';
  return `${normalized.message} (reasonCode=${normalized.reasonCode}${traceSuffix})`;
}

export function formatNimiRuntimeErrorBanner(
  label: string,
  error: unknown,
  defaults: Partial<CreateNimiErrorInput> = {},
): string {
  return `${label}: ${formatNimiRuntimeErrorDetail(error, defaults)}`;
}
