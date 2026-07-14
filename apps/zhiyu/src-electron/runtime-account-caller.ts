import {
  createNimiLocalFirstPartyRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
  type NimiRuntimeAppSessionMetadataProviderInput,
} from '@nimiplatform/sdk/runtime';

export const ZHIYU_RUNTIME_PROTECTED_SCOPES = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.autonomy.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'runtime.agent.ai_config.read',
  'runtime.agent.ai_config.write',
  'ai.spend.meter',
] as const;
export const ZHIYU_RUNTIME_REGISTRATION_CAPABILITIES = [
  ...ZHIYU_RUNTIME_PROTECTED_SCOPES,
  'account.session.read',
  'data.scope.read#realm.worlds.read-probe',
] as const;
const runtimeAppSessionTtlSeconds = 3600;
const runtimeAppSessionRefreshSkewMs = 30_000;

export function createZhiyuElectronRuntimeAccountCaller(appId: string) {
  const normalizedAppId = requireText(appId, 'appId');
  const clientIdPrefix = normalizeClientIdPrefix(normalizedAppId);
  const runtimeAccountDeviceId = `${clientIdPrefix}-local-first-party-device`;
  return createNimiLocalFirstPartyRuntimeAccountCaller({
    appId: normalizedAppId,
    appInstanceId: `${normalizedAppId}.local-first-party`,
    deviceId: runtimeAccountDeviceId,
  });
}

export function createZhiyuElectronRuntimeAppSessionMetadataProvider(input: {
  readonly appId: string;
  readonly auth: NimiRuntimeAppSessionMetadataProviderInput['auth'];
}) {
  const appId = requireText(input.appId, 'appId');
  const clientIdPrefix = normalizeClientIdPrefix(appId);
  return createNimiRuntimeAppSessionMetadataProvider({
    auth: input.auth,
    appId,
    appInstanceId: `${appId}.local-first-party`,
    deviceId: `${clientIdPrefix}-local-first-party-device`,
    capabilities: [...ZHIYU_RUNTIME_REGISTRATION_CAPABILITIES],
    ttlSeconds: runtimeAppSessionTtlSeconds,
    refreshSkewMs: runtimeAppSessionRefreshSkewMs,
  });
}

export function normalizeZhiyuElectronRuntimeClientIdPrefix(value: string): string {
  return normalizeClientIdPrefix(value);
}

function normalizeClientIdPrefix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nimi-app';
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
