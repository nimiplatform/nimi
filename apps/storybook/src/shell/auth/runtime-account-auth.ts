import { createNimiLocalFirstPartyRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/generated';
import {
  validateRuntimeOAuthAuthorizationUrl,
  type AuthPlatformAdapter,
  type ShellAuthDesktopBrowserAuth,
} from '@nimiplatform/kit/auth';
import { createTauriOAuthBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  appId,
  getRuntimePlatformProjection,
  runtimeAccountLoginEnabled,
  type StorybookRuntimePlatformClient,
} from './runtime-platform.js';

export const runtimeAccountCaller = createNimiLocalFirstPartyRuntimeAccountCaller({ appId });

export const nimiAppTauriOAuthBridge = createTauriOAuthBridge();

function requireRuntimeAccountLogin() {
  if (!runtimeAccountLoginEnabled) {
    throw new Error('Runtime account browser login is not enabled for this app identity. This app uses the single login model; enable runtime account login. There is no standalone developer-session fallback — a not-yet-admitted local app is admitted by the Runtime developer-registration gate (desktop Developer Mode) under a real logged-in account.');
  }
}

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error('This shell uses Runtime account browser login only; app-owned credential login is forbidden.'));
}

export async function loadRuntimeAccountUser(client: StorybookRuntimePlatformClient) {
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

async function requireRuntimePlatformClient(): Promise<StorybookRuntimePlatformClient> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message);
  }
  return projection.client;
}

export async function logoutRuntimeAccount() {
  requireRuntimeAccountLogin();
  const client = await requireRuntimePlatformClient();
  await client.runtime.account.logout({
    caller: runtimeAccountCaller,
    reason: 'generated_app_logout',
  });
}

export function createNimiAppRuntimeAccountBroker(): ShellAuthDesktopBrowserAuth['runtimeAccountBroker'] {
  return {
    begin: async (input) => {
      requireRuntimeAccountLogin();
      const client = await requireRuntimePlatformClient();
      const response = await client.runtime.account.beginLogin({
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
        authorizationUrl: validateRuntimeOAuthAuthorizationUrl(response.oauthAuthorizationUrl),
        state: response.state,
        nonce: response.nonce,
      };
    },
    complete: async (input) => {
      requireRuntimeAccountLogin();
      const client = await requireRuntimePlatformClient();
      const response = await client.runtime.account.completeLogin({
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
    loadCurrentUser: async () => loadRuntimeAccountUser(await requireRuntimePlatformClient()),
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
