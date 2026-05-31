type DesktopBridgeFacade = (typeof import('@renderer/bridge'))['desktopBridge'];
type CreateProxyFetch = (typeof import('@desktop-public/infra'))['createProxyFetch'];
type CreateRendererFlowId = (typeof import('@desktop-public/infra'))['createRendererFlowId'];
type LogRendererEvent = (typeof import('@desktop-public/infra'))['logRendererEvent'];
type UseAppStore = (typeof import('@desktop-public/app-store'))['useAppStore'];
type ConfigureWebRealmPlatformClient = (typeof import('@desktop-public/realm'))['configureWebRealmPlatformClient'];
type CallRealmApi = (typeof import('@desktop-public/realm'))['callRealmApi'];
type ClearPersistedAccessToken = (typeof import('@nimiplatform/kit/auth'))['clearPersistedAccessToken'];
type LoadPersistedAuthSession = (typeof import('@nimiplatform/kit/auth'))['loadPersistedAuthSession'];
type PersistAuthSession = (typeof import('@nimiplatform/kit/auth'))['persistAuthSession'];

type RuntimeBootstrapWebDeps = {
  desktopBridge: DesktopBridgeFacade;
  createProxyFetch: CreateProxyFetch;
  createRendererFlowId: CreateRendererFlowId;
  logRendererEvent: LogRendererEvent;
  useAppStore: UseAppStore;
  configureWebRealmPlatformClient: ConfigureWebRealmPlatformClient;
  callRealmApi: CallRealmApi;
  clearPersistedAccessToken: ClearPersistedAccessToken;
  loadPersistedAuthSession: LoadPersistedAuthSession;
  persistAuthSession: PersistAuthSession;
};

export const WEB_CLOUD_ADAPTER_AUTH_MODE = 'web-cloud-adapter' as const;

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
      realmModule,
      bridgeModule,
      infraModule,
      appStoreModule,
      authStorageModule,
    ] = await Promise.all([
      import('@desktop-public/realm'),
      import('@renderer/bridge'),
      import('@desktop-public/infra'),
      import('@desktop-public/app-store'),
      import('@nimiplatform/kit/auth'),
    ]);

    return {
      desktopBridge: bridgeModule.desktopBridge,
      createProxyFetch: infraModule.createProxyFetch,
      createRendererFlowId: infraModule.createRendererFlowId,
      logRendererEvent: infraModule.logRendererEvent,
      useAppStore: appStoreModule.useAppStore,
      configureWebRealmPlatformClient: realmModule.configureWebRealmPlatformClient,
      callRealmApi: realmModule.callRealmApi,
      clearPersistedAccessToken: authStorageModule.clearPersistedAccessToken,
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

async function configureWebRealmSession(
  deps: RuntimeBootstrapWebDeps,
  accessToken: string,
  refreshToken?: string,
): Promise<void> {
  let defaults = deps.useAppStore.getState().runtimeDefaults;
  if (!defaults?.realm?.realmBaseUrl) {
    defaults = await deps.desktopBridge.getRuntimeDefaults();
    deps.useAppStore.getState().setRuntimeDefaults(defaults);
  }
  await deps.configureWebRealmPlatformClient({
    appId: 'nimi.web',
    realmBaseUrl: defaults.realm.realmBaseUrl,
    accessToken,
    refreshToken,
    fetchImpl: deps.createProxyFetch(),
    getCurrentUser: () => deps.useAppStore.getState().auth.user,
    setAuthSession: (user, nextAccessToken, nextRefreshToken) => {
      deps.useAppStore.getState().setAuthSession(user, nextAccessToken, nextRefreshToken);
    },
    clearAuthSession: () => {
      deps.useAppStore.getState().clearAuthSession();
    },
  });
}

async function applyAuthSessionSnapshot(
  snapshot: AuthSessionSnapshot,
  deps: RuntimeBootstrapWebDeps,
): Promise<void> {
  if (hasAuthenticatedSnapshot(snapshot)) {
    await configureWebRealmSession(deps, snapshot.token, snapshot.refreshToken);
    deps.useAppStore.getState().setAuthSession(
      snapshot.user,
      snapshot.token,
      snapshot.refreshToken || undefined,
    );
    return;
  }

  await configureWebRealmSession(deps, '', '');
  deps.useAppStore.getState().clearAuthSession();
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

  if (!resolvedToken) {
    if (!input.preservePersistedAuthSession) {
      deps.clearPersistedAccessToken();
      await configureWebRealmSession(deps, '', '');
      appStore.clearAuthSession();
    } else {
      await applyAuthSessionSnapshot(input.authSessionSnapshot, deps);
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

  await configureWebRealmSession(deps, resolvedToken, resolvedRefreshToken);

  try {
    const user = await deps.callRealmApi(
      (realm) => realm.services.MeService.getMe(),
      '获取当前用户失败',
    );
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
      await configureWebRealmSession(deps, '', '');
    } else {
      await applyAuthSessionSnapshot(input.authSessionSnapshot, deps);
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
  // Wave C: legacy desktop_callback URL preservation flow is gone — direct-
  // to-loopback routes the user agent through the realm OAuth authorize
  // endpoint, which never lands a `?desktop_callback=` URL on apps/web.
  const preservePersistedAuthSession = false;
  bootstrapPromise = (async () => {
    deps = await loadRuntimeBootstrapWebDeps();
    const flowId = deps.createRendererFlowId('renderer-bootstrap-web');
    const startedAt = performance.now();
    const appStore = deps.useAppStore.getState();
    authSessionSnapshot = snapshotAuthSession(deps);
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
    deps.useAppStore.getState().setRuntimeDefaults(defaults);
    await configureWebRealmSession(deps, accessToken, refreshToken);

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
        await configureWebRealmSession(deps, '', '');
      } else {
        await applyAuthSessionSnapshot(authSessionSnapshot, deps);
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
    });
  })().catch(async (error) => {
    const message = safeErrorMessage(error);
    if (deps) {
      deps.useAppStore.getState().setBootstrapError(message);
      deps.useAppStore.getState().setBootstrapReady(false);
      if (!preservePersistedAuthSession) {
        deps.useAppStore.getState().clearAuthSession();
      } else if (authSessionSnapshot) {
        await applyAuthSessionSnapshot(authSessionSnapshot, deps);
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
