import { ReasonCode } from '../types/index.js';
import { ReasonCode as RuntimeReasonCode } from './generated/runtime/v1/common.js';

export type RuntimeReasonCodeMessageProjection = {
  reasonCode: string;
  defaultMessage: string;
};

const RUNTIME_REASON_CODE_MESSAGE_ENTRIES = [
  [ReasonCode.AI_PROVIDER_TIMEOUT, 'AI provider request timed out.'],
  [ReasonCode.AI_PROVIDER_UNAVAILABLE, 'AI provider is unavailable.'],
  [ReasonCode.AI_PROVIDER_RATE_LIMITED, 'AI provider rate limit was reached.'],
  [ReasonCode.AI_PROVIDER_INTERNAL, 'AI provider returned an internal error.'],
  [ReasonCode.AI_PROVIDER_ENDPOINT_FORBIDDEN, 'AI provider endpoint is forbidden.'],
  [ReasonCode.AI_PROVIDER_AUTH_FAILED, 'AI provider authentication failed.'],
  [ReasonCode.AI_STREAM_BROKEN, 'AI streaming response was interrupted.'],
  [ReasonCode.AI_CONNECTOR_CREDENTIAL_MISSING, 'AI connector credentials are missing.'],
  [ReasonCode.AI_CONNECTOR_DISABLED, 'AI connector is disabled.'],
  [ReasonCode.AI_CONNECTOR_NOT_FOUND, 'AI connector was not found.'],
  [ReasonCode.AI_CONNECTOR_INVALID, 'AI connector configuration is invalid.'],
  [ReasonCode.AI_CONNECTOR_IMMUTABLE, 'AI connector cannot be modified.'],
  [ReasonCode.AI_CONNECTOR_LIMIT_EXCEEDED, 'AI connector limit has been exceeded.'],
  [ReasonCode.AI_MODEL_NOT_FOUND, 'AI model was not found.'],
  [ReasonCode.AI_MODEL_NOT_READY, 'AI model is not ready.'],
  [ReasonCode.AI_MODALITY_NOT_SUPPORTED, 'AI modality is not supported.'],
  [ReasonCode.AI_MODEL_PROVIDER_MISMATCH, 'AI model does not match the selected provider.'],
  [ReasonCode.AI_MEDIA_IDEMPOTENCY_CONFLICT, 'Media task idempotency conflict occurred.'],
  [ReasonCode.AI_MEDIA_JOB_NOT_FOUND, 'Media task was not found.'],
  [ReasonCode.AI_MEDIA_SPEC_INVALID, 'Media specification is invalid.'],
  [ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED, 'Media option is not supported.'],
  [ReasonCode.AI_MEDIA_JOB_NOT_CANCELLABLE, 'Media task cannot be canceled.'],
  [ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE, 'Local AI model is unavailable.'],
  [ReasonCode.AI_LOCAL_MODEL_PROFILE_MISSING, 'Local AI model profile is missing.'],
  [ReasonCode.AI_LOCAL_ASSET_ALREADY_INSTALLED, 'Local AI asset is already installed.'],
  [ReasonCode.AI_LOCAL_ENDPOINT_REQUIRED, 'Local AI endpoint configuration is missing.'],
  ['AI_LOCAL_TEMPLATE_NOT_FOUND', 'Local AI template was not found.'],
  [ReasonCode.AI_LOCAL_MANIFEST_INVALID, 'Local AI manifest is invalid.'],
  [ReasonCode.AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED, 'Local Speech cannot initialize until local prerequisites are satisfied.'],
  [ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED, 'Local Speech requires explicit download confirmation before continuing.'],
  [ReasonCode.AI_LOCAL_SPEECH_ENV_INIT_FAILED, 'Local Speech environment initialization failed. Retry or repair the local speech setup.'],
  [ReasonCode.AI_LOCAL_SPEECH_HOST_INIT_FAILED, 'Local Speech service startup failed. Check the local speech environment and try again.'],
  [ReasonCode.AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED, 'The required Local Speech capability download failed. Retry that capability download.'],
  [ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED, 'Local Speech is degraded and must be repaired before continuing.'],
  [ReasonCode.LOCAL_AI_HF_DOWNLOAD_PAUSED, 'Download is paused and can be resumed later.'],
  [ReasonCode.LOCAL_AI_PROFILE_NOT_FOUND, 'Local AI profile was not found.'],
  [ReasonCode.LOCAL_LIFECYCLE_WRITE_DENIED, 'The current source is not allowed to perform local model lifecycle writes.'],
  [ReasonCode.AUTH_REVOCATION_UNAVAILABLE, 'Authentication revocation check is temporarily unavailable.'],
  [ReasonCode.AUTH_TOKEN_INVALID, 'Authentication token is invalid.'],
  [ReasonCode.AUTH_TOKEN_EXPIRED, 'Authentication token has expired.'],
  [ReasonCode.SESSION_EXPIRED, 'Session has expired.'],
  [ReasonCode.APP_MODE_DOMAIN_FORBIDDEN, 'App mode domain is forbidden.'],
  [ReasonCode.APP_MODE_SCOPE_FORBIDDEN, 'App mode scope is forbidden.'],
  [ReasonCode.APP_MODE_MANIFEST_INVALID, 'App mode manifest is invalid.'],
  [ReasonCode.RUNTIME_ROUTE_CAPABILITY_MISSING, 'Runtime route capability is missing.'],
  [ReasonCode.RUNTIME_ROUTE_MODEL_MISSING, 'Runtime route model is missing.'],
  [ReasonCode.RUNTIME_ROUTE_UNAVAILABLE, 'Runtime route is unavailable.'],
  [ReasonCode.RUNTIME_ROUTE_DEGRADED, 'Runtime route is degraded.'],
  [ReasonCode.RUNTIME_UNAVAILABLE, 'Runtime is unavailable.'],
  [ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE, 'Runtime daemon is unavailable.'],
  [ReasonCode.RUNTIME_CALL_FAILED, 'Runtime call failed.'],
] as const satisfies readonly (readonly [string, string])[];

