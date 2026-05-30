import type { TesterCapability } from './tester-capabilities.js';

// Typed unavailable reasons. Each reason maps 1:1 to a precise failure class so
// the cockpit never mislabels a real Runtime/auth contract failure as a missing
// SDK method. The reason is derived from the SDK ReasonCode at the call site
// (see tester-runtime-invokers.ts), not blanket-assigned.
export type TesterUnavailableReason =
  | 'runtime-not-ready'
  | 'ai-config-binding-missing'
  | 'input-invalid'
  | 'auth-context-missing'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable'
  | 'runtime-call-failed'
  | 'tauri-command-failed';

export type TesterUnavailable = {
  ok: false;
  capabilityId: string;
  reason: TesterUnavailableReason;
  message: string;
  actionHint: string;
  missingSurface?: string;
};

export function unavailableReasonTitle(reason: TesterUnavailableReason): string {
  switch (reason) {
    case 'runtime-not-ready':
      return 'Runtime unavailable';
    case 'ai-config-binding-missing':
      return 'Model binding required';
    case 'input-invalid':
      return 'Invalid request input';
    case 'auth-context-missing':
      return 'Sign-in required';
    case 'principal-unauthorized':
      return 'Session unauthorized';
    case 'sdk-method-unavailable':
      return 'SDK method unavailable';
    case 'runtime-call-failed':
      return 'Runtime call failed';
    case 'tauri-command-failed':
      return 'Tauri command failed';
  }
}

function actionHintForReason(reason: TesterUnavailableReason): string {
  switch (reason) {
    case 'sdk-method-unavailable':
      return 'Add an admitted SDK Nimi App execution method. Do not bypass Runtime with app-local REST.';
    case 'ai-config-binding-missing':
      return 'Import/apply an AIProfile or choose a runtime model binding in App Lab AIConfig, then retry.';
    case 'auth-context-missing':
      return 'Cloud routes require an authenticated Nimi account subject. Sign in to your Nimi account, or switch this capability to a local model binding, then retry.';
    case 'principal-unauthorized':
      return 'The Runtime account session is unauthorized or expired. Sign in again to refresh the session, then retry.';
    case 'input-invalid':
      return 'Supply a valid request body for this capability, then retry.';
    case 'runtime-call-failed':
      return 'Runtime returned a typed contract failure. Inspect the verbatim Runtime error above — this is a real Runtime/contract failure, not a missing SDK method.';
    case 'runtime-not-ready':
    case 'tauri-command-failed':
      return 'Restore Runtime or standalone Tauri readiness, then retry the lane.';
  }
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
