import { getParentOSRuntimeDefaults } from '../bridge/index.js';
import {
  clearAuthSession as clearPersistedAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '../bridge/index.js';
import { useAppStore } from '../app-shell/app-store.js';
import { createPlatformClient } from '@nimiplatform/sdk';
import {
  persistSharedDesktopAuthSession,
  resolveDesktopBootstrapAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { dbInit, getAppSetting, getChild, getChildren, getFamily } from '../bridge/sqlite-bridge.js';
import { mapChildRow } from '../bridge/mappers.js';
import { bootstrapParentOSAuthSession } from './parentos-bootstrap-auth.js';
import { loadPersistedParentosAIConfig } from '../features/settings/parentos-ai-config.js';
import { describeError, logRendererEvent } from './telemetry/renderer-log.js';

let bootstrapPromise: Promise<void> | null = null;
let localDataSyncPromise: Promise<void> = Promise.resolve();
const ACTIVE_CHILD_SETTING_KEYS = ['activeChildId', 'inspection:last-active-child-id'] as const;

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

export async function runParentOSBootstrap(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = doRunParentOSBootstrap().finally(() => {
    if (!useAppStore.getState().bootstrapReady) {
      bootstrapPromise = null;
    }
  });

  return bootstrapPromise;
}

export async function ensureParentOSBootstrapReady(): Promise<void> {
  const store = useAppStore.getState();
  if (store.bootstrapReady) {
    return;
  }

  await runParentOSBootstrap();

  const nextStore = useAppStore.getState();
  if (!nextStore.bootstrapReady) {
    throw new Error(nextStore.bootstrapError || 'ParentOS bootstrap did not complete');
  }
}

async function loadPersistedActiveChildId(): Promise<string | null> {
  for (const key of ACTIVE_CHILD_SETTING_KEYS) {
    const value = String(await getAppSetting(key) || '').trim();
    if (value) {
      return value;
    }
  }
  return null;
}

async function loadScopedLocalData(subjectUserId?: string | null): Promise<void> {
  const store = useAppStore.getState();
  store.clearLocalData();

  await dbInit(subjectUserId);

  const persistedAIConfig = await loadPersistedParentosAIConfig();
  if (persistedAIConfig) {
    useAppStore.getState().setAIConfig(persistedAIConfig);
  }

  const persistedActiveChildId = await loadPersistedActiveChildId();
  const persistedActiveChild = persistedActiveChildId
    ? await getChild(persistedActiveChildId)
    : null;
  const familyId = persistedActiveChild?.familyId
    ?? (await getFamily())?.familyId
    ?? null;
  if (!familyId) {
    return;
  }

  useAppStore.getState().setFamilyId(familyId);
  const rows = await getChildren(familyId);
  const children = rows.map(mapChildRow);
  useAppStore.getState().setChildren(children);
  if (children.length > 0) {
    const resolvedActiveChildId = children.find((child) => child.childId === persistedActiveChildId)?.childId
      ?? children[0]!.childId;
    useAppStore.getState().setActiveChildId(resolvedActiveChildId);
  }
}

export function syncParentOSLocalDataScope(subjectUserId?: string | null): Promise<void> {
  const normalizedSubjectUserId = String(subjectUserId || '').trim() || null;
  localDataSyncPromise = localDataSyncPromise
    .catch(() => undefined)
    .then(() => loadScopedLocalData(normalizedSubjectUserId));
  return localDataSyncPromise;
}

async function doRunParentOSBootstrap(): Promise<void> {
  const store = useAppStore.getState();
  const flowId = `parentos-bootstrap-${Date.now().toString(36)}`;

  try {
    // Step 1: Runtime Defaults
    const runtimeDefaults = await getParentOSRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);

    // Step 2: Resolve persisted auth session
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

    // Step 3: Platform Client
    const { runtime, realm } = await createPlatformClient({
      appId: 'app.nimi.parentos',
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      accessToken: bootstrapAccessToken,
      accessTokenProvider: resolveCurrentAccessToken,
      refreshTokenProvider: resolveCurrentRefreshToken,
      runtimeTransport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      runtimeDefaults: {
        callerId: 'app.nimi.parentos',
        surfaceId: 'parentos.advisor',
      },
      sessionStore: {
        getAccessToken: resolveCurrentAccessToken,
        getRefreshToken: resolveCurrentRefreshToken,
        getSubjectUserId: () => useAppStore.getState().auth.user?.id ?? '',
        getCurrentUser: () => useAppStore.getState().auth.user,
        setAuthSession: (user, accessToken, refreshToken) => {
          const previousUserId = useAppStore.getState().auth.user?.id ?? null;
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
          if (previousUserId !== normalizedUser.id) {
            void syncParentOSLocalDataScope(normalizedUser.id);
          }
        },
        clearAuthSession: () => {
          const previousUserId = useAppStore.getState().auth.user?.id ?? null;
          useAppStore.getState().clearAuthSession();
          clearDesktopSession();
          if (previousUserId) {
            void syncParentOSLocalDataScope(null);
          } else {
            useAppStore.getState().clearLocalData();
          }
        },
      },
    });
    // Step 4: Auth Session
    await bootstrapParentOSAuthSession({
      realm,
      accessToken: bootstrapAccessToken,
      refreshToken: bootstrapRefreshToken,
      source: resolvedBootstrapAuthSession.source,
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      clearPersistedSession: async () => {
        clearDesktopSession();
      },
    });

    // Step 5: Local data bootstrap (SQLite)
    try {
      await syncParentOSLocalDataScope(useAppStore.getState().auth.user?.id ?? null);
    } catch (error) {
      logRendererEvent({
        level: 'warn',
        area: 'bootstrap.local-data',
        message: 'action:local-data-bootstrap-failed',
        flowId,
        details: {
          error: describeError(error),
        },
      });
    }

    // Step 6: Runtime SDK Readiness
    try {
      await runtime.ready();
    } catch (error) {
      // Runtime readiness is non-blocking; core ParentOS features work without runtime
      logRendererEvent({
        level: 'warn',
        area: 'bootstrap.runtime',
        message: 'action:runtime-ready-nonblocking-failed',
        flowId,
        details: {
          error: describeError(error),
        },
      });
    }

    // Step 7: Ready
    store.setBootstrapReady(true);
    store.setBootstrapError(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logRendererEvent({
      level: 'error',
      area: 'bootstrap',
      message: 'action:bootstrap-failed',
      flowId,
      details: {
        error: describeError(error),
      },
    });
    store.setBootstrapError(message);
    store.setBootstrapReady(false);
  }
}
