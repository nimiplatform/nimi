import { ipcMain, shell, type BrowserWindow } from 'electron';
import { createPlatformClient, type PlatformClient } from '@nimiplatform/sdk';
import { OAuthProvider } from '@nimiplatform/sdk/realm';
import { DESKTOP_CALLBACK_TIMEOUT_MS } from '@nimiplatform/shell-core/oauth';
import type { RelayInvokeMap } from '../shared/ipc-contract.js';
import type { RelayEnv } from './env.js';
import { toIpcError } from './error-utils.js';
import { listenForOAuthCallback, performOauthTokenExchange } from './auth/index.js';

type AuthOauthLoginRequest = RelayInvokeMap['relay:auth:oauth-login']['request'];

async function createScopedRealm(
  env: RelayEnv,
  accessToken?: string,
): Promise<PlatformClient['realm']> {
  const normalizedAccessToken = String(
    accessToken ?? env.NIMI_ACCESS_TOKEN ?? '',
  ).trim();

  const client = await createPlatformClient({
    appId: 'nimi.relay',
    realmBaseUrl: env.NIMI_REALM_URL,
    accessToken: normalizedAccessToken,
    allowAnonymousRealm: !normalizedAccessToken,
    runtimeTransport: null,
  });
  return client.realm;
}

export function registerAuthIpcHandlers(
  env: RelayEnv,
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle('relay:auth:logout', async () => {
    const { invalidateAuth } = await import('./index.js');
    invalidateAuth();
  });

  ipcMain.handle('relay:auth:status', async () => {
    const { getAuthState } = await import('./index.js');
    return getAuthState();
  });

  ipcMain.handle('relay:auth:apply-token', async (_event, payload: { accessToken: string }) => {
    const { applyTokenAndInit } = await import('./index.js');
    try {
      await applyTokenAndInit(payload.accessToken);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('relay:auth:check-email', async (_event, payload: { email: string }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.checkEmail({
        email: payload.email,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:password-login', async (_event, payload: {
    identifier: string;
    password: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.passwordLogin({
        identifier: payload.identifier,
        password: payload.password,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:oauth-login', async (_event, payload: AuthOauthLoginRequest) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.oauthLogin({
        provider: payload.provider as OAuthProvider,
        accessToken: payload.accessToken,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:email-otp-request', async (_event, payload: { email: string }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.requestEmailOtp({
        email: payload.email,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:email-otp-verify', async (_event, payload: {
    email: string;
    code: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.verifyEmailOtp({
        email: payload.email,
        code: payload.code,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:2fa-verify', async (_event, payload: {
    tempToken: string;
    code: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.verifyTwoFactor({
        tempToken: payload.tempToken,
        code: payload.code,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:wallet-challenge', async (_event, payload: {
    walletAddress: string;
    chainId?: number;
    walletType: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.walletChallenge({
        walletAddress: payload.walletAddress,
        chainId: payload.chainId,
        walletType: payload.walletType,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:wallet-login', async (_event, payload: {
    walletAddress: string;
    chainId?: number;
    nonce: string;
    message: string;
    signature: string;
    walletType: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.walletLogin({
        walletAddress: payload.walletAddress,
        chainId: payload.chainId,
        nonce: payload.nonce,
        message: payload.message,
        signature: payload.signature,
        walletType: payload.walletType,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:update-password', async (_event, payload: {
    newPassword: string;
    accessToken?: string;
  }) => {
    try {
      await (await createScopedRealm(env, payload.accessToken)).services.AuthService.updatePassword({
        newPassword: payload.newPassword,
      });
      return { success: true };
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:current-user', async (_event, payload?: {
    accessToken?: string;
  }) => {
    try {
      return await (await createScopedRealm(env, payload?.accessToken)).services.MeService.getMe();
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:oauth:listen-for-code', async (_event, payload: {
    redirectUri: string;
    timeoutMs?: number;
  }) => {
    const result = await listenForOAuthCallback({
      redirectUri: payload.redirectUri,
      timeoutMs: payload.timeoutMs ?? DESKTOP_CALLBACK_TIMEOUT_MS,
    });
    return {
      callbackUrl: payload.redirectUri,
      code: result.code || undefined,
      state: result.state || undefined,
      error: undefined,
    };
  });

  ipcMain.handle('relay:oauth:open-external-url', async (_event, payload: { url: string }) => {
    await shell.openExternal(payload.url);
    return { opened: true };
  });

  ipcMain.handle('relay:oauth:focus-main-window', async () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  ipcMain.handle('relay:oauth:token-exchange', async (_event, payload) => {
    try {
      return await performOauthTokenExchange(payload);
    } catch (error) {
      throw toIpcError(error);
    }
  });
}
