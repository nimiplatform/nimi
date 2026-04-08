import { getRuntimeDefaults } from '@renderer/bridge/runtime-defaults.js';
import { getDaemonStatus } from '@renderer/bridge/runtime-daemon.js';
import {
  clearAuthSession as clearPersistedAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { createPlatformClient } from '@nimiplatform/sdk';
import {
  persistSharedDesktopAuthSession,
  resolveDesktopBootstrapAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';
import { registerForgeModSdkHost } from './forge-runtime-host.js';
import { bootstrapAuthSession } from './forge-bootstrap-auth.js';

function toForgeAuthUser(user: Record<string, unknown> | null) {
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

export async function runForgeBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  logRendererEvent({
    level: 'info',
    area: 'forge-bootstrap',
    message: 'phase:bootstrap:start',
  });

  try {
    // Step 1: Runtime Defaults (i18n is eagerly initialized at module load)
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

    // Step 2: Platform Client
    const { runtime, realm } = await createPlatformClient({
      appId: 'nimi.forge',
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
          const normalizedUser = toForgeAuthUser(user as Record<string, unknown> | null)
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

    // Step 3: Runtime Host Capabilities (per FG-ROUTE-003)
    registerForgeModSdkHost();

    // Step 4: Auth Session
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

    // Step 6: Runtime SDK Readiness
    try {
      await runtime.ready();
    } catch {
      // Runtime readiness is non-blocking for Forge — creator features
      // may work without local AI runtime available
    }

    // Step 7: Exit Handler (daemon status check)
    try {
      const daemonStatus = await getDaemonStatus();
      if (daemonStatus.managed) {
        // Register exit handler if daemon is managed
        // Forge uses a lighter touch — just log the status
      }
    } catch {
      // Non-blocking — daemon may not be running
    }

    // Step 8: Ready
    store.setBootstrapReady(true);
    logRendererEvent({
      level: 'info',
      area: 'forge-bootstrap',
      message: 'phase:bootstrap:ready',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrapError(message);
    logRendererEvent({
      level: 'error',
      area: 'forge-bootstrap',
      message: 'action:bootstrap:error',
      details: { error: message },
    });
  }
}
