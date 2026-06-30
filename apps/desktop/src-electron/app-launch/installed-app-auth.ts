import type { NimiRuntimeAppOpenProjection } from '@nimiplatform/sdk/runtime';
import {
  createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type NimiElectronInstalledAppRuntimeAccountTrustedMetadataProviderInput,
} from '@nimiplatform/kit/shell/electron/main';

import {
  DESKTOP_INSTALLED_APP_DEVICE_ID,
  DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
  desktopInstalledAppInstanceId,
} from './installed-app-identity.js';
import {
  DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES,
  createDesktopInstalledAppLaunchError,
} from '../../src/shell/shared/installed-app-launch-contract.js';

export type DesktopInstalledAppAuthProviderInput = NimiElectronInstalledAppRuntimeAccountTrustedMetadataProviderInput;

export function createDesktopInstalledAppAuthProviderInput(input: {
  readonly runtimeEndpoint: string;
  readonly projection: NimiRuntimeAppOpenProjection;
}): DesktopInstalledAppAuthProviderInput {
  const appId = requireAuthText(input.projection.appId, 'projection.appId');
  const releaseDescriptorRef = requireAuthText(input.projection.releaseDescriptorRef, 'projection.releaseDescriptorRef');
  const launchNonce = requireAuthText(input.projection.launchNonce, 'projection.launchNonce');
  return {
    appId,
    runtimeEndpoint: requireAuthText(input.runtimeEndpoint, 'runtimeEndpoint'),
    installedApp: {
      appInstanceId: desktopInstalledAppInstanceId(appId),
      deviceId: DESKTOP_INSTALLED_APP_DEVICE_ID,
      launchHostId: DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
      launchNonce,
      releaseDescriptorRef,
    },
    appSession: {
      appVersion: input.projection.activeVersion,
      capabilities: [],
    },
    protectedAccess: {
      consentId: `${appId}:desktop-installed-app-runtime-account`,
      authorizationVersion: 'desktop-installed-app-runtime-account-v1',
      scopeCatalogVersion: 'desktop-installed-app-standard-shell-v1',
      scopes: [],
    },
  };
}

export function createDesktopInstalledAppTrustedMetadataProvider(
  input: DesktopInstalledAppAuthProviderInput,
): ElectronRuntimeBridgeTrustedMetadataProvider {
  return createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider(input);
}

function requireAuthText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw createDesktopInstalledAppLaunchError({
      message: `Desktop installed app auth provider requires ${field}`,
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
      details: { field },
    });
  }
  return normalized;
}
