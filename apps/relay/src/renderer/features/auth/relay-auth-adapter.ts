import type { AuthPlatformAdapter } from '@nimiplatform/shell-auth';
import { createElectronOAuthBridge } from './electron-oauth-bridge.js';
import { getBridge } from '../../bridge/electron-bridge.js';

let currentAccessToken = '';

export function createRelayAuthAdapter(): AuthPlatformAdapter {
  currentAccessToken = '';
  const bridge = getBridge();

  return {
    checkEmail: (email) => bridge.auth.checkEmail({ email }) as ReturnType<AuthPlatformAdapter['checkEmail']>,

    passwordLogin: (identifier, password) =>
      bridge.auth.passwordLogin({ identifier, password }) as ReturnType<AuthPlatformAdapter['passwordLogin']>,

    requestEmailOtp: (email) =>
      bridge.auth.requestEmailOtp({ email }) as ReturnType<AuthPlatformAdapter['requestEmailOtp']>,

    verifyEmailOtp: (email, code) =>
      bridge.auth.verifyEmailOtp({ email, code }) as ReturnType<AuthPlatformAdapter['verifyEmailOtp']>,

    verifyTwoFactor: (tempToken, code) =>
      bridge.auth.verifyTwoFactor({ tempToken, code }) as ReturnType<AuthPlatformAdapter['verifyTwoFactor']>,

    walletChallenge: (input) =>
      bridge.auth.walletChallenge({
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        walletType: input.walletType,
      }) as ReturnType<AuthPlatformAdapter['walletChallenge']>,

    walletLogin: (input) =>
      bridge.auth.walletLogin({
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        nonce: input.nonce,
        message: input.message,
        signature: input.signature,
        walletType: input.walletType,
      }) as ReturnType<AuthPlatformAdapter['walletLogin']>,

    oauthLogin: (provider, accessToken) =>
      bridge.auth.oauthLogin({
        provider,
        accessToken,
      }) as ReturnType<AuthPlatformAdapter['oauthLogin']>,

    updatePassword: async (newPassword) => {
      await bridge.auth.updatePassword({
        newPassword,
        accessToken: currentAccessToken || undefined,
      });
    },

    loadCurrentUser: async () => {
      const user = await bridge.auth.currentUser({
        accessToken: currentAccessToken || undefined,
      }).catch(() => null);
      return user && typeof user === 'object' ? (user as Record<string, unknown>) : null;
    },

    applyToken: async (accessToken) => {
      currentAccessToken = String(accessToken || '').trim();
    },

    oauthBridge: createElectronOAuthBridge(),

    realmRequest: async (method, path, body) => {
      const response = await bridge.auth.realmRequest({
        method,
        path,
        body,
        accessToken: currentAccessToken || undefined,
      });
      return (response ?? {}) as Record<string, unknown>;
    },

    syncAfterLogin: async () => {},
  };
}