export const RUNTIME_REASON_CODE_MESSAGES: readonly RuntimeReasonCodeMessageProjection[] = Object.freeze(
  RUNTIME_REASON_CODE_MESSAGE_ENTRIES.map(([reasonCode, defaultMessage]) => Object.freeze({
    reasonCode,
    defaultMessage,
  })),
);

export const RUNTIME_REASON_CODE_MESSAGE_MAP: Readonly<Record<string, RuntimeReasonCodeMessageProjection>> = Object.freeze(
  Object.fromEntries(RUNTIME_REASON_CODE_MESSAGES.map((entry) => [entry.reasonCode, entry])),
);

export function getRuntimeReasonCodeMessage(reasonCode: unknown): RuntimeReasonCodeMessageProjection | null {
  const normalized = String(reasonCode || '').trim();
  if (!normalized) {
    return null;
  }
  return RUNTIME_REASON_CODE_MESSAGE_MAP[normalized] || null;
}

export function getRuntimeReasonCodeDefaultMessage(reasonCode: unknown): string | null {
  return getRuntimeReasonCodeMessage(reasonCode)?.defaultMessage || null;
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

export function normalizeRuntimeReasonCode(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const enumName = (RuntimeReasonCode as unknown as Record<number, string>)[value];
    return enumName && enumName !== 'REASON_CODE_UNSPECIFIED' ? String(enumName).trim() : '';
  }
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (/^\d+$/.test(normalized)) {
    return normalizeRuntimeReasonCode(Number(normalized));
  }
  return normalized;
}

export function extractRuntimeReasonCodeFromError(error: unknown): string | null {
  const record = asRuntimeReasonRecord(error);
  const direct = normalizeRuntimeReasonCode(readRuntimeReasonField(record, [
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
  const explicit = message.match(/\b(AI_[A-Z_]+|RUNTIME_[A-Z_]+|AUTH_[A-Z_]+|SESSION_[A-Z_]+)\b/);
  if (explicit?.[1]) {
    return explicit[1];
  }
  const numeric = message.match(/\b(\d{3})\b/);
  if (numeric?.[1]) {
    const mapped = normalizeRuntimeReasonCode(numeric[1]);
    if (mapped) {
      return mapped;
    }
  }
  return null;
}
