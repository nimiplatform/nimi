import {
  asNimiError,
  createNimiError,
  getNimiRuntimeReasonCodeMessage,
  isNimiError,
  NIMI_RUNTIME_REASON_CODES,
  type NimiError,
} from '@nimiplatform/kit/core/sdk-contract';
import { parseOptionalJsonObject, type JsonObject, type JsonValue } from './types.js';

export type ShellBridgeStructuredError = {
  code?: string;
  reasonCode?: string;
  actionHint?: string;
  traceId?: string;
  retryable?: boolean;
  message?: string;
  details?: JsonObject;
};

export type ShellBridgeUserMessageProjection = {
  key: string;
  defaultValue: string;
};

export type ShellBridgeNimiErrorOptions = {
  translate?: (key: string, defaultValue: string) => string;
};

const SHELL_BRIDGE_ERROR_CODE_MAP: Record<string, ShellBridgeUserMessageProjection> = {
  REALM_UNAVAILABLE: { key: 'BridgeErrors.codes.REALM_UNAVAILABLE', defaultValue: 'Realm service is unavailable. Start or repair Realm and try again.' },
  DESKTOP_HTTP_PAYLOAD_INVALID: { key: 'BridgeErrors.codes.DESKTOP_HTTP_PAYLOAD_INVALID', defaultValue: 'Request payload is invalid. Please try again.' },
  DESKTOP_HTTP_METHOD_INVALID: { key: 'BridgeErrors.codes.DESKTOP_HTTP_METHOD_INVALID', defaultValue: 'Unsupported request method. Please review the request configuration.' },
  DESKTOP_HTTP_URL_REQUIRED: { key: 'BridgeErrors.codes.DESKTOP_HTTP_URL_REQUIRED', defaultValue: 'Request URL is required. Please review the request configuration.' },
  DESKTOP_HTTP_URL_SCHEME_INVALID: { key: 'BridgeErrors.codes.DESKTOP_HTTP_URL_SCHEME_INVALID', defaultValue: 'Invalid request URL. Please review the configuration.' },
  DESKTOP_HTTP_URL_HOST_MISSING: { key: 'BridgeErrors.codes.DESKTOP_HTTP_URL_HOST_MISSING', defaultValue: 'Request URL is missing a host. Please review the configuration.' },
  DESKTOP_HTTP_HEADER_RESTRICTED: { key: 'BridgeErrors.codes.DESKTOP_HTTP_HEADER_RESTRICTED', defaultValue: 'Restricted request headers cannot be overridden from the renderer.' },
  DESKTOP_HTTP_FETCH_UNAVAILABLE: { key: 'BridgeErrors.codes.DESKTOP_HTTP_FETCH_UNAVAILABLE', defaultValue: 'This feature is not available in the current environment.' },
  DESKTOP_HTTP_SEND_FAILED: { key: 'BridgeErrors.codes.DESKTOP_HTTP_SEND_FAILED', defaultValue: 'Network request failed. Check the target service and try again.' },
  DESKTOP_AVATAR_HANDOFF_INVALID: { key: 'BridgeErrors.codes.DESKTOP_AVATAR_HANDOFF_INVALID', defaultValue: 'Avatar handoff payload is invalid. Reopen the avatar from an active desktop agent target.' },
  DESKTOP_AVATAR_HANDOFF_OPEN_FAILED: { key: 'BridgeErrors.codes.DESKTOP_AVATAR_HANDOFF_OPEN_FAILED', defaultValue: 'Failed to open the avatar app handoff. Check that the avatar app is available on this desktop.' },
  DESKTOP_OAUTH_REDIRECT_URI_REQUIRED: { key: 'BridgeErrors.codes.DESKTOP_OAUTH_REDIRECT_URI_REQUIRED', defaultValue: 'OAuth redirect URI is required.' },
  DESKTOP_OAUTH_LISTEN_UNAVAILABLE: { key: 'BridgeErrors.codes.DESKTOP_OAUTH_LISTEN_UNAVAILABLE', defaultValue: 'OAuth code listening requires the desktop runtime.' },
};

