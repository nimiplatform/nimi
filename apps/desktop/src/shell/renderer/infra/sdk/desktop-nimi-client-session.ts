import { NimiClient, createNimiClient } from '@nimiplatform/sdk';
import { Runtime, createNimiDesktopShellRuntimeAccountCaller, createNimiRuntimeAppSessionMetadataProvider, createNimiRuntimeFullAppRegistration, toNimiRuntimeTimestamp, withNimiRuntimeIdempotencyMetadata, type NimiHostRuntimeAgentDelegatedCapabilityClient, type NimiHostRuntimeAgentLifecycleClient, type NimiHostRuntimeAgentPresentationProfileClient, type NimiRuntimeAccountCaller, type NimiRuntimeAgentTurnsRuntime } from '@nimiplatform/sdk/runtime';
import { AccountSessionState, AuthorizationPreset, ExternalPrincipalType, PolicyMode, type AuthorizeExternalPrincipalResponse } from '@nimiplatform/sdk/runtime/generated';
import { Realm, createRealmFetchTransport } from '@nimiplatform/sdk/realm';
import { createNimiClientId, createNimiError, ReasonCode, type CoreMetadata } from '@nimiplatform/sdk/types';

export type DesktopNimiRealmFetch = typeof fetch;

export interface DesktopAuthUserRecord {
  readonly [key: string]: unknown;
  readonly id?: unknown;
  readonly accountId?: unknown;
  readonly subjectId?: unknown;
  readonly sub?: unknown;
}

export interface DesktopNimiClientSession {
  readonly appId: string;
  readonly client?: NimiClient;
  readonly runtime?: Runtime;
  readonly accountRuntime?: Runtime;
  readonly realm: Realm;
  readonly accountCaller?: NimiRuntimeAccountCaller;
}

export interface DesktopRuntimeRealmSession extends DesktopNimiClientSession {
  readonly client: NimiClient;
  readonly runtime: Runtime;
  readonly accountRuntime: Runtime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}

export interface ConfigureDesktopRuntimeRealmSessionInput {
  readonly appId: string;
  readonly realmBaseUrl: string;
  readonly realmFetchImpl: DesktopNimiRealmFetch;
  readonly runtimeTransport?: {
    readonly type: 'tauri-ipc';
    readonly commandNamespace?: string;
    readonly eventNamespace?: string;
  };
  readonly developerRegistration?: boolean;
}

export interface ConfigureDesktopRealmOnlySessionInput {
  readonly appId: string;
  readonly realmBaseUrl: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly fetchImpl?: DesktopNimiRealmFetch | null;
  readonly getCurrentUser?: () => DesktopAuthUserRecord | null;
  readonly setAuthSession?: (
    user: DesktopAuthUserRecord | null,
    accessToken: string,
  ) => void | Promise<void>;
  readonly clearAuthSession?: () => void | Promise<void>;
}

let currentSession: DesktopNimiClientSession | null = null;

const PLATFORM_RUNTIME_SESSION_APP_INSTANCE_SUFFIX = '.platform-runtime-session';
const PLATFORM_RUNTIME_SESSION_DEVICE_ID = 'platform-runtime-session';
const PLATFORM_RUNTIME_SESSION_TTL_SECONDS = 3600;
const PLATFORM_RUNTIME_SESSION_REFRESH_SKEW_MS = 30_000;
const DESKTOP_RUNTIME_PROTECTED_SCOPES = ['ai.spend.meter'] as const;
const DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION = 'sdk-v2';
const DESKTOP_RUNTIME_PROTECTED_TOKEN_TTL_SECONDS = 3600;
const DESKTOP_RUNTIME_PROTECTED_TOKEN_REFRESH_SKEW_MS = 60_000;
const DESKTOP_RUNTIME_PROTECTED_CONSENT_ID = 'desktop-shell-runtime-account';

