type DesktopBridgeFacade = (typeof import('./bridge.web'))['desktopBridge'];
type CreateRendererFlowId = (typeof import('@desktop-public/infra'))['createRendererFlowId'];
type LogRendererEvent = (typeof import('@desktop-public/infra'))['logRendererEvent'];
type DesktopPublicWebBootstrapStore = (typeof import('@desktop-public/app-store'))['desktopPublicWebBootstrapStore'];
type ConfigureWebRealmPlatformClient = (typeof import('./web-realm-session'))['configureWebRealmPlatformClient'];
type ClearWebRealmPlatformClient = (typeof import('./web-realm-session'))['clearWebRealmPlatformClient'];
type ClearPersistedAccessToken = (typeof import('@nimiplatform/kit/auth'))['clearPersistedAccessToken'];
type DesktopRendererLifecyclePort = import('@renderer/renderer/lifecycle-port').DesktopRendererLifecyclePort;

type RuntimeBootstrapWebDeps = {
  desktopBridge: DesktopBridgeFacade;
  createWebRealmFetch: (typeof import('./web-realm-fetch'))['createWebRealmFetch'];
  createRendererFlowId: CreateRendererFlowId;
  logRendererEvent: LogRendererEvent;
  bootstrapStore: DesktopPublicWebBootstrapStore;
  configureWebRealmPlatformClient: ConfigureWebRealmPlatformClient;
  clearWebRealmPlatformClient: ClearWebRealmPlatformClient;
  clearPersistedAccessToken: ClearPersistedAccessToken;
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
      webRealmSessionModule,
      webRealmFetchModule,
      bridgeModule,
      infraModule,
      bootstrapStoreModule,
      authStorageModule,
    ] = await Promise.all([
      import('./web-realm-session'),
      import('./web-realm-fetch'),
      import('./bridge.web'),
      import('@desktop-public/infra'),
      import('@desktop-public/app-store'),
      import('@nimiplatform/kit/auth'),
    ]);

    return {
      desktopBridge: bridgeModule.desktopBridge,
      createWebRealmFetch: webRealmFetchModule.createWebRealmFetch,
      createRendererFlowId: infraModule.createRendererFlowId,
      logRendererEvent: infraModule.logRendererEvent,
      bootstrapStore: bootstrapStoreModule.desktopPublicWebBootstrapStore,
      configureWebRealmPlatformClient: webRealmSessionModule.configureWebRealmPlatformClient,
      clearWebRealmPlatformClient: webRealmSessionModule.clearWebRealmPlatformClient,
      clearPersistedAccessToken: authStorageModule.clearPersistedAccessToken,
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
  lifecycle?: DesktopRendererLifecyclePort,
): Promise<void> {
  let defaults = deps.bootstrapStore.getRuntimeDefaults();
  if (!defaults?.realm?.realmBaseUrl) {
    defaults = await deps.desktopBridge.getRuntimeDefaults();
    deps.bootstrapStore.applyRuntimeDefaults(defaults);
  }
  await deps.configureWebRealmPlatformClient({
    appId: 'nimi.web',
    realmBaseUrl: defaults.realm.realmBaseUrl,
    fetchImpl: deps.createWebRealmFetch(),
    getCurrentUser: () => deps.bootstrapStore.getCurrentUser(),
    setAuthSession: (user) => {
      deps.bootstrapStore.applyAuthSession(user);
      lifecycle?.setAuthSession(user);
    },
    clearAuthSession: () => {
      deps.bootstrapStore.applySignedOutAuthSession();
      lifecycle?.clearAuthSession();
    },
  });
}

async function bootstrapAuthSession(input: {
  flowId: string;
}, deps: RuntimeBootstrapWebDeps, lifecycle?: DesktopRendererLifecyclePort): Promise<void> {
  const bootstrapStore = deps.bootstrapStore;
  deps.clearPersistedAccessToken();
  await configureWebRealmSession(deps, lifecycle);
  bootstrapStore.applySignedOutAuthSession();
  lifecycle?.clearAuthSession();
  deps.logRendererEvent({
    level: 'info',
    area: 'renderer-bootstrap',
    message: 'phase:auto-login:skipped',
    flowId: input.flowId,
    details: {
      reason: 'runtime-custody-required',
    },
  });
}

export function bootstrapRuntime(lifecycle?: DesktopRendererLifecyclePort): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  let deps: RuntimeBootstrapWebDeps | null = null;
  bootstrapPromise = (async () => {
    deps = await loadRuntimeBootstrapWebDeps();
    const flowId = deps.createRendererFlowId('renderer-bootstrap-web');
    const startedAt = performance.now();
    deps.bootstrapStore.beginBootstrap();
    lifecycle?.setAuthBootstrapping();
    lifecycle?.setBootstrapReady(false);

    deps.logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:web-bootstrap:start',
      flowId,
    });

    const defaults = await deps.desktopBridge.getRuntimeDefaults();
    deps.bootstrapStore.applyRuntimeDefaults(defaults);
    lifecycle?.setRuntimeDefaults(defaults);

    try {
      await withTimeout(
        bootstrapAuthSession({
          flowId,
        }, deps, lifecycle),
        WEB_BOOTSTRAP_AUTH_TIMEOUT_MS,
        'web-bootstrap-auth',
      );
    } catch (error) {
      deps.clearPersistedAccessToken();
      deps.bootstrapStore.applySignedOutAuthSession();
      lifecycle?.clearAuthSession();
      await configureWebRealmSession(deps, lifecycle);
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
    lifecycle?.setBootstrapError(null);
    lifecycle?.setBootstrapReady(true);
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
      lifecycle?.setBootstrapError(message);
      lifecycle?.setBootstrapReady(false);
      lifecycle?.clearAuthSession();
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

export async function rebootstrapRuntime(lifecycle?: DesktopRendererLifecyclePort): Promise<void> {
  await disposeRuntimeBootstrap();
  return bootstrapRuntime(lifecycle);
}

export async function disposeRuntimeBootstrap(): Promise<void> {
  const activeBootstrap = bootstrapPromise;
  if (activeBootstrap) {
    await activeBootstrap.catch(() => undefined);
  }
  if (depsPromise) {
    const deps = await depsPromise.catch(() => null);
    deps?.clearWebRealmPlatformClient();
  }
  bootstrapPromise = null;
}
