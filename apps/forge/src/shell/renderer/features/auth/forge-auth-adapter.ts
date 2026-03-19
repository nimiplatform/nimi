import type { Realm } from '@nimiplatform/sdk/realm';
import type { AuthPlatformAdapter } from '@nimiplatform/shell-auth';
import { forgeTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import { getPlatformClient } from '@runtime/platform-client.js';

const FORGE_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Forge desktop-browser mode.';

type ForgeUser = Record<string, unknown> & {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

type ForgeRealmRequestInput = Parameters<Realm['raw']['request']>[0];

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(FORGE_EMBEDDED_AUTH_UNSUPPORTED));
}

function normalizeForgeUser(
  user: Record<string, unknown> | null | undefined,
): ForgeUser | null {
  if (!user || !user.id) {
    return null;
  }

  const normalized: ForgeUser = {
    ...user,
    id: String(user.id),
    displayName: String(user.displayName || user.name || ''),
  };

  if (user.email) {
    normalized.email = String(user.email);
  }

  if (user.avatarUrl) {
    normalized.avatarUrl = String(user.avatarUrl);
  }

  return normalized;
}

export async function loadForgeCurrentUser(): Promise<ForgeUser | null> {
  const data = await getPlatformClient().realm.raw.request<Record<string, unknown>>({
    method: 'GET',
    path: '/api/auth/me',
  });

  return normalizeForgeUser((data.user as Record<string, unknown> | null | undefined) ?? null);
}

export function createForgeDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser: loadForgeCurrentUser,
    applyToken: async (accessToken: string, refreshToken?: string) => {
      getPlatformClient().realm.updateAuth({
        accessToken: () => accessToken,
        refreshToken: () => refreshToken || '',
      });
    },
    oauthBridge: forgeTauriOAuthBridge,
    realmRequest: async (method: string, path: string, body?: unknown) => {
      const request: ForgeRealmRequestInput = body === undefined
        ? { method: method as ForgeRealmRequestInput['method'], path }
        : { method: method as ForgeRealmRequestInput['method'], path, body };
      return getPlatformClient().realm.raw.request<Record<string, unknown>>(request);
    },
    syncAfterLogin: async () => {},
  };
}
