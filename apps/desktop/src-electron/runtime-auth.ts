import { createNimiDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import {
  createNimiElectronRuntimeAccountTrustedMetadataProvider,
  type ElectronRuntimeBridgeTrustedMetadata,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type NimiElectronRuntimeAccountAuthRuntime,
} from '@nimiplatform/kit/shell/electron/main';
import {
  DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION,
  DESKTOP_RUNTIME_PROTECTED_CONSENT_ID,
  DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION,
  DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE,
  DESKTOP_RUNTIME_PROTECTED_SCOPES,
  DESKTOP_RUNTIME_PROTECTED_TOKEN_REFRESH_SKEW_MS,
  DESKTOP_RUNTIME_PROTECTED_TOKEN_TTL_SECONDS,
  PLATFORM_RUNTIME_SESSION_APP_INSTANCE_SUFFIX,
  PLATFORM_RUNTIME_SESSION_DEVICE_ID,
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
  const auth = createNimiElectronRuntimeAccountTrustedMetadataProvider({
    appId,
    runtimeEndpoint: input.runtimeEndpoint,
    runtime: input.runtime,
    accountCaller: createNimiDesktopShellRuntimeAccountCaller({ appId }),
    appSession: {
      appInstanceId: `${appId}${PLATFORM_RUNTIME_SESSION_APP_INSTANCE_SUFFIX}`,
      deviceId: PLATFORM_RUNTIME_SESSION_DEVICE_ID,
      capabilities: [...DESKTOP_RUNTIME_PROTECTED_SCOPES],
      ttlSeconds: PLATFORM_RUNTIME_SESSION_TTL_SECONDS,
      refreshSkewMs: PLATFORM_RUNTIME_SESSION_REFRESH_SKEW_MS,
    },
    protectedAccess: {
      consentId: DESKTOP_RUNTIME_PROTECTED_CONSENT_ID,
      authorizationVersion: DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION,
      scopeCatalogVersion: DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION,
      scopes: [...DESKTOP_RUNTIME_PROTECTED_SCOPES],
      ttlSeconds: DESKTOP_RUNTIME_PROTECTED_TOKEN_TTL_SECONDS,
      refreshSkewMs: DESKTOP_RUNTIME_PROTECTED_TOKEN_REFRESH_SKEW_MS,
      idempotencyKey: `desktop-runtime-protected-access-${DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE}`,
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
