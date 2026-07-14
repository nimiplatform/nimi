import { NimiClient, createNimiClient } from '@nimiplatform/sdk';
import { createRuntimeAccountMediatedRealmTransport } from '@nimiplatform/sdk/app';
import { createNimiDesktopShellRuntimeAccountCaller, createNimiRuntimePlatformClient, type NimiHostRuntimeAgentDelegatedCapabilityClient, type NimiHostRuntimeAgentLifecycleClient, type NimiHostRuntimeAgentPresentationProfileClient, type NimiRuntimeAccountCaller, type NimiRuntimeAgentScopeRunner, type NimiRuntimeAgentTurnsRuntime, type Runtime } from '@nimiplatform/sdk/runtime';
import { type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { Realm } from '@nimiplatform/sdk/realm';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import {
  beginRuntimeAccountLogin,
  completeRuntimeAccountLogin,
  getRuntimeAccountSessionStatusResponse,
  invokeRuntimeAccountRealmUnary,
  logoutRuntimeAccount,
  switchRuntimeAccount,
} from '@nimiplatform/kit/shell/renderer/bridge';
import {
  DESKTOP_RUNTIME_PROTECTED_SCOPES,
} from '../../../shared/runtime-account-contract';

export interface DesktopNimiClientSession {
  readonly appId: string;
  readonly runtimeTransport?: DesktopRuntimeTransport;
  readonly client?: NimiClient;
  readonly runtime?: Runtime;
  readonly accountRuntime?: DesktopAccountRuntime;
  readonly realm: Realm;
  readonly accountCaller?: NimiRuntimeAccountCaller;
}

export interface DesktopRuntimeRealmSession extends DesktopNimiClientSession {
  readonly runtimeTransport: DesktopRuntimeTransport;
  readonly client: NimiClient;
  readonly runtime: Runtime;
  readonly accountRuntime: DesktopAccountRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}

type DesktopProtectedAccountModule = Pick<
  Runtime['account'],
  | 'getAccountSessionStatus'
  | 'beginLogin'
  | 'completeLogin'
  | 'invokeRealmUnary'
  | 'logout'
  | 'switchAccount'
>;

export type DesktopAccountRuntime = {
  readonly auth: Runtime['auth'];
  readonly account: DesktopProtectedAccountModule;
};

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
  const { runtime, accountRuntime: publicAccountRuntime } = platformClient;
  const accountRuntime = createDesktopProtectedAccountRuntime(publicAccountRuntime.auth);
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

function runtimeIdempotencyKey(options: RuntimeTypedCallOptions | undefined): string | undefined {
  const metadata = options?.metadata as Record<string, unknown> | undefined;
  const value = String(metadata?.idempotencyKey || metadata?.['x-nimi-idempotency-key'] || '').trim();
  return value || undefined;
}

function createDesktopProtectedAccountRuntime(auth: Runtime['auth']): DesktopAccountRuntime {
  const account: DesktopProtectedAccountModule = {
    getAccountSessionStatus: async () => getRuntimeAccountSessionStatusResponse(),
    beginLogin: async (request) => beginRuntimeAccountLogin({
      redirectUri: request.redirectUri,
      callbackOrigin: request.callbackOrigin,
      requestedScopes: request.requestedScopes,
      ttlSeconds: request.ttlSeconds,
    }),
    completeLogin: async (request) => {
      if (String(request.refreshToken || '').trim() || String(request.sealedCompletionTicket || '').trim()) {
        throw createNimiError({
          message: 'Desktop protected account login accepts only a loopback OAuth code.',
          reasonCode: ReasonCode.AUTH_UNSUPPORTED_PROOF_TYPE,
          actionHint: 'complete_with_runtime_owned_oauth_code',
          source: 'runtime',
        });
      }
      return completeRuntimeAccountLogin({
        loginAttemptId: request.loginAttemptId,
        code: request.code,
        state: request.state,
        nonce: request.nonce,
        redirectUri: request.redirectUri,
        callbackOrigin: request.callbackOrigin,
      });
    },
    invokeRealmUnary: async (request, options) => invokeRuntimeAccountRealmUnary({
      methodId: request.methodId,
      requestJson: request.requestJson,
      timeoutMs: request.timeoutMs,
      idempotencyKey: runtimeIdempotencyKey(options),
    }),
    logout: async (request) => logoutRuntimeAccount(request.reason),
    switchAccount: async (request) => switchRuntimeAccount(request.reason),
  };
  return { auth, account };
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

export function installRealmProjectionSession(input: {
  readonly appId: string;
  readonly realm: Realm;
}): DesktopNimiClientSession {
  const appId = requireText(input.appId, 'appId');
  const session = {
    appId,
    realm: input.realm,
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
    agent: session.runtime.agents,
  };
}

export function getDesktopAccountRuntime(): DesktopAccountRuntime {
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
