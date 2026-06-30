import {
  asNimiError,
  createNimiError,
  isNimiError,
  type JsonObject,
  type NimiError,
} from '@nimiplatform/sdk/types';

export const DESKTOP_INSTALLED_APP_LAUNCH_COMMAND = 'desktop.installedApp.launch';

export const DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES = {
  projectionBlocked: 'DESKTOP_INSTALLED_APP_OPEN_PROJECTION_BLOCKED',
  resolutionRequired: 'DESKTOP_INSTALLED_APP_LAUNCH_RESOLUTION_REQUIRED',
  attestationMismatch: 'DESKTOP_INSTALLED_APP_LAUNCH_ATTESTATION_MISMATCH',
  hostWindowFailed: 'DESKTOP_INSTALLED_APP_HOST_WINDOW_FAILED',
  launchFailed: 'DESKTOP_INSTALLED_APP_LAUNCH_FAILED',
} as const;

export type DesktopInstalledAppLaunchResult = {
  readonly appId: string;
  readonly state: 'launched';
  readonly launchHostId: string;
  readonly releaseDescriptorRef: string;
  readonly windowId?: number;
  readonly entryUrl?: string;
};

export function createDesktopInstalledAppLaunchError(input: {
  readonly message: string;
  readonly reasonCode: string;
  readonly actionHint?: string;
  readonly details?: JsonObject;
}): NimiError {
  return createNimiError({
    message: input.message,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint || 'check_desktop_installed_app_launch',
    source: 'sdk',
    details: input.details,
  });
}

export function asDesktopInstalledAppLaunchNimiError(error: unknown): NimiError {
  if (isNimiError(error)) {
    return error;
  }
  return asNimiError(error, {
    message: 'Desktop installed app launch failed',
    reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.launchFailed,
    actionHint: 'check_desktop_installed_app_launch',
    source: 'sdk',
  });
}
