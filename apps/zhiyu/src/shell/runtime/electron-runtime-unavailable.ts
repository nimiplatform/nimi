export type ZhiyuElectronRuntimeUnavailableProjection = {
  readonly code: 'external-daemon-required';
  readonly reasonCode: 'electron-runtime-endpoint-unavailable';
  readonly actionHint: 'start_external_runtime_daemon';
  readonly source: 'electron';
};

const ELECTRON_RUNTIME_UNAVAILABLE_REASON_CODES = new Set([
  'electron-runtime-endpoint-unavailable',
  'RUNTIME_GRPC_UNAVAILABLE',
  'RUNTIME_GRPC_DEADLINE_EXCEEDED',
]);

export function normalizeZhiyuElectronRuntimeUnavailableError(
  error: unknown,
): ZhiyuElectronRuntimeUnavailableProjection | null {
  const record = asRecord(error);
  const details = asRecord(record.details);
  const reasonCode = stringOr(record.reasonCode ?? record.reason_code ?? record.code);
  const grpcCode = numberOr(details.grpcCode ?? details.grpc_code);
  const message = error instanceof Error
    ? error.message
    : stringOr(record.message ?? error);
  const cause = stringOr(details.cause);

  if (isRuntimeAuthorizationOrAuthenticationFailure(reasonCode, message, cause)) {
    return null;
  }

  if (
    ELECTRON_RUNTIME_UNAVAILABLE_REASON_CODES.has(reasonCode)
    || grpcCode === 14
    || message.startsWith('14 UNAVAILABLE:')
  ) {
    return {
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      actionHint: 'start_external_runtime_daemon',
      source: 'electron',
    };
  }

  return null;
}

function isRuntimeAuthorizationOrAuthenticationFailure(
  reasonCode: string,
  message: string,
  cause: string,
): boolean {
  const normalized = `${reasonCode} ${message} ${cause}`.toLowerCase();
  return normalized.includes('permission_denied')
    || normalized.includes('permission denied')
    || normalized.includes('app_scope_forbidden')
    || normalized.includes('unauthenticated')
    || normalized.includes('principal_unauthenticated');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringOr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOr(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : NaN;
}
