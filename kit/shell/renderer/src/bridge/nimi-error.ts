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
  LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT: { key: 'BridgeErrors.codes.LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT', defaultValue: 'Import path is invalid. Move the model into the Local Runtime models directory and try again.' },
  LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID: { key: 'BridgeErrors.codes.LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID', defaultValue: 'Only resolved `asset.manifest.json` files under `~/.nimi/models/**/resolved/**` can be imported.' },
  LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID: { key: 'BridgeErrors.codes.LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID', defaultValue: 'Only `asset.manifest.json` manifest files can be imported.' },
  LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND: { key: 'BridgeErrors.codes.LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND', defaultValue: 'The dependency asset file to import was not found. Refresh and try again.' },
  LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID: { key: 'BridgeErrors.codes.LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID', defaultValue: 'Please choose a valid dependency asset type.' },
  LOCAL_AI_ARTIFACT_ORPHAN_TARGET_EXISTS: { key: 'BridgeErrors.codes.LOCAL_AI_ARTIFACT_ORPHAN_TARGET_EXISTS', defaultValue: 'The target dependency asset directory already exists. Rename the file or remove the old asset first.' },
  LOCAL_AI_ARTIFACT_ORPHAN_DIR_FAILED: { key: 'BridgeErrors.codes.LOCAL_AI_ARTIFACT_ORPHAN_DIR_FAILED', defaultValue: 'Failed to create the dependency asset directory. Check local file permissions.' },
  LOCAL_AI_ARTIFACT_ORPHAN_MOVE_FAILED: { key: 'BridgeErrors.codes.LOCAL_AI_ARTIFACT_ORPHAN_MOVE_FAILED', defaultValue: 'Failed to organize dependency asset files. Check file locks or permissions.' },
  LOCAL_AI_ARTIFACT_ORPHAN_SOURCE_CLEANUP_FAILED: { key: 'BridgeErrors.codes.LOCAL_AI_ARTIFACT_ORPHAN_SOURCE_CLEANUP_FAILED', defaultValue: 'Failed to clean up the original dependency asset file after copying. Please inspect the file state manually.' },
  LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_SERIALIZE_FAILED: { key: 'BridgeErrors.codes.LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_SERIALIZE_FAILED', defaultValue: 'Failed to generate the dependency asset manifest. Please try again.' },
  LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_WRITE_FAILED: { key: 'BridgeErrors.codes.LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_WRITE_FAILED', defaultValue: 'Failed to write the dependency asset manifest. Check local file permissions.' },
  LOCAL_AI_IMPORT_MANIFEST_NOT_FOUND: { key: 'BridgeErrors.codes.LOCAL_AI_IMPORT_MANIFEST_NOT_FOUND', defaultValue: 'Model manifest file was not found. Please inspect the import path.' },
  LOCAL_AI_IMPORT_MANIFEST_PARSE_FAILED: { key: 'BridgeErrors.codes.LOCAL_AI_IMPORT_MANIFEST_PARSE_FAILED', defaultValue: 'Model manifest parsing failed. Please check the JSON format.' },
  LOCAL_AI_IMPORT_HASH_MISMATCH: { key: 'BridgeErrors.codes.LOCAL_AI_IMPORT_HASH_MISMATCH', defaultValue: 'Model file verification failed. Confirm the file is intact and try again.' },
  LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN: { key: 'BridgeErrors.codes.LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN', defaultValue: 'Symbolic links are not supported for import. Import the real model file path instead.' },
  LOCAL_AI_ENDPOINT_NOT_LOOPBACK: { key: 'BridgeErrors.codes.LOCAL_AI_ENDPOINT_NOT_LOOPBACK', defaultValue: 'The local runtime endpoint only supports localhost, 127.0.0.1, or [::1].' },
  LOCAL_AI_ENDPOINT_INVALID: { key: 'BridgeErrors.codes.LOCAL_AI_ENDPOINT_INVALID', defaultValue: 'The local runtime endpoint format is invalid. Please check the address.' },
  LOCAL_AI_MODEL_NOT_FOUND: { key: 'BridgeErrors.codes.LOCAL_AI_MODEL_NOT_FOUND', defaultValue: 'No matching local asset was found. Review the Runtime asset inventory.' },
  LOCAL_AI_MODEL_HASHES_EMPTY: { key: 'BridgeErrors.codes.LOCAL_AI_MODEL_HASHES_EMPTY', defaultValue: 'The local asset has not completed integrity verification.' },
  LOCAL_AI_MODEL_CAPABILITY_INVALID: { key: 'BridgeErrors.codes.LOCAL_AI_MODEL_CAPABILITY_INVALID', defaultValue: 'Model capability configuration is invalid. Please inspect `manifest.capabilities`.' },
  LOCAL_AI_HF_DOWNLOAD_INTERRUPTED: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_INTERRUPTED', defaultValue: 'Download was interrupted. Resume the task manually after restarting.' },
  LOCAL_AI_HF_DOWNLOAD_CANCELLED: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_CANCELLED', defaultValue: 'Download has been canceled.' },
  LOCAL_AI_HF_DOWNLOAD_DISK_FULL: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_DISK_FULL', defaultValue: 'Insufficient disk space. Free up space and try the download again.' },
  LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH', defaultValue: 'Model file verification failed. Please download it again.' },
  LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE', defaultValue: 'The current download session cannot be resumed. Reinstall the model instead.' },
  LOCAL_AI_HF_DOWNLOAD_SESSION_EXISTS: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_SESSION_EXISTS', defaultValue: 'A download task for this model is already in progress.' },
  LOCAL_AI_DOWNLOAD_SESSION_NOT_FOUND: { key: 'BridgeErrors.codes.LOCAL_AI_DOWNLOAD_SESSION_NOT_FOUND', defaultValue: 'Download session was not found. Refresh and try again.' },
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
  LOCAL_AI_SPEECH_GPU_REQUIRED: { key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_GPU_REQUIRED', defaultValue: 'Local Speech requires an available NVIDIA GPU environment.' },
  LOCAL_AI_SPEECH_PYTHON_REQUIRED: { key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_PYTHON_REQUIRED', defaultValue: 'Local Speech requires Python 3.10+.' },
  LOCAL_AI_SPEECH_PYTHON_VERSION_UNSUPPORTED: { key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_PYTHON_VERSION_UNSUPPORTED', defaultValue: 'Local Speech requires Python 3.10+. The current version is unsupported.' },
  LOCAL_AI_SPEECH_BOOTSTRAP_FAILED: { key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_BOOTSTRAP_FAILED', defaultValue: 'Local Speech environment setup failed. Please check Python, dependencies, and network access.' },
};

const SHELL_BRIDGE_ERROR_PATTERNS: Array<{ pattern: RegExp } & ShellBridgeUserMessageProjection> = [
  { pattern: /桥接不可用|Tauri.*不可用/i, key: 'BridgeErrors.patterns.runtimeUnavailable', defaultValue: 'Desktop runtime is not ready. Please restart the app.' },
  { pattern: /HF 下载失败|hugging ?face|download failed/i, key: 'BridgeErrors.patterns.downloadFailed', defaultValue: 'Model download failed. Please check the network or repository address.' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_DISK_FULL|ENOSPC|disk full/i, key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_DISK_FULL', defaultValue: 'Insufficient disk space. Free up space and try the download again.' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_INTERRUPTED|interrupted/i, key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_INTERRUPTED', defaultValue: 'Download was interrupted. Resume the task manually after restarting.' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_PAUSED|paused/i, key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_PAUSED', defaultValue: 'Download is paused and can be resumed later.' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_CANCELLED|cancelled/i, key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_CANCELLED', defaultValue: 'Download has been canceled.' },
  { pattern: /hash 校验失败|checksum|sha256/i, key: 'BridgeErrors.patterns.hashMismatch', defaultValue: 'Model file verification failed. Please download or import it again.' },
  { pattern: /LOCAL_AI_SPEECH_GPU_REQUIRED|NVIDIA GPU/i, key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_GPU_REQUIRED', defaultValue: 'Local Speech requires an available NVIDIA GPU environment.' },
  { pattern: /LOCAL_AI_SPEECH_PYTHON_REQUIRED|Python 3\.10/i, key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_PYTHON_REQUIRED', defaultValue: 'Local Speech requires Python 3.10+.' },
  { pattern: /LOCAL_AI_SPEECH_BOOTSTRAP_FAILED|local-speech-python|pip install/i, key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_BOOTSTRAP_FAILED', defaultValue: 'Local Speech environment setup failed. Please check Python and dependency installation.' },
  { pattern: /manifest.*不能为空|manifest.*失败|model\.manifest\.json/i, key: 'BridgeErrors.patterns.invalidManifest', defaultValue: 'Model manifest is invalid. Please inspect the manifest file.' },
  { pattern: /engine.*failed/i, key: 'BridgeErrors.patterns.localEngineUnavailable', defaultValue: 'Runtime local execution is unavailable. Inspect Runtime diagnostics.' },
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
