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
import { OAuthProvider, updateRealmPassword, type RealmModel } from '@nimiplatform/sdk/realm';
import { getPlatformClient } from '@nimiplatform/sdk';
import { createDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/browser';
import { bootstrapRuntime } from '@renderer/infra/bootstrap/runtime-bootstrap';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { desktopBridge } from '@renderer/bridge';
import { createProxyFetch } from '@renderer/infra/bridge/proxy-fetch';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { callRealmApi } from '@renderer/infra/realm/realm-api';
import {
  configureWebRealmPlatformClient,
  isRealmPlatformClientReady,
} from '@renderer/infra/realm/realm-platform-session';
import { i18n } from '@renderer/i18n';
import {
  isExpectedAnonymousSessionError,
  toAuthTokensDto,
  toAuthUserRecord,
  toCheckEmailResponseDto,
  toOAuthLoginResultDto,
} from './auth-session-utils.js';

export const desktopOAuthBridge: TauriOAuthBridge = {
  hasTauriInvoke: () => desktopBridge.hasTauriInvoke(),
  oauthListenForCode: (payload) => desktopBridge.oauthListenForCode(payload),
  oauthTokenExchange: (payload) => desktopBridge.oauthTokenExchange(payload),
  openExternalUrl: (url) => desktopBridge.openExternalUrl(url),
  focusMainWindow: () => desktopBridge.focusMainWindow(),
};

type AuthTokensDto = RealmModel<'AuthTokensDto'>;
type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;
type OAuthLoginResultDto = RealmModel<'OAuthLoginResultDto'>;

const desktopRuntimeAccountCaller = createDesktopShellRuntimeAccountCaller({ appId: 'nimi.desktop' });

export function createDesktopRuntimeAccountBrowserBroker() {
  return createRuntimeAccountBrowserBroker({
    caller: desktopRuntimeAccountCaller,
    beforeRequest: ensureAuthApiReady,
    getClient: getPlatformClient,
    projectUser: (projection) => projection.accountId
      ? {
          id: projection.accountId,
          displayName: projection.displayName,
          realmEnvironmentId: projection.realmEnvironmentId,
        }
      : null,
  });
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

async function configureWebAuthRealmSession(accessToken: string, refreshToken?: string): Promise<void> {
  const defaults = useAppStore.getState().runtimeDefaults;
  if (!defaults?.realm?.realmBaseUrl) {
    await bootstrapRuntime();
  }
  const refreshedDefaults = useAppStore.getState().runtimeDefaults;
  const realmBaseUrl = String(refreshedDefaults?.realm?.realmBaseUrl || '').trim();
  if (!realmBaseUrl) {
    throw new Error('API not initialized');
  }
  await configureWebRealmPlatformClient({
    appId: 'nimi.web',
    realmBaseUrl,
    accessToken,
    refreshToken,
    fetchImpl: createProxyFetch(),
    getCurrentUser: () => useAppStore.getState().auth.user,
    setAuthSession: (user, nextAccessToken, nextRefreshToken) => {
      useAppStore.getState().setAuthSession(user, nextAccessToken, nextRefreshToken);
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
      return toCheckEmailResponseDto(
        await callRealmApi(
          (realm) => realm.services.AuthService.checkEmail({ email }),
          '',
        ),
      );
    },

    passwordLogin: async (identifier, password): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('passwordLogin');
      }
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await callRealmApi(
          (realm) => realm.services.AuthService.passwordLogin({ identifier, password }),
          i18n.t('Auth.passwordLoginFailed', { defaultValue: 'Email sign-in failed' }),
        ),
      );
    },

    requestEmailOtp: async (email) => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('requestEmailOtp');
      }
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => realm.services.AuthService.requestEmailOtp({ email }),
        i18n.t('Auth.requestEmailOtpFailed', { defaultValue: 'Failed to send verification code' }),
      );
    },

    verifyEmailOtp: async (email, code): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('verifyEmailOtp');
      }
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await callRealmApi(
          (realm) => realm.services.AuthService.verifyEmailOtp({ email, code }),
          i18n.t('Auth.verifyEmailOtpFailed', { defaultValue: 'Failed to sign in with email code' }),
        ),
      );
    },

    verifyTwoFactor: async (tempToken, code): Promise<AuthTokensDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('verifyTwoFactor');
      }
      await ensureAuthApiReady();
      return toAuthTokensDto(
        await callRealmApi(
          (realm) => realm.services.AuthService.verifyTwoFactor({ tempToken, code }),
          i18n.t('Auth.verifyTwoFactorFailed', { defaultValue: 'Two-factor verification failed' }),
        ),
      );
    },

    walletChallenge: async (input) => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('walletChallenge');
      }
      await ensureAuthApiReady();
      return callRealmApi(
        (realm) => realm.services.AuthService.walletChallenge({
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          walletType: input.walletType,
        }),
        i18n.t('Auth.walletChallengeFailed', { defaultValue: 'Failed to get wallet challenge' }),
      );
    },

    walletLogin: async (input): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('walletLogin');
      }
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await callRealmApi(
          (realm) => realm.services.AuthService.walletLogin({
            walletAddress: input.walletAddress,
            chainId: input.chainId,
            nonce: input.nonce,
            message: input.message,
            signature: input.signature,
            walletType: input.walletType,
          }),
          i18n.t('Auth.walletLoginFailed', { defaultValue: 'Wallet sign-in failed' }),
        ),
      );
    },

    oauthLogin: async (provider, accessToken): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('oauthLogin');
      }
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await callRealmApi(
          (realm) => realm.services.AuthService.oauthLogin({
            provider: provider as OAuthProvider,
            accessToken,
          }),
          i18n.t('Auth.oauthLoginFailed', { defaultValue: 'OAuth sign-in failed' }),
        ),
      );
    },

    updatePassword: async (newPassword) => {
      await ensureAuthApiReady();
      await updateRealmPassword(getPlatformClient().realm, { newPassword });
    },

    loadCurrentUser: async () => {
      if (isWebShellMode()) {
        try {
          const user = await realmSocialData.loadCurrentUser();
          return toAuthUserRecord(user);
        } catch (error) {
          if (isExpectedAnonymousSessionError(error)) {
            return null;
          }
          throw error;
        }
      }
      await ensureAuthApiReady();
      const response = await getPlatformClient().runtime.account.getAccountSessionStatus({
        caller: desktopRuntimeAccountCaller,
      });
      const projection = response.accountProjection;
      if (response.state !== AccountSessionState.AUTHENTICATED || !projection?.accountId) {
        return null;
      }
      const tokenStatus = await getPlatformClient().runtime.account.getAccessToken({
        caller: desktopRuntimeAccountCaller,
        requestedScopes: [],
      });
      if (!tokenStatus.accepted || !tokenStatus.accessToken) {
        return null;
      }
      return toAuthUserRecord({
        id: projection.accountId,
        displayName: projection.displayName,
        realmEnvironmentId: projection.realmEnvironmentId,
      });
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

      // Direct dataSync calls removed — query invalidation triggers
      // React Query refetches which call the dataSync methods once each.
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
      ]);
    },
  };
}
