import type { AuthPlatformAdapter } from '@nimiplatform/shell-auth';
import type { TauriOAuthBridge } from '@nimiplatform/shell-core/oauth';
import { OAuthProvider } from '@nimiplatform/sdk/realm';
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

export function createDesktopAuthAdapter(): AuthPlatformAdapter {
  return {
    checkEmail: (email) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.checkEmail({ email }),
        '',
      ),

    passwordLogin: (identifier, password) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.passwordLogin({ identifier, password }),
        '邮箱登录失败',
      ),

    requestEmailOtp: (email) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.requestEmailOtp({ email }),
        '发送验证码失败',
      ),

    verifyEmailOtp: (email, code) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.verifyEmailOtp({ email, code }),
        '验证码登录失败',
      ),

    verifyTwoFactor: (tempToken, code) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.verifyTwoFactor({ tempToken, code }),
        '2FA 验证失败',
      ),

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
      ),

    oauthLogin: (provider, accessToken) =>
      dataSync.callApi(
        (realm) => realm.services.AuthService.oauthLogin({
          provider: provider as OAuthProvider,
          accessToken,
        }),
        'OAuth 登录失败',
      ),

    updatePassword: async (newPassword) => {
      await dataSync.updatePassword({ newPassword });
    },

    loadCurrentUser: async () => {
      const user = await dataSync.loadCurrentUser().catch(() => null);
      return user && typeof user === 'object' ? (user as Record<string, unknown>) : null;
    },

    applyToken: async (accessToken, refreshToken) => {
      dataSync.setToken(accessToken);
      if (refreshToken) {
        dataSync.setRefreshToken(refreshToken);
      }
    },

    oauthBridge: desktopOAuthBridge,

    realmRequest: async (method, path, body) => {
      // Desktop realm requests go through SDK raw request
      const response = await dataSync.callApi(
        (realm) => realm.raw.request({
          method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          path,
          body,
        }),
        'Realm request failed',
      );
      return (response ?? {}) as Record<string, unknown>;
    },

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
