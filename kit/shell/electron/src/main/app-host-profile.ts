import { lstatSync } from 'node:fs';
import path from 'node:path';

import { NimiElectronShellHostError } from './types.js';

/** Child-environment key Nimi Desktop sets for every managed App Host launch. */
export const NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY = 'NIMI_APP_HOST_PROFILE_DIR';

export type NimiElectronAppHostProfile = {
  readonly profileRoot: string;
  readonly userData: string;
  readonly sessionData: string;
  readonly temp: string;
};

export type NimiElectronAppHostProfileTarget = {
  isReady(): boolean;
  setPath(name: 'userData' | 'sessionData' | 'temp', value: string): void;
};

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034c
/**
 * Binds Electron's `userData`, `sessionData`, and `temp` paths to the Host
 * technical profile that Nimi Desktop prepared for this launch under the
 * selected data root. Call it synchronously at the top of the Electron main
 * module, before any `session`, `BrowserWindow`, or `app.whenReady()` work.
 * Import it from `@nimiplatform/kit/shell/electron/host-profile`, which loads
 * nothing else from Kit, and load the rest of Kit afterwards: a module that
 * fails to load before this call would otherwise leave Electron on its
 * default paths. A missing or unusable profile throws; nothing falls back to
 * Electron's default location in the OS user profile.
 */
export function configureNimiElectronAppHostProfile(
  electronApp: NimiElectronAppHostProfileTarget,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): NimiElectronAppHostProfile {
  if (electronApp.isReady()) {
    throw profileError('electron-app-host-profile-after-ready', 'Host profile must be configured before Electron is ready');
  }
  const profileRoot = environment[NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY];
  if (typeof profileRoot !== 'string' || !profileRoot || profileRoot.length > 4096
    || profileRoot.trim() !== profileRoot || profileRoot.includes('\0')
    || !path.isAbsolute(profileRoot) || path.normalize(profileRoot) !== profileRoot) {
    throw profileError('electron-app-host-profile-missing', 'Launch this App from Nimi Desktop to receive its Host profile');
  }
  const profile: NimiElectronAppHostProfile = Object.freeze({
    profileRoot,
    userData: path.join(profileRoot, 'user-data'),
    sessionData: path.join(profileRoot, 'session-data'),
    temp: path.join(profileRoot, 'tmp'),
  });
  for (const directory of [profile.profileRoot, profile.userData, profile.sessionData, profile.temp]) {
    requirePreparedDirectory(directory);
  }
  electronApp.setPath('userData', profile.userData);
  electronApp.setPath('sessionData', profile.sessionData);
  electronApp.setPath('temp', profile.temp);
  return profile;
}

function requirePreparedDirectory(directory: string): void {
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(directory);
  } catch {
    throw profileError('electron-app-host-profile-unavailable', 'The prepared Host profile directory is unavailable');
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw profileError('electron-app-host-profile-unavailable', 'The prepared Host profile directory is not a real directory');
  }
}

function profileError(reasonCode: string, message: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'capability-unavailable',
    message,
    reasonCode,
    actionHint: 'launch_from_nimi_desktop',
  });
}
