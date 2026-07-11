import { createNimiDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import {
  createNimiElectronRuntimeAccountTrustedMetadataProvider,
  type ElectronRuntimeBridgeTrustedMetadata,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type NimiElectronRuntimeAccountAuthRuntime,
} from '@nimiplatform/kit/shell/electron/main';
import {
  DESKTOP_RUNTIME_REGISTRATION_CAPABILITIES,
  PLATFORM_RUNTIME_SESSION_REFRESH_SKEW_MS,
  PLATFORM_RUNTIME_SESSION_TTL_SECONDS,
} from '../src/shell/shared/runtime-account-contract.js';
import {
  DESKTOP_ELECTRON_PRODUCT_CONTROL_CALLER_ID,
  DESKTOP_ELECTRON_PRODUCT_CONTROL_CALLER_KIND,
  DESKTOP_ELECTRON_PRODUCT_CONTROL_SURFACE_ID,
  DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS,
} from './desktop-electron-command-matrix.js';

const RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS = new Set<string>(
  DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS,
);

export type DesktopElectronRuntimeAuthRuntime = NimiElectronRuntimeAccountAuthRuntime;

export function createDesktopElectronTrustedRuntimeMetadataProvider(input: {
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly runtime?: DesktopElectronRuntimeAuthRuntime;
}): ElectronRuntimeBridgeTrustedMetadataProvider {
  const appId = requireText(input.appId, 'appId');
  const accountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId });
  const auth = createNimiElectronRuntimeAccountTrustedMetadataProvider({
    appId,
    runtimeEndpoint: input.runtimeEndpoint,
    runtime: input.runtime,
    accountCaller,
    appSession: {
      appInstanceId: accountCaller.appInstanceId,
      deviceId: accountCaller.deviceId,
      capabilities: [...DESKTOP_RUNTIME_REGISTRATION_CAPABILITIES],
      ttlSeconds: PLATFORM_RUNTIME_SESSION_TTL_SECONDS,
      refreshSkewMs: PLATFORM_RUNTIME_SESSION_REFRESH_SKEW_MS,
    },
    callerEnvelope: {
      sourceHost: 'desktop-electron-account-host',
    },
  });
  return (providerInput) => {
    const { methodId } = providerInput;
    if (isDesktopRuntimeLocalProductControlMethodId(methodId)) {
      return desktopProductControlTrustedMetadata(appId);
    }
    return auth(providerInput);
  };
}

export function isDesktopRuntimeLocalProductControlMethodId(methodId: string): boolean {
  return RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.has(normalizeText(methodId));
}

function desktopProductControlTrustedMetadata(appId: string): ElectronRuntimeBridgeTrustedMetadata {
  return {
    metadata: {
      participantId: appId,
      callerKind: DESKTOP_ELECTRON_PRODUCT_CONTROL_CALLER_KIND,
      callerId: DESKTOP_ELECTRON_PRODUCT_CONTROL_CALLER_ID,
      surfaceId: DESKTOP_ELECTRON_PRODUCT_CONTROL_SURFACE_ID,
    },
  };
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`Desktop Electron Runtime auth requires ${field}`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
