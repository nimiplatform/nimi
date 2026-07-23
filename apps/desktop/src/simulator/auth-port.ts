import { createRuntimeAccountBrowserBroker } from '@nimiplatform/kit/auth';
import type { AuthPlatformAdapter } from '@nimiplatform/kit/auth/shell';
import type { ShellOAuthBridge } from '@nimiplatform/kit/core/oauth';
import {
  createNimiTestingHarness,
  type NimiTestingHostFailureDisposition,
  type NimiTestingHostPort,
  type NimiTestingUnaryMethod,
} from '@nimiplatform/sdk/testing';
import { createNimiDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';

import type { DesktopRendererAuthPort } from '../shell/renderer/renderer/auth-port.js';
import type { DesktopRendererLifecyclePort } from '../shell/renderer/renderer/lifecycle-port.js';
import type { DesktopRendererSdkPort } from '../shell/renderer/renderer/sdk-port.js';
import type {
  AuthStatus,
  RuntimeAccountAuthProjection,
} from '../shell/renderer/app-shell/providers/store-types.js';
import type {
  DesktopSimulatorJsonValue,
  DesktopSimulatorPrepareContext,
} from './protocol.js';

/**
 * Deterministic State Engine-backed simulated RuntimeAccount projection.
 *
 * Shape mirrors the production desktop port (`desktop-auth-adapter.ts`): the
 * only admitted login path is the RuntimeAccount browser broker flow, token
 * custody stays Runtime-owned (the kit broker completes with the sealed /
 * empty-token loopback-code-only shape), and every runtime-owned adapter
 * method keeps throwing. Instead of a Runtime connection, the broker's SDK
 * client is the SDK testing harness routed through the desktop simulator
 * module's declared State Engine commands/events/projection, so the whole
 * flow is deterministic, replayable, and network-free.
 */

const METHOD_GET_SESSION_STATUS = 'nimi.runtime.account.getAccountSessionStatus' as const;
const METHOD_BEGIN_LOGIN = 'nimi.runtime.account.beginLogin' as const;
const METHOD_COMPLETE_LOGIN = 'nimi.runtime.account.completeLogin' as const;
const METHOD_LOGOUT = 'nimi.runtime.account.logout' as const;
const SIMULATOR_OAUTH_REDIRECT_URI = 'http://127.0.0.1:43110/oauth/callback';
const SIMULATOR_OAUTH_CALLBACK_ORIGIN = 'http://127.0.0.1:43110';

type JsonRecord = { readonly [key: string]: DesktopSimulatorJsonValue };

type RuntimeAccountCaller = ReturnType<typeof createNimiDesktopShellRuntimeAccountCaller>;

type SimulatorAccountProjection = {
  readonly accountId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly role: string;
  readonly realmEnvironmentId: string;
};

type BeginLoginRequest = {
  readonly caller: RuntimeAccountCaller;
  readonly redirectUri: string;
  readonly callbackOrigin: string;
  readonly requestedScopes: readonly string[];
  readonly ttlSeconds: number;
};

type BeginLoginResponse = {
  readonly accepted: boolean;
  readonly loginAttemptId?: string | null;
  readonly oauthAuthorizationUrl?: string | null;
  readonly state?: string | null;
  readonly nonce?: string | null;
};

type CompleteLoginRequest = {
  readonly caller: RuntimeAccountCaller;
  readonly loginAttemptId: string;
  readonly code: string;
  readonly refreshToken: '';
  readonly state: string;
  readonly nonce: string;
  readonly redirectUri: string;
  readonly callbackOrigin: string;
  readonly uxTraceId: string;
  readonly sealedCompletionTicket: string;
};

type CompleteLoginResponse = {
  readonly accepted: boolean;
  readonly accountProjection?: SimulatorAccountProjection | null;
};

type GetAccountSessionStatusRequest = { readonly caller: RuntimeAccountCaller };

type GetAccountSessionStatusResponse = {
  readonly accepted: boolean;
  readonly snapshot?: {
    readonly state: string;
    readonly accountProjection?: SimulatorAccountProjection | null;
  } | null;
};

type LogoutRequest = {
  readonly caller: RuntimeAccountCaller;
  readonly reason: string;
};

type LogoutResponse = { readonly accepted: boolean };

interface DesktopSimulatorRuntimeAccountMethodMap {
  readonly [METHOD_GET_SESSION_STATUS]: NimiTestingUnaryMethod<
    GetAccountSessionStatusRequest,
    GetAccountSessionStatusResponse
  >;
  readonly [METHOD_BEGIN_LOGIN]: NimiTestingUnaryMethod<BeginLoginRequest, BeginLoginResponse>;
  readonly [METHOD_COMPLETE_LOGIN]: NimiTestingUnaryMethod<CompleteLoginRequest, CompleteLoginResponse>;
  readonly [METHOD_LOGOUT]: NimiTestingUnaryMethod<LogoutRequest, LogoutResponse>;
}

type PendingLoginNotice = {
  readonly loginAttemptId: string;
  readonly authorizationUrl: string;
  readonly state: string;
  readonly nonce: string;
};

type RuntimeAccountResult<TKey extends keyof DesktopSimulatorRuntimeAccountMethodMap> =
  DesktopSimulatorRuntimeAccountMethodMap[TKey] extends NimiTestingUnaryMethod<infer _TRequest, infer TResult>
    ? TResult
    : never;

type AuthProjectionSnapshot = {
  readonly status: 'anonymous' | 'login-pending' | 'authenticated';
  readonly sessionRevision: number;
  readonly persona: SimulatorAccountProjection | null;
};

export interface DesktopSimulatorAuthSessionPort {
  readonly authPort: DesktopRendererAuthPort;
  readonly accountRuntime: ReturnType<DesktopRendererSdkPort['accountRuntime']>;
  readonly caller: RuntimeAccountCaller;
  isSessionReady(): boolean;
  reconcileLoginState(input: {
    readonly authStatus: AuthStatus;
  }): Promise<{ readonly clearAuthSession: boolean }>;
  bindLifecycle(lifecycle: DesktopRendererLifecyclePort): () => void;
}

function record(value: DesktopSimulatorJsonValue | undefined, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`DESKTOP_SIMULATOR_${label}_INVALID`);
  }
  return value as JsonRecord;
}

