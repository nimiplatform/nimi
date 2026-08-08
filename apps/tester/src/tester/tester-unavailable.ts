import type { TesterCapability } from './tester-capabilities.js';
import { t } from '../shell/i18n/index.js';

// App-owned presentation categories for typed SDK/Runtime failures. They never
// stand in for a successful execution.
//
// Copy resolves through the shared i18n t() at call time. The i18n module is
// import-safe under node:test contract builds (its Vite glob is guarded), so
// this module stays loadable there and t() falls back to returning keys.
export type TesterUnavailableReason =
  | 'runtime-unavailable'
  | 'input-invalid'
  | 'sdk-method-unavailable'
  | 'principal-unauthorized'
  | 'runtime-call-failed';

export type TesterUnavailable = {
  ok: false;
  capabilityId: string;
  reason: TesterUnavailableReason;
  message: string;
  actionHint: string;
  missingSurface?: string;
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
    case 'runtime-call-failed':
      return 'runtimeCallFailed';
    default:
      return '';
  }
}

export function unavailableReasonTitle(reason: TesterUnavailableReason): string {
  return t(`Unavailable.title.${reasonKeySegment(reason)}`);
}

export function unavailableReasonUserMessage(reason: string): string {
  const segment = reasonKeySegment(reason);
  return t(segment ? `Unavailable.message.${segment}` : 'Unavailable.message.fallback');
}

export function unavailableReasonUserAction(reason: string): string {
  const segment = reasonKeySegment(reason);
  return t(segment ? `Unavailable.action.${segment}` : 'Unavailable.action.fallback');
}

function actionHintForReason(reason: TesterUnavailableReason): string {
  return t(`Unavailable.hint.${reasonKeySegment(reason)}`);
}

export function capabilityUnavailable(
  capability: TesterCapability,
  reason: TesterUnavailableReason,
  message: string,
): TesterUnavailable {
  return {
    ok: false,
    capabilityId: capability.id,
    reason,
    message,
    actionHint: actionHintForReason(reason),
    missingSurface: capability.missingSurface,
  };
}
