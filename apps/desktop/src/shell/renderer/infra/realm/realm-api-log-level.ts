import { ReasonCode } from '@nimiplatform/sdk/types';

const SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED = 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED';

// Keep the mediated failure classification, not the remote response text or
// arbitrary details. Zero means no HTTP status was supplied; it must not be
// diagnosed as an HTTP 5xx response.
export function realmDataErrorDiagnosticDetails(error: unknown): {
  httpStatus?: number;
  accountReasonCode?: string;
} {
  if (!error || typeof error !== 'object') return {};
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const { httpStatus, accountReasonCode } = details as Record<string, unknown>;
  return {
    ...(typeof httpStatus === 'number' && Number.isInteger(httpStatus)
      && (httpStatus === 0 || (httpStatus >= 100 && httpStatus <= 599)) ? { httpStatus } : {}),
    ...(typeof accountReasonCode === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(accountReasonCode)
      ? { accountReasonCode } : {}),
  };
}

export function resolveRealmDataErrorLogLevel(input: {
  readonly action: string;
  readonly reasonCode?: string;
  readonly realmOffline: boolean;
  readonly runtimeOffline: boolean;
}): 'warn' | 'error' {
  if (input.realmOffline || input.runtimeOffline) {
    return 'warn';
  }
  if (input.reasonCode === SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED) {
    return 'error';
  }
  if (input.action === 'load-current-user'
    && input.reasonCode === ReasonCode.APP_AUTHORIZATION_DENIED) {
    return 'warn';
  }
  return 'error';
}
