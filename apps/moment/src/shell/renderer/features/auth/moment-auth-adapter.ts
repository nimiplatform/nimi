import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import {
  persistSharedDesktopAuthSession,
  type AuthPlatformAdapter,
} from '@nimiplatform/nimi-kit/auth';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  clearAuthSession as clearPersistedAuthSession,
  saveAuthSession,
} from '@renderer/bridge';
import { momentTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { ensureMomentBootstrapReady } from '@renderer/infra/bootstrap/moment-bootstrap.js';

const MOMENT_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Moment desktop-browser mode.';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

type MomentUser = Record<string, unknown> & {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(MOMENT_EMBEDDED_AUTH_UNSUPPORTED));
}

function normalizeMomentUser(
  user: Record<string, unknown> | null | undefined,
): MomentUser | null {
  if (!user || !user.id) {
    return null;
  }

  const normalized: MomentUser = {
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

export async function loadMomentCurrentUser(): Promise<MomentUser | null> {
  await ensureMomentBootstrapReady();
  const data: CurrentUserDto = await getPlatformClient().realm.services.MeService.getMe();
  return normalizeMomentUser((data as Record<string, unknown> | null | undefined) ?? null);
}

export function createMomentDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser: loadMomentCurrentUser,
    applyToken: async (accessToken: string, refreshToken?: string) => {
      await ensureMomentBootstrapReady();
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
    oauthBridge: momentTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}
