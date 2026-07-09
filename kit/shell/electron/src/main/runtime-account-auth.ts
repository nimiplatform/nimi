import { createNimiClientId } from '@nimiplatform/sdk';
import {
  Runtime,
  createNimiDesktopLaunchedNimiAppRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
  createNimiRuntimeFullAppRegistration,
  toNimiRuntimeTimestamp,
  withNimiRuntimeIdempotencyMetadata,
  type NimiRuntimeAccountCaller,
} from '@nimiplatform/sdk/runtime';
import {
  AccountCallerMode,
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
} from './types.js';

export type NimiElectronRuntimeAccountAuthRuntime = Pick<Runtime, 'account' | 'auth' | 'grants'>;

export type NimiElectronRuntimeAccountAppSessionInput = {
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly appVersion?: string;
  readonly capabilities: readonly string[];
  readonly developerRegistration?: boolean;
  readonly ttlSeconds?: number;
  readonly refreshSkewMs?: number;
};

export type NimiElectronRuntimeAccountResourceSelectors = {
  readonly conversationIds?: readonly string[];
  readonly messageIds?: readonly string[];
  readonly documentIds?: readonly string[];
  readonly labels?: Readonly<Record<string, string>>;
};

export type NimiElectronRuntimeProtectedAccessIdempotencyInput = {
  readonly appId: string;
  readonly subjectUserId: string;
  readonly normalizedSubjectUserId: string;
  readonly authorizationVersion: string;
  readonly policyVersion: string;
  readonly scopeCatalogVersion: string;
  readonly scopesSignature: string;
};

export type NimiElectronRuntimeProtectedAccessIdempotencyKey =
  | string
  | ((input: NimiElectronRuntimeProtectedAccessIdempotencyInput) => string);

export type NimiElectronRuntimeAccountProtectedAccessInput = {
  readonly domain?: string;
  readonly externalPrincipalId?: string;
  readonly consentId: string;
  readonly authorizationVersion: string;
  readonly consentVersion?: string;
  readonly policyVersion?: string;
  readonly scopeCatalogVersion: string;
  readonly scopes: readonly string[];
  readonly resourceSelectors?: NimiElectronRuntimeAccountResourceSelectors;
  readonly ttlSeconds?: number;
  readonly refreshSkewMs?: number;
  readonly idempotencyKey?: NimiElectronRuntimeProtectedAccessIdempotencyKey;
};

export type NimiElectronRuntimeAccountTrustedMetadataProviderInput = {
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly appSession: NimiElectronRuntimeAccountAppSessionInput;
  readonly protectedAccess: NimiElectronRuntimeAccountProtectedAccessInput;
  readonly runtime?: NimiElectronRuntimeAccountAuthRuntime;
};

export type NimiElectronInstalledAppLaunchBinding = {
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly launchHostId: string;
  readonly launchNonce: string;
  readonly releaseDescriptorRef: string;
};

export type NimiElectronInstalledAppSessionInput =
  Omit<NimiElectronRuntimeAccountAppSessionInput, 'appInstanceId' | 'deviceId' | 'developerRegistration'> & {
    readonly developerRegistration?: boolean;
  };

export type NimiElectronInstalledAppRuntimeAccountTrustedMetadataProviderInput =
  Omit<NimiElectronRuntimeAccountTrustedMetadataProviderInput, 'accountCaller' | 'appSession'> & {
    readonly installedApp: NimiElectronInstalledAppLaunchBinding;
    readonly appSession: NimiElectronInstalledAppSessionInput;
  };

const DEFAULT_PROTECTED_ACCESS_DOMAIN = 'app-auth';
const DEFAULT_PROTECTED_ACCESS_TTL_SECONDS = 3600;
const DEFAULT_PROTECTED_ACCESS_REFRESH_SKEW_MS = 60_000;

