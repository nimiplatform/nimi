import type { AuthPlatformAdapter } from '@nimiplatform/shell-auth';
import type { TauriOAuthBridge } from '@nimiplatform/shell-core/oauth';
import { OAuthProvider } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { desktopBridge } from '@renderer/bridge';

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

function toAuthUserRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function createDesktopAuthAdapter(): AuthPlatformAdapter {
  return {
    supportsPasswordLogin: false,
    checkEmail: (email) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.checkEmail({ email }),
        '',
      ) as Promise<CheckEmailResponseDto>,

    requestEmailOtp: (email) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.requestEmailOtp({ email }),
        '发送验证码失败',
      ),

    verifyEmailOtp: (email, code) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.verifyEmailOtp({ email, code }),
        '验证码登录失败',
      ) as Promise<OAuthLoginResultDto>,

    verifyTwoFactor: (tempToken, code) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.verifyTwoFactor({ tempToken, code }),
        '2FA 验证失败',
      ) as Promise<AuthTokensDto>,

    walletChallenge: (input) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.walletChallenge({
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          walletType: input.walletType,
        }),
        '获取钱包签名挑战失败',
      ),

    walletLogin: (input) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.walletLogin({
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          nonce: input.nonce,
          message: input.message,
          signature: input.signature,
          walletType: input.walletType,
        }),
        '钱包登录失败',
      ) as Promise<OAuthLoginResultDto>,

    oauthLogin: (provider, accessToken) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.oauthLogin({
          provider: provider as OAuthProvider,
          accessToken,
        }),
        'OAuth 登录失败',
      ) as Promise<OAuthLoginResultDto>,

    updatePassword: async (newPassword) => {
      await dataSync.updatePassword({ newPassword });
    },

    loadCurrentUser: async () => {
      const user = await dataSync.loadCurrentUser().catch(() => null);
      return toAuthUserRecord(user);
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
