import { NimiClient, createNimiClient } from '@nimiplatform/sdk';
import { createRealmWithRuntimeAccountToken } from '@nimiplatform/sdk/app';
import { createNimiDesktopShellRuntimeAccountCaller, createNimiRuntimeAppSessionMetadataProvider, createNimiRuntimeFullAppRegistration, createNimiRuntimePlatformClient, toNimiRuntimeTimestamp, withNimiRuntimeIdempotencyMetadata, type NimiHostRuntimeAgentDelegatedCapabilityClient, type NimiHostRuntimeAgentLifecycleClient, type NimiHostRuntimeAgentPresentationProfileClient, type NimiRuntimeAccountCaller, type NimiRuntimeAgentScopeRunner, type NimiRuntimeAgentTurnsRuntime, type Runtime } from '@nimiplatform/sdk/runtime';
import { AccountSessionState, AuthorizationPreset, ExternalPrincipalType, PolicyMode, type AuthorizeExternalPrincipalResponse, type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { Realm, createRealmFetchTransport, loginNimiRealmAuthPassword, type NimiRealmOAuthLoginResult } from '@nimiplatform/sdk/realm';
import { createNimiClientId, createNimiError, ReasonCode, type CoreMetadata } from '@nimiplatform/sdk/types';
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
} from '../../../shared/runtime-account-contract';

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
  readonly runtimeTransport?: DesktopRuntimeTransport;
  readonly client?: NimiClient;
  readonly runtime?: Runtime;
  readonly accountRuntime?: Runtime;
  readonly realm: Realm;
  readonly accountCaller?: NimiRuntimeAccountCaller;
}

export interface DesktopRuntimeRealmSession extends DesktopNimiClientSession {
  readonly runtimeTransport: DesktopRuntimeTransport;
  readonly client: NimiClient;
  readonly runtime: Runtime;
  readonly accountRuntime: Runtime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}

export type DesktopRuntimeTransport =
  | {
    readonly type: 'tauri-ipc';
    readonly commandNamespace?: string;
    readonly eventNamespace?: string;
  }
  | {
    readonly type: 'electron-ipc';
  };

export interface ConfigureDesktopRuntimeRealmSessionInput {
  readonly appId: string;
  readonly realmBaseUrl: string;
  readonly realmFetchImpl: DesktopNimiRealmFetch;
  readonly runtimeTransport: DesktopRuntimeTransport;
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

export async function configureDesktopRuntimeRealmSession(
  input: ConfigureDesktopRuntimeRealmSessionInput,
): Promise<DesktopRuntimeRealmSession> {
  const appId = requireText(input.appId, 'appId');
  const transport = input.runtimeTransport;
  const accountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId });
  const platformClient = createNimiRuntimePlatformClient({
    appId,
    transport,
    ...(transport.type === 'electron-ipc'
      ? {}
      : { createRuntimeAuthMetadata: createDesktopRendererRuntimeAuthMetadataFactory(appId, accountCaller) }),
  });
  const { runtime, accountRuntime } = platformClient;
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
    runtimeTransport: transport,
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
  readonly authorizationVersion: string;
  readonly metadata: CoreMetadata;
  readonly expiresAtMs: number;
} | null = null;
let protectedAccessInflight: Promise<{
  readonly appId: string;
  readonly subjectUserId: string;
  readonly authorizationVersion: string;
  readonly metadata: CoreMetadata;
  readonly expiresAtMs: number;
}> | null = null;
let protectedAccessInflightKey = '';

function createDesktopRendererRuntimeAuthMetadataFactory(
  appId: string,
  accountCaller: NimiRuntimeAccountCaller,
) {
  return ({ accountRuntime }: { readonly accountRuntime: Runtime }) => {
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
    return async (): Promise<CoreMetadata> => {
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
  };
}

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
    && protectedAccessCache.authorizationVersion === DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION
    && protectedAccessCache.expiresAtMs - Date.now() > DESKTOP_RUNTIME_PROTECTED_TOKEN_REFRESH_SKEW_MS
  ) {
    return protectedAccessCache.metadata;
  }
  const cacheKey = `${appId}:${subjectUserId}:${DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION}`;
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

async function getDesktopRuntimeProtectedAccessCallOptions(
  requestedScopes: readonly string[],
): Promise<RuntimeTypedCallOptions> {
  const session = getDesktopRuntimeRealmSession();
  assertDesktopProtectedScopes(requestedScopes);
  if (session.runtimeTransport.type === 'electron-ipc') {
    return {};
  }
  const subjectUserId = await getAuthenticatedRuntimeSubjectUserId(session.accountRuntime, session.accountCaller);
  if (!subjectUserId || !(await ensureRuntimeAccountAccessToken(session.accountRuntime, session.accountCaller))) {
    throw createNimiError({
      message: 'Desktop Runtime protected access requires an authenticated Runtime account.',
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'complete_runtime_account_login',
      source: 'runtime',
    });
  }
  return {
    metadata: await getDesktopRuntimeProtectedAccessMetadata(
      session.appId,
      session.accountRuntime,
      subjectUserId,
    ),
  };
}

export const withDesktopRuntimeProtectedScopes: NimiRuntimeAgentScopeRunner = async (
  scopes,
  operation,
) => operation(await getDesktopRuntimeProtectedAccessCallOptions(scopes));

async function getAuthenticatedRuntimeSubjectUserId(
  accountRuntime: Runtime,
  accountCaller: NimiRuntimeAccountCaller,
): Promise<string> {
  const response = await accountRuntime.account.getAccountSessionStatus({ caller: accountCaller });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return '';
  }
  return normalizeText(response.accountProjection?.accountId);
}

function assertDesktopProtectedScopes(scopes: readonly string[]): void {
  const allowed = new Set<string>(DESKTOP_RUNTIME_PROTECTED_SCOPES);
  const unsupported = [...new Set(scopes.map(normalizeText).filter(Boolean))]
    .filter((scope) => !allowed.has(scope));
  if (unsupported.length > 0) {
    throw createNimiError({
      message: `Desktop Runtime protected access does not include scopes: ${unsupported.join(', ')}`,
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'register_desktop_runtime_protected_scope',
      source: 'runtime',
    });
  }
}

async function issueDesktopRuntimeProtectedAccessMetadata(
  appId: string,
  accountRuntime: Runtime,
  subjectUserId: string,
): Promise<{
  readonly appId: string;
  readonly subjectUserId: string;
  readonly authorizationVersion: string;
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
    consentVersion: DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION,
    decisionAt: toNimiRuntimeTimestamp(new Date()),
    policyVersion: DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION,
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
  }, createNimiClientId(`desktop-runtime-protected-access-${DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE}`)));
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
    authorizationVersion: DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION,
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

export async function loginDesktopRealmPasswordWithBrowserSession(input: {
  readonly realmBaseUrl: string;
  readonly identifier: string;
  readonly password: string;
  readonly fetchImpl?: DesktopNimiRealmFetch;
}): Promise<NimiRealmOAuthLoginResult> {
  const realm = new Realm({
    transport: createRealmFetchTransport({
      baseUrl: input.realmBaseUrl,
      fetch: input.fetchImpl,
      credentials: 'include',
    }),
  });
  return loginNimiRealmAuthPassword(realm, input.identifier, input.password);
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

export function isDesktopRuntimeAccountSessionReady(): boolean {
  return Boolean(currentSession?.accountRuntime && currentSession.accountCaller);
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
  if (
    !currentSession?.runtime
    || !currentSession.accountRuntime
    || !currentSession.accountCaller
    || !currentSession.client
    || !currentSession.runtimeTransport
  ) {
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