export function createNimiElectronRuntimeAccountTrustedMetadataProvider(
  input: NimiElectronRuntimeAccountTrustedMetadataProviderInput,
): ElectronRuntimeBridgeTrustedMetadataProvider {
  const appId = requireText(input.appId, 'appId');
  const runtimeEndpoint = requireText(input.runtimeEndpoint, 'runtimeEndpoint');
  const accountRuntime = input.runtime ?? new Runtime({
    appId,
    transport: { endpoint: runtimeEndpoint },
  });
  const accountCaller = input.accountCaller;
  const appSessionAppInstanceId = requireText(input.appSession.appInstanceId, 'appSession.appInstanceId');
  const appSessionDeviceId = requireText(input.appSession.deviceId, 'appSession.deviceId');
  const appSessionCapabilities = normalizeStrings(input.appSession.capabilities);
  const appSessionDeveloperRegistration = input.appSession.developerRegistration === true;
  const protectedAccess = normalizeProtectedAccessInput(appId, input.protectedAccess);
  const accountCallerMode = accountCaller.mode;
  const accountCallerDeveloperRegistration = accountCallerMode === AccountCallerMode.LOCAL_DEVELOPER_APP;
  const ensureAccountCallerRegistered = shouldRegisterAccountCaller(accountCallerMode)
    ? createNimiRuntimeFullAppRegistration(
      () => ({ auth: accountRuntime.auth }),
      {
        appId: requireText(accountCaller.appId, 'accountCaller.appId'),
        appInstanceId: requireText(accountCaller.appInstanceId, 'accountCaller.appInstanceId'),
        deviceId: requireText(accountCaller.deviceId, 'accountCaller.deviceId'),
        appVersion: input.appSession.appVersion,
        capabilities: normalizeStrings([
          ...(accountCaller.scopes ?? []),
          ...appSessionCapabilities,
        ]),
        developerRegistration: accountCallerDeveloperRegistration,
      },
    )
    : undefined;
  const appSessionMetadataProvider = createNimiRuntimeAppSessionMetadataProvider({
    appId,
    appInstanceId: appSessionAppInstanceId,
    deviceId: appSessionDeviceId,
    appVersion: input.appSession.appVersion,
    capabilities: appSessionCapabilities,
    developerRegistration: appSessionDeveloperRegistration,
    ttlSeconds: input.appSession.ttlSeconds,
    refreshSkewMs: input.appSession.refreshSkewMs,
    auth: accountRuntime.auth,
  });
  const identityMetadata = createTrustedIdentityMetadata(appId, accountCaller);

  let protectedAccessCache: {
    readonly subjectUserId: string;
    readonly policyVersion: string;
    readonly scopeCatalogVersion: string;
    readonly scopesSignature: string;
    readonly metadata: CoreMetadata;
    readonly expiresAtMs: number;
  } | null = null;
  let protectedAccessInflight: Promise<{
    readonly subjectUserId: string;
    readonly policyVersion: string;
    readonly scopeCatalogVersion: string;
    readonly scopesSignature: string;
    readonly metadata: CoreMetadata;
    readonly expiresAtMs: number;
  }> | null = null;
  let protectedAccessInflightKey = '';

  const trustedMetadata: ElectronRuntimeBridgeTrustedMetadataProvider = async (): Promise<ElectronRuntimeBridgeTrustedMetadata | undefined> => {
    await ensureAccountCallerRegistered?.();
    const appSessionMetadata = await appSessionMetadataProvider();
    const subjectUserId = await readRuntimeSubjectUserIdIfAvailable(accountRuntime, accountCaller);
    if (!subjectUserId) {
      return toTrustedMetadata({
        ...identityMetadata,
        ...appSessionMetadata,
      });
    }
    const protectedAccessMetadata = await getProtectedAccessMetadata(subjectUserId);
    return toTrustedMetadata({
      ...identityMetadata,
      ...appSessionMetadata,
      ...protectedAccessMetadata,
    });
  };

  trustedMetadata.invalidate = () => {
    protectedAccessCache = null;
    protectedAccessInflight = null;
    protectedAccessInflightKey = '';
  };

  async function getProtectedAccessMetadata(subjectUserId: string): Promise<CoreMetadata> {
    if (
      protectedAccessCache
      && protectedAccessCache.subjectUserId === subjectUserId
      && protectedAccessCache.policyVersion === protectedAccess.policyVersion
      && protectedAccessCache.scopeCatalogVersion === protectedAccess.scopeCatalogVersion
      && protectedAccessCache.scopesSignature === protectedAccess.scopesSignature
      && protectedAccessCache.expiresAtMs - Date.now() > protectedAccess.refreshSkewMs
    ) {
      return protectedAccessCache.metadata;
    }
    const cacheKey = [
      appId,
      subjectUserId,
      protectedAccess.policyVersion,
      protectedAccess.scopeCatalogVersion,
      protectedAccess.scopesSignature,
    ].join(':');
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
    readonly policyVersion: string;
    readonly scopeCatalogVersion: string;
    readonly scopesSignature: string;
    readonly metadata: CoreMetadata;
    readonly expiresAtMs: number;
  }> {
    const token = await accountRuntime.grants.authorizeExternalPrincipal({
      domain: protectedAccess.domain,
      appId,
      externalPrincipalId: protectedAccess.externalPrincipalId,
      externalPrincipalType: ExternalPrincipalType.APP,
      subjectUserId,
      consentId: protectedAccess.consentId,
      consentVersion: protectedAccess.consentVersion,
      decisionAt: toNimiRuntimeTimestamp(new Date()),
      policyVersion: protectedAccess.policyVersion,
      policyMode: PolicyMode.CUSTOM,
      preset: AuthorizationPreset.UNSPECIFIED,
      scopes: [...protectedAccess.scopes],
      resourceSelectors: {
        conversationIds: [...protectedAccess.resourceSelectors.conversationIds],
        messageIds: [...protectedAccess.resourceSelectors.messageIds],
        documentIds: [...protectedAccess.resourceSelectors.documentIds],
        labels: { ...protectedAccess.resourceSelectors.labels },
      },
      canDelegate: false,
      maxDelegationDepth: 0,
      ttlSeconds: protectedAccess.ttlSeconds,
      scopeCatalogVersion: protectedAccess.scopeCatalogVersion,
      policyOverride: false,
    }, withNimiRuntimeIdempotencyMetadata({
      metadata: { domain: protectedAccess.domain },
    }, resolveProtectedAccessIdempotencyKey(subjectUserId)));
    const tokenId = normalizeText(token.tokenId);
    const secret = normalizeText(token.secret);
    if (!tokenId || !secret) {
      throw new Error('Electron Runtime protected access token response is missing credentials.');
    }
    return {
      subjectUserId,
      policyVersion: protectedAccess.policyVersion,
      scopeCatalogVersion: protectedAccess.scopeCatalogVersion,
      scopesSignature: protectedAccess.scopesSignature,
      metadata: {
        'x-nimi-access-token-id': tokenId,
        'x-nimi-access-token-secret': secret,
      },
      expiresAtMs: runtimeAuthorizeResponseExpiresAtMs(token) || Date.now() + (protectedAccess.ttlSeconds * 1000),
    };
  }

  function resolveProtectedAccessIdempotencyKey(subjectUserId: string): string {
    const normalizedSubjectUserId = normalizeSubjectSegment(subjectUserId);
    const inputForResolver: NimiElectronRuntimeProtectedAccessIdempotencyInput = {
      appId,
      subjectUserId,
      normalizedSubjectUserId,
      authorizationVersion: protectedAccess.authorizationVersion,
      policyVersion: protectedAccess.policyVersion,
      scopeCatalogVersion: protectedAccess.scopeCatalogVersion,
      scopesSignature: protectedAccess.scopesSignature,
    };
    const rawPrefix = typeof protectedAccess.idempotencyKey === 'function'
      ? protectedAccess.idempotencyKey(inputForResolver)
      : protectedAccess.idempotencyKey;
    return createNimiClientId(
      normalizeText(rawPrefix) || `${normalizeClientIdPrefix(appId)}-runtime-protected-${normalizedSubjectUserId}`,
    );
  }

  return trustedMetadata;
}

