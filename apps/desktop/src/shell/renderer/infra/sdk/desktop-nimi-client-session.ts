import { NimiClient, createNimiClient } from '@nimiplatform/sdk';
import { createRuntimeAccountMediatedRealmTransport } from '@nimiplatform/sdk/app';
import { createNimiDesktopShellRuntimeAccountCaller, createNimiRuntimeFullAppRegistration, createNimiRuntimePlatformClient, type NimiHostRuntimeAgentDelegatedCapabilityClient, type NimiHostRuntimeAgentLifecycleClient, type NimiHostRuntimeAgentPresentationProfileClient, type NimiRuntimeAccountCaller, type NimiRuntimeAgentScopeRunner, type NimiRuntimeAgentTurnsRuntime, type Runtime } from '@nimiplatform/sdk/runtime';
import { type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { Realm, createRealmFetchTransport, loginNimiRealmAuthPassword, type NimiRealmOAuthLoginResult } from '@nimiplatform/sdk/realm';
import { createNimiError, ReasonCode, type CoreMetadata } from '@nimiplatform/sdk/types';
import {
  DESKTOP_RUNTIME_PROTECTED_SCOPES,
  DESKTOP_RUNTIME_REGISTRATION_CAPABILITIES,
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
  });
  const { runtime, accountRuntime } = platformClient;
  await createNimiRuntimeFullAppRegistration(
    () => ({ auth: accountRuntime.auth }),
    {
      appId,
      appInstanceId: accountCaller.appInstanceId,
      deviceId: accountCaller.deviceId,
      capabilities: [...DESKTOP_RUNTIME_REGISTRATION_CAPABILITIES],
      rejectionLabel: 'desktop shell Runtime account caller registration rejected',
      developerRegistration: input.developerRegistration,
    },
  )();
  const realm = new Realm({
    transport: createRuntimeAccountMediatedRealmTransport({
      realmBaseUrl: input.realmBaseUrl,
      runtime: accountRuntime,
      accountCaller,
    }),
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

async function getDesktopRuntimeProtectedAccessCallOptions(
  requestedScopes: readonly string[],
): Promise<RuntimeTypedCallOptions> {
  const session = getDesktopRuntimeRealmSession();
  assertDesktopProtectedScopes(requestedScopes);
  if (session.runtimeTransport.type === 'electron-ipc') {
    return {};
  }
  throw createNimiError({
    message: 'Desktop renderer Runtime protected access requires a Runtime-owned scoped carrier.',
    reasonCode: 'SDK_RUNTIME_AGENT_SCOPED_CARRIER_REQUIRED',
    actionHint: 'use_runtime_owned_scoped_carrier',
    source: 'runtime',
  });
}

export const withDesktopRuntimeProtectedScopes: NimiRuntimeAgentScopeRunner = async (
  scopes,
  operation,
) => operation(await getDesktopRuntimeProtectedAccessCallOptions(scopes));

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
