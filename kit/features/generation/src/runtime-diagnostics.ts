import {
  ReasonCode,
  ScenarioJobStatus,
  createNimiError,
  getNimiRuntimeScenarioJobTerminalStatusFromError,
  type NimiError,
} from '@nimiplatform/kit/core/sdk-contract';

export type RuntimeGenerationNonSuccessReason =
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeScenarioJobNonSuccessReason =
  | RuntimeGenerationNonSuccessReason
  | 'operation-aborted'
  | 'runtime-canceled'
  | 'runtime-timeout'
  | 'stream-interrupted';

export type RuntimeExecutionUnavailable = {
  readonly reason: 'sdk-method-unavailable';
  readonly message: string;
  readonly error: NimiError;
};

export function createRuntimeExecutionUnavailableError(
  capabilityContract: string,
): NimiError {
  const capability = normalizeText(capabilityContract) || 'unknown';
  return createNimiError({
    message: `Runtime ${capability} is unavailable because the current Scenario API still requires caller-supplied execution target fields that Kit no longer accepts.`,
    code: ReasonCode.AI_ROUTE_UNSUPPORTED,
    reasonCode: ReasonCode.AI_ROUTE_UNSUPPORTED,
    actionHint: 'upgrade_runtime_owner_driven_scenario_api',
    source: 'sdk',
    retryable: false,
    details: {
      capabilityContract: capability,
      blockedBy: 'runtime-scenario-api-requires-execution-target',
    },
  });
}

export function runtimeExecutionUnavailable(
  capabilityContract: string,
): RuntimeExecutionUnavailable {
  const error = createRuntimeExecutionUnavailableError(capabilityContract);
  return {
    reason: 'sdk-method-unavailable',
    message: error.message,
    error,
  };
}

export function runtimeGenerationNonSuccessReasonFromError(
  error: unknown,
): RuntimeGenerationNonSuccessReason {
  const reasonCode = errorReasonCode(error);
  return reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE
    ? 'sdk-method-unavailable'
    : reasonCode === ReasonCode.AUTH_CONTEXT_MISSING
      || reasonCode === ReasonCode.PRINCIPAL_UNAUTHORIZED
      || reasonCode === ReasonCode.SESSION_EXPIRED
      || reasonCode === ReasonCode.APP_TOKEN_EXPIRED
      || reasonCode === ReasonCode.APP_TOKEN_REVOKED
        ? 'principal-unauthorized'
        : 'runtime-call-failed';
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r002
// @nimi-authority: rule.nimi.desktop.ai-consumption.r059
export function runtimeScenarioJobNonSuccessReasonFromError(
  error: unknown,
): RuntimeScenarioJobNonSuccessReason {
  const terminalStatus = getNimiRuntimeScenarioJobTerminalStatusFromError(error);
  if (terminalStatus === ScenarioJobStatus.CANCELED) {
    return 'runtime-canceled';
  }
  if (terminalStatus === ScenarioJobStatus.TIMEOUT) {
    return 'runtime-timeout';
  }
  if (errorReasonCode(error) === ReasonCode.OPERATION_ABORTED) {
    return 'operation-aborted';
  }
  if (errorReasonCode(error) === 'SDK_RUNTIME_SCENARIO_JOB_STREAM_INTERRUPTED') {
    return 'stream-interrupted';
  }
  return runtimeGenerationNonSuccessReasonFromError(error);
}

export function describeRuntimeGenerationError(
  error: unknown,
  fallbackMessage = 'Runtime SDK call failed.',
): string {
  const providerDetail = providerDetailFromError(error);
  const withProviderDetail = (message: string): string => {
    if (!providerDetail || message.includes(providerDetail)) return message;
    return `${message}\nProvider detail: ${providerDetail}`;
  };
  if (error instanceof Error) {
    const reasonCode = normalizeText((error as { readonly reasonCode?: unknown }).reasonCode);
    const code = reasonCode || (error.name && error.name !== 'Error' ? error.name : '');
    return withProviderDetail(code ? `${code}: ${error.message}` : error.message || fallbackMessage);
  }
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    const code = normalizeText(record.reasonCode) || normalizeText(record.code);
    const message = normalizeText(record.message) || fallbackMessage;
    return withProviderDetail(code ? `${code}: ${message}` : message);
  }
  return withProviderDetail(String(error || fallbackMessage));
}

function errorReasonCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return normalizeText(
    (error as { readonly reasonCode?: unknown }).reasonCode
    || (error as { readonly code?: unknown }).code,
  );
}

function providerDetailFromError(error: unknown): string {
  for (const record of diagnosticRecords(error)) {
    const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? record.details as Record<string, unknown>
      : {};
    const detail = normalizeText(record.provider_message ?? record.providerMessage)
      || normalizeText(details.provider_message ?? details.providerMessage);
    if (detail) return detail;
  }
  return '';
}

function diagnosticRecords(error: unknown): readonly Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const pushRecord = (value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      records.push(value as Record<string, unknown>);
    }
  };
  pushRecord(error);
  if (error instanceof Error) {
    pushRecord(error.cause);
  } else if (error && typeof error === 'object' && !Array.isArray(error)) {
    pushRecord((error as { readonly cause?: unknown }).cause);
  }
  return records;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
