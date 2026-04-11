import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import {
  persistSharedDesktopAuthSession,
  type AuthPlatformAdapter,
} from '@nimiplatform/nimi-kit/auth';
import {
  forgeTauriOAuthBridge,
  clearAuthSession as clearPersistedAuthSession,
  saveAuthSession,
} from '@renderer/bridge';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { ensureForgeBootstrapReady } from '@renderer/infra/bootstrap/forge-bootstrap.js';

const FORGE_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Forge desktop-browser mode.';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

type ForgeUser = Record<string, unknown> & {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

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
  await ensureForgeBootstrapReady();
  const data: CurrentUserDto = await getPlatformClient().realm.services.MeService.getMe();
  return normalizeForgeUser((data as Record<string, unknown> | null | undefined) ?? null);
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
      await ensureForgeBootstrapReady();
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
    oauthBridge: forgeTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}
