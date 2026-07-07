import { ReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import { NIMI_STANDARD_SHELL_ERROR_CODES } from '@nimiplatform/kit/shell/capabilities';
import { NimiElectronShellHostError } from './types.js';

const STANDARD_SHELL_ERROR_CODE_SET: ReadonlySet<string> = new Set(NIMI_STANDARD_SHELL_ERROR_CODES);
const RUNTIME_ENDPOINT_UNAVAILABLE_REASON_CODES: ReadonlySet<string> = new Set([
  'RUNTIME_GRPC_UNAVAILABLE',
  'RUNTIME_GRPC_DEADLINE_EXCEEDED',
  'electron-runtime-endpoint-unavailable',
]);

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
export function createElectronCapabilityNotInHostSetError(
  command: string,
  capabilitySetRef: string,
): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'capability-unavailable',
    message: `Electron standard shell capability set ${normalizeErrorToken(capabilitySetRef, 'capabilitySetRef')} does not admit command: ${normalizeErrorToken(command, 'command')}`,
    reasonCode: 'electron-standard-capability-not-in-host-set',
    actionHint: 'use_command_admitted_by_electron_standard_shell_capability_set',
    details: { command, capabilitySetRef },
  });
}
export function createElectronCapabilitySetUnknownError(capabilitySetRef: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'capability-unavailable',
    message: `Electron standard shell capability set is unknown: ${normalizeErrorToken(capabilitySetRef, 'capabilitySetRef')}`,
    reasonCode: 'electron-standard-capability-set-unknown',
    actionHint: 'use_admitted_standard_shell_capability_set',
    details: { capabilitySetRef },
  });
}
export function createElectronRuntimeEndpointUnavailableError(
  command: string,
  runtimeEndpoint: string,
  error: unknown,
): NimiElectronShellHostError {
  const runtimeError = classifyRuntimeEndpointError(command, runtimeEndpoint, error);
  if (runtimeError) {
    return runtimeError;
  }
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

function classifyRuntimeEndpointError(
  command: string,
  runtimeEndpoint: string,
  error: unknown,
): NimiElectronShellHostError | null {
  const grpcCode = runtimeGrpcCode(error);
  const message = errorMessage(error);
  const embedded = parseRuntimeErrorPayload(message);
  const record = asOptionalRecord(error) ?? {};
  const reasonCode = normalizeErrorText(
    embedded.reasonCode
    ?? embedded.reason_code
    ?? record.reasonCode
    ?? record.reason_code,
  );
  const actionHint = normalizeErrorText(
    embedded.actionHint
    ?? embedded.action_hint
    ?? record.actionHint
    ?? record.action_hint,
  );
  const normalized = `${grpcCode} ${reasonCode} ${message}`.toLowerCase();

  if (
    grpcCode === 7
    || normalized.includes('permission_denied')
    || normalized.includes('permission denied')
    || normalized.includes('app_scope_forbidden')
  ) {
    return new NimiElectronShellHostError({
      code: 'runtime-permission-denied',
      message: `Electron Runtime permission was denied for ${normalizeErrorToken(command, 'command')}: ${message}`,
      reasonCode: reasonCode || 'RUNTIME_GRPC_PERMISSION_DENIED',
      actionHint: actionHint || 'authorize_missing_runtime_permission',
      source: 'runtime',
      details: {
        command,
        runtimeEndpoint,
        cause: message,
        grpcCode: Number.isFinite(grpcCode) ? grpcCode : 7,
      },
    });
  }

  if (
    grpcCode === 16
    || normalized.includes('unauthenticated')
    || normalized.includes('principal_unauthenticated')
  ) {
    return new NimiElectronShellHostError({
      code: 'runtime-unauthenticated',
      message: `Electron Runtime authentication is required for ${normalizeErrorToken(command, 'command')}: ${message}`,
      reasonCode: reasonCode || 'RUNTIME_GRPC_UNAUTHENTICATED',
      actionHint: actionHint || 'authenticate_runtime_account',
      source: 'runtime',
      details: {
        command,
        runtimeEndpoint,
        cause: message,
        grpcCode: Number.isFinite(grpcCode) ? grpcCode : 16,
      },
    });
  }

  return null;
}

export function isRuntimeEndpointUnavailableLike(error: unknown): boolean {
  const grpcCode = runtimeGrpcCode(error);
  const message = errorMessage(error);
  const embedded = parseRuntimeErrorPayload(message);
  const record = asOptionalRecord(error) ?? {};
  const details = asOptionalRecord(record.details);
  const reasonCode = normalizeErrorText(
    embedded.reasonCode
    ?? embedded.reason_code
    ?? record.reasonCode
    ?? record.reason_code
    ?? record.code,
  );
  const detailsGrpcCode = Number(details?.grpcCode ?? details?.grpc_code);
  return grpcCode === 14
    || grpcCode === 4
    || detailsGrpcCode === 14
    || detailsGrpcCode === 4
    || RUNTIME_ENDPOINT_UNAVAILABLE_REASON_CODES.has(reasonCode)
    || message.startsWith('14 UNAVAILABLE:')
    || message.startsWith('4 DEADLINE_EXCEEDED:');
}

export function isRuntimeAppGrantInvalidLike(error: unknown): boolean {
  const message = errorMessage(error);
  const embedded = parseRuntimeErrorPayload(message);
  const record = asOptionalRecord(error) ?? {};
  const details = asOptionalRecord(record.details);
  const reasonCode = normalizeErrorText(
    embedded.reasonCode
    ?? embedded.reason_code
    ?? record.reasonCode
    ?? record.reason_code
    ?? details?.reasonCode
    ?? details?.reason_code,
  );
  return reasonCode === ReasonCode.APP_GRANT_INVALID || message.includes(ReasonCode.APP_GRANT_INVALID);
}

function runtimeGrpcCode(error: unknown): number {
  const record = asOptionalRecord(error);
  const rawCode = record?.code ?? record?.grpcCode ?? record?.grpc_code;
  const direct = typeof rawCode === 'number' ? rawCode : Number(rawCode);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const match = errorMessage(error).match(/^\s*(\d+)\s+(?:[A-Z_]+):/u);
  return match ? Number(match[1]) : NaN;
}

function parseRuntimeErrorPayload(message: string): Record<string, unknown> {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return {};
  }
  try {
    return asOptionalRecord(JSON.parse(message.slice(start, end + 1))) ?? {};
  } catch {
    return {};
  }
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
