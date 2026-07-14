import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import {
  clearPersistedAccessToken,
  createRuntimeAccountBrowserBroker,
  persistAuthSessionMetadata,
  resolveSessionExpiry,
} from '@nimiplatform/kit/auth';
import type {
  AuthPlatformAdapter,
} from '@nimiplatform/kit/auth/shell';
import type { ShellOAuthBridge } from '@nimiplatform/kit/core/oauth';
import {
  checkNimiRealmAuthEmail,
  createNimiRealmWalletChallenge,
  isNimiRealmExpectedAnonymousSessionError,
  loginNimiRealmAuthPassword,
  loginNimiRealmOAuth,
  loginNimiRealmWallet,
  requestNimiRealmEmailOtp,
  toNimiRealmAuthUserRecord,
  updateNimiRealmPassword,
  verifyNimiRealmEmailOtp,
  verifyNimiRealmTwoFactor,
  type NimiRealmAuthTokens,
  type NimiRealmCheckEmailResponse,
  type NimiRealmOAuthLoginResult,
  type NimiRealmOAuthProvider,
} from '@nimiplatform/sdk/realm';
import { createNimiDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { bootstrapRuntime } from '@renderer/infra/bootstrap/runtime-bootstrap';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { desktopBridge } from '@renderer/bridge';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { createWebRealmFetch } from './web-realm-fetch.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { callRealmApi } from '@renderer/infra/realm/realm-api';
import { getDesktopAccountRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';
import { i18n } from '@renderer/i18n';
import {
  configureWebRealmPlatformClient,
  isWebRealmPlatformClientReady,
  loginFreshOauthPasswordWithBrowserSession,
  shouldUseFreshOauthBrowserSessionLogin,
} from './web-realm-session.js';

export const desktopOAuthBridge: ShellOAuthBridge = {
  hasShellHostInvoke: () => desktopBridge.hasShellHostInvoke(),
  oauthListenForCode: (payload) => desktopBridge.oauthListenForCode(payload),
  oauthTokenExchange: (payload) => desktopBridge.oauthTokenExchange(payload),
  openExternalUrl: (url) => desktopBridge.openExternalUrl(url),
  focusMainWindow: () => desktopBridge.focusMainWindow(),
};

type AuthTokensDto = NimiRealmAuthTokens;
type CheckEmailResponseDto = NimiRealmCheckEmailResponse;
type OAuthLoginResultDto = NimiRealmOAuthLoginResult;

const desktopRuntimeAccountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId: 'nimi.desktop' });

async function loadDesktopRuntimeAccountUser(): Promise<Record<string, unknown> | null> {
  const response = await desktopBridge.getRuntimeAccountSessionStatus();
  const projection = response.accountProjection;
  if (response.state !== 'authenticated' || !projection?.accountId) {
    return null;
  }
  return toNimiRealmAuthUserRecord({
    id: projection.accountId,
    displayName: projection.displayName,
    realmEnvironmentId: projection.realmEnvironmentId,
  });
}

export function createDesktopRuntimeAccountBrowserBroker() {
  const broker = createRuntimeAccountBrowserBroker({
    caller: desktopRuntimeAccountCaller,
    beforeRequest: ensureAuthApiReady,
    getClient: () => ({
      runtime: {
        account: getDesktopAccountRuntime().account,
      },
    }),
    projectUser: (projection) => projection.accountId
      ? {
          id: projection.accountId,
          displayName: projection.displayName,
          realmEnvironmentId: projection.realmEnvironmentId,
        }
      : null,
  });
  return {
    begin: broker.begin,
    complete: async (request: Parameters<typeof broker.complete>[0]) => {
      await broker.complete(request);
      const user = await loadDesktopRuntimeAccountUser();
      if (!user) {
        throw new Error('Runtime account login completed without an authenticated account projection.');
      }
      return { user };
    },
  };
}

export async function ensureAuthApiReady(): Promise<void> {
  if (isWebRealmPlatformClientReady()) {
    return;
  }
  await bootstrapRuntime();
  if (!isWebRealmPlatformClientReady()) {
    throw new Error('API not initialized');
  }
}

async function resolveWebRealmBaseUrl(): Promise<string> {
  const defaults = useAppStore.getState().runtimeDefaults;
  if (!defaults?.realm?.realmBaseUrl) {
    await bootstrapRuntime();
  }
  const refreshedDefaults = useAppStore.getState().runtimeDefaults;
  const realmBaseUrl = String(refreshedDefaults?.realm?.realmBaseUrl || '').trim();
  if (!realmBaseUrl) {
    throw new Error('API not initialized');
  }
  return realmBaseUrl;
}

