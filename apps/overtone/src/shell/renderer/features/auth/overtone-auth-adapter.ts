import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import type { AuthPlatformAdapter } from '@nimiplatform/shell-auth';
import { overtoneTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import {
  clearRealmInstance,
  getRealmInstance,
  initRealmInstance,
} from '@renderer/bridge/realm-sdk.js';

const OVERTONE_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Overtone desktop-browser mode.';

type OvertoneUser = Record<string, unknown> & {
  id: string;
  displayName: string;
};

let currentAccessToken = '';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(OVERTONE_EMBEDDED_AUTH_UNSUPPORTED));
}

function normalizeOvertoneUser(
  user: Record<string, unknown> | null | undefined,
): OvertoneUser | null {
  if (!user || !user.id) {
    return null;
  }

  return {
    ...user,
    id: String(user.id),
    displayName: String(user.displayName || user.name || ''),
  };
}

export function getOvertoneRealmBaseUrl(): string {
  const baseUrl = String(
    import.meta.env.VITE_NIMI_REALM_BASE_URL
    || import.meta.env.NIMI_REALM_URL
    || '',
  ).trim();
  if (!baseUrl) {
    throw new Error('Missing VITE_NIMI_REALM_BASE_URL (or NIMI_REALM_URL) configuration');
  }
  return baseUrl;
}

export async function resolveOvertoneCurrentUser(
  accessToken: string,
): Promise<OvertoneUser | null> {
  const realm = initRealmInstance(getOvertoneRealmBaseUrl(), accessToken);
  const data: CurrentUserDto = await realm.services.MeService.getMe();
  return normalizeOvertoneUser((data as Record<string, unknown> | null | undefined) ?? null);
}

export function createOvertoneDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser: async () => {
      if (!currentAccessToken) {
        return null;
      }
      return resolveOvertoneCurrentUser(currentAccessToken);
    },
    applyToken: async (accessToken: string) => {
      currentAccessToken = String(accessToken || '').trim();
      if (!currentAccessToken) {
        clearRealmInstance();
        return;
      }
      initRealmInstance(getOvertoneRealmBaseUrl(), currentAccessToken);
    },
    oauthBridge: overtoneTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}
