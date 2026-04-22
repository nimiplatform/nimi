import { clearPlatformClient, createPlatformClient, type PlatformClient } from '@nimiplatform/sdk';
import { persistSharedDesktopAuthSession, resolveDesktopBootstrapAuthSession } from '@nimiplatform/nimi-kit/auth';
import { clearAuthSession, getRuntimeDefaults, hasTauriInvoke, loadAuthSession, saveAuthSession, startDaemon } from '@renderer/bridge';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import type { AgentDataDriver } from '../driver/types.js';
import { bootstrapAuthSession } from './bootstrap-auth.js';
import { useAvatarStore } from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './tauri-commands.js';

export type BootstrapHandle = {
  driver: AgentDataDriver;
  shutdown(): Promise<void>;
};

function readNormalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadDefaultMockScenarioJson(): Promise<string> {
  const module = await import('../mock/scenarios/default.mock.json?raw');
  return module.default;
}

async function resolveConversationAnchorId(
  runtime: PlatformClient['runtime'],
  agentId: string,
): Promise<string> {
  const opened = await runtime.agent.anchors.open({
    agentId,
    metadata: {
      surface: 'avatar-carrier',
    },
  });
  const record = opened as unknown as Record<string, unknown>;
  const conversationAnchorId = readNormalizedString(
    record.conversationAnchorId ?? record.conversation_anchor_id,
  );
  if (!conversationAnchorId) {
    throw new Error('runtime.agent anchor open did not return conversationAnchorId');
  }
  return conversationAnchorId;
}

