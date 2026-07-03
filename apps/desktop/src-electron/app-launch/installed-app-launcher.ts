import type { NimiRuntimeAppOpenProjection, NimiRuntimeAppInstallStorage } from '@nimiplatform/sdk/runtime';
import type {
  ElectronRuntimeBridgeTrustedMetadataProvider,
  NimiElectronCommandHandler,
  NimiElectronAIConfigStore,
} from '@nimiplatform/kit/shell/electron/main';

import {
  DESKTOP_INSTALLED_APP_LAUNCH_COMMAND,
  DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES,
  type DesktopInstalledAppLaunchResult,
  createDesktopInstalledAppLaunchError,
} from '../../src/shell/shared/installed-app-launch-contract.js';
import {
  createDesktopInstalledAppAuthProviderInput,
  createDesktopInstalledAppTrustedMetadataProvider,
  type DesktopInstalledAppAuthProviderInput,
} from './installed-app-auth.js';
import {
  createDesktopInstalledAppProtocolBinding,
  type DesktopInstalledAppProtocolBinding,
  type DesktopInstalledAppProtocolBindingInput,
} from './installed-app-protocol.js';
import {
  type DesktopInstalledAppHostWindowInput,
  type DesktopInstalledAppHostWindowResult,
} from './installed-app-host-window.js';
import {
  DESKTOP_INSTALLED_APP_CALLER_MODE,
  DESKTOP_INSTALLED_APP_DEVICE_ID,
  DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
  INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF,
  desktopInstalledAppInstanceId,
} from './installed-app-identity.js';

export {
  DESKTOP_INSTALLED_APP_CALLER_MODE,
  DESKTOP_INSTALLED_APP_DEVICE_ID,
  DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
  INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF,
  desktopInstalledAppInstanceId,
} from './installed-app-identity.js';

export type DesktopInstalledAppLaunchOverride = {
  readonly releaseDescriptorRef?: string;
  readonly activeReleaseRoot?: string;
  readonly runtimeEntryRef?: string;
};

export type DesktopInstalledAppLaunchRequest = {
  readonly projection: NimiRuntimeAppOpenProjection;
  readonly override?: DesktopInstalledAppLaunchOverride;
};

export type DesktopInstalledAppLaunchResolution = {
  readonly appId: string;
  readonly activeVersion: string;
  readonly releaseDescriptorRef: string;
  readonly activeReleaseRoot: string;
  readonly runtimeEntryRef: string;
  readonly storage: NimiRuntimeAppInstallStorage;
  readonly shellCapabilitySetRef: typeof INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF;
  readonly callerMode: typeof DESKTOP_INSTALLED_APP_CALLER_MODE;
  readonly launchNonce: string;
  readonly appInstanceId: string;
  readonly deviceId: typeof DESKTOP_INSTALLED_APP_DEVICE_ID;
  readonly launchHostId: typeof DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID;
};

export type DesktopInstalledAppLauncherDeps = {
  readonly runtimeEndpoint: string;
  readonly preloadPath: string;
  readonly createAIConfigStore?: (dataRoot: string) => NimiElectronAIConfigStore;
  readonly registerProtocol?: (
    input: DesktopInstalledAppProtocolBindingInput,
  ) => Promise<DesktopInstalledAppProtocolBinding> | DesktopInstalledAppProtocolBinding;
  readonly createAuthProvider?: (
    input: DesktopInstalledAppAuthProviderInput,
  ) => ElectronRuntimeBridgeTrustedMetadataProvider;
  readonly createHostWindow?: (
    input: DesktopInstalledAppHostWindowInput,
  ) => Promise<DesktopInstalledAppHostWindowResult> | DesktopInstalledAppHostWindowResult;
};

export type DesktopInstalledAppLauncher = {
  readonly launch: (request: DesktopInstalledAppLaunchRequest) => Promise<DesktopInstalledAppLaunchResult>;
};

export function createDesktopInstalledAppLauncher(deps: DesktopInstalledAppLauncherDeps): DesktopInstalledAppLauncher {
  const runtimeEndpoint = requireLaunchText(deps.runtimeEndpoint, 'runtimeEndpoint');
  const preloadPath = requireLaunchText(deps.preloadPath, 'preloadPath');
  const registerProtocol = deps.registerProtocol ?? createDesktopInstalledAppProtocolBinding;
  const createAuthProvider = deps.createAuthProvider ?? createDesktopInstalledAppTrustedMetadataProvider;
  const createHostWindow = deps.createHostWindow ?? createDesktopInstalledAppHostWindowMissingDeps;
  return {
    async launch(request) {
      const resolution = resolveDesktopInstalledAppLaunchResolution(request.projection, request.override);
      const protocol = await registerProtocol({
        appId: resolution.appId,
        releaseDescriptorRef: resolution.releaseDescriptorRef,
        activeReleaseRoot: resolution.activeReleaseRoot,
        runtimeEntryRef: resolution.runtimeEntryRef,
      });
      const trustedRuntimeMetadataProvider = createAuthProvider(createDesktopInstalledAppAuthProviderInput({
        runtimeEndpoint,
        projection: request.projection,
      }));
      const host = await createHostWindow({
        appId: resolution.appId,
        preloadPath,
        entryUrl: protocol.entryUrl,
        allowedOrigins: protocol.allowedOrigins,
        runtimeEndpoint,
        trustedRuntimeMetadataProvider,
        standardShell: {
          capabilitySetRef: INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF,
          dataRoot: resolution.storage.durableDataRoot,
          localAssetRoots: [resolution.activeReleaseRoot],
          ...(deps.createAIConfigStore
            ? { aiConfigStore: deps.createAIConfigStore(resolution.storage.durableDataRoot) }
            : {}),
        },
      });
      return {
        appId: resolution.appId,
        state: 'launched',
        launchHostId: resolution.launchHostId,
        releaseDescriptorRef: resolution.releaseDescriptorRef,
        windowId: host.windowId,
        entryUrl: host.entryUrl,
      };
    },
  };
}

