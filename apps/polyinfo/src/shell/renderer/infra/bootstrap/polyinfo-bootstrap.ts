import {
  getRuntimeDefaults,
  clearAuthSession as clearPersistedAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { createPlatformClient } from '@nimiplatform/sdk';
import {
  persistSharedDesktopAuthSession,
  resolveDesktopBootstrapAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { bootstrapAuthSession } from './polyinfo-bootstrap-auth.js';
import { loadPersistedAIConfig } from '@renderer/data/runtime-routes.js';

function toAuthUser(user: Record<string, unknown> | null) {
  if (!user) {
    return null;
  }
  const id = String(user.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    displayName: String(user.displayName || user.name || '').trim(),
    email: user.email ? String(user.email) : undefined,
    avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
  };
}

export async function runPolyinfoBootstrap(): Promise<void> {
  const store = useAppStore.getState();
  try {
    store.setAuthBootstrapping();
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);

    const resolvedBootstrapAuthSession = await resolveDesktopBootstrapAuthSession({
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      envAccessToken: runtimeDefaults.realm.accessToken,
      loadPersistedSession: () => loadAuthSession(),
    });

    if (resolvedBootstrapAuthSession.shouldClearPersistedSession) {
      await clearPersistedAuthSession();
    }

    let bootstrapAccessToken = String(resolvedBootstrapAuthSession.session?.accessToken || '').trim();
    let bootstrapRefreshToken = String(resolvedBootstrapAuthSession.session?.refreshToken || '').trim();

    const resolveCurrentAccessToken = () => {
      const authToken = String(useAppStore.getState().auth.token || '').trim();
      if (authToken) {
        return authToken;
      }
      return useAppStore.getState().auth.status === 'bootstrapping'
        ? bootstrapAccessToken
        : '';
    };

    const resolveCurrentRefreshToken = () => {
      const refreshToken = String(useAppStore.getState().auth.refreshToken || '').trim();
      if (refreshToken) {
        return refreshToken;
      }
      return useAppStore.getState().auth.status === 'bootstrapping'
        ? bootstrapRefreshToken
        : '';
    };

    const persistDesktopSession = (user: Record<string, unknown> | null, accessToken: string, refreshToken?: string) => {
      void persistSharedDesktopAuthSession({
        realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
        accessToken,
        refreshToken,
        user,
        saveSession: (session) => saveAuthSession(session),
        clearSession: () => clearPersistedAuthSession(),
      });
    };

    const clearDesktopSession = () => {
      bootstrapAccessToken = '';
      bootstrapRefreshToken = '';
      void clearPersistedAuthSession();
    };

    const { realm } = await createPlatformClient({
      appId: 'nimi.polyinfo',
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      accessToken: bootstrapAccessToken,
      accessTokenProvider: resolveCurrentAccessToken,
      refreshTokenProvider: resolveCurrentRefreshToken,
      runtimeTransport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      sessionStore: {
        getAccessToken: resolveCurrentAccessToken,
        getRefreshToken: resolveCurrentRefreshToken,
        getSubjectUserId: () => useAppStore.getState().auth.user?.id ?? '',
        getCurrentUser: () => useAppStore.getState().auth.user,
        setAuthSession: (user, accessToken, refreshToken) => {
          bootstrapAccessToken = String(accessToken || '').trim();
          if (refreshToken !== undefined) {
            bootstrapRefreshToken = String(refreshToken || '').trim();
          }
          const normalizedUser = toAuthUser(user as Record<string, unknown> | null)
            ?? useAppStore.getState().auth.user;
          if (!normalizedUser) {
            return;
          }
          useAppStore.getState().setAuthSession(normalizedUser, accessToken, refreshToken || '');
          persistDesktopSession(normalizedUser, accessToken, refreshToken);
        },
        clearAuthSession: () => {
          useAppStore.getState().clearAuthSession();
          clearDesktopSession();
        },
      },
    });

    await bootstrapAuthSession({
      realm,
      accessToken: bootstrapAccessToken,
      refreshToken: bootstrapRefreshToken,
      source: resolvedBootstrapAuthSession.source,
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      clearPersistedSession: async () => {
        clearDesktopSession();
      },
    });

    store.setAIConfig(loadPersistedAIConfig(runtimeDefaults));
    store.setBootstrapReady(true);
    store.setBootstrapError(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrapError(message);
  }
}
