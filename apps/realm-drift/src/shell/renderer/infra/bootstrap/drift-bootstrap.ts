import { getRuntimeDefaults } from '@renderer/bridge/runtime-defaults.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { createPlatformClient } from '@nimiplatform/sdk';
import { initI18n } from '@renderer/i18n/index.js';
import { bootstrapAuthSession } from './drift-bootstrap-auth.js';

function toDriftAuthUser(user: Record<string, unknown> | null) {
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

export async function runDriftBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  try {
    // Step 1: i18n
    await initI18n();

    // Step 2: Runtime Defaults
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);

    // Step 3: Platform Client
    const { realm } = await createPlatformClient({
      appId: 'nimi.realm-drift',
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      accessToken: runtimeDefaults.realm.accessToken,
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
          const normalizedUser = toDriftAuthUser(user as Record<string, unknown> | null);
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

    // Step 4: Auth Session
    await bootstrapAuthSession({
      realm,
      accessToken: runtimeDefaults.realm.accessToken,
    });

    // Step 5: Ready
    store.setBootstrapReady(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrapError(message);
  }
}