function shouldRegisterAccountCaller(mode: AccountCallerMode | undefined): boolean {
  return mode === AccountCallerMode.LOCAL_FIRST_PARTY_APP
    || mode === AccountCallerMode.LOCAL_DEVELOPER_APP;
}

function createTrustedIdentityMetadata(
  appId: string,
  accountCaller: NimiRuntimeAccountCaller,
): CoreMetadata {
  return {
    participantId: appId,
    callerKind: accountCallerKindForMode(accountCaller.mode),
    callerId: requireText(accountCaller.appInstanceId, 'accountCaller.appInstanceId'),
  };
}

function accountCallerKindForMode(mode: AccountCallerMode | undefined): string {
  if (mode === AccountCallerMode.LOCAL_FIRST_PARTY_APP) {
    return 'local-first-party-app';
  }
  if (mode === AccountCallerMode.LOCAL_DEVELOPER_APP) {
    return 'local-developer-app';
  }
  if (mode === AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP) {
    return 'desktop-launched-nimi-app';
  }
  if (mode === AccountCallerMode.DESKTOP_SHELL) {
    return 'desktop-shell';
  }
  return 'third-party-app';
}

export function createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider(
  input: NimiElectronInstalledAppRuntimeAccountTrustedMetadataProviderInput,
): ElectronRuntimeBridgeTrustedMetadataProvider {
  const appId = requireText(input.appId, 'appId');
  const installedApp = {
    appInstanceId: requireText(input.installedApp.appInstanceId, 'installedApp.appInstanceId'),
    deviceId: requireText(input.installedApp.deviceId, 'installedApp.deviceId'),
    launchHostId: requireText(input.installedApp.launchHostId, 'installedApp.launchHostId'),
    launchNonce: requireText(input.installedApp.launchNonce, 'installedApp.launchNonce'),
    releaseDescriptorRef: requireText(input.installedApp.releaseDescriptorRef, 'installedApp.releaseDescriptorRef'),
  };
  if (input.appSession.developerRegistration === true) {
    throw new Error('Electron installed app Runtime account metadata forbids appSession.developerRegistration');
  }
  return createNimiElectronRuntimeAccountTrustedMetadataProvider({
    appId,
    runtimeEndpoint: input.runtimeEndpoint,
    protectedAccess: input.protectedAccess,
    runtime: input.runtime,
    accountCaller: createNimiDesktopLaunchedNimiAppRuntimeAccountCaller({
      appId,
      appInstanceId: installedApp.appInstanceId,
      deviceId: installedApp.deviceId,
      launchHostId: installedApp.launchHostId,
      launchNonce: installedApp.launchNonce,
      releaseDescriptorRef: installedApp.releaseDescriptorRef,
    }),
    appSession: {
      ...input.appSession,
      appInstanceId: installedApp.appInstanceId,
      deviceId: installedApp.deviceId,
      developerRegistration: false,
    },
  });
}

