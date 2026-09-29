import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  WorkbenchRuntimeGateCopy,
  WorkbenchRuntimeGateProjection,
} from '../workbench-core/index.js';
import {
  appId,
  appTitle,
  clearRuntimePlatformProjection,
  getRuntimePlatformProjection,
  type RuntimePlatformUnavailableProjection,
} from './auth/runtime-platform.js';

export { appTitle };

// Plain copy for people using the App. Reason codes and Runtime hints stay in
// the gate's folded technical details.
export const targetRuntimeGateCopy: WorkbenchRuntimeGateCopy = Object.freeze({
  checking: 'Connecting to Nimi…',
  setupRequired: 'Not connected',
  signInRequired: 'Sign in to Nimi to continue',
  connectionRequired: 'This App needs Nimi',
  retry: 'Try again',
  offlineTier: (tier) => `Offline tier: ${tier}`,
  nextAction: (step) => step,
  technicalDetails: 'Technical details',
});

// A gate that renders recovery actions and technical details receives them;
// an App-owned gate from an earlier scaffold still type-checks and shows the
// plain copy without them.
type TargetRuntimeGateRecovery = {
  readonly recoveryAction?: { readonly label: string; readonly run: () => Promise<string> };
  readonly technicalDetails?: readonly { readonly label: string; readonly value: string }[];
};

export type TargetRuntimeGateProjection =
  | Extract<WorkbenchRuntimeGateProjection, { readonly status: 'ready' }>
  | (Extract<WorkbenchRuntimeGateProjection, { readonly status: 'unavailable' }> & TargetRuntimeGateRecovery);

type TargetRuntimeGateGuidance = {
  readonly signInRequired: boolean;
  readonly body: string;
  readonly nextStep: string;
};

export async function resolveTargetRuntimeGate(): Promise<TargetRuntimeGateProjection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status === 'ready') return { status: 'ready' };
  const guidance = targetRuntimeGateGuidance(projection);
  return {
    status: 'unavailable',
    body: guidance.body,
    signInRequired: guidance.signInRequired,
    nextAction: guidance.nextStep,
    recoveryAction: { label: 'Open Nimi', run: openNimi },
    technicalDetails: [
      { label: 'Reason', value: projection.reasonCode },
      ...(projection.actionHint ? [{ label: 'Suggested action', value: projection.actionHint }] : []),
      { label: 'Details', value: projection.message },
    ],
  };
}

export function clearTargetRuntimeGate(): void {
  clearRuntimePlatformProjection();
}

// The Runtime projection already carries failures as data; this covers only an
// unexpected rejection of the check itself.
export function targetRuntimeGateErrorMessage(): string {
  return "This App couldn't check its connection to Nimi.";
}

function targetRuntimeGateGuidance(projection: RuntimePlatformUnavailableProjection): TargetRuntimeGateGuidance {
  if (projection.reasonCode === 'runtime-unauthenticated') {
    return {
      signInRequired: true,
      body: "You aren't signed in to Nimi on this computer.",
      nextStep: 'Open Nimi and sign in, then select Try again.',
    };
  }
  switch (projection.actionHint) {
    case 'establish_fresh_app_access_session':
    case 'wait_for_app_access_admission':
      return {
        signInRequired: false,
        body: "Nimi hasn't finished giving this App access.",
        nextStep: 'Wait a moment, then select Try again. If this keeps happening, open the App again from Nimi.',
      };
    case 'reopen_local_app_session':
    case 'establish_session_for_current_account':
    case 'restart_through_verified_desktop_supervisor':
    case 'retry_when_nimi_access_is_available':
      return {
        signInRequired: false,
        body: "This App's connection to Nimi ended, for example because Nimi restarted or the account changed.",
        nextStep: 'Close this App and open it again from Nimi.',
      };
    case 'register_local_development_project':
    case 'restart_official_nimi_app_dev_command':
    case 'restore_registered_project_identity':
      return {
        signInRequired: false,
        body: "Nimi doesn't recognize this development project as it is now.",
        nextStep: 'Stop the App and start it again with pnpm dev.',
      };
    default:
      return {
        signInRequired: false,
        body: "Nimi isn't running, or this App can't reach it right now.",
        nextStep: 'Make sure Nimi is open, then select Try again.',
      };
  }
}

// Brings a running Nimi forward on this App's page. Nimi is never started from
// here, so a closed Nimi gets a plain instruction instead.
async function openNimi(): Promise<string> {
  try {
    const result = await openDesktopIntent({ intent: { kind: 'open-apps', appId } });
    if (result.status === 'accepted') return "Nimi is open. When you're done there, select Try again.";
    if (result.reasonCode === 'desktop-open-desktop-not-running') return "Nimi isn't running. Start Nimi, then select Try again.";
    if (result.reasonCode === 'desktop-open-desktop-not-ready') return 'Nimi is still starting. Wait a moment, then select Try again.';
  } catch {
    // Without the verified Host bridge, for example in a plain browser tab,
    // this App cannot ask Nimi to open.
  }
  return "This App couldn't open Nimi. Open Nimi yourself, then select Try again.";
}
