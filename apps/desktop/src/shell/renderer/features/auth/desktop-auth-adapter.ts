import type { AuthPlatformAdapter } from '@nimiplatform/shell-auth';
import type { TauriOAuthBridge } from '@nimiplatform/shell-core/oauth';
import { OAuthProvider } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { desktopBridge } from '@renderer/bridge';
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

export function createDesktopAuthAdapter(): AuthPlatformAdapter {
  return {
    supportsPasswordLogin: false,
    checkEmail: async (email): Promise<CheckEmailResponseDto> =>
      toCheckEmailResponseDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.checkEmail({ email }),
          '',
        ),
      ),

    requestEmailOtp: (email) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.requestEmailOtp({ email }),
        i18n.t('Auth.requestEmailOtpFailed', { defaultValue: 'Failed to send verification code' }),
      ),

    verifyEmailOtp: async (email, code): Promise<OAuthLoginResultDto> =>
      toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.verifyEmailOtp({ email, code }),
          i18n.t('Auth.verifyEmailOtpFailed', { defaultValue: 'Failed to sign in with email code' }),
        ),
      ),

    verifyTwoFactor: async (tempToken, code): Promise<AuthTokensDto> =>
      toAuthTokensDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.verifyTwoFactor({ tempToken, code }),
          i18n.t('Auth.verifyTwoFactorFailed', { defaultValue: 'Two-factor verification failed' }),
        ),
      ),

    walletChallenge: (input) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.walletChallenge({
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          walletType: input.walletType,
        }),
        i18n.t('Auth.walletChallengeFailed', { defaultValue: 'Failed to get wallet challenge' }),
      ),

    walletLogin: async (input): Promise<OAuthLoginResultDto> =>
      toOAuthLoginResultDto(
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
      ),

    oauthLogin: async (provider, accessToken): Promise<OAuthLoginResultDto> =>
      toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.oauthLogin({
            provider: provider as OAuthProvider,
            accessToken,
          }),
          i18n.t('Auth.oauthLoginFailed', { defaultValue: 'OAuth sign-in failed' }),
        ),
      ),

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

    oauthBridge: desktopOAuthBridge,
    syncAfterLogin: async () => {
      await Promise.allSettled([
        dataSync.loadChats(),
        dataSync.loadContacts(),
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
      ]);
    },
  };
}
