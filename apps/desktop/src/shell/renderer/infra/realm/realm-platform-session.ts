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
    refreshToken?: string,
  ) => void | Promise<void>;
  clearAuthSession?: () => void | Promise<void>;
}) {
  const accessToken = String(input.accessToken || '').trim();
  const refreshToken = String(input.refreshToken || '').trim();
  clearPlatformClient();
  return createPlatformClient({
    appId: input.appId || 'nimi.web',
    authMode: 'web-cloud',
    realmBaseUrl: input.realmBaseUrl,
    accessToken,
    refreshTokenProvider: () => refreshToken,
    sessionStore: {
      getAccessToken: () => accessToken,
      getRefreshToken: () => refreshToken,
      getCurrentUser: () => input.getCurrentUser?.() ?? null,
      setAuthSession: input.setAuthSession,
      clearAuthSession: input.clearAuthSession,
    },
    runtimeTransport: null,
    realmFetchImpl: input.fetchImpl || undefined,
    allowAnonymousRealm: !accessToken,
  });
}
