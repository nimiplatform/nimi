import {
  createLocalFirstPartyRuntimePlatformClient,
  getPlatformClient,
  type PlatformClient,
} from '@nimiplatform/sdk';
import {
  AccountCallerMode,
  AccountSessionState,
  type AccountCaller,
  type AccountProjection,
} from '@nimiplatform/sdk/runtime/browser';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { RuntimeDefaults } from '@renderer/bridge';
import type { AuthUser } from '@renderer/app-shell/providers/app-store.js';

export const MOMENT_RUNTIME_APP_ID = 'nimi.moment';
export const MOMENT_RUNTIME_APP_INSTANCE_ID = `${MOMENT_RUNTIME_APP_ID}.local-first-party`;
export const MOMENT_RUNTIME_DEVICE_ID = 'local-first-party-device';

export const momentRuntimeAccountCaller: AccountCaller = {
  appId: MOMENT_RUNTIME_APP_ID,
  appInstanceId: MOMENT_RUNTIME_APP_INSTANCE_ID,
  deviceId: MOMENT_RUNTIME_DEVICE_ID,
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

export function isMissingRuntimeAccountService(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('unknown service nimi.runtime.v1.RuntimeAccountService')
    || message.includes('/nimi.runtime.v1.RuntimeAccountService/');
}

export function staleRuntimeAccountServiceError(): Error {
  return new Error(
    'Moment runtime is too old and does not expose Runtime account service. Restart Moment with the current runtime before signing in.',
  );
}

export function normalizeMomentAccountProjection(
  projection: AccountProjection | null | undefined,
): AuthUser | null {
  const accountId = String(projection?.accountId || '').trim();
  if (!accountId) {
    return null;
  }
  return {
    id: accountId,
    displayName: String(projection?.displayName || '').trim(),
  };
}

export async function createMomentLocalFirstPartyPlatformClient(
  runtimeDefaults: RuntimeDefaults,
): Promise<PlatformClient> {
  return createLocalFirstPartyRuntimePlatformClient({
    appId: MOMENT_RUNTIME_APP_ID,
    realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });
}

export async function loadMomentRuntimeAccountUser(
  runtime: Runtime = getPlatformClient().runtime,
): Promise<AuthUser | null> {
  const response = await runtime.account.getAccountSessionStatus({
    caller: momentRuntimeAccountCaller,
  });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return null;
  }
  return normalizeMomentAccountProjection(response.accountProjection);
}

export async function logoutMomentRuntimeAccount(
  runtime: Runtime = getPlatformClient().runtime,
): Promise<void> {
  await runtime.account.logout({
    caller: momentRuntimeAccountCaller,
    reason: 'moment_logout',
  });
}

export function createMomentRuntimeAccountBrowserBroker() {
  return {
    begin: async (input: { callbackUrl: string; baseUrl?: string; timeoutMs: number }) => {
      const response = await getPlatformClient().runtime.account.beginLogin({
        caller: momentRuntimeAccountCaller,
        redirectUri: input.callbackUrl,
        callbackOrigin: new URL(input.callbackUrl).origin,
        requestedScopes: [],
        ttlSeconds: Math.max(10, Math.ceil(input.timeoutMs / 1000)),
      });
      if (
        !response.accepted
        || !response.loginAttemptId
        || !response.state
        || !response.nonce
      ) {
        throw new Error(`Runtime account login could not start: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`);
      }
      // R-OAUTH / K-ACCSVC-008: use the realm OAuth authorize URL constructed
      // by runtime (PKCE S256 challenge bound to runtime-held verifier).
      return {
        loginAttemptId: response.loginAttemptId,
        authorizationUrl: response.oauthAuthorizationUrl,
        state: response.state,
        nonce: response.nonce,
      };
    },
    complete: async (input: {
      loginAttemptId: string;
      code: string;
      state: string;
      nonce: string;
      callbackUrl: string;
    }) => {
      // R-OAUTH / K-ACCSVC-008: code-only proof envelope; runtime owns the
      // token exchange and refresh-token custody.
      const response = await getPlatformClient().runtime.account.completeLogin({
        caller: momentRuntimeAccountCaller,
        loginAttemptId: input.loginAttemptId,
        code: input.code,
        // R-OAUTH-008 / spec K-ACCSVC-008: refreshToken MUST be empty here.
        // Runtime fail-closes any non-empty value with PROOF_UNSUPPORTED.
        refreshToken: '',
        state: input.state,
        nonce: input.nonce,
        redirectUri: input.callbackUrl,
        callbackOrigin: new URL(input.callbackUrl).origin,
        uxTraceId: '',
        sealedCompletionTicket: '',
      });
      if (!response.accepted) {
        throw new Error(`Runtime account login could not complete: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`);
      }
      return {
        user: normalizeMomentAccountProjection(response.accountProjection),
      };
    },
  };
}