const SHELL_BRIDGE_ERROR_PATTERNS: Array<{ pattern: RegExp } & ShellBridgeUserMessageProjection> = [
  { pattern: /桥接不可用|Tauri.*不可用/i, key: 'BridgeErrors.patterns.runtimeUnavailable', defaultValue: 'Desktop runtime is not ready. Please restart the app.' },
  { pattern: /LOCAL_LIFECYCLE_WRITE_DENIED/i, key: 'BridgeErrors.codes.LOCAL_LIFECYCLE_WRITE_DENIED', defaultValue: 'The current source is not allowed to perform local model lifecycle writes.' },
];

const REDACTED_BRIDGE_VALUE = '[REDACTED]';
const REDACTED_BRIDGE_PATH = '[REDACTED_PATH]';

function scrubBridgeErrorText(input: unknown): string {
  return String(input || '').trim()
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, `Bearer ${REDACTED_BRIDGE_VALUE}`)
    .replace(/\b(authorization|proxy-authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|credential|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, `$1=${REDACTED_BRIDGE_VALUE}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, REDACTED_BRIDGE_VALUE)
    .replace(/([?&](?:access_token|refresh_token|api_key|apikey|token|secret)=)[^&#\s]*/giu, `$1${REDACTED_BRIDGE_VALUE}`)
    .replace(/\bfile:\/\/\/?[^\s"'<>]+/giu, REDACTED_BRIDGE_PATH)
    .replace(/\b[A-Za-z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]*/gu, REDACTED_BRIDGE_PATH)
    .replace(/\/(?:Users|home|root|tmp|private)(?:\/[^\s"'<>]*)?/gu, REDACTED_BRIDGE_PATH);
}

function bridgeDetailKeyKind(key: string): 'credential' | 'path' | null {
  const normalized = key.trim().toLowerCase().replace(/[-_]/gu, '');
  if (
    normalized.includes('authorization')
    || normalized.includes('bearer')
    || normalized.includes('credential')
    || normalized.includes('password')
    || normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('apikey')
    || normalized.includes('header')
    || normalized.includes('providerpayload')
    || normalized.includes('rawpayload')
  ) {
    return 'credential';
  }
  if (
    normalized === 'cwd'
    || normalized === 'home'
    || normalized.includes('path')
    || normalized.includes('filename')
  ) {
    return 'path';
  }
  return null;
}

function scrubBridgeDetailValue(value: JsonValue, depth = 0): JsonValue {
  if (depth >= 6) return '[TRUNCATED]';
  if (typeof value === 'string') return scrubBridgeErrorText(value);
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((entry) => scrubBridgeDetailValue(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;
  const scrubbed: JsonObject = {};
  for (const [key, entry] of Object.entries(value).slice(0, 48)) {
    const keyKind = bridgeDetailKeyKind(key);
    scrubbed[key] = keyKind === 'credential'
      ? REDACTED_BRIDGE_VALUE
      : keyKind === 'path'
        ? REDACTED_BRIDGE_PATH
        : scrubBridgeDetailValue(entry, depth + 1);
  }
  return scrubbed;
}

function scrubBridgeErrorDetails(details: JsonObject | undefined): JsonObject {
  return (scrubBridgeDetailValue(details || {}) || {}) as JsonObject;
}

function asRecord(value: unknown): JsonObject {
  return parseOptionalJsonObject(value) || {};
}

export function parseShellBridgeJsonPayload(input: unknown): ShellBridgeStructuredError | null {
  if (!input) {
    return null;
  }
  const directRecord = asRecord(input);
  if (Object.keys(directRecord).length > 0) {
    const reasonCode = String(directRecord.reasonCode || directRecord.reason_code || '').trim();
    const actionHint = String(directRecord.actionHint || directRecord.action_hint || '').trim();
    const traceId = String(directRecord.traceId || directRecord.trace_id || '').trim();
    const message = String(directRecord.message || '').trim();
    const retryableRaw = directRecord.retryable;
    const retryable = typeof retryableRaw === 'boolean'
      ? retryableRaw
      : undefined;
    const hasStructuredFields = Boolean(
      reasonCode
      || actionHint
      || traceId
      || typeof retryable === 'boolean',
    );
    if (!hasStructuredFields) {
      return null;
    }
    return {
      code: String(directRecord.code || '').trim() || undefined,
      reasonCode: reasonCode || undefined,
      actionHint: actionHint || undefined,
      traceId: traceId || undefined,
      retryable,
      message: message || undefined,
      details: asRecord(directRecord.details),
    };
  }

  const raw = String(input || '').trim();
  if (!raw) {
    return null;
  }
  const parseObject = (candidate: string): ShellBridgeStructuredError | null => {
    try {
      return parseShellBridgeJsonPayload(JSON.parse(candidate));
    } catch {
      return null;
    }
  };

  const directParsed = parseObject(raw);
  if (directParsed) {
    return directParsed;
  }
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    return parseObject(raw.slice(braceStart, braceEnd + 1));
  }
  return null;
}

export function extractShellBridgeErrorCode(raw: string): string {
  const normalized = String(raw || '').trim();
  const matched = normalized.match(/^([A-Z0-9_]+)(?::|$)/);
  return matched?.[1] || '';
}

export function getShellBridgeUserMessageProjection(error: unknown): ShellBridgeUserMessageProjection {
  const raw = error instanceof Error ? error.message : String(error || '');
  const codeFromNimiError = isNimiError(error) ? String(error.reasonCode || '').trim() : '';
  const codeFromPayload = parseShellBridgeJsonPayload(error)?.reasonCode || '';
  const errorCode = codeFromNimiError || codeFromPayload || extractShellBridgeErrorCode(raw);
  const runtimeReasonProjection = getNimiRuntimeReasonCodeMessage(errorCode);
  if (runtimeReasonProjection) {
    return {
      key: `BridgeErrors.codes.${runtimeReasonProjection.reasonCode}`,
      defaultValue: runtimeReasonProjection.defaultMessage,
    };
  }
  const mappedProjection = errorCode
    ? SHELL_BRIDGE_ERROR_CODE_MAP[errorCode]
    : undefined;
  if (mappedProjection) {
    return mappedProjection;
  }
  for (const entry of SHELL_BRIDGE_ERROR_PATTERNS) {
    if (entry.pattern.test(raw)) {
      return {
        key: entry.key,
        defaultValue: entry.defaultValue,
      };
    }
  }
  return {
    key: 'BridgeErrors.generic',
    defaultValue: 'Operation failed. Please try again later.',
  };
}

export function toShellBridgeUserMessage(error: unknown, options?: ShellBridgeNimiErrorOptions): string {
  const projection = getShellBridgeUserMessageProjection(error);
  return options?.translate
    ? options.translate(projection.key, projection.defaultValue)
    : projection.defaultValue;
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r073
export function toShellBridgeNimiError(error: unknown, options?: ShellBridgeNimiErrorOptions): NimiError {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const normalized: NimiError = (() => {
    if (isNimiError(error)) {
      return error;
    }

    const parsedPayload = parseShellBridgeJsonPayload(error) || parseShellBridgeJsonPayload(rawMessage);
    if (parsedPayload) {
      return createNimiError({
        message: parsedPayload.message || rawMessage || 'RUNTIME_CALL_FAILED',
        code: parsedPayload.code || parsedPayload.reasonCode || NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED,
        reasonCode: parsedPayload.reasonCode || NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED,
        actionHint: parsedPayload.actionHint || 'retry_or_check_runtime_status',
        traceId: parsedPayload.traceId || '',
        retryable: parsedPayload.retryable ?? false,
        source: 'runtime',
        details: parsedPayload.details,
      });
    }

    const prefixedCode = extractShellBridgeErrorCode(rawMessage);
    if (prefixedCode) {
      return createNimiError({
        message: rawMessage || prefixedCode,
        code: prefixedCode,
        reasonCode: prefixedCode,
        actionHint: 'check_runtime_bridge_logs',
        source: 'runtime',
      });
    }

    return asNimiError(error, {
      reasonCode: NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED,
      actionHint: 'retry_or_check_runtime_status',
      source: 'runtime',
    });
  })();

  normalized.message = scrubBridgeErrorText(normalized.message) || normalized.reasonCode;
  normalized.actionHint = scrubBridgeErrorText(normalized.actionHint) || 'check_runtime_bridge_logs';
  const originalTraceId = String(normalized.traceId || '').trim();
  const scrubbedTraceId = scrubBridgeErrorText(originalTraceId);
  normalized.traceId = scrubbedTraceId === originalTraceId ? scrubbedTraceId : '';
  const scrubbedDetails = scrubBridgeErrorDetails(normalized.details);
  normalized.details = {
    ...scrubbedDetails,
    userMessage: toShellBridgeUserMessage(normalized, options),
    rawMessage: normalized.message,
  };
  return normalized;
}
