import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import {
  persistSharedDesktopAuthSession,
  type AuthPlatformAdapter,
} from '@nimiplatform/nimi-kit/auth';
import {
  clearAuthSession as clearPersistedAuthSession,
  saveAuthSession,
} from '../../bridge/auth-session.js';
import { parentosTauriOAuthBridge } from '../../bridge/oauth.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useAppStore } from '../../app-shell/app-store.js';
import { ensureParentOSBootstrapReady } from '../../infra/parentos-bootstrap.js';

const PARENTOS_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in ParentOS desktop-browser mode.';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

type ParentOSUser = Record<string, unknown> & {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(PARENTOS_EMBEDDED_AUTH_UNSUPPORTED));
}

function normalizeUser(
  user: Record<string, unknown> | null | undefined,
): ParentOSUser | null {
  if (!user || !user.id) {
    return null;
  }

  const normalized: ParentOSUser = {
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

export async function loadCurrentUser(): Promise<ParentOSUser | null> {
  await ensureParentOSBootstrapReady();
  const data: CurrentUserDto = await getPlatformClient().realm.services.MeService.getMe();
  return normalizeUser((data as Record<string, unknown> | null | undefined) ?? null);
}

export function createParentOSDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser,
    applyToken: async (accessToken: string, refreshToken?: string) => {
      await ensureParentOSBootstrapReady();
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
    oauthBridge: parentosTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}
