import { createPlatformClient } from '@nimiplatform/sdk';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { getRuntimeDefaults } from '@renderer/bridge/runtime-defaults.js';
import { getDaemonStatus } from '@renderer/bridge/runtime-daemon.js';
import { bootstrapAuthSession } from './moment-bootstrap-auth.js';

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
  const store = useAppStore.getState();

  logRendererEvent({
    level: 'info',
    area: 'moment-bootstrap',
    message: 'phase:bootstrap:start',
  });

  try {
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);
    const initialAccessToken = runtimeDefaults.realm.accessToken || '';

    const { runtime, realm } = await createPlatformClient({
      appId: 'nimi.moment',
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      accessToken: initialAccessToken,
      accessTokenProvider: () => useAppStore.getState().auth.token ?? '',
      runtimeTransport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      sessionStore: {
        getAccessToken: () => useAppStore.getState().auth.token,
        getRefreshToken: () => useAppStore.getState().auth.refreshToken,
        getSubjectUserId: () => useAppStore.getState().auth.user?.id ?? '',
        getCurrentUser: () => useAppStore.getState().auth.user,
        setAuthSession: (user, accessToken, refreshToken) => {
          const normalizedUser = toMomentAuthUser(user as Record<string, unknown> | null);
          if (!normalizedUser) {
            return;
          }
          useAppStore.getState().setAuthSession(normalizedUser, accessToken, refreshToken || '');
        },
        clearAuthSession: () => {
          useAppStore.getState().clearAuthSession();
        },
      },
    });

    await bootstrapAuthSession({
      realm,
      accessToken: initialAccessToken,
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
