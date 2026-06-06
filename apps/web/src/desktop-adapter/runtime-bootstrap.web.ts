type DesktopBridgeFacade = (typeof import('./bridge.web'))['desktopBridge'];
type CreateProxyFetch = (typeof import('@desktop-public/infra'))['createProxyFetch'];
type CreateRendererFlowId = (typeof import('@desktop-public/infra'))['createRendererFlowId'];
type LogRendererEvent = (typeof import('@desktop-public/infra'))['logRendererEvent'];
type DesktopPublicWebBootstrapStore = (typeof import('@desktop-public/app-store'))['desktopPublicWebBootstrapStore'];
type ConfigureWebRealmPlatformClient = (typeof import('@desktop-public/realm'))['configureWebRealmPlatformClient'];
type CallRealmApi = (typeof import('@desktop-public/realm'))['callRealmApi'];
type ClearPersistedAccessToken = (typeof import('@nimiplatform/kit/auth'))['clearPersistedAccessToken'];
type PersistAuthSession = (typeof import('@nimiplatform/kit/auth'))['persistAuthSession'];

type RuntimeBootstrapWebDeps = {
  desktopBridge: DesktopBridgeFacade;
  createProxyFetch: CreateProxyFetch;
  createRendererFlowId: CreateRendererFlowId;
  logRendererEvent: LogRendererEvent;
  bootstrapStore: DesktopPublicWebBootstrapStore;
  configureWebRealmPlatformClient: ConfigureWebRealmPlatformClient;
  callRealmApi: CallRealmApi;
  clearPersistedAccessToken: ClearPersistedAccessToken;
  persistAuthSession: PersistAuthSession;
};

export const WEB_CLOUD_ADAPTER_AUTH_MODE = 'web-cloud-adapter' as const;

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
      bootstrapStoreModule,
      authStorageModule,
    ] = await Promise.all([
      import('@desktop-public/realm'),
      import('./bridge.web'),
      import('@desktop-public/infra'),
      import('@desktop-public/app-store'),
      import('@nimiplatform/kit/auth'),
    ]);

    return {
      desktopBridge: bridgeModule.desktopBridge,
      createProxyFetch: infraModule.createProxyFetch,
      createRendererFlowId: infraModule.createRendererFlowId,
      logRendererEvent: infraModule.logRendererEvent,
      bootstrapStore: bootstrapStoreModule.desktopPublicWebBootstrapStore,
      configureWebRealmPlatformClient: realmModule.configureWebRealmPlatformClient,
      callRealmApi: realmModule.callRealmApi,
      clearPersistedAccessToken: authStorageModule.clearPersistedAccessToken,
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

async function configureWebRealmSession(
  deps: RuntimeBootstrapWebDeps,
  accessToken: string,
  refreshToken?: string,
): Promise<void> {
  let defaults = deps.bootstrapStore.getRuntimeDefaults();
  if (!defaults?.realm?.realmBaseUrl) {
    defaults = await deps.desktopBridge.getRuntimeDefaults();
    deps.bootstrapStore.applyRuntimeDefaults(defaults);
  }
  await deps.configureWebRealmPlatformClient({
    appId: 'nimi.web',
    realmBaseUrl: defaults.realm.realmBaseUrl,
    accessToken,
    refreshToken,
    fetchImpl: deps.createProxyFetch(),
    getCurrentUser: () => deps.bootstrapStore.getCurrentUser(),
    setAuthSession: (user) => {
      deps.bootstrapStore.applyAuthSession(user);
    },
    clearAuthSession: () => {
      deps.bootstrapStore.applySignedOutAuthSession();
    },
  });
}

async function bootstrapAuthSession(input: {
  flowId: string;
  accessToken: string;
  refreshToken?: string;
}, deps: RuntimeBootstrapWebDeps): Promise<void> {
  const bootstrapStore = deps.bootstrapStore;
  let resolvedToken = String(input.accessToken || '').trim();
  let resolvedRefreshToken = String(input.refreshToken || '').trim();

  if (!resolvedToken) {
    deps.clearPersistedAccessToken();
    await configureWebRealmSession(deps, '', '');
    bootstrapStore.applySignedOutAuthSession();
    deps.logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:auto-login:skipped',
      flowId: input.flowId,
      details: {
        reason: 'missing_access_token',
      },
    });
    return;
  }

  await configureWebRealmSession(deps, resolvedToken, resolvedRefreshToken);

  try {
    const user = await deps.callRealmApi(
      (realm) => realm.me(),
      '获取当前用户失败',
    );
    const normalizedUser = user && typeof user === 'object'
      ? (user as unknown as Record<string, unknown>)
      : null;
    bootstrapStore.applyAuthSession(normalizedUser);
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
    deps.clearPersistedAccessToken();
    bootstrapStore.applySignedOutAuthSession();
    await configureWebRealmSession(deps, '', '');
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
  bootstrapPromise = (async () => {
    deps = await loadRuntimeBootstrapWebDeps();
    const flowId = deps.createRendererFlowId('renderer-bootstrap-web');
    const startedAt = performance.now();
    deps.bootstrapStore.beginBootstrap();

    deps.logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:web-bootstrap:start',
      flowId,
    });

    const defaults = await deps.desktopBridge.getRuntimeDefaults();
    const envAccessToken = String(defaults.realm.accessToken || '').trim();
    const accessToken = envAccessToken;
    const refreshToken = '';
    deps.bootstrapStore.applyRuntimeDefaults(defaults);
    await configureWebRealmSession(deps, accessToken, refreshToken);

    try {
      await withTimeout(
        bootstrapAuthSession({
          flowId,
          accessToken,
          refreshToken,
        }, deps),
        WEB_BOOTSTRAP_AUTH_TIMEOUT_MS,
        'web-bootstrap-auth',
      );
    } catch (error) {
      deps.clearPersistedAccessToken();
      deps.bootstrapStore.applySignedOutAuthSession();
      await configureWebRealmSession(deps, '', '');
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

    deps.bootstrapStore.completeBootstrap();
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
      deps.bootstrapStore.failBootstrap(message);
      deps.bootstrapStore.applySignedOutAuthSession();
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
