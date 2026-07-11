import { createNimiDeveloperRegisteredRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import {
  createNimiElectronRuntimeAccountTrustedMetadataProvider,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
} from '@nimiplatform/kit/shell/electron/main';

const runtimeDeveloperRegistrationRequested = true;
const runtimeAccountBrokerCapabilities = [
  'account.session.read',
  'data.scope.read#realm.worlds.read-probe',
] as const;
const runtimeRegistrationCapabilities = [
  ...runtimeAccountBrokerCapabilities,
] as const;
const runtimeAppSessionTtlSeconds = 3600;
const runtimeAppSessionRefreshSkewMs = 30_000;

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
      appInstanceId: `${appId}.local-developer`,
      deviceId: `${clientIdPrefix}-local-developer-device`,
      capabilities: [...runtimeRegistrationCapabilities],
      ttlSeconds: runtimeAppSessionTtlSeconds,
      refreshSkewMs: runtimeAppSessionRefreshSkewMs,
      developerRegistration: runtimeDeveloperRegistrationRequested,
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
