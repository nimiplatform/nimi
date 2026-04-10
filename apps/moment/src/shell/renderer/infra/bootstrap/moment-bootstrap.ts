import { createPlatformClient } from '@nimiplatform/sdk';
import {
  persistSharedDesktopAuthSession,
  resolveDesktopBootstrapAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import {
  clearAuthSession as clearPersistedAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '@renderer/bridge';
import { getRuntimeDefaults } from '@renderer/bridge/runtime-defaults.js';
import { getDaemonStatus } from '@renderer/bridge/runtime-daemon.js';
import { bootstrapAuthSession } from './moment-bootstrap-auth.js';

let bootstrapPromise: Promise<void> | null = null;
let bootstrapSettled = false;

function toMomentAuthUser(user: Record<string, unknown> | null) {
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

export async function runMomentBootstrap(): Promise<void> {
  if (bootstrapPromise && !bootstrapSettled) {
    return bootstrapPromise;
  }
  if (bootstrapPromise && useAppStore.getState().bootstrapReady) {
    return bootstrapPromise;
  }

  bootstrapSettled = false;
  bootstrapPromise = doRunMomentBootstrap().finally(() => {
    bootstrapSettled = true;
    if (!useAppStore.getState().bootstrapReady) {
      bootstrapPromise = null;
    }
  });

  return bootstrapPromise;
}

export async function ensureMomentBootstrapReady(): Promise<void> {
  const store = useAppStore.getState();
  if (store.bootstrapReady) {
    return;
  }

  await runMomentBootstrap();

  const nextStore = useAppStore.getState();
  if (!nextStore.bootstrapReady) {
    throw new Error(nextStore.bootstrapError || 'Moment bootstrap did not complete');
  }
}

async function doRunMomentBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  logRendererEvent({
    level: 'info',
    area: 'moment-bootstrap',
    message: 'phase:bootstrap:start',
  });

  try {
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

    const { runtime, realm } = await createPlatformClient({
      appId: 'nimi.moment',
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
          const normalizedUser = toMomentAuthUser(user as Record<string, unknown> | null)
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

    try {
      await runtime.ready();
    } catch {
      // Runtime readiness is probed later and must stay observable.
    }

    try {
      await getDaemonStatus();
    } catch {
      // no-op
    }

    store.setBootstrapReady(true);
    logRendererEvent({
      level: 'info',
      area: 'moment-bootstrap',
      message: 'phase:bootstrap:ready',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrapError(message);
    logRendererEvent({
      level: 'error',
      area: 'moment-bootstrap',
      message: 'action:bootstrap:error',
      details: { error: message },
    });
  }
}
