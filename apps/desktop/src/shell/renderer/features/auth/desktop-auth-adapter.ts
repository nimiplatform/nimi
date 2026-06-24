import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import {
  clearPersistedAccessToken,
  createRuntimeAccountBrowserBroker,
  persistAuthSessionMetadata,
  resolveSessionExpiry,
  type AuthPlatformAdapter,
} from '@nimiplatform/kit/auth';
import type { TauriOAuthBridge } from '@nimiplatform/kit/core/oauth';
import { isWebShellMode } from '@nimiplatform/kit/core/shell-mode';
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
import { AccountSessionState } from '@nimiplatform/sdk/runtime/generated';
import { bootstrapRuntime } from '@renderer/infra/bootstrap/runtime-bootstrap';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { desktopBridge } from '@renderer/bridge';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  initializeBuiltInChatScopesFromProductControl,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  refreshConversationCapabilityProjections,
} from '@renderer/features/chat/conversation-capability-projection';
import { createProxyFetch } from '@renderer/infra/bridge/proxy-fetch';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { callRealmApi } from '@renderer/infra/realm/realm-api';
import {
  configureWebRealmPlatformClient,
  isRealmPlatformClientReady,
} from '@renderer/infra/realm/realm-platform-session';
import {
  getDesktopAccountRuntime,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import { i18n } from '@renderer/i18n';
import {
  loginFreshOauthPasswordWithBrowserSession,
  shouldUseFreshOauthBrowserSessionLogin,
} from './fresh-oauth-browser-session-login.js';

export const desktopOAuthBridge: TauriOAuthBridge = {
  hasTauriInvoke: () => desktopBridge.hasTauriInvoke(),
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
  const runtime = getDesktopAccountRuntime();
  const response = await runtime.account.getAccountSessionStatus({
    caller: desktopRuntimeAccountCaller,
  });
  const projection = response.accountProjection;
  if (response.state !== AccountSessionState.AUTHENTICATED || !projection?.accountId) {
    return null;
  }
  const tokenStatus = await runtime.account.getAccessToken({
    caller: desktopRuntimeAccountCaller,
    requestedScopes: [],
  });
  if (!tokenStatus.accepted || !tokenStatus.accessToken) {
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
        throw new Error('Runtime account login completed without a usable Runtime access token.');
      }
      return { user };
    },
  };
}

async function syncDesktopBuiltInChatAIConfigAfterLogin(): Promise<void> {
  const projection = await desktopBridge.getProductControlRecord();
  if (projection.state !== 'ready_for_use') {
    logRendererEvent({
      level: 'info',
      area: 'desktop-auth',
      message: 'phase:post-login-built-in-ai-config:skipped-product-not-ready',
      details: {
        productState: projection.state,
      },
    });
    return;
  }
  await initializeBuiltInChatScopesFromProductControl();
  await refreshConversationCapabilityProjections(['text.generate']);
}

function logDesktopPostLoginSyncFailures(results: readonly PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status !== 'rejected') {
      continue;
    }
    logRendererEvent({
      level: 'warn',
      area: 'desktop-auth',
      message: 'phase:post-login-sync:deferred',
      details: {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason || 'unknown'),
      },
    });
  }
}

export async function ensureAuthApiReady(): Promise<void> {
  if (isRealmPlatformClientReady()) {
    return;
  }
  await bootstrapRuntime();
  if (!isRealmPlatformClientReady()) {
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
    fetchImpl: createProxyFetch(),
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
  const localFirstPartyBlocked = (route: string): never => {
    throw new Error(`Desktop local first-party ${route} is owned by RuntimeAccountService`);
  };
  return {
    supportsPasswordLogin: isWebShellMode(),
    checkEmail: async (email): Promise<CheckEmailResponseDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('checkEmail');
      }
      await ensureAuthApiReady();
      return callRealmApi((realm) => checkNimiRealmAuthEmail(realm, email));
    },

    passwordLogin: async (identifier, password): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('passwordLogin');
      }
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
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('requestEmailOtp');
      }
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => requestNimiRealmEmailOtp(realm, email),
        i18n.t('Auth.requestEmailOtpFailed', { defaultValue: 'Failed to send verification code' }),
      );
    },

    verifyEmailOtp: async (email, code): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('verifyEmailOtp');
      }
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => verifyNimiRealmEmailOtp(realm, email, code),
        i18n.t('Auth.verifyEmailOtpFailed', { defaultValue: 'Failed to sign in with email code' }),
      );
    },

    verifyTwoFactor: async (tempToken, code): Promise<AuthTokensDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('verifyTwoFactor');
      }
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => verifyNimiRealmTwoFactor(realm, tempToken, code),
        i18n.t('Auth.verifyTwoFactorFailed', { defaultValue: 'Two-factor verification failed' }),
      );
    },

    walletChallenge: async (input) => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('walletChallenge');
      }
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => createNimiRealmWalletChallenge(realm, input),
        i18n.t('Auth.walletChallengeFailed', { defaultValue: 'Failed to get wallet challenge' }),
      );
    },

    walletLogin: async (input): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('walletLogin');
      }
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => loginNimiRealmWallet(realm, input),
        i18n.t('Auth.walletLoginFailed', { defaultValue: 'Wallet sign-in failed' }),
      );
    },

    oauthLogin: async (provider, accessToken): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('oauthLogin');
      }
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
      if (isWebShellMode()) {
        try {
          const user = await realmSocialData.loadCurrentUser();
          return toNimiRealmAuthUserRecord(user);
        } catch (error) {
          if (isNimiRealmExpectedAnonymousSessionError(error)) {
            return null;
          }
          throw error;
        }
      }
      await ensureAuthApiReady();
      return loadDesktopRuntimeAccountUser();
    },

    applyToken: async (accessToken, refreshToken) => {
      if (isWebShellMode()) {
        await configureWebAuthRealmSession(accessToken, refreshToken);
        return;
      }
    },
    restoreSession: async () => localFirstPartyBlocked('restoreSession'),
    persistSession: async ({ accessToken, user }) => {
      if (isWebShellMode()) {
        const updatedAt = new Date().toISOString();
        persistAuthSessionMetadata({
          user,
          updatedAt,
          expiresAt: resolveSessionExpiry(accessToken, updatedAt),
        });
        return;
      }
    },
    clearPersistedSession: async () => {
      if (isWebShellMode()) {
        clearPersistedAccessToken();
        return;
      }
    },

    oauthBridge: desktopOAuthBridge,
    syncAfterLogin: async () => {
      if (isWebShellMode()) {
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ['chats'] }),
          queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        ]);
        return;
      }

      // Keep login completion independent from full renderer bootstrap, then
      // materialize the built-in chat AIConfig scopes needed by Nimi Chat.
      const results = await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        syncDesktopBuiltInChatAIConfigAfterLogin(),
      ]);
      logDesktopPostLoginSyncFailures(results);
    },
  };
}
