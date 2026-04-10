import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import {
  persistSharedDesktopAuthSession,
  type AuthPlatformAdapter,
} from '@nimiplatform/nimi-kit/auth';
import {
  clearAuthSession as clearPersistedAuthSession,
  saveAuthSession,
} from '@renderer/bridge';
import { lookdevTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { ensureLookdevBootstrapReady } from '@renderer/infra/bootstrap/lookdev-bootstrap.js';

const LOOKDEV_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Lookdev desktop-browser mode.';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

type LookdevUser = Record<string, unknown> & {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(LOOKDEV_EMBEDDED_AUTH_UNSUPPORTED));
}

function normalizeLookdevUser(
  user: Record<string, unknown> | null | undefined,
): LookdevUser | null {
  if (!user || !user.id) {
    return null;
  }

  const normalized: LookdevUser = {
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

export async function loadLookdevCurrentUser(): Promise<LookdevUser | null> {
  await ensureLookdevBootstrapReady();
  const data: CurrentUserDto = await getPlatformClient().realm.services.MeService.getMe();
  return normalizeLookdevUser((data as Record<string, unknown> | null | undefined) ?? null);
}

export function createLookdevDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser: loadLookdevCurrentUser,
    applyToken: async (accessToken: string, refreshToken?: string) => {
      await ensureLookdevBootstrapReady();
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
    oauthBridge: lookdevTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}