function readWindowLocationSearch(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location?.search || '';
}

async function configureWebAuthRealmSession(accessToken: string, refreshToken?: string): Promise<void> {
  const realmBaseUrl = await resolveWebRealmBaseUrl();
  await configureWebRealmPlatformClient({
    appId: 'nimi.web',
    realmBaseUrl,
    accessToken,
    refreshToken,
    fetchImpl: createWebRealmFetch(),
    getCurrentUser: () => useAppStore.getState().auth.user,
    setAuthSession: (user) => {
      useAppStore.getState().setAuthSession(user);
    },
    clearAuthSession: () => {
      useAppStore.getState().clearAuthSession();
    },
  });
}

export function createDesktopAuthAdapter(): AuthPlatformAdapter {
  return {
    // This module is admitted only through apps/web's Vite adapter replacement.
    // Do not re-resolve shell ownership here: doing so creates a second cached
    // shell-mode truth that can disagree with the Web route which loaded it.
    supportsPasswordLogin: true,
    checkEmail: async (email): Promise<CheckEmailResponseDto> => {
      await ensureAuthApiReady();
      return callRealmApi((realm) => checkNimiRealmAuthEmail(realm, email));
    },

    passwordLogin: async (identifier, password): Promise<OAuthLoginResultDto> => {
      await ensureAuthApiReady();
      if (shouldUseFreshOauthBrowserSessionLogin(readWindowLocationSearch())) {
        return loginFreshOauthPasswordWithBrowserSession({
          realmBaseUrl: await resolveWebRealmBaseUrl(),
          identifier,
          password,
        });
      }
      return callRealmApi(
        (realm) => loginNimiRealmAuthPassword(realm, identifier, password),
        i18n.t('Auth.passwordLoginFailed', { defaultValue: 'Email sign-in failed' }),
      );
    },

    requestEmailOtp: async (email) => {
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => requestNimiRealmEmailOtp(realm, email),
        i18n.t('Auth.requestEmailOtpFailed', { defaultValue: 'Failed to send verification code' }),
      );
    },

    verifyEmailOtp: async (email, code): Promise<OAuthLoginResultDto> => {
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => verifyNimiRealmEmailOtp(realm, email, code),
        i18n.t('Auth.verifyEmailOtpFailed', { defaultValue: 'Failed to sign in with email code' }),
      );
    },

    verifyTwoFactor: async (tempToken, code): Promise<AuthTokensDto> => {
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => verifyNimiRealmTwoFactor(realm, tempToken, code),
        i18n.t('Auth.verifyTwoFactorFailed', { defaultValue: 'Two-factor verification failed' }),
      );
    },

    walletChallenge: async (input) => {
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => createNimiRealmWalletChallenge(realm, input),
        i18n.t('Auth.walletChallengeFailed', { defaultValue: 'Failed to get wallet challenge' }),
      );
    },

    walletLogin: async (input): Promise<OAuthLoginResultDto> => {
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => loginNimiRealmWallet(realm, input),
        i18n.t('Auth.walletLoginFailed', { defaultValue: 'Wallet sign-in failed' }),
      );
    },

    oauthLogin: async (provider, accessToken): Promise<OAuthLoginResultDto> => {
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => loginNimiRealmOAuth(realm, provider as NimiRealmOAuthProvider, accessToken),
        i18n.t('Auth.oauthLoginFailed', { defaultValue: 'OAuth sign-in failed' }),
      );
    },

    updatePassword: async (newPassword) => {
      await ensureAuthApiReady();
      await callRealmApi((realm) => updateNimiRealmPassword(realm, { newPassword }));
    },

    loadCurrentUser: async () => {
      try {
        const user = await realmSocialData.loadCurrentUser();
        return toNimiRealmAuthUserRecord(user);
      } catch (error) {
        if (isNimiRealmExpectedAnonymousSessionError(error)) {
          return null;
        }
        throw error;
      }
    },

    applyToken: async (accessToken, refreshToken) => {
      await configureWebAuthRealmSession(accessToken, refreshToken);
    },
    restoreSession: async () => {
      throw new Error('Web auth session restore requires browser-owned session authority.');
    },
    persistSession: async ({ accessToken, user }) => {
      const updatedAt = new Date().toISOString();
      persistAuthSessionMetadata({
        user,
        updatedAt,
        expiresAt: resolveSessionExpiry(accessToken, updatedAt),
      });
    },
    clearPersistedSession: async () => {
      clearPersistedAccessToken();
    },

    oauthBridge: desktopOAuthBridge,
    syncAfterLogin: async () => {
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
      ]);
    },
  };
}
