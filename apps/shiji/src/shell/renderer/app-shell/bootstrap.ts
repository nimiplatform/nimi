import { getRuntimeDefaults } from '@renderer/bridge/runtime-defaults.js';
import { useAppStore } from './app-store.js';
import { createPlatformClient } from '@nimiplatform/sdk';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';
import { bootstrapAuthSession } from './bootstrap-auth.js';
import { invoke } from '@renderer/bridge/invoke.js';
import { getDaemonStatus, startDaemon } from '@renderer/bridge/runtime-daemon.js';

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

    // Step 2: Platform client
    const { runtime, realm } = await createPlatformClient({
      appId: 'nimi.shiji',
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      accessToken: runtimeDefaults.realm.accessToken,
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
          const u = user as Record<string, unknown> | null;
          if (!u || typeof u['id'] !== 'string' || !String(u['id']).trim()) {
            throw new Error('platform auth session is missing a valid user.id');
          }
          useAppStore.getState().setAuthSession(
            {
              id: String(u['id']),
              displayName: typeof u['displayName'] === 'string' ? u['displayName'] : '',
              email: u['email'] ? String(u['email']) : undefined,
              avatarUrl: u['avatarUrl'] ? String(u['avatarUrl']) : undefined,
            },
            accessToken,
            refreshToken ?? '',
          );
        },
        clearAuthSession: () => {
          useAppStore.getState().clearAuthSession();
        },
      },
    });

    // Step 3: Auth session
    await bootstrapAuthSession({
      realm,
      accessToken: runtimeDefaults.realm.accessToken,
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
