import { NIMI_STANDARD_SHELL_ERROR_CODES } from '@nimiplatform/kit/shell/capabilities';
import { NimiElectronShellHostError } from './types.js';

const STANDARD_SHELL_ERROR_CODE_SET: ReadonlySet<string> = new Set(NIMI_STANDARD_SHELL_ERROR_CODES);

function normalizeErrorText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeErrorToken(value: unknown, field: string): string {
  const normalized = normalizeErrorText(value);
  if (!normalized) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: field + ' is required',
      reasonCode: 'electron-shell-required-field-missing',
      actionHint: 'provide_required_electron_shell_host_option',
      details: { field },
    });
  }
  return normalized;
}

function normalizeRendererUrlForComparison(value: unknown): string {
  const text = normalizeErrorText(value);
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text);
    url.hash = '';
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/') {
      url.search = '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

export function createElectronCapabilityUnavailableError(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'capability-unavailable',
    message: `Electron standard shell capability is unavailable for command: ${normalizeErrorToken(command, 'command')}`,
    reasonCode: 'electron-standard-capability-unavailable',
    actionHint: 'provide_electron_standard_shell_capability_handler',
    details: { command },
  });
}
export function createElectronRuntimeEndpointUnavailableError(
  command: string,
  runtimeEndpoint: string,
  error: unknown,
): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'external-daemon-required',
    message: `Electron Runtime endpoint is unavailable for ${normalizeErrorToken(command, 'command')}: ${errorMessage(error)}`,
    reasonCode: 'electron-runtime-endpoint-unavailable',
    actionHint: 'start_external_runtime_daemon',
    details: {
      command,
      runtimeEndpoint,
      cause: errorMessage(error),
    },
  });
}
export function normalizeElectronShellAppId(appId: unknown): string {
  const normalized = normalizeErrorText(appId);
  if (!normalized) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Electron shell host requires an explicit appId',
      reasonCode: 'electron-app-id-required',
      actionHint: 'provide_app_id_when_registering_electron_host',
    });
  }
  return normalized;
}
export function isAllowedElectronRendererOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  const normalizedOrigin = normalizeErrorText(origin);
  if (!normalizedOrigin) {
    return false;
  }
  return allowedOrigins.some((allowed) => {
    const normalizedAllowed = normalizeErrorText(allowed);
    return normalizedAllowed === normalizedOrigin;
  });
}
export function isAllowedElectronRendererUrl(
  url: string | undefined,
  allowedUrls: readonly string[] | undefined,
): boolean {
  if (!allowedUrls || allowedUrls.length === 0) {
    return true;
  }
  const normalizedUrl = normalizeRendererUrlForComparison(url);
  if (!normalizedUrl) {
    return false;
  }
  return allowedUrls.some((allowedUrl) => normalizeRendererUrlForComparison(allowedUrl) === normalizedUrl);
}
export function assertAllowedElectronRendererOrigin(input: {
  readonly origin: string | undefined;
  readonly allowedOrigins: readonly string[];
}): string {
  const origin = normalizeErrorText(input.origin);
  if (isAllowedElectronRendererOrigin(origin, input.allowedOrigins)) {
    return origin;
  }
  throw new NimiElectronShellHostError({
    code: 'forbidden-renderer-access',
    message: `Electron renderer origin is not allowed: ${origin || '<missing>'}`,
    reasonCode: 'electron-renderer-origin-not-allowed',
    actionHint: 'add_renderer_origin_to_electron_host_allowlist',
    details: {
      origin,
      allowedOrigins: [...input.allowedOrigins],
    },
  });
}
export function assertAllowedElectronRendererUrl(input: {
  readonly url: string | undefined;
  readonly allowedUrls: readonly string[] | undefined;
}): string {
  const url = normalizeErrorText(input.url);
  if (isAllowedElectronRendererUrl(url, input.allowedUrls)) {
    return url;
  }
  throw new NimiElectronShellHostError({
    code: 'forbidden-renderer-access',
    message: `Electron renderer URL is not allowed: ${url || '<missing>'}`,
    reasonCode: 'electron-renderer-url-not-allowed',
    actionHint: 'add_renderer_url_to_electron_host_allowlist',
    details: {
      url,
      allowedUrls: [...(input.allowedUrls ?? [])],
    },
  });
}
export function createElectronExternalDaemonRequiredError(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'external-daemon-required',
    message: `Electron Runtime daemon command ${normalizeErrorToken(command, 'command')} requires an external daemon in Phase 1`,
    reasonCode: 'electron-runtime-daemon-managed-externally',
    actionHint: 'start_runtime_daemon_outside_electron_or_use_tauri_host_lifecycle',
    details: { command },
  });
}
export function createElectronRuntimeAccountCustodyExternalError(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'external-daemon-required',
    message: `Electron auth session command ${normalizeErrorToken(command, 'command')} is owned by the external Runtime account service`,
    reasonCode: 'electron-runtime-account-custody-external',
    actionHint: 'use_runtime_account_service_for_account_session_custody',
    details: { command },
  });
}
export function toElectronRuntimeBridgeError(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      message: normalizeErrorText(record.message) || 'Runtime stream failed',
      code: standardErrorCodeOrHostInternal(record.code),
      reasonCode: normalizeErrorText(record.reasonCode ?? record.code) || 'runtime-stream-failed',
      actionHint: normalizeErrorText(record.actionHint) || 'check_runtime_daemon',
      source: normalizeErrorText(record.source) || 'electron',
      traceId: normalizeErrorText(record.traceId) || undefined,
      retryable: typeof record.retryable === 'boolean' ? record.retryable : undefined,
    };
  }
  return {
    message: normalizeErrorText(error) || 'Runtime stream failed',
    code: 'host-internal-error',
    reasonCode: 'runtime-stream-failed',
    actionHint: 'check_runtime_daemon',
    source: 'electron',
  };
}

export function toSerializedElectronShellError(error: unknown): Record<string, unknown> {
  const streamError = toElectronRuntimeBridgeError(error);
  const details = error && typeof error === 'object'
    ? asOptionalRecord((error as Record<string, unknown>).details)
    : undefined;
  return {
    name: error instanceof Error ? error.name : 'NimiElectronShellHostError',
    message: streamError.message,
    code: streamError.code,
    reasonCode: streamError.reasonCode,
    actionHint: streamError.actionHint,
    source: streamError.source,
    traceId: streamError.traceId,
    retryable: streamError.retryable,
    details,
    envelope: {
      code: streamError.code,
      reasonCode: streamError.reasonCode,
      actionHint: streamError.actionHint,
      source: streamError.source,
      details,
    },
  };
}

export function standardErrorCodeOrHostInternal(value: unknown): string {
  const code = normalizeErrorText(value);
  return STANDARD_SHELL_ERROR_CODE_SET.has(code) ? code : 'host-internal-error';
}

export function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : normalizeErrorText(error) || 'unknown error';
}
