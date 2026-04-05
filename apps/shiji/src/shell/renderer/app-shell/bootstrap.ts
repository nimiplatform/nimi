import { getRuntimeDefaults } from '@renderer/bridge/runtime-defaults.js';
import { useAppStore } from './app-store.js';
import { createPlatformClient } from '@nimiplatform/sdk';
import {
  persistSharedDesktopAuthSession,
  resolveDesktopBootstrapAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';
import { bootstrapAuthSession } from './bootstrap-auth.js';
import { invoke } from '@renderer/bridge/invoke.js';
import {
  clearAuthSession as clearPersistedAuthSession,
  getDaemonStatus,
  loadAuthSession,
  saveAuthSession,
  startDaemon,
} from '@renderer/bridge';

/**
 * runShiJiBootstrap — Phase 0 bootstrap sequence (SJ-SHELL-001)
 *
 * 1. Runtime defaults from Tauri bridge
 * 2. createPlatformClient({ appId: 'nimi.shiji' })
 * 3. Auth session bootstrap
 * 4. SQLite init (non-blocking — local data, not auth-critical)
 * 5. Runtime readiness check (non-blocking — cloud-only mode valid)
 * 6. bootstrapReady = true → routes render
 */
export async function runShiJiBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  logRendererEvent({
    level: 'info',
    area: 'shiji-bootstrap',
    message: 'phase:bootstrap:start',
  });

  try {
    // Step 1: Runtime defaults
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);
    if (!store.aiModel && runtimeDefaults.runtime.localProviderModel) {
      store.setAiModel(runtimeDefaults.runtime.localProviderModel);
    }
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

    // Step 2: Platform client
    const { runtime, realm } = await createPlatformClient({
      appId: 'nimi.shiji',
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
          const u = user as Record<string, unknown> | null;
          const existingUser = useAppStore.getState().auth.user;
          const normalizedUser = !u || typeof u['id'] !== 'string' || !String(u['id']).trim()
            ? existingUser
            : {
                id: String(u['id']),
                displayName: typeof u['displayName'] === 'string' ? u['displayName'] : '',
                email: u['email'] ? String(u['email']) : undefined,
                avatarUrl: u['avatarUrl'] ? String(u['avatarUrl']) : undefined,
              };
          if (!normalizedUser) {
            throw new Error('platform auth session is missing a valid user.id');
          }
          useAppStore.getState().setAuthSession(normalizedUser, accessToken, refreshToken ?? '');
          persistDesktopSession(normalizedUser, accessToken, refreshToken);
        },
        clearAuthSession: () => {
          useAppStore.getState().clearAuthSession();
          clearDesktopSession();
        },
      },
    });

    // Step 3: Auth session
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

    // Step 4: SQLite init (blocking — local data is required for all stable paths)
    await invoke('db_init', {});
    logRendererEvent({
      level: 'info',
      area: 'shiji-bootstrap',
      message: 'phase:sqlite:ready',
    });

    // Step 5: Runtime readiness check (blocking — SJ-SHELL-001:5 hard-cut)
    // Runtime must be available for AI generation. No cloud-only fallback.
    const daemonStatus = await getDaemonStatus();
    if (!daemonStatus.running) {
      const startedDaemon = await startDaemon();
      if (!startedDaemon.running) {
        throw new Error(startedDaemon.lastError?.trim() || 'runtime daemon failed to start');
      }
    }
    const runtimeReadyTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('runtime ready timeout (15s)')), 15_000),
    );
    await Promise.race([runtime.ready(), runtimeReadyTimeout]);
    logRendererEvent({
      level: 'info',
      area: 'shiji-bootstrap',
      message: 'phase:runtime:ready',
    });

    // Step 6: Ready — routes render
    store.setBootstrapReady(true);
    logRendererEvent({
      level: 'info',
      area: 'shiji-bootstrap',
      message: 'phase:bootstrap:ready',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrapError(message);
    logRendererEvent({
      level: 'error',
      area: 'shiji-bootstrap',
      message: 'action:bootstrap:error',
      details: { error: message },
    });
  }
}
