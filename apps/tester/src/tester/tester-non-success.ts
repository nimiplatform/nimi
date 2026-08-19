import type { TesterCapability } from './tester-capabilities.js';
import { t } from '../shell/i18n/index.js';

// App-owned presentation categories for typed SDK/Runtime failures. They never
// stand in for a successful execution.
//
// Copy resolves through the shared i18n t() at call time. The i18n module is
// import-safe under node:test contract builds (its Vite glob is guarded), so
// this module stays loadable there and t() falls back to returning keys.
export type TesterNonSuccessReason =
  | 'runtime-unavailable'
  | 'input-invalid'
  | 'sdk-method-unavailable'
  | 'principal-unauthorized'
  | 'operation-aborted'
  | 'runtime-canceled'
  | 'runtime-timeout'
  | 'stream-interrupted'
  | 'runtime-call-failed';

export type TesterNonSuccessDiagnostics = {
  reasonCode: string;
  actionHint?: string;
  traceId?: string;
  retryable?: boolean;
  source?: string;
};

export type TesterNonSuccess = {
  ok: false;
  capabilityId: string;
  reason: TesterNonSuccessReason;
  message: string;
  actionHint: string;
  missingSurface?: string;
  diagnostics?: TesterNonSuccessDiagnostics;
};

function reasonKeySegment(reason: string): string {
  switch (reason) {
    case 'runtime-unavailable':
      return 'runtimeUnavailable';
    case 'input-invalid':
      return 'inputInvalid';
    case 'sdk-method-unavailable':
      return 'sdkMethodUnavailable';
    case 'principal-unauthorized':
      return 'principalUnauthorized';
    case 'operation-aborted':
      return 'operationAborted';
    case 'runtime-canceled':
      return 'runtimeCanceled';
    case 'runtime-timeout':
      return 'runtimeTimeout';
    case 'stream-interrupted':
      return 'streamInterrupted';
    case 'runtime-call-failed':
      return 'runtimeCallFailed';
    default:
      return '';
  }
}

export function nonSuccessReasonTitle(reason: TesterNonSuccessReason): string {
  return t(`NonSuccess.title.${reasonKeySegment(reason)}`);
}

export function nonSuccessReasonUserMessage(reason: string): string {
  const segment = reasonKeySegment(reason);
  return t(segment ? `NonSuccess.message.${segment}` : 'NonSuccess.message.fallback');
}

export function nonSuccessReasonUserAction(reason: string): string {
  const segment = reasonKeySegment(reason);
  return t(segment ? `NonSuccess.action.${segment}` : 'NonSuccess.action.fallback');
}

function actionHintForReason(reason: TesterNonSuccessReason): string {
  return t(`NonSuccess.hint.${reasonKeySegment(reason)}`);
}

export function capabilityNonSuccess(
  capability: TesterCapability,
  reason: TesterNonSuccessReason,
  message: string,
  diagnostics?: TesterNonSuccessDiagnostics,
): TesterNonSuccess {
  return {
    ok: false,
    capabilityId: capability.id,
    reason,
    message,
    actionHint: actionHintForReason(reason),
    missingSurface: capability.missingSurface,
    ...(diagnostics ? { diagnostics } : {}),
  };
}
