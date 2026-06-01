import { getPlatformClient, type PlatformClient } from '@nimiplatform/sdk';
import {
  AccountSessionState,
  createLocalFirstPartyRuntimeAccountCaller,
} from '@nimiplatform/sdk/runtime';
import {
  createRuntimeAccountBrowserBroker,
  type AuthPlatformAdapter,
  type ShellAuthDesktopBrowserAuth,
} from '@nimiplatform/kit/auth';
import { createTauriOAuthBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { appId, runtimeAccountLoginEnabled } from './runtime-platform.js';

export const runtimeAccountCaller = createLocalFirstPartyRuntimeAccountCaller({ appId });

export const nimiAppTauriOAuthBridge = createTauriOAuthBridge();

function requireRuntimeAccountLogin() {
  if (!runtimeAccountLoginEnabled) {
    throw new Error('Runtime account browser login is not enabled for this app identity. This app uses the single login model; enable runtime account login. There is no standalone developer-session fallback — a not-yet-admitted local app is admitted by the Runtime developer-registration gate (desktop Developer Mode) under a real logged-in account.');
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
  return createRuntimeAccountBrowserBroker({
    caller: runtimeAccountCaller,
    beforeRequest: requireRuntimeAccountLogin,
    getClient: getPlatformClient,
    projectUser: (projection) => {
      const accountId = String(projection.accountId || '').trim();
      return accountId
        ? {
            id: accountId,
            displayName: String(projection.displayName || '').trim(),
          }
        : null;
    },
  });
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
