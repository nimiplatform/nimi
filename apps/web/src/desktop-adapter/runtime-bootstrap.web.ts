type DataSyncFacade = (typeof import('@runtime/data-sync'))['dataSync'];
type DesktopBridgeFacade = (typeof import('@renderer/bridge'))['desktopBridge'];
type CreateProxyFetch = (typeof import('@renderer/infra/bridge/proxy-fetch'))['createProxyFetch'];
type CreateRendererFlowId = (typeof import('@renderer/infra/telemetry/renderer-log'))['createRendererFlowId'];
type LogRendererEvent = (typeof import('@renderer/infra/telemetry/renderer-log'))['logRendererEvent'];
type UseAppStore = (typeof import('@renderer/app-shell/providers/app-store'))['useAppStore'];
type ClearPersistedAccessToken = (typeof import('@renderer/features/auth/auth-session-storage'))['clearPersistedAccessToken'];
type LoadPersistedAccessToken = (typeof import('@renderer/features/auth/auth-session-storage'))['loadPersistedAccessToken'];
type PersistAuthSession = (typeof import('@renderer/features/auth/auth-session-storage'))['persistAuthSession'];

type RuntimeBootstrapWebDeps = {
  dataSync: DataSyncFacade;
  desktopBridge: DesktopBridgeFacade;
  createProxyFetch: CreateProxyFetch;
  createRendererFlowId: CreateRendererFlowId;
  logRendererEvent: LogRendererEvent;
  useAppStore: UseAppStore;
  clearPersistedAccessToken: ClearPersistedAccessToken;
  loadPersistedAccessToken: LoadPersistedAccessToken;
  persistAuthSession: PersistAuthSession;
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
      proxyFetchModule,
      telemetryModule,
      appStoreModule,
      authStorageModule,
    ] = await Promise.all([
      import('@runtime/data-sync'),
      import('@renderer/bridge'),
      import('@renderer/infra/bridge/proxy-fetch'),
      import('@renderer/infra/telemetry/renderer-log'),
      import('@renderer/app-shell/providers/app-store'),
      import('@renderer/features/auth/auth-session-storage'),
    ]);

    return {
      dataSync: dataSyncModule.dataSync,
      desktopBridge: bridgeModule.desktopBridge,
      createProxyFetch: proxyFetchModule.createProxyFetch,
      createRendererFlowId: telemetryModule.createRendererFlowId,
      logRendererEvent: telemetryModule.logRendererEvent,
      useAppStore: appStoreModule.useAppStore,
      clearPersistedAccessToken: authStorageModule.clearPersistedAccessToken,
      loadPersistedAccessToken: authStorageModule.loadPersistedAccessToken,
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

async function bootstrapAuthSession(input: {
  flowId: string;
  accessToken: string;
}, deps: RuntimeBootstrapWebDeps): Promise<void> {
  const appStore = deps.useAppStore.getState();
  const envToken = String(input.accessToken || '').trim();
  if (!envToken) {
    deps.clearPersistedAccessToken();
    appStore.clearAuthSession();
    return;
  }

  try {
    const user = await deps.dataSync.loadCurrentUser();
    const normalizedUser = user && typeof user === 'object'
      ? (user as Record<string, unknown>)
      : null;
    appStore.setAuthSession(
      normalizedUser,
      envToken,
    );
    deps.persistAuthSession({
      accessToken: envToken,
      user: normalizedUser,
    });
    await Promise.allSettled([
      deps.dataSync.loadChats(),
      deps.dataSync.loadContacts(),
    ]);
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
    appStore.clearAuthSession();
    deps.dataSync.setToken('');
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
    const appStore = deps.useAppStore.getState();
    appStore.setAuthBootstrapping();
    appStore.setBootstrapReady(false);

    deps.logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:web-bootstrap:start',
      flowId,
    });

    const defaults = await deps.desktopBridge.getRuntimeDefaults();
    const fallbackToken = deps.loadPersistedAccessToken();
    const accessToken = fallbackToken || String(defaults.realm.accessToken || '').trim();
    const proxyFetch = deps.createProxyFetch();
    deps.useAppStore.getState().setRuntimeDefaults(defaults);

    deps.dataSync.initApi({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken,
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
        }, deps),
        WEB_BOOTSTRAP_AUTH_TIMEOUT_MS,
        'web-bootstrap-auth',
      );
    } catch (error) {
      deps.clearPersistedAccessToken();
      deps.useAppStore.getState().clearAuthSession();
      deps.dataSync.setToken('');
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
      deps.useAppStore.getState().clearAuthSession();
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
