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
import { buildDesktopWebAuthLaunchUrl } from '@nimiplatform/nimi-kit/auth';
import type { RuntimeDefaults } from '@renderer/bridge';
import type { AuthUser } from '@renderer/data/types.js';

export const POLYINFO_RUNTIME_APP_ID = 'nimi.polyinfo';
export const POLYINFO_RUNTIME_APP_INSTANCE_ID = `${POLYINFO_RUNTIME_APP_ID}.local-first-party`;
export const POLYINFO_RUNTIME_DEVICE_ID = 'local-first-party-device';

export const polyinfoRuntimeAccountCaller: AccountCaller = {
  appId: POLYINFO_RUNTIME_APP_ID,
  appInstanceId: POLYINFO_RUNTIME_APP_INSTANCE_ID,
  deviceId: POLYINFO_RUNTIME_DEVICE_ID,
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

export function isMissingRuntimeAccountService(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('unknown service nimi.runtime.v1.RuntimeAccountService')
    || message.includes('/nimi.runtime.v1.RuntimeAccountService/');
}

export function isRuntimeAccountAccessUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('runtime account access token unavailable: 4')
    || message.includes('ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE');
}

export function staleRuntimeAccountServiceError(): Error {
  return new Error(
    'Polyinfo 启动到的 runtime 版本太旧，缺少新的账号服务。请停止旧 runtime 后用最新代码重新启动 Polyinfo。',
  );
}

export function normalizePolyinfoAccountProjection(
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

export async function createPolyinfoLocalFirstPartyPlatformClient(
  runtimeDefaults: RuntimeDefaults,
): Promise<PlatformClient> {
  return createLocalFirstPartyRuntimePlatformClient({
    appId: POLYINFO_RUNTIME_APP_ID,
    realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });
}

export async function loadPolyinfoRuntimeAccountUser(
  runtime: Runtime = getPlatformClient().runtime,
): Promise<AuthUser | null> {
  const response = await runtime.account.getAccountSessionStatus({
    caller: polyinfoRuntimeAccountCaller,
  });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return null;
  }
  return normalizePolyinfoAccountProjection(response.accountProjection);
}

export async function logoutPolyinfoRuntimeAccount(
  runtime: Runtime = getPlatformClient().runtime,
): Promise<void> {
  await runtime.account.logout({
    caller: polyinfoRuntimeAccountCaller,
    reason: 'polyinfo_logout',
  });
}

export function createPolyinfoRuntimeAccountBrowserBroker() {
  return {
    begin: async (input: { callbackUrl: string; baseUrl?: string; timeoutMs: number }) => {
      const response = await getPlatformClient().runtime.account.beginLogin({
        caller: polyinfoRuntimeAccountCaller,
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
      return {
        loginAttemptId: response.loginAttemptId,
        authorizationUrl: buildDesktopWebAuthLaunchUrl({
          callbackUrl: input.callbackUrl,
          state: response.state,
          baseUrl: input.baseUrl,
        }),
        state: response.state,
        nonce: response.nonce,
      };
    },
    complete: async (input: {
      loginAttemptId: string;
      accessToken: string;
      refreshToken: string;
      state: string;
      nonce: string;
      callbackUrl: string;
    }) => {
      const response = await getPlatformClient().runtime.account.completeLogin({
        caller: polyinfoRuntimeAccountCaller,
        loginAttemptId: input.loginAttemptId,
        code: input.accessToken,
        refreshToken: input.refreshToken,
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
        user: normalizePolyinfoAccountProjection(response.accountProjection),
      };
    },
  };
}