function text(value: DesktopSimulatorJsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`DESKTOP_SIMULATOR_${label}_INVALID`);
  }
  return value;
}

function runtimeAccountOwned(route: string): never {
  throw new Error(`Desktop ${route} is owned by RuntimeAccountService`);
}

function assertLoopbackCallback(redirectUri: string, callbackOrigin?: string): void {
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error('DESKTOP_SIMULATOR_AUTH_REDIRECT_URI_INVALID');
  }
  if (redirect.protocol !== 'http:'
    || (redirect.hostname !== '127.0.0.1' && redirect.hostname !== 'localhost')
    || redirect.username || redirect.password || redirect.hash
    || (callbackOrigin !== undefined && redirect.origin !== callbackOrigin)) {
    throw new Error('DESKTOP_SIMULATOR_AUTH_REDIRECT_URI_INVALID');
  }
}

function dispositionForCommandError(code: string): NimiTestingHostFailureDisposition {
  switch (code) {
    case 'SIMULATOR_UNSUPPORTED':
      return 'unsupported';
    case 'SIMULATOR_CAPABILITY_DENIED':
      return 'capability-denied';
    case 'SIMULATOR_RESOURCE_EXHAUSTED':
      return 'resource-exhausted';
    case 'SIMULATOR_INVALID_PAYLOAD':
      return 'invalid-input';
    case 'SIMULATOR_EFFECT_FORBIDDEN':
      return 'effect-forbidden';
    default:
      return 'host-unavailable';
  }
}

function simulatorUser(projection: SimulatorAccountProjection): Record<string, unknown> {
  return {
    id: projection.userId,
    displayName: projection.displayName,
    role: projection.role,
    realmEnvironmentId: projection.realmEnvironmentId,
    accountId: projection.accountId,
    simulated: true,
  };
}

