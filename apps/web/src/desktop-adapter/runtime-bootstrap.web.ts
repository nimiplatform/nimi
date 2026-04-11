type DataSyncFacade = (typeof import('@desktop-public/data-sync'))['dataSync'];
type DesktopBridgeFacade = (typeof import('@renderer/bridge'))['desktopBridge'];
type CreateProxyFetch = (typeof import('@desktop-public/infra'))['createProxyFetch'];
type CreateRendererFlowId = (typeof import('@desktop-public/infra'))['createRendererFlowId'];
type LogRendererEvent = (typeof import('@desktop-public/infra'))['logRendererEvent'];
type UseAppStore = (typeof import('@desktop-public/app-store'))['useAppStore'];
type ClearPersistedAccessToken = (typeof import('@nimiplatform/nimi-kit/auth'))['clearPersistedAccessToken'];
type HasDesktopCallbackRequestInLocation = (typeof import('@nimiplatform/nimi-kit/auth'))['hasDesktopCallbackRequestInLocation'];
type LoadPersistedAuthSession = (typeof import('@nimiplatform/nimi-kit/auth'))['loadPersistedAuthSession'];
type PersistAuthSession = (typeof import('@nimiplatform/nimi-kit/auth'))['persistAuthSession'];

type RuntimeBootstrapWebDeps = {
  dataSync: DataSyncFacade;
  desktopBridge: DesktopBridgeFacade;
  createProxyFetch: CreateProxyFetch;
  createRendererFlowId: CreateRendererFlowId;
  logRendererEvent: LogRendererEvent;
  useAppStore: UseAppStore;
  clearPersistedAccessToken: ClearPersistedAccessToken;
  hasDesktopCallbackRequestInLocation: HasDesktopCallbackRequestInLocation;
  loadPersistedAuthSession: LoadPersistedAuthSession;
  persistAuthSession: PersistAuthSession;
};

type AuthSessionSnapshot = {
  status: string;
  user: Record<string, unknown> | null;
  token: string;
  refreshToken: string;
};

let bootstrapPromise: Promise<void> | null = null;
let depsPromise: Promise<RuntimeBootstrapWebDeps> | null = null;
const WEB_BOOTSTRAP_AUTH_TIMEOUT_MS = 12000;