export async function configureDesktopRuntimeRealmSession(
  input: ConfigureDesktopRuntimeRealmSessionInput,
): Promise<DesktopRuntimeRealmSession> {
  const appId = requireText(input.appId, 'appId');
  const transport = input.runtimeTransport || {
    type: 'tauri-ipc' as const,
    commandNamespace: 'runtime_bridge',
    eventNamespace: 'runtime_bridge',
  };
  const accountRuntime = new Runtime({ appId, transport });
  const accountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId });
  await createNimiRuntimeFullAppRegistration(
    () => ({ auth: accountRuntime.auth }),
    {
      appId,
      appInstanceId: accountCaller.appInstanceId,
      deviceId: accountCaller.deviceId,
      capabilities: [...DESKTOP_RUNTIME_PROTECTED_SCOPES],
      rejectionLabel: 'desktop shell Runtime account caller registration rejected',
      developerRegistration: input.developerRegistration,
    },
  )();
  const getRuntimeSubjectUserId = async () => {
    const response = await accountRuntime.account.getAccountSessionStatus({ caller: accountCaller });
    if (response.state !== AccountSessionState.AUTHENTICATED) {
      return '';
    }
    return normalizeText(response.accountProjection?.accountId);
  };
  const requiredRuntimeSessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId,
    appInstanceId: `${appId}${PLATFORM_RUNTIME_SESSION_APP_INSTANCE_SUFFIX}`,
    deviceId: PLATFORM_RUNTIME_SESSION_DEVICE_ID,
    capabilities: [...DESKTOP_RUNTIME_PROTECTED_SCOPES],
    ttlSeconds: PLATFORM_RUNTIME_SESSION_TTL_SECONDS,
    refreshSkewMs: PLATFORM_RUNTIME_SESSION_REFRESH_SKEW_MS,
    auth: accountRuntime.auth,
  });
  const runtimeSessionMetadata = async (): Promise<CoreMetadata> => {
    const subjectUserId = await getRuntimeSubjectUserId();
    if (!subjectUserId || !(await ensureRuntimeAccountAccessToken(accountRuntime, accountCaller))) {
      return {};
    }
    const appSessionMetadata = await requiredRuntimeSessionMetadata();
    const protectedAccessMetadata = await getDesktopRuntimeProtectedAccessMetadata(
      appId,
      accountRuntime,
      subjectUserId,
    );
    return {
      ...appSessionMetadata,
      ...protectedAccessMetadata,
    };
  };
  const runtime = new Runtime({
    appId,
    transport,
    authMetadata: runtimeSessionMetadata,
  });
  const realm = createRealmWithRuntimeAccountToken({
    baseUrl: input.realmBaseUrl,
    fetchImpl: input.realmFetchImpl,
    runtime: accountRuntime,
    accountCaller,
  });
  const client = createNimiClient({
    appId,
    runtime,
    realm,
  });
  const session: DesktopRuntimeRealmSession = {
    appId,
    client,
    runtime,
    accountRuntime,
    realm,
    accountCaller,
  };
  currentSession = session;
  return session;
}

let protectedAccessCache: {
  readonly appId: string;
  readonly subjectUserId: string;
  readonly metadata: CoreMetadata;
  readonly expiresAtMs: number;
} | null = null;
let protectedAccessInflight: Promise<{
  readonly appId: string;
  readonly subjectUserId: string;
  readonly metadata: CoreMetadata;
  readonly expiresAtMs: number;
}> | null = null;
let protectedAccessInflightKey = '';

async function ensureRuntimeAccountAccessToken(
  accountRuntime: Runtime,
  accountCaller: NimiRuntimeAccountCaller,
): Promise<boolean> {
  const token = await accountRuntime.account.getAccessToken({
    caller: accountCaller,
    requestedScopes: [],
  });
  if (token.accepted && normalizeText(token.accessToken)) {
    return true;
  }
  const refreshed = await accountRuntime.account.refreshAccountSession({
    caller: accountCaller,
  });
  if (!refreshed.accepted) {
    return false;
  }
  const retry = await accountRuntime.account.getAccessToken({
    caller: accountCaller,
    requestedScopes: [],
  });
  return Boolean(retry.accepted && normalizeText(retry.accessToken));
}

