import { asNimiError, createNimiError, getRuntimeReasonCodeMessage, isNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode, type NimiError } from '@nimiplatform/sdk/types';
import { invokeTauri } from '@nimiplatform/kit/shell/renderer/bridge';
import { i18n } from '@renderer/i18n';
import { hasTauriInvoke } from './env';
import { emitRendererLog, resolveRendererSessionTraceId, toRendererLogMessage } from '@nimiplatform/kit/telemetry';
import { parseOptionalJsonObject } from './shared.js';
import type { RuntimeBridgeStructuredError } from './types';
import type { JsonObject } from './types';

const BRIDGE_ERROR_CODE_MAP: Record<string, { key: string; defaultValue: string }> = {
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
  LOCAL_AI_MODEL_NOT_FOUND: { key: 'BridgeErrors.codes.LOCAL_AI_MODEL_NOT_FOUND', defaultValue: 'No available model was found. Install and enable one first.' },
  LOCAL_AI_MODEL_HASHES_EMPTY: { key: 'BridgeErrors.codes.LOCAL_AI_MODEL_HASHES_EMPTY', defaultValue: 'The model has not completed integrity verification and cannot be started.' },
  LOCAL_AI_MODEL_CAPABILITY_INVALID: { key: 'BridgeErrors.codes.LOCAL_AI_MODEL_CAPABILITY_INVALID', defaultValue: 'Model capability configuration is invalid. Please inspect `manifest.capabilities`.' },
  LOCAL_AI_HF_DOWNLOAD_INTERRUPTED: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_INTERRUPTED', defaultValue: 'Download was interrupted. Resume the task manually after restarting.' },
  LOCAL_AI_HF_DOWNLOAD_CANCELLED: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_CANCELLED', defaultValue: 'Download has been canceled.' },
  LOCAL_AI_HF_DOWNLOAD_DISK_FULL: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_DISK_FULL', defaultValue: 'Insufficient disk space. Free up space and try the download again.' },
  LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH', defaultValue: 'Model file verification failed. Please download it again.' },
  LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE', defaultValue: 'The current download session cannot be resumed. Reinstall the model instead.' },
  LOCAL_AI_HF_DOWNLOAD_SESSION_EXISTS: { key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_SESSION_EXISTS', defaultValue: 'A download task for this model is already in progress.' },
  LOCAL_AI_DOWNLOAD_SESSION_NOT_FOUND: { key: 'BridgeErrors.codes.LOCAL_AI_DOWNLOAD_SESSION_NOT_FOUND', defaultValue: 'Download session was not found. Refresh and try again.' },
  RUNTIME_ROUTE_CAPABILITY_MISMATCH: { key: 'BridgeErrors.codes.RUNTIME_ROUTE_CAPABILITY_MISMATCH', defaultValue: 'The current route is bound to a model with incompatible capabilities. Switch to a matching model.' },
  DESKTOP_HTTP_PAYLOAD_INVALID: { key: 'BridgeErrors.codes.DESKTOP_HTTP_PAYLOAD_INVALID', defaultValue: 'Request payload is invalid. Please try again.' },
  DESKTOP_HTTP_METHOD_INVALID: { key: 'BridgeErrors.codes.DESKTOP_HTTP_METHOD_INVALID', defaultValue: 'Unsupported request method. Please review the request configuration.' },
  DESKTOP_HTTP_URL_REQUIRED: { key: 'BridgeErrors.codes.DESKTOP_HTTP_URL_REQUIRED', defaultValue: 'Request URL is required. Please review the request configuration.' },
  DESKTOP_HTTP_URL_SCHEME_INVALID: { key: 'BridgeErrors.codes.DESKTOP_HTTP_URL_SCHEME_INVALID', defaultValue: 'Invalid request URL. Please review the configuration.' },
  DESKTOP_HTTP_URL_HOST_MISSING: { key: 'BridgeErrors.codes.DESKTOP_HTTP_URL_HOST_MISSING', defaultValue: 'Request URL is missing a host. Please review the configuration.' },
  DESKTOP_HTTP_HEADER_RESTRICTED: { key: 'BridgeErrors.codes.DESKTOP_HTTP_HEADER_RESTRICTED', defaultValue: 'Restricted request headers cannot be overridden from the renderer.' },
  DESKTOP_HTTP_FETCH_UNAVAILABLE: { key: 'BridgeErrors.codes.DESKTOP_HTTP_FETCH_UNAVAILABLE', defaultValue: 'This feature is not available in the current environment.' },
  DESKTOP_AVATAR_HANDOFF_INVALID: { key: 'BridgeErrors.codes.DESKTOP_AVATAR_HANDOFF_INVALID', defaultValue: 'Avatar handoff payload is invalid. Reopen the avatar from an active desktop agent target.' },
  DESKTOP_AVATAR_HANDOFF_OPEN_FAILED: { key: 'BridgeErrors.codes.DESKTOP_AVATAR_HANDOFF_OPEN_FAILED', defaultValue: 'Failed to open the avatar app handoff. Check that the avatar app is available on this desktop.' },
  DESKTOP_OAUTH_TOKEN_EXCHANGE_INPUT_INVALID: { key: 'BridgeErrors.codes.DESKTOP_OAUTH_TOKEN_EXCHANGE_INPUT_INVALID', defaultValue: 'OAuth token exchange requires provider, clientId, and code.' },
  DESKTOP_OAUTH_TOKEN_EXCHANGE_UNAVAILABLE: { key: 'BridgeErrors.codes.DESKTOP_OAUTH_TOKEN_EXCHANGE_UNAVAILABLE', defaultValue: 'OAuth token exchange is not available in the current environment.' },
  DESKTOP_OAUTH_TOKEN_EXCHANGE_RESPONSE_INVALID: { key: 'BridgeErrors.codes.DESKTOP_OAUTH_TOKEN_EXCHANGE_RESPONSE_INVALID', defaultValue: 'OAuth token response is invalid.' },
  DESKTOP_OAUTH_REDIRECT_URI_REQUIRED: { key: 'BridgeErrors.codes.DESKTOP_OAUTH_REDIRECT_URI_REQUIRED', defaultValue: 'OAuth redirect URI is required.' },
  DESKTOP_OAUTH_LISTEN_UNAVAILABLE: { key: 'BridgeErrors.codes.DESKTOP_OAUTH_LISTEN_UNAVAILABLE', defaultValue: 'OAuth code listening requires the desktop runtime.' },
  LOCAL_AI_SPEECH_GPU_REQUIRED: { key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_GPU_REQUIRED', defaultValue: 'Local Speech requires an available NVIDIA GPU environment.' },
  LOCAL_AI_SPEECH_PYTHON_REQUIRED: { key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_PYTHON_REQUIRED', defaultValue: 'Local Speech requires Python 3.10+.' },
  LOCAL_AI_SPEECH_PYTHON_VERSION_UNSUPPORTED: { key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_PYTHON_VERSION_UNSUPPORTED', defaultValue: 'Local Speech requires Python 3.10+. The current version is unsupported.' },
  LOCAL_AI_SPEECH_BOOTSTRAP_FAILED: { key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_BOOTSTRAP_FAILED', defaultValue: 'Local Speech environment setup failed. Please check Python, dependencies, and network access.' },
};

const BRIDGE_ERROR_MAP: Array<{ pattern: RegExp; key: string; defaultValue: string }> = [
  { pattern: /桥接不可用|Tauri.*不可用/i, key: 'BridgeErrors.patterns.runtimeUnavailable', defaultValue: 'Desktop runtime is not ready. Please restart the app.' },
  { pattern: /HF 下载失败|hugging ?face|download failed/i, key: 'BridgeErrors.patterns.downloadFailed', defaultValue: 'Model download failed. Please check the network or repository address.' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_DISK_FULL|ENOSPC|disk full/i, key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_DISK_FULL', defaultValue: 'Insufficient disk space. Free up space and try the download again.' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_INTERRUPTED|interrupted/i, key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_INTERRUPTED', defaultValue: 'Download was interrupted. Resume the task manually after restarting.' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_PAUSED|paused/i, key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_PAUSED', defaultValue: 'Download is paused and can be resumed later.' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_CANCELLED|cancelled/i, key: 'BridgeErrors.codes.LOCAL_AI_HF_DOWNLOAD_CANCELLED', defaultValue: 'Download has been canceled.' },
  { pattern: /hash 校验失败|checksum|sha256/i, key: 'BridgeErrors.patterns.hashMismatch', defaultValue: 'Model file verification failed. Please download or import it again.' },
  { pattern: /LOCAL_AI_SPEECH_GPU_REQUIRED|NVIDIA GPU/i, key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_GPU_REQUIRED', defaultValue: 'Local Speech requires an available NVIDIA GPU environment.' },
  { pattern: /LOCAL_AI_SPEECH_PYTHON_REQUIRED|Python 3\\.10/i, key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_PYTHON_REQUIRED', defaultValue: 'Local Speech requires Python 3.10+.' },
  { pattern: /LOCAL_AI_SPEECH_BOOTSTRAP_FAILED|local-speech-python|pip install/i, key: 'BridgeErrors.codes.LOCAL_AI_SPEECH_BOOTSTRAP_FAILED', defaultValue: 'Local Speech environment setup failed. Please check Python and dependency installation.' },
  { pattern: /manifest.*不能为空|manifest.*失败|model\.manifest\.json/i, key: 'BridgeErrors.patterns.invalidManifest', defaultValue: 'Model manifest is invalid. Please inspect the manifest file.' },
  { pattern: /模型不存在|model.*missing|RUNTIME_ROUTE_MODEL_MISSING/i, key: 'BridgeErrors.codes.LOCAL_AI_MODEL_NOT_FOUND', defaultValue: 'No available model was found. Install and enable one first.' },
  { pattern: /connector.*missing|RUNTIME_ROUTE_CONNECTOR/i, key: 'BridgeErrors.patterns.connectorMissing', defaultValue: 'Token API connector is unavailable. Please check connector settings.' },
  { pattern: /RUNTIME_ROUTE_CAPABILITY_MISMATCH|capability mismatch/i, key: 'BridgeErrors.codes.RUNTIME_ROUTE_CAPABILITY_MISMATCH', defaultValue: 'The current route is bound to a model with incompatible capabilities. Switch to a matching model.' },
  { pattern: /unhealthy|engine.*failed|llama\.cpp/i, key: 'BridgeErrors.patterns.localEngineUnavailable', defaultValue: 'Local engine is unavailable. Please check engine health or binary paths.' },
  { pattern: /LOCAL_LIFECYCLE_WRITE_DENIED/i, key: 'BridgeErrors.codes.LOCAL_LIFECYCLE_WRITE_DENIED', defaultValue: 'The current source is not allowed to perform local model lifecycle writes.' },
];

function translateBridgeMessage(key: string, defaultValue: string): string {
  if (!i18n.isInitialized) {
    return defaultValue;
  }
  const translated = i18n.t(key, { defaultValue });
  return typeof translated === 'string' && translated.trim().length > 0
    ? translated
    : defaultValue;
}

function asRecord(value: unknown): JsonObject {
  return parseOptionalJsonObject(value) || {};
}

function parseBridgeJsonPayload(input: unknown): RuntimeBridgeStructuredError | null {
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
  const parseObject = (candidate: string): RuntimeBridgeStructuredError | null => {
    try {
      return parseBridgeJsonPayload(JSON.parse(candidate));
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

function extractBridgeErrorCode(raw: string): string {
  const normalized = String(raw || '').trim();
  const matched = normalized.match(/^([A-Z0-9_]+)(?::|$)/);
  return matched?.[1] || '';
}

export function toBridgeUserMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const codeFromNimiError = isNimiError(error) ? String(error.reasonCode || '').trim() : '';
  const codeFromPayload = parseBridgeJsonPayload(error)?.reasonCode || '';
  const errorCode = codeFromNimiError || codeFromPayload || extractBridgeErrorCode(raw);
  const runtimeReasonProjection = getRuntimeReasonCodeMessage(errorCode);
  if (runtimeReasonProjection) {
    return translateBridgeMessage(
      `BridgeErrors.codes.${runtimeReasonProjection.reasonCode}`,
      runtimeReasonProjection.defaultMessage,
    );
  }
  if (errorCode && BRIDGE_ERROR_CODE_MAP[errorCode]) {
    return translateBridgeMessage(
      BRIDGE_ERROR_CODE_MAP[errorCode].key,
      BRIDGE_ERROR_CODE_MAP[errorCode].defaultValue,
    );
  }
  for (const entry of BRIDGE_ERROR_MAP) {
    if (entry.pattern.test(raw)) {
      return translateBridgeMessage(entry.key, entry.defaultValue);
    }
  }
  return translateBridgeMessage(
    'BridgeErrors.generic',
    'Operation failed. Please try again later.',
  );
}

export function toBridgeNimiError(error: unknown): NimiError {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const normalized: NimiError = (() => {
    if (isNimiError(error)) {
      return error;
    }

    const parsedPayload = parseBridgeJsonPayload(error) || parseBridgeJsonPayload(rawMessage);
    if (parsedPayload) {
      return createNimiError({
        message: parsedPayload.message || rawMessage || 'RUNTIME_CALL_FAILED',
        code: parsedPayload.code || parsedPayload.reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
        reasonCode: parsedPayload.reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: parsedPayload.actionHint || 'retry_or_check_runtime_status',
        traceId: parsedPayload.traceId || '',
        retryable: parsedPayload.retryable ?? false,
        source: 'runtime',
        details: parsedPayload.details,
      });
    }

    const prefixedCode = extractBridgeErrorCode(rawMessage);
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
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_or_check_runtime_status',
      source: 'runtime',
    });
  })();

  const userMessage = toBridgeUserMessage(normalized);
  normalized.details = {
    ...(normalized.details || {}),
    userMessage,
    rawMessage: rawMessage || normalized.message,
  };
  return normalized;
}

function summarizeInvokePayload(command: string, payload: unknown): JsonObject {
  if (command !== 'http_request') {
    return {};
  }

  const root = parseOptionalJsonObject(payload) || {};
  const inner = parseOptionalJsonObject(root.payload) || {};
  const url = String(inner.url || '').trim();
  const method = String(inner.method || 'GET').toUpperCase();
  const body = typeof inner.body === 'string' ? inner.body : '';

  return {
    requestUrl: url,
    requestMethod: method,
    requestBodyBytes: body.length,
  };
}

type TauriInvokeFn = (command: string, payload?: unknown) => Promise<unknown>;

function resolveTauriInvoke(): TauriInvokeFn {
  if (!hasTauriInvoke()) {
    throw toBridgeNimiError(new Error('RUNTIME_UNAVAILABLE'));
  }
  return invokeTauri;
}

function createSecureInvokeId(command: string): string {
  if (typeof globalThis.crypto === 'undefined') {
    throw new Error('Secure random generator is unavailable');
  }
  const secureCrypto = globalThis.crypto;
  if (typeof secureCrypto.randomUUID === 'function') {
    return `${command}-${secureCrypto.randomUUID().replace(/-/g, '')}`;
  }
  const bytes = new Uint8Array(12);
  secureCrypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${command}-${suffix}`;
}

export async function invoke(command: string, payload: unknown = {}): Promise<unknown> {
  const startedAt = performance.now();
  if (!hasTauriInvoke()) {
    throw toBridgeNimiError(new Error('RUNTIME_UNAVAILABLE'));
  }
  const tauriInvoke = resolveTauriInvoke();
  const invokeId = createSecureInvokeId(command);
  const sessionTraceId = resolveRendererSessionTraceId();
  const payloadSummary = summarizeInvokePayload(command, payload);
  const commandLog = {
    level: 'info' as const,
    area: 'bridge',
    message: toRendererLogMessage(`action:invoke-start:${command}`),
    details: {
      invokeId,
      command,
      hasPayload: Boolean(payload),
      sessionTraceId,
      ...payloadSummary,
      },
  };
  void emitRendererLog(commandLog);
  try {
    const result = await tauriInvoke(command, payload);
    const costMs = Number((performance.now() - startedAt).toFixed(2));
    void emitRendererLog({
      level: 'debug',
      area: 'bridge',
      message: toRendererLogMessage(`action:invoke-success:${command}`),
      details: {
        invokeId,
        command,
        costMs,
        sessionTraceId,
        ...payloadSummary,
      },
      costMs,
    });
    return result;
  } catch (error) {
    const bridgeError = toBridgeNimiError(error);
    const costMs = Number((performance.now() - startedAt).toFixed(2));
    const rawMessage = String(bridgeError.details?.rawMessage || bridgeError.message || '').trim();
    void emitRendererLog({
      level: 'error',
      area: 'bridge',
      message: toRendererLogMessage(`action:invoke-failed:${command}`),
      details: {
        invokeId,
        command,
        costMs,
        sessionTraceId,
        ...payloadSummary,
        reasonCode: bridgeError.reasonCode,
        actionHint: bridgeError.actionHint,
        traceId: bridgeError.traceId || null,
        retryable: bridgeError.retryable,
        rawMessage,
        userMessage: bridgeError.details?.userMessage,
      },
      costMs,
    });
    throw bridgeError;
  }
}

export async function invokeChecked<T>(
  command: string,
  payload: unknown,
  parseResult: (value: unknown) => T,
): Promise<T> {
  return parseResult(await invoke(command, payload));
}
