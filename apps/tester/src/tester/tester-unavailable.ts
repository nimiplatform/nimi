import type { TesterCapability } from './tester-capabilities.js';

// App-owned presentation categories for typed SDK/Runtime failures. They never
// stand in for a successful execution.
export type TesterUnavailableReason =
  | 'runtime-unavailable'
  | 'permission-required'
  | 'input-invalid'
  | 'sdk-method-unavailable'
  | 'runtime-call-failed';

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
    case 'runtime-unavailable':
      return 'Runtime unavailable';
    case 'permission-required':
      return 'Permission required';
    case 'input-invalid':
      return 'Invalid request input';
    case 'sdk-method-unavailable':
      return 'SDK method unavailable';
    case 'runtime-call-failed':
      return 'Runtime call failed';
  }
}

export function unavailableReasonUserMessage(reason: string): string {
  switch (reason) {
    case 'runtime-unavailable':
      return 'Runtime is unavailable for this request.';
    case 'permission-required':
      return 'Text generation requires approval in Nimi Desktop.';
    case 'input-invalid':
      return 'The request needs a valid prompt or required input before it can run.';
    case 'sdk-method-unavailable':
      return 'This capability is not available in the current app build.';
    case 'runtime-call-failed':
      return 'Runtime could not complete this generation.';
    default:
      return 'The generation did not complete.';
  }
}

export function unavailableReasonUserAction(reason: string): string {
  switch (reason) {
    case 'runtime-unavailable':
      return 'Start or reconnect Runtime, then try again.';
    case 'permission-required':
      return 'Approve or restore the text generation permission in Nimi Desktop, then retry.';
    case 'input-invalid':
      return 'Review the prompt and required fields, then run it again.';
    case 'sdk-method-unavailable':
      return 'Update the app or switch to a supported capability.';
    case 'runtime-call-failed':
      return 'Inspect the typed Runtime error, then retry after resolving its cause.';
    default:
      return 'Check Runtime details for diagnostics, then try again.';
  }
}

function actionHintForReason(reason: TesterUnavailableReason): string {
  switch (reason) {
    case 'permission-required':
      return 'Approve or restore ai.text.generate in Nimi Desktop, then retry the same request.';
    case 'sdk-method-unavailable':
      return 'Add an admitted SDK Nimi App execution method. Do not bypass Runtime with app-local REST.';
    case 'input-invalid':
      return 'Supply a valid request body for this capability, then retry.';
    case 'runtime-call-failed':
      return 'Runtime returned a typed contract failure. Inspect the verbatim Runtime error without inferring success.';
    case 'runtime-unavailable':
      return 'Restore the protected Runtime connection, then retry the same request.';
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