async function loadRuntimeBootstrapWebDeps(): Promise<RuntimeBootstrapWebDeps> {
  if (depsPromise) {
    return depsPromise;
  }

  depsPromise = (async () => {
    const [
      dataSyncModule,
      bridgeModule,
      infraModule,
      appStoreModule,
      authStorageModule,
    ] = await Promise.all([
      import('@desktop-public/data-sync'),
      import('@renderer/bridge'),
      import('@desktop-public/infra'),
      import('@desktop-public/app-store'),
      import('@nimiplatform/nimi-kit/auth'),
    ]);

    return {
      dataSync: dataSyncModule.dataSync,
      desktopBridge: bridgeModule.desktopBridge,
      createProxyFetch: infraModule.createProxyFetch,
      createRendererFlowId: infraModule.createRendererFlowId,
      logRendererEvent: infraModule.logRendererEvent,
      useAppStore: appStoreModule.useAppStore,
      clearPersistedAccessToken: authStorageModule.clearPersistedAccessToken,
      hasDesktopCallbackRequestInLocation: authStorageModule.hasDesktopCallbackRequestInLocation,
      loadPersistedAuthSession: authStorageModule.loadPersistedAuthSession,
      persistAuthSession: authStorageModule.persistAuthSession,
    };
  })();

  return depsPromise;
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

export function isExpectedUnauthorizedAutoLogin(error: unknown): boolean {
  const message = safeErrorMessage(error).toUpperCase();
  return message.includes('HTTP_401') || message.includes('UNAUTHORIZED');
}

export function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function snapshotAuthSession(deps: RuntimeBootstrapWebDeps): AuthSessionSnapshot {
  const auth = deps.useAppStore.getState().auth;
  return {
    status: String(auth.status || ''),
    user: auth.user && typeof auth.user === 'object'
      ? (auth.user as Record<string, unknown>)
      : null,
    token: String(auth.token || '').trim(),
    refreshToken: String(auth.refreshToken || '').trim(),
  };
}

function hasAuthenticatedSnapshot(snapshot: AuthSessionSnapshot): boolean {
  return snapshot.status === 'authenticated' && Boolean(snapshot.token);
}

function applyAuthSessionSnapshot(
  snapshot: AuthSessionSnapshot,
  deps: RuntimeBootstrapWebDeps,
): void {
  if (hasAuthenticatedSnapshot(snapshot)) {
    deps.dataSync.setToken(snapshot.token);
    deps.dataSync.setRefreshToken(snapshot.refreshToken);
    deps.useAppStore.getState().setAuthSession(
      snapshot.user,
      snapshot.token,
      snapshot.refreshToken || undefined,
    );
    return;
  }

  deps.dataSync.setToken('');
  deps.dataSync.setRefreshToken('');
  deps.useAppStore.getState().clearAuthSession();
}

async function recoverDesktopCallbackAccessToken(
  deps: RuntimeBootstrapWebDeps,
): Promise<{ accessToken: string; refreshToken: string }> {
  const result = await deps.dataSync.callApi(
    (realm) => realm.services.AuthService.refreshToken(),
    'Failed to restore web session for desktop authorization',
  );
  const record = result && typeof result === 'object'
    ? (result as Record<string, unknown>)
    : {};
  const accessToken = String(record.accessToken || '').trim();
  const refreshToken = String(record.refreshToken || '').trim();
  if (!accessToken) {
    throw new Error('desktop callback session refresh missing accessToken');
  }
  return {
    accessToken,
    refreshToken,
  };
}

async function bootstrapAuthSession(input: {
  flowId: string;
  accessToken: string;
  refreshToken?: string;
  preservePersistedAuthSession?: boolean;
  authSessionSnapshot: AuthSessionSnapshot;
}, deps: RuntimeBootstrapWebDeps): Promise<void> {
  const appStore = deps.useAppStore.getState();
  let resolvedToken = String(input.accessToken || '').trim();
  let resolvedRefreshToken = String(input.refreshToken || '').trim();

  if (!resolvedToken && input.preservePersistedAuthSession && hasAuthenticatedSnapshot(input.authSessionSnapshot)) {
    resolvedToken = input.authSessionSnapshot.token;
    resolvedRefreshToken = input.authSessionSnapshot.refreshToken;
  }

  if (!resolvedToken && input.preservePersistedAuthSession) {
    try {
      const refreshed = await recoverDesktopCallbackAccessToken(deps);
      resolvedToken = refreshed.accessToken;
      resolvedRefreshToken = refreshed.refreshToken;
    } catch (error) {
      deps.logRendererEvent({
        level: 'info',
        area: 'renderer-bootstrap',
        message: 'phase:auto-login:session-refresh-skipped',
        flowId: input.flowId,
        details: {
          error: safeErrorMessage(error),
        },
      });
    }
  }

  if (!resolvedToken) {
    if (!input.preservePersistedAuthSession) {
      deps.clearPersistedAccessToken();
      deps.dataSync.setToken('');
      deps.dataSync.setRefreshToken('');
      appStore.clearAuthSession();
    } else {
      applyAuthSessionSnapshot(input.authSessionSnapshot, deps);
    }
    deps.logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:auto-login:skipped',
      flowId: input.flowId,
      details: {
        reason: 'missing_access_token',
        preservePersistedAuthSession: Boolean(input.preservePersistedAuthSession),
      },
    });
    return;
  }

  deps.dataSync.setToken(resolvedToken);
  deps.dataSync.setRefreshToken(resolvedRefreshToken);

  try {
    const user = await deps.dataSync.loadCurrentUser();
    const normalizedUser = user && typeof user === 'object'
      ? (user as Record<string, unknown>)
      : null;
    appStore.setAuthSession(
      normalizedUser,
      resolvedToken,
      resolvedRefreshToken || undefined,
    );
    deps.persistAuthSession({
      accessToken: resolvedToken,
      refreshToken: resolvedRefreshToken,
      user: normalizedUser,
    });
    deps.logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:auto-login:done',
      flowId: input.flowId,
      details: {
        hasToken: true,
      },
    });
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    const expectedUnauthorized = isExpectedUnauthorizedAutoLogin(error);
    if (!input.preservePersistedAuthSession) {
      deps.clearPersistedAccessToken();
      appStore.clearAuthSession();
      deps.dataSync.setToken('');
      deps.dataSync.setRefreshToken('');
    } else {
      applyAuthSessionSnapshot(input.authSessionSnapshot, deps);
    }
    deps.logRendererEvent({
      level: expectedUnauthorized ? 'info' : 'warn',
      area: 'renderer-bootstrap',
      message: expectedUnauthorized
        ? 'phase:auto-login:skipped'
        : 'phase:auto-login:failed',
      flowId: input.flowId,
      details: {
        error: errorMessage,
        reason: expectedUnauthorized ? 'unauthorized' : 'error',
      },
    });
  }
}

