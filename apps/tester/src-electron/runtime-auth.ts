import { createNimiDeveloperRegisteredRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import {
  createNimiElectronRuntimeAccountTrustedMetadataProvider,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
} from '@nimiplatform/kit/shell/electron/main';

const runtimeDeveloperRegistrationRequested = true;
const runtimeProtectedScopes = ['ai.spend.meter'] as const;
const runtimeProtectedScopeCatalogVersion = 'sdk-v2';
const runtimeAppSessionDeviceId = 'platform-runtime-session';
const runtimeAppSessionTtlSeconds = 3600;
const runtimeAppSessionRefreshSkewMs = 30_000;
const runtimeProtectedTokenTtlSeconds = 3600;
const runtimeProtectedTokenRefreshSkewMs = 60_000;

export function createTesterElectronTrustedRuntimeMetadataProvider(input: {
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): ElectronRuntimeBridgeTrustedMetadataProvider {
  const appId = requireText(input.appId, 'appId');
  const runtimeEndpoint = requireText(input.runtimeEndpoint, 'runtimeEndpoint');
  const clientIdPrefix = normalizeClientIdPrefix(appId);
  return createNimiElectronRuntimeAccountTrustedMetadataProvider({
    appId,
    runtimeEndpoint,
    accountCaller: createNimiDeveloperRegisteredRuntimeAccountCaller({
      appId,
      appInstanceId: `${appId}.local-developer`,
      deviceId: `${clientIdPrefix}-local-developer-device`,
    }),
    appSession: {
      appInstanceId: `${appId}.platform-runtime-session`,
      deviceId: runtimeAppSessionDeviceId,
      capabilities: [...runtimeProtectedScopes],
      ttlSeconds: runtimeAppSessionTtlSeconds,
      refreshSkewMs: runtimeAppSessionRefreshSkewMs,
      developerRegistration: runtimeDeveloperRegistrationRequested,
    },
    protectedAccess: {
      consentId: `${clientIdPrefix}-runtime-account`,
      authorizationVersion: 'v1',
      policyVersion: `${clientIdPrefix}-runtime-account-v1`,
      scopeCatalogVersion: runtimeProtectedScopeCatalogVersion,
      scopes: [...runtimeProtectedScopes],
      ttlSeconds: runtimeProtectedTokenTtlSeconds,
      refreshSkewMs: runtimeProtectedTokenRefreshSkewMs,
      idempotencyKey: ({ normalizedSubjectUserId }) => `${clientIdPrefix}-runtime-protected-${normalizedSubjectUserId}`,
    },
  });
}

function normalizeClientIdPrefix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nimi-app';
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`tester Electron Runtime auth requires ${field}`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