function normalizeProtectedAccessInput(
  appId: string,
  input: NimiElectronRuntimeAccountProtectedAccessInput,
) {
  const scopes = normalizeStrings(input.scopes);
  const authorizationVersion = requireText(input.authorizationVersion, 'protectedAccess.authorizationVersion');
  const policyVersion = requireText(input.policyVersion ?? authorizationVersion, 'protectedAccess.policyVersion');
  return {
    domain: normalizeText(input.domain) || DEFAULT_PROTECTED_ACCESS_DOMAIN,
    externalPrincipalId: normalizeText(input.externalPrincipalId) || appId,
    consentId: requireText(input.consentId, 'protectedAccess.consentId'),
    authorizationVersion,
    consentVersion: requireText(input.consentVersion ?? authorizationVersion, 'protectedAccess.consentVersion'),
    policyVersion,
    scopeCatalogVersion: requireText(input.scopeCatalogVersion, 'protectedAccess.scopeCatalogVersion'),
    scopes,
    scopesSignature: buildScopesSignature(scopes),
    resourceSelectors: {
      conversationIds: normalizeStrings(input.resourceSelectors?.conversationIds ?? []),
      messageIds: normalizeStrings(input.resourceSelectors?.messageIds ?? []),
      documentIds: normalizeStrings(input.resourceSelectors?.documentIds ?? []),
      labels: { ...(input.resourceSelectors?.labels ?? {}) },
    },
    ttlSeconds: normalizePositiveInt(input.ttlSeconds, DEFAULT_PROTECTED_ACCESS_TTL_SECONDS),
    refreshSkewMs: normalizeNonNegativeInt(input.refreshSkewMs, DEFAULT_PROTECTED_ACCESS_REFRESH_SKEW_MS),
    idempotencyKey: input.idempotencyKey,
  };
}

async function readRuntimeSubjectUserIdIfAvailable(
  accountRuntime: NimiElectronRuntimeAccountAuthRuntime,
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
  accountRuntime: NimiElectronRuntimeAccountAuthRuntime,
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
    reasonCode === 'RUNTIME_GRPC_UNAVAILABLE'
    || reasonCode === 'RUNTIME_GRPC_DEADLINE_EXCEEDED'
    || reasonCode === ReasonCode.RUNTIME_UNAVAILABLE
    || reasonCode === ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE
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
  if (!sessionId || !sessionToken) {
    return undefined;
  }
  if ((tokenId && !secret) || (!tokenId && secret)) {
    throw new Error('Electron Runtime protected access metadata is incomplete.');
  }
  return {
    metadata: {
      participantId: normalizeText(metadata.participantId),
      callerKind: normalizeText(metadata.callerKind),
      callerId: normalizeText(metadata.callerId),
      protocolVersion: normalizeText(metadata.protocolVersion) || undefined,
      participantProtocolVersion: normalizeText(metadata.participantProtocolVersion) || undefined,
      domain: normalizeText(metadata.domain) || undefined,
      traceId: normalizeText(metadata.traceId) || undefined,
      idempotencyKey: normalizeText(metadata.idempotencyKey) || undefined,
      surfaceId: normalizeText(metadata.surfaceId) || undefined,
      keySource: normalizeText(metadata.keySource) || undefined,
      providerType: normalizeText(metadata.providerType) || undefined,
      clientId: normalizeText(metadata.clientId) || undefined,
      providerEndpoint: normalizeText(metadata.providerEndpoint) || undefined,
    },
    appSession: { sessionId, sessionToken },
    ...(tokenId && secret ? { protectedAccessToken: { tokenId, secret } } : {}),
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

function buildScopesSignature(scopes: readonly string[]): string {
  const normalized = scopes.slice().sort();
  let hash = 0x811c9dc5;
  for (const scope of normalized) {
    for (let index = 0; index < scope.length; index += 1) {
      hash ^= scope.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x7c;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `s${normalized.length}-${hash.toString(36)}`;
}

function normalizeSubjectSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80) || 'unknown';
}

function normalizeClientIdPrefix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nimi-app';
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : fallback;
}

function normalizeStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`Electron Runtime account auth requires ${field}`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
