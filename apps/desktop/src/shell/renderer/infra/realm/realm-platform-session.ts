import {
  clearDesktopNimiClientSession,
  configureDesktopRealmOnlySession,
  isDesktopNimiClientSessionReady,
  type DesktopAuthUserRecord,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

export function isRealmPlatformClientReady(): boolean {
  return isDesktopNimiClientSessionReady();
}

export async function configureWebRealmPlatformClient(input: {
  appId?: string;
  realmBaseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  fetchImpl?: typeof fetch | null;
  getCurrentUser?: () => DesktopAuthUserRecord | null;
  setAuthSession?: (
    user: DesktopAuthUserRecord | null,
    accessToken: string,
  ) => void | Promise<void>;
  clearAuthSession?: () => void | Promise<void>;
}) {
  clearDesktopNimiClientSession();
  return configureDesktopRealmOnlySession({
    appId: input.appId || 'nimi.web',
    realmBaseUrl: input.realmBaseUrl,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    fetchImpl: input.fetchImpl,
    getCurrentUser: input.getCurrentUser,
    setAuthSession: input.setAuthSession,
    clearAuthSession: input.clearAuthSession,
  });
}
