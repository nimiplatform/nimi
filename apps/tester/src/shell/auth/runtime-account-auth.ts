import { getPlatformClient, type PlatformClient } from '@nimiplatform/sdk';
import { AccountSessionState } from '@nimiplatform/sdk/runtime';
import type { AuthPlatformAdapter, ShellAuthDesktopBrowserAuth } from '@nimiplatform/kit/auth';
import { createTauriOAuthBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { appId, runtimeAccountLoginEnabled } from './runtime-platform.js';

const DEVICE_ID = 'local-first-party-device';
const ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP = 1;

export const runtimeAccountCaller = {
  appId,
  appInstanceId: `${appId}.local-first-party`,
  deviceId: DEVICE_ID,
  mode: ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
  scopes: [] as string[],
};

export const nimiAppTauriOAuthBridge = createTauriOAuthBridge();

function requireRuntimeAccountLogin() {
  if (!runtimeAccountLoginEnabled) {
    throw new Error('Runtime account browser login is not admitted for this generated third-party app identity. Use dev:shell developer session or an admitted Runtime app session.');
  }
}

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error('This shell uses Runtime account browser login only; app-owned credential login is forbidden.'));
}

export async function loadRuntimeAccountUser(client: PlatformClient = getPlatformClient()) {
  if (!runtimeAccountLoginEnabled) {
    return null;
  }
  const response = await client.runtime.account.getAccountSessionStatus({ caller: runtimeAccountCaller });
  if (response.state !== AccountSessionState.AUTHENTICATED || !response.accountProjection?.accountId) {
    return null;
  }
  return {
    id: response.accountProjection.accountId,
    displayName: response.accountProjection.displayName || 'Runtime account',
  };
}

export async function logoutRuntimeAccount() {
  requireRuntimeAccountLogin();
  await getPlatformClient().runtime.account.logout({
    caller: runtimeAccountCaller,
    reason: 'generated_app_logout',
  });
}

export function createNimiAppRuntimeAccountBroker(): ShellAuthDesktopBrowserAuth['runtimeAccountBroker'] {
  return {
    begin: async (input) => {
      requireRuntimeAccountLogin();
      const response = await getPlatformClient().runtime.account.beginLogin({
        caller: runtimeAccountCaller,
        redirectUri: input.callbackUrl,
        callbackOrigin: new URL(input.callbackUrl).origin,
        requestedScopes: [],
        ttlSeconds: Math.max(10, Math.ceil(input.timeoutMs / 1000)),
      });
      if (!response.accepted || !response.loginAttemptId || !response.oauthAuthorizationUrl || !response.state || !response.nonce) {
        throw new Error(`Runtime account login could not start: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`);
      }
      return {
        loginAttemptId: response.loginAttemptId,
        authorizationUrl: response.oauthAuthorizationUrl,
        state: response.state,
        nonce: response.nonce,
      };
    },
    complete: async (input) => {
      requireRuntimeAccountLogin();
      const response = await getPlatformClient().runtime.account.completeLogin({
        caller: runtimeAccountCaller,
        loginAttemptId: input.loginAttemptId,
        code: input.code,
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
      const accountId = String(response.accountProjection?.accountId || '').trim();
      return {
        user: accountId
          ? {
              id: accountId,
              displayName: String(response.accountProjection?.displayName || '').trim(),
            }
          : null,
      };
    },
  };
}

export function createNimiAppDesktopBrowserAuthAdapter(onLoginComplete: () => void | Promise<void>): AuthPlatformAdapter {
  return {
    checkEmail: unsupported,
    passwordLogin: unsupported,
    requestEmailOtp: unsupported,
    verifyEmailOtp: unsupported,
    verifyTwoFactor: unsupported,
    walletChallenge: unsupported,
    walletLogin: unsupported,
    oauthLogin: unsupported,
    updatePassword: unsupported,
    loadCurrentUser: async () => loadRuntimeAccountUser(),
    applyToken: async () => {
      throw new Error('Generated Nimi App shell must not own access or refresh token custody.');
    },
    persistSession: async () => {
      throw new Error('Generated Nimi App shell must not persist access or refresh tokens.');
    },
    clearPersistedSession: async () => {
      await logoutRuntimeAccount();
    },
    oauthBridge: nimiAppTauriOAuthBridge,
    syncAfterLogin: async () => {},
    onLoginComplete: async () => {
      await onLoginComplete();
    },
  };
}
