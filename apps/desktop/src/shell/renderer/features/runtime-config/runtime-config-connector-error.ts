import { asNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode, type NimiError } from '@nimiplatform/sdk/types';

export function asRuntimeConfigNimiError(error: unknown): NimiError {
  return asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'retry_or_check_runtime_status',
    source: 'runtime',
  });
}

export function formatRuntimeConfigErrorDetail(error: unknown): string {
  const normalized = asRuntimeConfigNimiError(error);
  const traceSuffix = normalized.traceId
    ? `, traceId=${normalized.traceId}`
    : '';
  return `${normalized.message} (reasonCode=${normalized.reasonCode}${traceSuffix})`;
}

export function formatRuntimeConfigErrorBanner(
  label: string,
  error: unknown,
): string {
  return `${label}: ${formatRuntimeConfigErrorDetail(error)}`;
}