export function registerDesktopInstalledAppLaunchIpc(
  launcher: DesktopInstalledAppLauncher,
): Readonly<Record<string, NimiElectronCommandHandler>> {
  return {
    [DESKTOP_INSTALLED_APP_LAUNCH_COMMAND]: async ({ payload }) =>
      launcher.launch(parseDesktopInstalledAppLaunchPayload(payload)),
  };
}

export function parseDesktopInstalledAppLaunchPayload(payload: Readonly<Record<string, unknown>>): DesktopInstalledAppLaunchRequest {
  const projection = payload.projection;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    throw createDesktopInstalledAppLaunchError({
      message: 'Desktop installed app launch command requires a Runtime OpenApp projection',
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
    });
  }
  const override = payload.override && typeof payload.override === 'object' && !Array.isArray(payload.override)
    ? payload.override as DesktopInstalledAppLaunchOverride
    : undefined;
  return { projection: projection as NimiRuntimeAppOpenProjection, ...(override ? { override } : {}) };
}

export function resolveDesktopInstalledAppLaunchResolution(
  projection: NimiRuntimeAppOpenProjection,
  override?: DesktopInstalledAppLaunchOverride,
): DesktopInstalledAppLaunchResolution {
  if (projection.state !== 'launched' || projection.launched !== true || projection.reachedStep !== 'launch') {
    throw createDesktopInstalledAppLaunchError({
      message: 'Desktop installed app launch requires a successful Runtime OpenApp launched projection',
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.projectionBlocked,
      details: {
        appId: projection.appId,
        state: projection.state,
        reachedStep: projection.reachedStep,
        runtimeReasonCode: projection.reasonCode,
      },
    });
  }
  rejectAttestationOverride('releaseDescriptorRef', projection.releaseDescriptorRef, override?.releaseDescriptorRef);
  rejectAttestationOverride('activeReleaseRoot', projection.activeReleaseRoot, override?.activeReleaseRoot);
  rejectAttestationOverride('runtimeEntryRef', projection.runtimeEntryRef, override?.runtimeEntryRef);

  const appId = requireLaunchText(projection.appId, 'projection.appId');
  const storage = requireStorage(projection.storage);
  const activeReleaseRoot = requireLaunchText(projection.activeReleaseRoot, 'projection.activeReleaseRoot');
  if (storage.releaseRoot !== activeReleaseRoot) {
    throw createDesktopInstalledAppLaunchError({
      message: 'Desktop installed app launch requires storage.releaseRoot to match activeReleaseRoot',
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
      details: { appId },
    });
  }
  const shellCapabilitySetRef = requireLaunchText(projection.shellCapabilitySetRef, 'projection.shellCapabilitySetRef');
  if (shellCapabilitySetRef !== INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF) {
    throw createDesktopInstalledAppLaunchError({
      message: 'Desktop installed app launch requires the installed app standard shell capability set',
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
      details: { appId, shellCapabilitySetRef },
    });
  }
  const callerMode = requireLaunchText(projection.callerMode, 'projection.callerMode');
  if (callerMode !== DESKTOP_INSTALLED_APP_CALLER_MODE) {
    throw createDesktopInstalledAppLaunchError({
      message: 'Desktop installed app launch requires desktop-launched-nimi-app caller posture',
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
      details: { appId, callerMode },
    });
  }
  return {
    appId,
    activeVersion: requireLaunchText(projection.activeVersion, 'projection.activeVersion'),
    releaseDescriptorRef: requireLaunchText(projection.releaseDescriptorRef, 'projection.releaseDescriptorRef'),
    activeReleaseRoot,
    runtimeEntryRef: requireLaunchText(projection.runtimeEntryRef, 'projection.runtimeEntryRef'),
    storage,
    shellCapabilitySetRef: INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF,
    callerMode: DESKTOP_INSTALLED_APP_CALLER_MODE,
    launchNonce: requireLaunchText(projection.launchNonce, 'projection.launchNonce'),
    appInstanceId: desktopInstalledAppInstanceId(appId),
    deviceId: DESKTOP_INSTALLED_APP_DEVICE_ID,
    launchHostId: DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
  };
}

function rejectAttestationOverride(
  field: keyof DesktopInstalledAppLaunchOverride,
  attestedValue: unknown,
  overrideValue: unknown,
): void {
  if (overrideValue === undefined) {
    return;
  }
  if (String(overrideValue || '').trim() !== String(attestedValue || '').trim()) {
    throw createDesktopInstalledAppLaunchError({
      message: `Desktop installed app launch override ${field} does not match Runtime attestation`,
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.attestationMismatch,
      details: { field },
    });
  }
}

function requireStorage(storage: NimiRuntimeAppInstallStorage | undefined): NimiRuntimeAppInstallStorage {
  if (!storage?.appRoot || !storage.releaseRoot || !storage.durableDataRoot || !storage.cacheRoot || !storage.tempRoot) {
    throw createDesktopInstalledAppLaunchError({
      message: 'Desktop installed app launch requires complete Runtime app storage handles',
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
    });
  }
  return storage;
}

function requireLaunchText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw createDesktopInstalledAppLaunchError({
      message: `Desktop installed app launch requires ${field}`,
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
      details: { field },
    });
  }
  return normalized;
}

function createDesktopInstalledAppHostWindowMissingDeps(): never {
  throw createDesktopInstalledAppLaunchError({
    message: 'Desktop installed app host window factory is not configured',
    reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.hostWindowFailed,
  });
}
