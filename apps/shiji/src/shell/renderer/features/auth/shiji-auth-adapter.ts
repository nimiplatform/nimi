import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import {
  persistSharedDesktopAuthSession,
  type AuthPlatformAdapter,
} from '@nimiplatform/nimi-kit/auth';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  clearAuthSession as clearPersistedAuthSession,
  saveAuthSession,
  shijiTauriOAuthBridge,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/app-store.js';

const SHIJI_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in ShiJi desktop-browser mode.';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

type ShiJiUser = Record<string, unknown> & {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(SHIJI_EMBEDDED_AUTH_UNSUPPORTED));
}

function normalizeShiJiUser(
  user: Record<string, unknown> | null | undefined,
): ShiJiUser | null {
  if (!user || !user['id']) {
    return null;
  }

  const normalized: ShiJiUser = {
    ...user,
    id: String(user['id']),
    displayName: String(user['displayName'] || user['name'] || ''),
  };

  if (user['email']) {
    normalized.email = String(user['email']);
  }

  if (user['avatarUrl']) {
    normalized.avatarUrl = String(user['avatarUrl']);
  }

  return normalized;
}

export async function loadShiJiCurrentUser(): Promise<ShiJiUser | null> {
  const data: CurrentUserDto = await getPlatformClient().realm.services.MeService.getMe();
  return normalizeShiJiUser((data as Record<string, unknown> | null | undefined) ?? null);
}

export function createShiJiDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser: loadShiJiCurrentUser,
    applyToken: async (accessToken: string, refreshToken?: string) => {
      getPlatformClient().realm.updateAuth({
        accessToken: () => accessToken,
        refreshToken: () => refreshToken || '',
      });
    },
    persistSession: async ({ accessToken, refreshToken, user }) => {
      const realmBaseUrl = String(useAppStore.getState().runtimeDefaults?.realm?.realmBaseUrl || '').trim();
      await persistSharedDesktopAuthSession({
        realmBaseUrl,
        accessToken,
        refreshToken,
        user,
        saveSession: (session) => saveAuthSession(session),
        clearSession: () => clearPersistedAuthSession(),
      });
    },
    clearPersistedSession: async () => {
      await clearPersistedAuthSession();
    },
    oauthBridge: shijiTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}