export function bootstrapRuntime(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  let deps: RuntimeBootstrapWebDeps | null = null;
  let authSessionSnapshot: AuthSessionSnapshot | null = null;
  let preservePersistedAuthSession = false;
  bootstrapPromise = (async () => {
    deps = await loadRuntimeBootstrapWebDeps();
    const flowId = deps.createRendererFlowId('renderer-bootstrap-web');
    const startedAt = performance.now();
    const appStore = deps.useAppStore.getState();
    authSessionSnapshot = snapshotAuthSession(deps);
    preservePersistedAuthSession = deps.hasDesktopCallbackRequestInLocation();
    appStore.setAuthBootstrapping();
    appStore.setBootstrapReady(false);

    deps.logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:web-bootstrap:start',
      flowId,
    });

    const defaults = await deps.desktopBridge.getRuntimeDefaults();
    const envAccessToken = String(defaults.realm.accessToken || '').trim();
    deps.loadPersistedAuthSession();
    const accessToken = envAccessToken;
    const refreshToken = '';
    const proxyFetch = deps.createProxyFetch();
    deps.useAppStore.getState().setRuntimeDefaults(defaults);

    deps.dataSync.initApi({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken,
      refreshToken,
      fetchImpl: proxyFetch,
    });

    appStore.setLocalManifestSummaries([]);
    appStore.setRegisteredRuntimeModIds([]);
    appStore.setRuntimeModFailures([]);

    try {
      await withTimeout(
        bootstrapAuthSession({
          flowId,
          accessToken,
          refreshToken,
          preservePersistedAuthSession,
          authSessionSnapshot,
        }, deps),
        WEB_BOOTSTRAP_AUTH_TIMEOUT_MS,
        'web-bootstrap-auth',
      );
    } catch (error) {
      if (!preservePersistedAuthSession) {
        deps.clearPersistedAccessToken();
        deps.useAppStore.getState().clearAuthSession();
        deps.dataSync.setToken('');
        deps.dataSync.setRefreshToken('');
      } else {
        applyAuthSessionSnapshot(authSessionSnapshot, deps);
      }
      deps.logRendererEvent({
        level: 'warn',
        area: 'renderer-bootstrap',
        message: 'phase:auto-login:timeout',
        flowId,
        details: {
          error: safeErrorMessage(error),
          timeoutMs: WEB_BOOTSTRAP_AUTH_TIMEOUT_MS,
        },
      });
    }

    deps.useAppStore.getState().setBootstrapReady(true);
    deps.useAppStore.getState().setBootstrapError(null);
    deps.logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:web-bootstrap:done',
      flowId,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        runtimeModCount: 0,
        manifestCount: 0,
        runtimeModFailureCount: 0,
      },
    });
  })().catch((error) => {
    const message = safeErrorMessage(error);
    if (deps) {
      deps.useAppStore.getState().setBootstrapError(message);
      deps.useAppStore.getState().setBootstrapReady(false);
      if (!preservePersistedAuthSession) {
        deps.useAppStore.getState().clearAuthSession();
      } else if (authSessionSnapshot) {
        applyAuthSessionSnapshot(authSessionSnapshot, deps);
      }
      deps.logRendererEvent({
        level: 'error',
        area: 'renderer-bootstrap',
        message: 'phase:web-bootstrap:failed',
        details: {
          error: message,
        },
      });
    }
    throw error;
  });

  return bootstrapPromise;
}

export { bootstrapAuthSession as bootstrapAuthSessionForTest };
