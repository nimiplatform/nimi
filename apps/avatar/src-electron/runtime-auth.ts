import {
  Runtime,
  createNimiBindingOnlyAvatarRuntimeAccountCaller,
  createNimiLocalFirstPartyRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
} from '@nimiplatform/sdk/runtime';
import {
  createNimiElectronRuntimeAccountTrustedMetadataProvider,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
} from '@nimiplatform/kit/shell/electron/main';

const runtimeDeveloperRegistrationRequested = false;
const runtimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.avatar_debug.read',
  'runtime.agent.avatar_debug.write',
] as const;
const runtimeAccountBrokerCapabilities = [
  'account.session.read',
  'account.raw-token',
  'data.scope.read#realm.worlds.read-probe',
] as const;
const runtimeRegistrationCapabilities = [
  ...runtimeProtectedScopes,
  ...runtimeAccountBrokerCapabilities,
] as const;
const runtimeProtectedScopeCatalogVersion = 'sdk-v2';
const runtimeAppSessionTtlSeconds = 3600;
const runtimeAppSessionRefreshSkewMs = 30_000;
const runtimeProtectedTokenTtlSeconds = 3600;
const runtimeProtectedTokenRefreshSkewMs = 60_000;

export type AvatarElectronRawAccessPosture = 'first-party' | 'binding-only';

export type AvatarElectronRawAccessPostureResult = {
  readonly posture: AvatarElectronRawAccessPosture;
  readonly accepted: boolean;
  readonly materialPresent: boolean;
  readonly materialProjected: false;
  readonly reasonCode: unknown;
  readonly accountReasonCode: unknown;
};

export function createAvatarElectronTrustedRuntimeMetadataProvider(input: {
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): ElectronRuntimeBridgeTrustedMetadataProvider {
  const appId = requireText(input.appId, 'appId');
  const runtimeEndpoint = requireText(input.runtimeEndpoint, 'runtimeEndpoint');
  const clientIdPrefix = normalizeClientIdPrefix(appId);
  return createNimiElectronRuntimeAccountTrustedMetadataProvider({
    appId,
    runtimeEndpoint,
    accountCaller: createNimiLocalFirstPartyRuntimeAccountCaller({
      appId,
      appInstanceId: `${appId}.local-first-party`,
      deviceId: `${clientIdPrefix}-local-first-party-device`,
    }),
    appSession: {
      appInstanceId: `${appId}.local-first-party`,
      deviceId: `${clientIdPrefix}-local-first-party-device`,
      capabilities: [...runtimeRegistrationCapabilities],
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

export async function probeAvatarElectronRawAccessPosture(input: {
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly posture: AvatarElectronRawAccessPosture;
}): Promise<AvatarElectronRawAccessPostureResult> {
  const appId = requireText(input.appId, 'appId');
  const runtimeEndpoint = requireText(input.runtimeEndpoint, 'runtimeEndpoint');
  const clientIdPrefix = normalizeClientIdPrefix(appId);
  const runtime = new Runtime({
    appId,
    transport: { endpoint: runtimeEndpoint },
  });
  const firstParty = input.posture === 'first-party';
  const caller = firstParty
    ? createNimiLocalFirstPartyRuntimeAccountCaller({
      appId,
      appInstanceId: `${appId}.local-first-party`,
      deviceId: `${clientIdPrefix}-local-first-party-device`,
    })
    : createNimiBindingOnlyAvatarRuntimeAccountCaller({
      appId,
      appInstanceId: `${appId}.binding-only`,
      deviceId: 'desktop-avatar-host',
    });
  const metadata = firstParty
    ? await createNimiRuntimeAppSessionMetadataProvider({
      auth: runtime.auth,
      appId,
      appInstanceId: caller.appInstanceId,
      deviceId: caller.deviceId,
      capabilities: [...runtimeRegistrationCapabilities],
      developerRegistration: false,
      ttlSeconds: runtimeAppSessionTtlSeconds,
      refreshSkewMs: runtimeAppSessionRefreshSkewMs,
    })()
    : undefined;
  const response = await runtime.account.getAccessToken(
    { caller, requestedScopes: [] },
    metadata ? { metadata } : undefined,
  );
  const materialPresent = Boolean(response.accepted && normalizeText(response.accessToken));
  return {
    posture: input.posture,
    accepted: response.accepted,
    materialPresent,
    materialProjected: false,
    reasonCode: response.reasonCode,
    accountReasonCode: response.accountReasonCode,
  };
}

function normalizeClientIdPrefix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nimi-app';
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`Avatar Electron Runtime auth requires ${field}`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
