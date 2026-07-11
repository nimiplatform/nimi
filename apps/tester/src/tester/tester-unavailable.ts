import type { TesterCapability } from './tester-capabilities.js';

// Typed unavailable reasons retained by the workbench presentation model.
// The admitted app-host path currently emits only runtime-not-ready and
// sdk-method-unavailable; adding another live reason requires a separately
// admitted SDK operation and a concrete call site.
export type TesterUnavailableReason =
  | 'runtime-not-ready'
  | 'ai-config-binding-missing'
  | 'input-invalid'
  | 'auth-context-missing'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable'
  | 'local-environment-preparing'
  | 'local-environment-blocked'
  | 'runtime-call-failed'
  | 'tauri-command-failed';

export type TesterUnavailable = {
  ok: false;
  capabilityId: string;
  reason: TesterUnavailableReason;
  message: string;
  actionHint: string;
  missingSurface?: string;
  runtimeRequest?: {
    request?: unknown;
    options?: unknown;
  };
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
    case 'local-environment-preparing':
      return 'Local environment preparing';
    case 'local-environment-blocked':
      return 'Local environment blocked';
    case 'runtime-call-failed':
      return 'Runtime call failed';
    case 'tauri-command-failed':
      return 'Tauri command failed';
  }
}

export function unavailableReasonUserMessage(reason: string): string {
  switch (reason) {
    case 'runtime-not-ready':
      return 'Runtime is not ready to generate a response yet.';
    case 'ai-config-binding-missing':
      return 'No model is selected for this generation.';
    case 'input-invalid':
      return 'The request needs a valid prompt or required input before it can run.';
    case 'auth-context-missing':
      return 'This route needs a signed-in Nimi account.';
    case 'principal-unauthorized':
      return 'The current session is expired or not authorized for this route.';
    case 'sdk-method-unavailable':
      return 'This capability is not available in the current app build.';
    case 'local-environment-preparing':
      return 'Runtime is preparing the selected local image environment.';
    case 'local-environment-blocked':
      return 'The selected local image environment is missing required setup.';
    case 'runtime-call-failed':
      return 'The selected Runtime or model could not complete this generation.';
    case 'tauri-command-failed':
      return 'The desktop shell could not complete the requested action.';
    default:
      return 'The generation did not complete.';
  }
}

export function unavailableReasonUserAction(reason: string): string {
  switch (reason) {
    case 'runtime-not-ready':
      return 'Start or reconnect Runtime, then try again.';
    case 'ai-config-binding-missing':
      return 'Choose a model in the model control, then try again.';
    case 'input-invalid':
      return 'Review the prompt and required fields, then run it again.';
    case 'auth-context-missing':
    case 'principal-unauthorized':
      return 'Sign in again or switch to a local model route.';
    case 'sdk-method-unavailable':
      return 'Update the app or switch to a supported capability.';
    case 'local-environment-preparing':
      return 'Wait for local setup to finish, then run the image request again.';
    case 'local-environment-blocked':
      return 'Set the required companion models, then run the image request again.';
    case 'runtime-call-failed':
      return 'Check Runtime status and the selected model, then retry.';
    case 'tauri-command-failed':
      return 'Reopen the desktop shell or retry after the shell is ready.';
    default:
      return 'Check Runtime details for diagnostics, then try again.';
  }
}

function actionHintForReason(reason: TesterUnavailableReason): string {
  switch (reason) {
    case 'sdk-method-unavailable':
      return 'Add an admitted SDK Nimi App execution method. Do not bypass Runtime with app-local REST.';
    case 'ai-config-binding-missing':
      return 'Import/apply an AIProfile or choose a runtime model binding in App Lab NimiAIConfig, then retry.';
    case 'auth-context-missing':
      return 'Cloud routes require an authenticated Nimi account subject. Sign in to your Nimi account, or switch this capability to a local model binding, then retry.';
    case 'principal-unauthorized':
      return 'The Runtime account session is unauthorized or expired. Sign in again to refresh the session, then retry.';
    case 'input-invalid':
      return 'Supply a valid request body for this capability, then retry.';
    case 'local-environment-preparing':
      return 'Tester started the Runtime-owned local image dependency jobs. Keep Runtime running and retry after setup reaches ready.';
    case 'local-environment-blocked':
      return 'Select the required image companion models (VAE and LLM/text encoder) in the model setup before retrying.';
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
