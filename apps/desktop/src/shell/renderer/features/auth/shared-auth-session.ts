import {
  clearPersistedAccessToken,
  persistSharedDesktopAuthSession,
  resolveDesktopBootstrapAuthSession,
  type ResolvedDesktopBootstrapAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';

function resolveRealmBaseUrl(inputRealmBaseUrl?: string): string {
  const explicitRealmBaseUrl = String(inputRealmBaseUrl || '').trim();
  if (explicitRealmBaseUrl) {
    return explicitRealmBaseUrl;
  }
  return String(useAppStore.getState().runtimeDefaults?.realm?.realmBaseUrl || '').trim();
}

export async function loadResolvedSharedDesktopBootstrapAuthSession(input: {
  realmBaseUrl: string;
  envAccessToken?: string | null;
}): Promise<ResolvedDesktopBootstrapAuthSession> {
  const resolved = await resolveDesktopBootstrapAuthSession({
    realmBaseUrl: input.realmBaseUrl,
    envAccessToken: input.envAccessToken,
    loadPersistedSession: () => desktopBridge.loadAuthSession(),
  });
  if (resolved.shouldClearPersistedSession) {
    await desktopBridge.clearAuthSession();
  }
  return resolved;
}

export async function persistSharedDesktopSession(input: {
  realmBaseUrl?: string;
  accessToken: string;
  refreshToken?: string | null;
  user?: Record<string, unknown> | null;
}): Promise<void> {
  const realmBaseUrl = resolveRealmBaseUrl(input.realmBaseUrl);
  await persistSharedDesktopAuthSession({
    realmBaseUrl,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    user: input.user,
    saveSession: (session) => desktopBridge.saveAuthSession(session),
    clearSession: () => desktopBridge.clearAuthSession(),
  });
}

export async function clearSharedDesktopSession(): Promise<void> {
  await desktopBridge.clearAuthSession();
  clearPersistedAccessToken();
}
