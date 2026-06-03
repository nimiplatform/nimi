import {
  clearPlatformClient,
  createPlatformClient,
  getPlatformClient,
} from '@nimiplatform/sdk';
import type { RealmFetchImpl } from '@nimiplatform/sdk/realm';

export function isRealmPlatformClientReady(): boolean {
  try {
    void getPlatformClient().realm;
    return true;
  } catch {
    return false;
  }
}

export async function configureWebRealmPlatformClient(input: {
  appId?: string;
  realmBaseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  fetchImpl?: RealmFetchImpl | null;
  getCurrentUser?: () => Record<string, unknown> | null;
  setAuthSession?: (
    user: Record<string, unknown> | null,
    accessToken: string,
  ) => void | Promise<void>;
  clearAuthSession?: () => void | Promise<void>;
}) {
  let currentAccessToken = String(input.accessToken || '').trim();
  let currentRefreshToken = String(input.refreshToken || '').trim();
  clearPlatformClient();
  return createPlatformClient({
    appId: input.appId || 'nimi.web',
    authMode: 'web-cloud',
    realmBaseUrl: input.realmBaseUrl,
    accessTokenProvider: () => currentAccessToken,
    refreshTokenProvider: () => currentRefreshToken,
    sessionStore: {
      getAccessToken: () => currentAccessToken,
      getRefreshToken: () => currentRefreshToken,
      getCurrentUser: () => input.getCurrentUser?.() ?? null,
      setAuthSession: (user, nextAccessToken, nextRefreshToken) => {
        currentAccessToken = String(nextAccessToken || '').trim();
        if (typeof nextRefreshToken === 'string') {
          currentRefreshToken = nextRefreshToken.trim();
        }
        return input.setAuthSession?.(user, currentAccessToken);
      },
      clearAuthSession: input.clearAuthSession,
    },
    runtimeTransport: null,
    realmFetchImpl: input.fetchImpl || undefined,
    allowAnonymousRealm: !currentAccessToken,
  });
}
