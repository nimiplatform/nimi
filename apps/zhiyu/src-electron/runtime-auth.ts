import {
  createNimiElectronRuntimeAccountTrustedMetadataProvider,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
} from '@nimiplatform/kit/shell/electron/main';
import {
  createZhiyuElectronRuntimeAccountCaller,
  normalizeZhiyuElectronRuntimeClientIdPrefix,
} from './runtime-account-caller.js';

const runtimeDeveloperRegistrationRequested = false;
const runtimeAccountBrokerCapabilities = [
  'account.session.read',
  'data.scope.read#realm.worlds.read-probe',
] as const;
const runtimeRegistrationCapabilities = [
  ...runtimeAccountBrokerCapabilities,
] as const;
const runtimeAppSessionTtlSeconds = 3600;
const runtimeAppSessionRefreshSkewMs = 30_000;

export function createZhiyuElectronTrustedRuntimeMetadataProvider(input: {
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): ElectronRuntimeBridgeTrustedMetadataProvider {
  const appId = requireText(input.appId, 'appId');
  const runtimeEndpoint = requireText(input.runtimeEndpoint, 'runtimeEndpoint');
  const clientIdPrefix = normalizeZhiyuElectronRuntimeClientIdPrefix(appId);
  return createNimiElectronRuntimeAccountTrustedMetadataProvider({
    appId,
    runtimeEndpoint,
    accountCaller: createZhiyuElectronRuntimeAccountCaller(appId),
    appSession: {
      appInstanceId: `${appId}.local-first-party`,
      deviceId: `${clientIdPrefix}-local-first-party-device`,
      capabilities: [...runtimeRegistrationCapabilities],
      ttlSeconds: runtimeAppSessionTtlSeconds,
      refreshSkewMs: runtimeAppSessionRefreshSkewMs,
      developerRegistration: runtimeDeveloperRegistrationRequested,
    },
  });
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`zhiyu Electron Runtime auth requires ${field}`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
