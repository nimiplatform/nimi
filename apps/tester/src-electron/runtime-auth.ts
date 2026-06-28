import { createNimiClientId } from '@nimiplatform/sdk';
import {
  Runtime,
  createNimiDeveloperRegisteredRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
  toNimiRuntimeTimestamp,
  withNimiRuntimeIdempotencyMetadata,
  type NimiRuntimeAccountCaller,
} from '@nimiplatform/sdk/runtime';
import {
  AccountSessionState,
  AuthorizationPreset,
  ExternalPrincipalType,
  PolicyMode,
  type AuthorizeExternalPrincipalResponse,
} from '@nimiplatform/sdk/runtime/generated';
import { ReasonCode, type CoreMetadata } from '@nimiplatform/sdk/types';
import type {
  ElectronRuntimeBridgeTrustedMetadata,
  ElectronRuntimeBridgeTrustedMetadataProvider,
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
  const auth = createTesterElectronRuntimeAuth(input);
  return () => auth.trustedMetadata();
}

function createTesterElectronRuntimeAuth(input: {
  readonly appId: string;
  readonly runtimeEndpoint: string;
}) {
  const appId = requireText(input.appId, 'appId');
  const runtimeEndpoint = requireText(input.runtimeEndpoint, 'runtimeEndpoint');
  const clientIdPrefix = normalizeClientIdPrefix(appId);
  const accountCaller = createNimiDeveloperRegisteredRuntimeAccountCaller({
    appId,
    appInstanceId: `${appId}.local-developer`,
    deviceId: `${clientIdPrefix}-local-developer-device`,
  });
  const accountRuntime = new Runtime({
    appId,
    transport: { endpoint: runtimeEndpoint },
  });
  const appSessionMetadataProvider = createNimiRuntimeAppSessionMetadataProvider({
    appId,
    appInstanceId: `${appId}.platform-runtime-session`,
    deviceId: runtimeAppSessionDeviceId,
    capabilities: [...runtimeProtectedScopes],
    ttlSeconds: runtimeAppSessionTtlSeconds,
    refreshSkewMs: runtimeAppSessionRefreshSkewMs,
    auth: accountRuntime.auth,
    developerRegistration: runtimeDeveloperRegistrationRequested,
  });

  let protectedAccessCache: {
    readonly subjectUserId: string;
    readonly metadata: CoreMetadata;
    readonly expiresAtMs: number;
  } | null = null;
  let protectedAccessInflight: Promise<{
    readonly subjectUserId: string;
    readonly metadata: CoreMetadata;
    readonly expiresAtMs: number;
  }> | null = null;
  let protectedAccessInflightKey = '';

  async function trustedMetadata(): Promise<ElectronRuntimeBridgeTrustedMetadata | undefined> {
    const subjectUserId = await readRuntimeSubjectUserIdIfAvailable(accountRuntime, accountCaller);
    if (!subjectUserId) {
      return undefined;
    }
    const appSessionMetadata = await appSessionMetadataProvider();
    const protectedAccessMetadata = await getProtectedAccessMetadata(subjectUserId);
    return toTrustedMetadata({
      ...appSessionMetadata,
      ...protectedAccessMetadata,
    });
  }

  async function getProtectedAccessMetadata(subjectUserId: string): Promise<CoreMetadata> {
    if (
      protectedAccessCache &&
      protectedAccessCache.subjectUserId === subjectUserId &&
      protectedAccessCache.expiresAtMs - Date.now() > runtimeProtectedTokenRefreshSkewMs
    ) {
      return protectedAccessCache.metadata;
    }
    const cacheKey = `${appId}:${subjectUserId}:${runtimeProtectedScopeCatalogVersion}`;
    if (!protectedAccessInflight || protectedAccessInflightKey !== cacheKey) {
      protectedAccessInflightKey = cacheKey;
      protectedAccessInflight = issueProtectedAccessMetadata(subjectUserId);
    }
    try {
      protectedAccessCache = await protectedAccessInflight;
      return protectedAccessCache.metadata;
    } finally {
      if (protectedAccessInflightKey === cacheKey) {
        protectedAccessInflight = null;
        protectedAccessInflightKey = '';
      }
    }
  }

  async function issueProtectedAccessMetadata(subjectUserId: string): Promise<{
    readonly subjectUserId: string;
    readonly metadata: CoreMetadata;
    readonly expiresAtMs: number;
  }> {
    const normalizedSubject = subjectUserId.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80) || 'unknown';
    const token = await accountRuntime.grants.authorizeExternalPrincipal({
      domain: 'app-auth',
      appId,
      externalPrincipalId: appId,
      externalPrincipalType: ExternalPrincipalType.APP,
      subjectUserId,
      consentId: `${clientIdPrefix}-runtime-account`,
      consentVersion: 'v1',
      decisionAt: toNimiRuntimeTimestamp(new Date()),
      policyVersion: `${clientIdPrefix}-runtime-account-v1`,
      policyMode: PolicyMode.CUSTOM,
      preset: AuthorizationPreset.UNSPECIFIED,
      scopes: [...runtimeProtectedScopes],
      resourceSelectors: {
        conversationIds: [],
        messageIds: [],
        documentIds: [],
        labels: {},
      },
      canDelegate: false,
      maxDelegationDepth: 0,
      ttlSeconds: runtimeProtectedTokenTtlSeconds,
      scopeCatalogVersion: runtimeProtectedScopeCatalogVersion,
      policyOverride: false,
    }, withNimiRuntimeIdempotencyMetadata({
      metadata: { domain: 'app-auth' },
    }, createScopedClientId(clientIdPrefix, `runtime-protected-${normalizedSubject}`)));
    const tokenId = normalizeText(token.tokenId);
    const secret = normalizeText(token.secret);
    if (!tokenId || !secret) {
      throw new Error('Runtime protected access token response is missing credentials.');
    }
    return {
      subjectUserId,
      metadata: {
        'x-nimi-access-token-id': tokenId,
        'x-nimi-access-token-secret': secret,
      },
      expiresAtMs: runtimeAuthorizeResponseExpiresAtMs(token) || Date.now() + (runtimeProtectedTokenTtlSeconds * 1000),
    };
  }

  return { trustedMetadata };
}