export function createDesktopSimulatorAuthSessionPort(
  context: DesktopSimulatorPrepareContext,
): DesktopSimulatorAuthSessionPort {
  let lifecycle: DesktopRendererLifecyclePort | null = null;
  const pendingRef: { current: PendingLoginNotice | null } = { current: null };
  const clearPendingNotice = (): void => {
    pendingRef.current = null;
  };
  const readPendingNotice = (): PendingLoginNotice | null => pendingRef.current;
  let personaShareInFlight = false;
  let personaShareSettled = false;
  const oauthListeners = new Map<string, (result: {
    readonly callbackUrl: string;
    readonly code?: string;
    readonly state?: string;
    readonly error?: string;
  }) => void>();

  function readAuthProjection(): AuthProjectionSnapshot {
    const projection = record(context.projection.get(), 'AUTH_PROJECTION');
    const auth = record(projection.auth, 'AUTH_PROJECTION');
    const status = auth.status;
    if (status !== 'anonymous' && status !== 'login-pending' && status !== 'authenticated') {
      throw new Error('DESKTOP_SIMULATOR_AUTH_PROJECTION_INVALID');
    }
    if (!Number.isSafeInteger(auth.sessionRevision)) {
      throw new Error('DESKTOP_SIMULATOR_AUTH_PROJECTION_INVALID');
    }
    let persona: SimulatorAccountProjection | null = null;
    if (auth.persona !== null) {
      const candidate = record(auth.persona, 'AUTH_PERSONA');
      persona = {
        accountId: text(candidate.accountId, 'AUTH_PERSONA'),
        userId: text(candidate.userId, 'AUTH_PERSONA'),
        displayName: text(candidate.displayName, 'AUTH_PERSONA'),
        role: text(candidate.role, 'AUTH_PERSONA'),
        realmEnvironmentId: text(candidate.realmEnvironmentId, 'AUTH_PERSONA'),
      };
    }
    if (status === 'authenticated' && !persona) {
      throw new Error('DESKTOP_SIMULATOR_AUTH_PROJECTION_INVALID');
    }
    return { status, sessionRevision: auth.sessionRevision as number, persona };
  }

  function authenticatedStoreProjection(snapshot: AuthProjectionSnapshot): RuntimeAccountAuthProjection {
    if (snapshot.status !== 'authenticated' || !snapshot.persona) {
      throw new Error('DESKTOP_SIMULATOR_AUTH_PROJECTION_INVALID');
    }
    return {
      status: 'authenticated',
      user: simulatorUser(snapshot.persona),
      sequence: String(snapshot.sessionRevision),
      reasonCode: 0,
      accountReasonCode: 0,
    };
  }

  const pendingSubscription = context.events.subscribe('desktop.auth.login.pending', (value) => {
    const payload = record(value, 'AUTH_LOGIN_PENDING_EVENT');
    if (payload.instanceId !== context.instanceId) return;
    pendingRef.current = {
      loginAttemptId: text(payload.loginAttemptId, 'AUTH_LOGIN_PENDING_EVENT'),
      authorizationUrl: text(payload.authorizationUrl, 'AUTH_LOGIN_PENDING_EVENT'),
      state: text(payload.state, 'AUTH_LOGIN_PENDING_EVENT'),
      nonce: text(payload.nonce, 'AUTH_LOGIN_PENDING_EVENT'),
    };
  });
  if (!pendingSubscription.ok) {
    throw new Error(`DESKTOP_SIMULATOR_AUTH_EVENT_REJECTED:${pendingSubscription.error.code}`);
  }
  const oauthSubscription = context.events.subscribe('desktop.auth.oauth.callback', (value) => {
    const payload = record(value, 'AUTH_OAUTH_CALLBACK_EVENT');
    if (payload.instanceId !== context.instanceId) return;
    const redirectUri = text(payload.redirectUri, 'AUTH_OAUTH_CALLBACK_EVENT');
    const listener = oauthListeners.get(redirectUri);
    if (!listener) return;
    oauthListeners.delete(redirectUri);
    listener({
      callbackUrl: redirectUri,
      code: text(payload.code, 'AUTH_OAUTH_CALLBACK_EVENT'),
      state: text(payload.state, 'AUTH_OAUTH_CALLBACK_EVENT'),
    });
  });
  if (!oauthSubscription.ok) {
    throw new Error(`DESKTOP_SIMULATOR_AUTH_EVENT_REJECTED:${oauthSubscription.error.code}`);
  }
  const sharePersona = (): void => {
    if (personaShareInFlight || personaShareSettled) return;
    const snapshot = readAuthProjection();
    if (snapshot.status !== 'authenticated' || !snapshot.persona) return;
    personaShareInFlight = true;
    const persona = snapshot.persona;
    void context.interactions.emit({
      protocol: 'nimi.simulator.interaction/v1',
      interactionId: `sim-persona-${persona.userId}`,
      targets: ['zhiyu', 'tester'],
      type: 'session.persona.share',
      payload: { ...persona },
    }).then((result) => {
      personaShareInFlight = false;
      personaShareSettled = result.ok;
    });
  };
  const authenticatedSubscription = context.events.subscribe('desktop.auth.session.authenticated', (value) => {
    const payload = record(value, 'AUTH_AUTHENTICATED_EVENT');
    if (payload.instanceId !== context.instanceId) return;
    if (lifecycle) {
      lifecycle.applyRuntimeAccountProjection(authenticatedStoreProjection(readAuthProjection()));
    }
    record(payload.persona, 'AUTH_AUTHENTICATED_PERSONA');
    sharePersona();
  });
  if (!authenticatedSubscription.ok) {
    throw new Error(`DESKTOP_SIMULATOR_AUTH_EVENT_REJECTED:${authenticatedSubscription.error.code}`);
  }
  const anonymousSubscription = context.events.subscribe('desktop.auth.session.anonymous', (value) => {
    const payload = record(value, 'AUTH_ANONYMOUS_EVENT');
    if (payload.instanceId !== context.instanceId || !lifecycle) return;
    lifecycle.clearAuthSession();
  });
  if (!anonymousSubscription.ok) {
    throw new Error(`DESKTOP_SIMULATOR_AUTH_EVENT_REJECTED:${anonymousSubscription.error.code}`);
  }
  const cleanup = context.cleanup.add(() => {
    pendingSubscription.value();
    oauthSubscription.value();
    authenticatedSubscription.value();
    anonymousSubscription.value();
    const pending = [...oauthListeners.entries()];
    oauthListeners.clear();
    for (const [redirectUri, listener] of pending) {
      listener({ callbackUrl: redirectUri, error: 'simulator_instance_disposed' });
    }
  });
  if (!cleanup.ok) throw new Error('DESKTOP_SIMULATOR_AUTH_CLEANUP_REJECTED');

  async function invokeEngine(
    type: string,
    payload: JsonRecord,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly disposition: NimiTestingHostFailureDisposition }> {
    const result = await context.commands.invoke(type, payload);
    if (!result.ok) {
      return { ok: false, disposition: dispositionForCommandError(result.error.code) };
    }
    return { ok: true };
  }

  const port = {
    async invoke(methodId: string, request: unknown) {
      if (methodId === METHOD_GET_SESSION_STATUS) {
        const snapshot = readAuthProjection();
        return {
          ok: true as const,
          value: {
            accepted: true,
            snapshot: {
              state: snapshot.status,
              accountProjection: snapshot.persona,
            },
          },
        };
      }
      if (methodId === METHOD_BEGIN_LOGIN) {
        const input = request as BeginLoginRequest;
        assertLoopbackCallback(input.redirectUri, input.callbackOrigin);
        clearPendingNotice();
        const invoked = await invokeEngine('desktop.auth.begin-login', {
          instanceId: context.instanceId,
          redirectUri: SIMULATOR_OAUTH_REDIRECT_URI,
          callbackOrigin: SIMULATOR_OAUTH_CALLBACK_ORIGIN,
          requestedScopes: [...input.requestedScopes],
          ttlSeconds: input.ttlSeconds,
        });
        if (!invoked.ok) return { ok: false as const, error: { disposition: invoked.disposition } };
        const notice = readPendingNotice();
        if (!notice) return { ok: false as const, error: { disposition: 'internal' as const } };
        return {
          ok: true as const,
          value: {
            accepted: true,
            loginAttemptId: notice.loginAttemptId,
            oauthAuthorizationUrl: notice.authorizationUrl,
            state: notice.state,
            nonce: notice.nonce,
          },
        };
      }
      if (methodId === METHOD_COMPLETE_LOGIN) {
        const input = request as CompleteLoginRequest;
        assertLoopbackCallback(input.redirectUri, input.callbackOrigin);
        const invoked = await invokeEngine('desktop.auth.complete-login', {
          instanceId: context.instanceId,
          loginAttemptId: input.loginAttemptId,
          code: input.code,
          state: input.state,
          nonce: input.nonce,
          redirectUri: SIMULATOR_OAUTH_REDIRECT_URI,
          callbackOrigin: SIMULATOR_OAUTH_CALLBACK_ORIGIN,
        });
        if (!invoked.ok) return { ok: false as const, error: { disposition: invoked.disposition } };
        const snapshot = readAuthProjection();
        if (snapshot.status !== 'authenticated' || !snapshot.persona) {
          return { ok: false as const, error: { disposition: 'internal' as const } };
        }
        return {
          ok: true as const,
          value: { accepted: true, accountProjection: snapshot.persona },
        };
      }
      if (methodId === METHOD_LOGOUT) {
        const input = request as LogoutRequest;
        const invoked = await invokeEngine('desktop.auth.logout', {
          instanceId: context.instanceId,
          reason: input.reason,
        });
        if (!invoked.ok) return { ok: false as const, error: { disposition: invoked.disposition } };
        return { ok: true as const, value: { accepted: true } };
      }
      return { ok: false as const, error: { disposition: 'unsupported' as const } };
    },
    async openStream() {
      return { ok: false as const, error: { disposition: 'unsupported' as const } };
    },
  } as NimiTestingHostPort<DesktopSimulatorRuntimeAccountMethodMap>;

  const harness = createNimiTestingHarness<DesktopSimulatorRuntimeAccountMethodMap>({
    opaqueTraceSeed: '5'.repeat(64),
    methods: [
      { id: METHOD_GET_SESSION_STATUS, kind: 'unary' },
      { id: METHOD_BEGIN_LOGIN, kind: 'unary' },
      { id: METHOD_COMPLETE_LOGIN, kind: 'unary' },
      { id: METHOD_LOGOUT, kind: 'unary' },
    ],
    port,
  });

  const instanceIdentity = context.instanceId.replaceAll(':', '-');
  const caller = createNimiDesktopShellRuntimeAccountCaller({
    appId: 'nimi.desktop',
    appInstanceId: `sim-desktop-${instanceIdentity}`,
    deviceId: `sim-device-${instanceIdentity}`,
  });

  async function callRuntimeAccount<TKey extends keyof DesktopSimulatorRuntimeAccountMethodMap & string>(
    methodId: TKey,
    request: DesktopSimulatorJsonValue,
  ): Promise<RuntimeAccountResult<TKey>> {
    const result = await harness.invoke(
      methodId,
      request as never,
    );
    if (!result.ok) throw harness.projectFailure(methodId, result.error);
    return result.value as RuntimeAccountResult<TKey>;
  }

  const accountClient = Object.freeze({
    runtime: Object.freeze({
      account: Object.freeze({
        getAccountSessionStatus: (input: GetAccountSessionStatusRequest) => (
          callRuntimeAccount(METHOD_GET_SESSION_STATUS, input as unknown as DesktopSimulatorJsonValue)
        ),
        beginLogin: (input: BeginLoginRequest) => (
          callRuntimeAccount(METHOD_BEGIN_LOGIN, input as unknown as DesktopSimulatorJsonValue)
        ),
        completeLogin: (input: CompleteLoginRequest) => (
          callRuntimeAccount(METHOD_COMPLETE_LOGIN, input as unknown as DesktopSimulatorJsonValue)
        ),
        logout: (input: LogoutRequest) => (
          callRuntimeAccount(METHOD_LOGOUT, input as unknown as DesktopSimulatorJsonValue)
        ),
        async invokeRealmUnary() {
          throw new Error('DESKTOP_SIMULATOR_REALM_UNADMITTED');
        },
        async switchAccount() {
          throw new Error('DESKTOP_SIMULATOR_ACCOUNT_SWITCH_UNADMITTED');
        },
      }),
    }),
  });

  async function loadSimulatorUser(): Promise<Record<string, unknown> | null> {
    const response = await accountClient.runtime.account.getAccountSessionStatus({ caller });
    const projection = response.snapshot?.accountProjection;
    if (!response.accepted || response.snapshot?.state !== 'authenticated' || !projection?.accountId) {
      return null;
    }
    return simulatorUser(projection);
  }

  const broker = createRuntimeAccountBrowserBroker({
    caller,
    getClient: () => accountClient,
    projectUser: (projection) => {
      const accountId = String(projection.accountId || '').trim();
      if (!accountId) return null;
      const candidate = projection as unknown as SimulatorAccountProjection;
      return simulatorUser({
        accountId,
        userId: String(candidate.userId || accountId),
        displayName: String(candidate.displayName || '').trim(),
        role: String(candidate.role || '').trim(),
        realmEnvironmentId: String(candidate.realmEnvironmentId || '').trim(),
      });
    },
  });

  const oauthBridge: ShellOAuthBridge = Object.freeze({
    hasShellHostInvoke: () => true,
    oauthListenForCode: (payload) => new Promise((resolve) => {
      assertLoopbackCallback(payload.redirectUri);
      oauthListeners.set(SIMULATOR_OAUTH_REDIRECT_URI, resolve);
    }),
    oauthTokenExchange: async () => {
      throw new Error('Desktop OAuth exchange is owned by RuntimeAccountService');
    },
    openExternalUrl: async (url) => {
      const state = new URL(url).searchParams.get('state') || '';
      const invoked = await invokeEngine('desktop.auth.oauth.open', {
        instanceId: context.instanceId,
        url,
        state,
      });
      if (!invoked.ok) {
        throw new Error(`DESKTOP_SIMULATOR_AUTH_OAUTH_OPEN_REJECTED:${invoked.disposition}`);
      }
      return { opened: true };
    },
    focusMainWindow: async () => {},
  });

  const adapter: AuthPlatformAdapter = {
    supportsPasswordLogin: false,
    checkEmail: async () => runtimeAccountOwned('checkEmail'),
    passwordLogin: async () => runtimeAccountOwned('passwordLogin'),
    requestEmailOtp: async () => runtimeAccountOwned('requestEmailOtp'),
    verifyEmailOtp: async () => runtimeAccountOwned('verifyEmailOtp'),
    verifyTwoFactor: async () => runtimeAccountOwned('verifyTwoFactor'),
    walletChallenge: async () => runtimeAccountOwned('walletChallenge'),
    walletLogin: async () => runtimeAccountOwned('walletLogin'),
    oauthLogin: async () => runtimeAccountOwned('oauthLogin'),
    updatePassword: async () => runtimeAccountOwned('updatePassword'),
    loadCurrentUser: loadSimulatorUser,
    applyToken: async () => runtimeAccountOwned('applyToken'),
    restoreSession: async () => runtimeAccountOwned('restoreSession'),
    persistSession: async () => runtimeAccountOwned('persistSession'),
    clearPersistedSession: async () => {
      if (readAuthProjection().status === 'authenticated') {
        // The engine-owned logout commits the session transition; its declared
        // desktop.auth.session.anonymous event clears the renderer auth slice.
        await accountClient.runtime.account.logout({
          caller,
          reason: 'simulator-clear-persisted-session',
        });
        return;
      }
      lifecycle?.clearAuthSession();
    },
    oauthBridge,
    syncAfterLogin: async () => {},
  };

  const authPort: DesktopRendererAuthPort = Object.freeze({
    adapter,
    oauthBridge,
    runtimeAccountBroker: Object.freeze({
      begin: broker.begin,
      complete: async (request: Parameters<typeof broker.complete>[0]) => {
        await broker.complete(request);
        const user = await loadSimulatorUser();
        if (!user) {
          throw new Error('Runtime account login completed without an authenticated account projection.');
        }
        return { user };
      },
    }),
  });

  return Object.freeze({
    authPort,
    accountRuntime: Object.freeze({
      auth: Object.freeze({}),
      account: accountClient.runtime.account,
    }) as unknown as ReturnType<DesktopRendererSdkPort['accountRuntime']>,
    caller,
    isSessionReady: () => readAuthProjection().status === 'authenticated',
    async reconcileLoginState({ authStatus }: { readonly authStatus: AuthStatus }) {
      const snapshot = readAuthProjection();
      if (snapshot.status === 'authenticated') {
        if (authStatus !== 'authenticated' && lifecycle) {
          lifecycle.applyRuntimeAccountProjection(authenticatedStoreProjection(snapshot));
        }
        return Object.freeze({ clearAuthSession: false });
      }
      return Object.freeze({ clearAuthSession: authStatus === 'authenticated' });
    },
    bindLifecycle(nextLifecycle: DesktopRendererLifecyclePort) {
      lifecycle = nextLifecycle;
      const snapshot = readAuthProjection();
      if (snapshot.status === 'authenticated') {
        nextLifecycle.applyRuntimeAccountProjection(authenticatedStoreProjection(snapshot));
      } else {
        nextLifecycle.clearAuthSession();
      }
      return () => {
        if (lifecycle === nextLifecycle) lifecycle = null;
      };
    },
  });
}
