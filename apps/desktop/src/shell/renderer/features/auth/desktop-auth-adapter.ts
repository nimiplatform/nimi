import {
  clearPersistedAccessToken,
  persistAuthSession,
  type AuthPlatformAdapter,
} from '@nimiplatform/nimi-kit/auth';
import type { TauriOAuthBridge } from '@nimiplatform/nimi-kit/core/oauth';
import { isWebShellMode } from '@nimiplatform/nimi-kit/core/shell-mode';
import { OAuthProvider } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { bootstrapRuntime } from '@renderer/infra/bootstrap/runtime-bootstrap';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { desktopBridge } from '@renderer/bridge';
import { i18n } from '@renderer/i18n';
import {
  clearSharedDesktopSession,
  persistSharedDesktopSession,
} from './shared-auth-session.js';
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

export async function ensureAuthApiReady(): Promise<void> {
  if (dataSync.isApiConfigured()) {
    return;
  }
  await bootstrapRuntime();
  if (!dataSync.isApiConfigured()) {
    throw new Error('API not initialized');
  }
}

export function createDesktopAuthAdapter(): AuthPlatformAdapter {
  return {
    supportsPasswordLogin: true,
    checkEmail: async (email): Promise<CheckEmailResponseDto> => {
      await ensureAuthApiReady();
      return toCheckEmailResponseDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.checkEmail({ email }),
          '',
        ),
      );
    },

    passwordLogin: async (identifier, password): Promise<OAuthLoginResultDto> => {
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.passwordLogin({ identifier, password }),
          i18n.t('Auth.passwordLoginFailed', { defaultValue: 'Email sign-in failed' }),
        ),
      );
    },

    requestEmailOtp: async (email) => {
      await ensureAuthApiReady();
      return dataSync.callApi(
        (realm) => realm.services.AuthService.requestEmailOtp({ email }),
        i18n.t('Auth.requestEmailOtpFailed', { defaultValue: 'Failed to send verification code' }),
      );
    },

    verifyEmailOtp: async (email, code): Promise<OAuthLoginResultDto> => {
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.verifyEmailOtp({ email, code }),
          i18n.t('Auth.verifyEmailOtpFailed', { defaultValue: 'Failed to sign in with email code' }),
        ),
      );
    },

    verifyTwoFactor: async (tempToken, code): Promise<AuthTokensDto> => {
      await ensureAuthApiReady();
      return toAuthTokensDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.verifyTwoFactor({ tempToken, code }),
          i18n.t('Auth.verifyTwoFactorFailed', { defaultValue: 'Two-factor verification failed' }),
        ),
      );
    },

    walletChallenge: async (input) => {
      await ensureAuthApiReady();
      return dataSync.callApi(
        (realm) => realm.services.AuthService.walletChallenge({
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          walletType: input.walletType,
        }),
        i18n.t('Auth.walletChallengeFailed', { defaultValue: 'Failed to get wallet challenge' }),
      );
    },

    walletLogin: async (input): Promise<OAuthLoginResultDto> => {
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await dataSync.callApi(
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
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.oauthLogin({
            provider: provider as OAuthProvider,
            accessToken,
          }),
          i18n.t('Auth.oauthLoginFailed', { defaultValue: 'OAuth sign-in failed' }),
        ),
      );
    },

    updatePassword: async (newPassword) => {
      await dataSync.updatePassword({ newPassword });
    },

    loadCurrentUser: async () => {
      try {
        const user = await dataSync.loadCurrentUser();
        return toAuthUserRecord(user);
      } catch (error) {
        if (isExpectedAnonymousSessionError(error)) {
          return null;
        }
        throw error;
      }
    },

    applyToken: async (accessToken, refreshToken) => {
      dataSync.setToken(accessToken);
      if (refreshToken) {
        dataSync.setRefreshToken(refreshToken);
      }
    },
    restoreSession: async () => {
      await ensureAuthApiReady();
      const restored = await dataSync.callApi(
        (realm) => realm.services.AuthService.refreshToken(),
        i18n.t('Auth.desktopSessionExpired', { defaultValue: 'Current login session has expired' }),
      );
      const record = restored && typeof restored === 'object'
        ? (restored as Record<string, unknown>)
        : {};
      const accessToken = String(record.accessToken || '').trim();
      if (!accessToken) {
        throw new Error('restored session missing access token');
      }
      const refreshToken = String(record.refreshToken || '').trim();
      const user = record.user && typeof record.user === 'object'
        ? toAuthUserRecord(record.user)
        : null;
      return {
        accessToken,
        refreshToken,
        user,
      };
    },
    persistSession: async ({ accessToken, refreshToken, user }) => {
      if (isWebShellMode()) {
        persistAuthSession({
          accessToken,
          refreshToken,
          user,
        });
        return;
      }
      await persistSharedDesktopSession({
        accessToken,
        refreshToken,
        user,
      });
    },
    clearPersistedSession: async () => {
      if (isWebShellMode()) {
        clearPersistedAccessToken();
        return;
      }
      await clearSharedDesktopSession();
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