async function getDesktopRuntimeProtectedAccessMetadata(
  appId: string,
  accountRuntime: Runtime,
  subjectUserId: string,
): Promise<CoreMetadata> {
  if (
    protectedAccessCache
    && protectedAccessCache.appId === appId
    && protectedAccessCache.subjectUserId === subjectUserId
    && protectedAccessCache.expiresAtMs - Date.now() > DESKTOP_RUNTIME_PROTECTED_TOKEN_REFRESH_SKEW_MS
  ) {
    return protectedAccessCache.metadata;
  }
  const cacheKey = `${appId}:${subjectUserId}`;
  if (!protectedAccessInflight || protectedAccessInflightKey !== cacheKey) {
    protectedAccessInflightKey = cacheKey;
    protectedAccessInflight = issueDesktopRuntimeProtectedAccessMetadata(appId, accountRuntime, subjectUserId);
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

async function issueDesktopRuntimeProtectedAccessMetadata(
  appId: string,
  accountRuntime: Runtime,
  subjectUserId: string,
): Promise<{
  readonly appId: string;
  readonly subjectUserId: string;
  readonly metadata: CoreMetadata;
  readonly expiresAtMs: number;
}> {
  const token = await accountRuntime.grants.authorizeExternalPrincipal({
    domain: 'app-auth',
    appId,
    externalPrincipalId: appId,
    externalPrincipalType: ExternalPrincipalType.APP,
    subjectUserId,
    consentId: DESKTOP_RUNTIME_PROTECTED_CONSENT_ID,
    consentVersion: 'v1',
    decisionAt: toNimiRuntimeTimestamp(new Date()),
    policyVersion: 'desktop-shell-runtime-account-v1',
    policyMode: PolicyMode.CUSTOM,
    preset: AuthorizationPreset.UNSPECIFIED,
    scopes: [...DESKTOP_RUNTIME_PROTECTED_SCOPES],
    resourceSelectors: {
      conversationIds: [],
      messageIds: [],
      documentIds: [],
      labels: {},
    },
    canDelegate: false,
    maxDelegationDepth: 0,
    ttlSeconds: DESKTOP_RUNTIME_PROTECTED_TOKEN_TTL_SECONDS,
    scopeCatalogVersion: DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION,
    policyOverride: false,
  }, withNimiRuntimeIdempotencyMetadata({
    metadata: { domain: 'app-auth' },
  }, createNimiClientId('desktop-runtime-protected-access')));
  const tokenId = normalizeText(token.tokenId);
  const secret = normalizeText(token.secret);
  if (!tokenId || !secret) {
    throw createNimiError({
      message: 'Desktop Runtime protected access token response is missing credentials.',
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'authorize_desktop_runtime_protected_access',
      source: 'runtime',
    });
  }
  return {
    appId,
    subjectUserId,
    metadata: {
      'x-nimi-access-token-id': tokenId,
      'x-nimi-access-token-secret': secret,
    },
    expiresAtMs: runtimeAuthorizeResponseExpiresAtMs(token) || Date.now() + (DESKTOP_RUNTIME_PROTECTED_TOKEN_TTL_SECONDS * 1000),
  };
}

function runtimeAuthorizeResponseExpiresAtMs(token: AuthorizeExternalPrincipalResponse): number {
  const expiresAt = token.expiresAt;
  if (!expiresAt) {
    return 0;
  }
  const seconds = Number(expiresAt.seconds || 0);
  const nanos = Number(expiresAt.nanos || 0);
  const millis = (seconds * 1000) + Math.floor(nanos / 1_000_000);
  return Number.isFinite(millis) && millis > 0 ? millis : 0;
}

export async function configureDesktopRealmOnlySession(
  input: ConfigureDesktopRealmOnlySessionInput,
): Promise<DesktopNimiClientSession> {
  const appId = requireText(input.appId, 'appId');
  const currentAccessToken = normalizeText(input.accessToken);
  const realm = new Realm({
    transport: createRealmFetchTransport({
      baseUrl: input.realmBaseUrl,
      fetch: input.fetchImpl || undefined,
      headers: (): CoreMetadata => {
        if (!currentAccessToken) {
          return {};
        }
        return {
          authorization: `Bearer ${currentAccessToken}`,
        };
      },
    }),
  });
  const session = {
    appId,
    realm,
  };
  currentSession = session;
  return session;
}

export function clearDesktopNimiClientSession(): void {
  currentSession = null;
}

export function setDesktopNimiClientSessionForTests(session: DesktopNimiClientSession): void {
  currentSession = session;
}

export function isDesktopNimiClientSessionReady(): boolean {
  return Boolean(currentSession?.realm);
}

export function getDesktopAppId(): string {
  if (!currentSession?.appId) {
    throw desktopSessionMissingError('appId');
  }
  return currentSession.appId;
}

export function getDesktopNimiClient(): NimiClient {
  if (!currentSession?.client) {
    throw desktopSessionMissingError('NimiClient');
  }
  return currentSession.client;
}

export function getDesktopRuntime(): Runtime {
  if (!currentSession?.runtime) {
    throw desktopSessionMissingError('Runtime');
  }
  return currentSession.runtime;
}

function getDesktopRuntimeRealmSession(): DesktopRuntimeRealmSession {
  if (!currentSession?.runtime || !currentSession.accountRuntime || !currentSession.accountCaller || !currentSession.client) {
    throw desktopSessionMissingError('Runtime Realm session');
  }
  return currentSession as DesktopRuntimeRealmSession;
}

export function getDesktopRuntimeAgentTurnsRuntime(): NimiRuntimeAgentTurnsRuntime {
  const session = getDesktopRuntimeRealmSession();
  return {
    appId: session.appId,
    auth: session.accountRuntime.auth,
    appAuth: session.accountRuntime.grants,
    agents: session.runtime.agents,
    appMessages: session.runtime.appMessages,
  };
}

export function getDesktopHostRuntimeAgentClient():
  NimiHostRuntimeAgentLifecycleClient &
  NimiHostRuntimeAgentPresentationProfileClient &
  NimiHostRuntimeAgentDelegatedCapabilityClient {
  const session = getDesktopRuntimeRealmSession();
  return {
    appId: session.appId,
    auth: session.accountRuntime.auth,
    appAuth: session.accountRuntime.grants,
    agent: session.runtime.agents,
  };
}

export function getDesktopAccountRuntime(): Runtime {
  if (!currentSession?.accountRuntime) {
    throw desktopSessionMissingError('Runtime account bootstrap');
  }
  return currentSession.accountRuntime;
}

export function getDesktopRealm(): Realm {
  if (!currentSession?.realm) {
    throw desktopSessionMissingError('Realm');
  }
  return currentSession.realm;
}

export function getDesktopRuntimeAccountCaller(): NimiRuntimeAccountCaller {
  if (!currentSession?.accountCaller) {
    throw desktopSessionMissingError('Runtime account caller');
  }
  return currentSession.accountCaller;
}

function createRealmWithRuntimeAccountToken(input: {
  readonly baseUrl: string;
  readonly fetchImpl: DesktopNimiRealmFetch;
  readonly runtime: Runtime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): Realm {
  return new Realm({
    transport: createRealmFetchTransport({
      baseUrl: input.baseUrl,
      fetch: createRuntimeAccountRefreshingRealmFetch(input),
      headers: async () => {
        const token = await input.runtime.account.getAccessToken({
          caller: input.accountCaller,
          requestedScopes: [],
        });
        const accessToken = normalizeText(token.accessToken);
        if (!token.accepted || !accessToken) {
          throw createNimiError({
            message: `Runtime account access token unavailable: ${String(token.accountReasonCode || token.reasonCode || 'unknown')}`,
            reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
            actionHint: 'complete_runtime_account_login',
            source: 'runtime',
          });
        }
        return {
          authorization: `Bearer ${accessToken}`,
        };
      },
    }),
  });
}

function createRuntimeAccountRefreshingRealmFetch(input: {
  readonly fetchImpl: DesktopNimiRealmFetch;
  readonly runtime: Runtime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): DesktopNimiRealmFetch {
  return async (request, init) => {
    const response = await input.fetchImpl(request, init);
    if (response.status !== 401) {
      return response;
    }

    const refreshed = await input.runtime.account.refreshAccountSession({
      caller: input.accountCaller,
    });
    if (!refreshed.accepted) {
      return response;
    }

    const token = await input.runtime.account.getAccessToken({
      caller: input.accountCaller,
      requestedScopes: [],
    });
    const accessToken = normalizeText(token.accessToken);
    if (!token.accepted || !accessToken) {
      return response;
    }

    const retryInit: RequestInit = {
      ...init,
      headers: withAuthorizationHeader(init?.headers, accessToken),
    };
    return input.fetchImpl(request, retryInit);
  };
}

function withAuthorizationHeader(headers: HeadersInit | undefined, accessToken: string): Headers {
  const next = new Headers(headers);
  next.set('authorization', `Bearer ${accessToken}`);
  return next;
}

function desktopSessionMissingError(surface: string): Error {
  return createNimiError({
    message: `Desktop ${surface} session is not ready.`,
    reasonCode: ReasonCode.SDK_PLATFORM_CLIENT_NOT_READY,
    actionHint: 'configure_desktop_nimi_client_session',
    source: 'sdk',
  });
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `Desktop Nimi client session requires ${field}.`,
      reasonCode: ReasonCode.SDK_APP_ID_REQUIRED,
      actionHint: 'provide_desktop_nimi_client_session_identity',
      source: 'sdk',
    });
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}
