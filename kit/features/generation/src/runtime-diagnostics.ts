import { ReasonCode } from '@nimiplatform/kit/core/sdk-contract';

export type RuntimeRequestDiagnostics = {
  readonly request: unknown;
  readonly options?: unknown;
};

export type RuntimeRequestDiagnosticsRecorder = (diagnostics: RuntimeRequestDiagnostics) => void;

export type RuntimeGenerationUnavailableReason =
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export function runtimeUnavailableReasonFromError(error: unknown): RuntimeGenerationUnavailableReason {
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

export function describeRuntimeGenerationError(error: unknown, fallbackMessage = 'Runtime SDK call failed.'): string {
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

export function withRuntimeRequestDiagnostics<T extends object>(
  ai: T,
  recorder: RuntimeRequestDiagnosticsRecorder | undefined,
): T {
  if (!recorder) return ai;
  const record = ai as Record<string, unknown>;
  return {
    ...ai,
    ...(typeof record.executeScenario === 'function'
      ? {
        executeScenario(request: unknown, options?: unknown) {
          recorder({ request, options });
          return (record.executeScenario as (request: unknown, options?: unknown) => unknown).call(ai, request, options);
        },
      }
      : {}),
    ...(typeof record.streamScenario === 'function'
      ? {
        streamScenario(request: unknown, options?: unknown) {
          recorder({ request, options });
          return (record.streamScenario as (request: unknown, options?: unknown) => unknown).call(ai, request, options);
        },
      }
      : {}),
    ...(typeof record.submitScenarioJob === 'function'
      ? {
        submitScenarioJob(request: unknown, options?: unknown) {
          recorder({ request, options });
          return (record.submitScenarioJob as (request: unknown, options?: unknown) => unknown).call(ai, request, options);
        },
      }
      : {}),
    ...(typeof record.listPresetVoices === 'function'
      ? {
        listPresetVoices(request: unknown, options?: unknown) {
          recorder({ request, options });
          return (record.listPresetVoices as (request: unknown, options?: unknown) => unknown).call(ai, request, options);
        },
      }
      : {}),
  } as T;
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