async function readRuntimeSubjectUserIdIfAvailable(
  accountRuntime: Runtime,
  accountCaller: NimiRuntimeAccountCaller,
): Promise<string> {
  try {
    return await readRuntimeSubjectUserId(accountRuntime, accountCaller);
  } catch (error) {
    if (isRuntimeAuthProbeUnavailable(error)) {
      return '';
    }
    throw error;
  }
}

async function readRuntimeSubjectUserId(
  accountRuntime: Runtime,
  accountCaller: NimiRuntimeAccountCaller,
): Promise<string> {
  const session = await accountRuntime.account.getAccountSessionStatus({ caller: accountCaller });
  if (session.state === AccountSessionState.AUTHENTICATED && session.accountProjection?.accountId) {
    return normalizeText(session.accountProjection.accountId);
  }
  return '';
}

function isRuntimeAuthProbeUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as Record<string, unknown>;
  const reasonCode = normalizeText(record.reasonCode);
  if (
    reasonCode === 'RUNTIME_GRPC_UNAVAILABLE' ||
    reasonCode === 'RUNTIME_GRPC_DEADLINE_EXCEEDED' ||
    reasonCode === ReasonCode.RUNTIME_UNAVAILABLE ||
    reasonCode === ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE
  ) {
    return true;
  }
  const details = record.details && typeof record.details === 'object'
    ? record.details as Record<string, unknown>
    : undefined;
  return Number(details?.grpcCode) === 14;
}

function toTrustedMetadata(metadata: CoreMetadata): ElectronRuntimeBridgeTrustedMetadata | undefined {
  const sessionId = normalizeText(metadata['x-nimi-session-id']);
  const sessionToken = normalizeText(metadata['x-nimi-session-token']);
  const tokenId = normalizeText(metadata['x-nimi-access-token-id']);
  const secret = normalizeText(metadata['x-nimi-access-token-secret']);
  if (!sessionId || !sessionToken || !tokenId || !secret) {
    return undefined;
  }
  return {
    appSession: { sessionId, sessionToken },
    protectedAccessToken: { tokenId, secret },
  };
}

function runtimeAuthorizeResponseExpiresAtMs(token: AuthorizeExternalPrincipalResponse): number {
  const expiresAt = token.expiresAt;
  if (!expiresAt) return 0;
  const seconds = Number(expiresAt.seconds || 0);
  const nanos = Number(expiresAt.nanos || 0);
  const millis = (seconds * 1000) + Math.floor(nanos / 1_000_000);
  return Number.isFinite(millis) && millis > 0 ? millis : 0;
}

function createScopedClientId(clientIdPrefix: string, suffix: string): string {
  return createNimiClientId(`${clientIdPrefix}-${suffix}`);
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
