import type { NimiClient } from '@nimiplatform/sdk';
import {
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/generated';
import {
  createRuntimeAccountBrowserBroker,
  type AuthPlatformAdapter,
  type RuntimeAccountBrowserBrokerClient,
  type ShellAuthDesktopBrowserAuth,
} from '@nimiplatform/kit/auth';
import { createTauriOAuthBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import {
  getRuntimeAccountCaller,
  runtimeAccountLoginEnabled,
} from './runtime-platform.js';

export { getRuntimeAccountCaller };

export const nimiAppTauriOAuthBridge = createTauriOAuthBridge();

type RuntimeAccountClient = RuntimeAccountBrowserBrokerClient & Pick<NimiClient, 'runtime'> & {
  runtime: RuntimeAccountBrowserBrokerClient['runtime'] & NimiClient['runtime'] & {
    account: RuntimeAccountBrowserBrokerClient['runtime']['account'] & NimiClient['runtime']['account'] & {
      getAccountSessionStatus(input: { caller: NimiRuntimeAccountCaller }): Promise<{
        state: AccountSessionState;
        accountProjection?: {
          accountId?: string | null;
          displayName?: string | null;
        } | null;
      }>;
      logout(input: { caller: NimiRuntimeAccountCaller; reason: string }): Promise<unknown>;
    };
  };
};

function requireRuntimeAccountLogin() {
  if (!runtimeAccountLoginEnabled) {
    throw new Error('Runtime account browser login is not enabled for this app identity. This app uses the single login model; enable runtime account login. There is no standalone developer-session fallback — a not-yet-admitted local app is admitted by the Runtime developer-registration gate (desktop Developer Mode) under a real logged-in account.');
  }
}

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error('This shell uses Runtime account browser login only; app-owned credential login is forbidden.'));
}

export async function loadRuntimeAccountUser(client: RuntimeAccountClient | NimiClient) {
  if (!runtimeAccountLoginEnabled) {
    return null;
  }
  const caller = getRuntimeAccountCaller();
  const response = await client.runtime.account.getAccountSessionStatus({ caller });
  if (response.state !== AccountSessionState.AUTHENTICATED || !response.accountProjection?.accountId) {
    return null;
  }
  return {
    id: response.accountProjection.accountId,
    displayName: response.accountProjection.displayName || 'Runtime account',
  };
}

export async function logoutRuntimeAccount(client: RuntimeAccountClient) {
  void client;
  requireRuntimeAccountLogin();
  throw new Error('Generated Nimi App shell cannot own Runtime account logout. Sign out from the first-party Desktop account surface.');
}

export function createNimiAppRuntimeAccountBroker(
  client: RuntimeAccountClient,
): ShellAuthDesktopBrowserAuth['runtimeAccountBroker'] {
  return createRuntimeAccountBrowserBroker({
    caller: getRuntimeAccountCaller(),
    beforeRequest: requireRuntimeAccountLogin,
    getClient: () => client,
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

export function createNimiAppDesktopBrowserAuthAdapter(
  onLoginComplete: () => void | Promise<void>,
  client: RuntimeAccountClient,
): AuthPlatformAdapter {
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
    loadCurrentUser: async () => loadRuntimeAccountUser(client),
    applyToken: async () => {
      throw new Error('Generated Nimi App shell must not own access or refresh token custody.');
    },
    persistSession: async () => {
      throw new Error('Generated Nimi App shell must not persist access or refresh tokens.');
    },
    clearPersistedSession: async () => {
      await logoutRuntimeAccount(client);
    },
    oauthBridge: nimiAppTauriOAuthBridge,
    syncAfterLogin: async () => {},
    onLoginComplete: async () => {
      await onLoginComplete();
    },
  };
}