export async function bootstrapAvatar(): Promise<BootstrapHandle> {
  const store = useAvatarStore.getState();

  let shellUnlisten: (() => void) | null = null;
  let driver: AgentDataDriver | null = null;
  let unsubscribeStatus = () => {};
  let unsubscribeBundle = () => {};
  let shouldClearPlatformClient = false;
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    unsubscribeStatus();
    unsubscribeBundle();
    shellUnlisten?.();
    if (driver) {
      await driver.stop().catch(() => {});
    }
    if (shouldClearPlatformClient) {
      useAvatarStore.getState().clearRuntimeBinding();
      clearPlatformClient();
    }
  };

  try {
    if (isTauriRuntime()) {
      shellUnlisten = await onShellReady((payload) => {
        useAvatarStore.getState().markShellReady({ width: payload.width, height: payload.height });
      });
      await setAlwaysOnTop(store.shell.alwaysOnTop);
    } else {
      // Browser dev mode (pnpm dev:renderer without Tauri shell) — mark shell ready immediately with current window size
      useAvatarStore.getState().markShellReady({
        width: typeof window !== 'undefined' ? window.innerWidth : 400,
        height: typeof window !== 'undefined' ? window.innerHeight : 600,
      });
    }

    const driverKind = resolveDriverKind();

    if (driverKind === 'mock') {
      const scenarioJson = await loadDefaultMockScenarioJson();
      useAvatarStore.getState().setConsumeMode({
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'default',
        fixturePlaying: true,
      });
      driver = createDriver({
        kind: 'mock',
        scenarioJson,
        scenarioSource: 'default.mock.json',
      });
    } else {
      if (!isTauriRuntime() || !hasTauriInvoke()) {
        throw new Error('avatar real runtime bootstrap requires Tauri runtime');
      }

      const runtimeDefaults = await getRuntimeDefaults();
      useAvatarStore.getState().setRuntimeDefaults(runtimeDefaults);
      const resolvedBootstrapAuthSession = await resolveDesktopBootstrapAuthSession({
        realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
        envAccessToken: runtimeDefaults.realm.accessToken,
        loadPersistedSession: () => loadAuthSession(),
      });
      if (resolvedBootstrapAuthSession.shouldClearPersistedSession) {
        await clearAuthSession();
      }

      let bootstrapAccessToken = String(resolvedBootstrapAuthSession.session?.accessToken || '').trim();
      let bootstrapRefreshToken = String(resolvedBootstrapAuthSession.session?.refreshToken || '').trim();
      const resolveCurrentAccessToken = () => {
        const fromStore = String(useAvatarStore.getState().auth.accessToken || '').trim();
        return fromStore || bootstrapAccessToken;
      };
      const resolveCurrentRefreshToken = () => {
        const fromStore = String(useAvatarStore.getState().auth.refreshToken || '').trim();
        return fromStore || bootstrapRefreshToken;
      };
      const clearPersistedSession = async () => {
        bootstrapAccessToken = '';
        bootstrapRefreshToken = '';
        await clearAuthSession();
      };

      const { runtime, realm } = await createPlatformClient({
        appId: 'nimi.avatar',
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
          getSubjectUserId: () => useAvatarStore.getState().auth.user?.id ?? '',
          getCurrentUser: () => useAvatarStore.getState().auth.user,
          setAuthSession: (user, accessToken, refreshToken) => {
            bootstrapAccessToken = String(accessToken || '').trim();
            if (refreshToken !== undefined) {
              bootstrapRefreshToken = String(refreshToken || '').trim();
            }
            const record = user as Record<string, unknown> | null;
            const userId = readNormalizedString(record?.['id']);
            if (!userId) {
              return;
            }
            useAvatarStore.getState().setAuthSession(
              {
                id: userId,
                displayName: readNormalizedString(record?.['displayName']),
                ...(readNormalizedString(record?.['email']) ? { email: readNormalizedString(record?.['email']) } : {}),
                ...(readNormalizedString(record?.['avatarUrl']) ? { avatarUrl: readNormalizedString(record?.['avatarUrl']) } : {}),
              },
              accessToken,
              refreshToken || '',
            );
            void persistSharedDesktopAuthSession({
              realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
              accessToken,
              refreshToken,
              user: record,
              saveSession: (session) => saveAuthSession(session),
              clearSession: () => clearAuthSession(),
            });
          },
          clearAuthSession: () => {
            useAvatarStore.getState().clearAuthSession();
            void clearPersistedSession();
          },
        },
      });
      shouldClearPlatformClient = true;

      const authUser = await bootstrapAuthSession({
        realm,
        accessToken: bootstrapAccessToken,
        refreshToken: bootstrapRefreshToken,
        source: resolvedBootstrapAuthSession.source,
        realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
        clearPersistedSession,
      });

      const startedDaemon = await startDaemon();
      if (!startedDaemon.running) {
        throw new Error(startedDaemon.lastError?.trim() || 'runtime daemon failed to start');
      }
      await Promise.race([
        runtime.ready(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('avatar runtime ready timeout (15s)')), 15_000);
        }),
      ]);

      const agentId = readNormalizedString(runtimeDefaults.runtime.agentId);
      const worldId = readNormalizedString(runtimeDefaults.runtime.worldId);
      if (!agentId) {
        throw new Error('avatar runtime defaults are missing runtime.agentId');
      }
      if (!worldId) {
        throw new Error('avatar runtime defaults are missing runtime.worldId');
      }

      const conversationAnchorId = await resolveConversationAnchorId(runtime, agentId);
      useAvatarStore.getState().setConsumeMode({
        mode: 'sdk',
        authority: 'runtime',
        fixtureId: null,
        fixturePlaying: false,
      });
      useAvatarStore.getState().setRuntimeBinding({
        conversationAnchorId,
        agentId,
        worldId,
      });
      driver = createDriver({
        kind: 'sdk',
        sdk: {
          runtime,
          agentId,
          conversationAnchorId,
          activeWorldId: worldId,
          activeUserId: authUser.id,
          locale: navigator.language || 'en-US',
          windowInfo: () => {
            const state = useAvatarStore.getState();
            return {
              x: 0,
              y: 0,
              width: state.shell.windowSize.width,
              height: state.shell.windowSize.height,
            };
          },
        },
      });
    }

    unsubscribeStatus = driver.onStatusChange((status) => {
      useAvatarStore.getState().setDriverStatus(status);
    });

    unsubscribeBundle = driver.onBundleChange((bundle) => {
      useAvatarStore.getState().setBundle(bundle);
    });

    await driver.start();

    return {
      driver,
      async shutdown() {
        await cleanup();
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
