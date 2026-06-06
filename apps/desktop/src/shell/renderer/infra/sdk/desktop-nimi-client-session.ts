import { NimiClient, createNimiClient } from '@nimiplatform/sdk';
import { Runtime, createNimiLocalFirstPartyRuntimeAccountCaller, createNimiRuntimeAppSessionMetadataProvider, createNimiRuntimeFullAppRegistration, type NimiHostRuntimeAgentDelegatedCapabilityClient, type NimiHostRuntimeAgentLifecycleClient, type NimiHostRuntimeAgentPresentationProfileClient, type NimiRuntimeAccountCaller, type NimiRuntimeAgentTurnsRuntime } from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/generated';
import { Realm, createRealmFetchTransport } from '@nimiplatform/sdk/realm';
import { createNimiError, ReasonCode, type CoreMetadata } from '@nimiplatform/sdk/types';

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
  const accountCaller = createNimiLocalFirstPartyRuntimeAccountCaller({ appId });
  await createNimiRuntimeFullAppRegistration(
    () => ({ auth: accountRuntime.auth }),
    {
      appId,
      appInstanceId: accountCaller.appInstanceId,
      deviceId: accountCaller.deviceId,
      rejectionLabel: 'local first-party Runtime account caller registration rejected',
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
    ttlSeconds: PLATFORM_RUNTIME_SESSION_TTL_SECONDS,
    refreshSkewMs: PLATFORM_RUNTIME_SESSION_REFRESH_SKEW_MS,
    auth: accountRuntime.auth,
    getSubjectUserId: getRuntimeSubjectUserId,
  });
  const runtimeSessionMetadata = async (): Promise<CoreMetadata> => {
    if (!(await getRuntimeSubjectUserId())) {
      return {};
    }
    return requiredRuntimeSessionMetadata();
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
      fetch: input.fetchImpl,
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
