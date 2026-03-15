import { dataSync } from '@runtime/data-sync';
import {
  checkLocalLlmHealth,
  executeLocalKernelTurn,
} from '@runtime/llm-adapter';
import { withOpenApiContextLock } from '@runtime/context/openapi-context';
import {
  getRuntimeHookRuntime,
  listRegisteredRuntimeModIds,
  setRuntimeModSdkContextProvider,
  setRuntimeHttpContextProvider,
  setInternalModSdkHost,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { setRuntimeLogger } from '@runtime/telemetry/logger';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { desktopBridge, toRendererLogMessage } from '@renderer/bridge';
import { createProxyFetch } from '@renderer/infra/bridge/proxy-fetch';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { initializePlatformClient } from '@runtime/platform-client';
import { getOfflineCoordinator } from '@runtime/offline';
import { bootstrapAuthSession } from './runtime-bootstrap-auth';
import {
  ensureCoreWorldDataCapabilitiesRegistered,
  isCoreWorldDataCapability,
} from './runtime-bootstrap-data-capabilities';
import { registerBootstrapRuntimeMods } from './runtime-bootstrap-runtime-mods';
import {
  safeErrorMessage,
} from './runtime-bootstrap-utils';
import {
  buildRuntimeHostCapabilities,
} from './runtime-bootstrap-host-capabilities';
import { syncRuntimeJwtConfig } from './runtime-bootstrap-jwt-sync';
import { reconcileLocalRuntimeBootstrapState } from './runtime-bootstrap-local-ai';
import { attachOfflineCoordinatorBindings } from './runtime-bootstrap-offline';
import {
  startExternalAgentActionBridge,
  resyncExternalAgentActionDescriptors,
} from '@runtime/external-agent';
import { registerExternalAgentTier1Actions } from '@runtime/external-agent/tier1-actions';
import { startAuthStateWatcher } from './auth-state-watcher';
import { checkDaemonVersion } from './version-check';
import { registerExitHandler } from './exit-handler';
import { isRuntimeDaemonReachable } from './runtime-bootstrap-runtime-availability';
import { isFriendInContacts } from '@runtime/data-sync/flows/social-flow';
import { getCachedContacts } from '@runtime/data-sync/flows/profile-flow-social';

let bootstrapPromise: Promise<void> | null = null;
let offlineCoordinatorBindingsReady = false;

function suspendRuntimeCallbacksForL2(): void {
  const hookRuntime = getRuntimeHookRuntime();
  for (const modId of listRegisteredRuntimeModIds()) {
    try {
      hookRuntime.suspendMod(modId);
    } catch {
      // Ignore suspend failures; reconnect bootstrap will rebuild runtime state.
    }
  }
}

function bindOfflineCoordinator(): void {
  if (offlineCoordinatorBindingsReady) {
    return;
  }
  offlineCoordinatorBindingsReady = true;
  const coordinator = getOfflineCoordinator();
  attachOfflineCoordinatorBindings({
    coordinator,
    setOfflineTier: (tier) => useAppStore.getState().setOfflineTier(tier),
    suspendRuntimeCallbacksForL2,
    probeRealmReachability: async () => {
      const authStatus = useAppStore.getState().auth.status;
      if (authStatus !== 'authenticated') {
        return false;
      }
      await dataSync.loadCurrentUser();
      return true;
    },
    probeRuntimeReachability: async () => {
      const daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
      return isRuntimeDaemonReachable(daemonStatus);
    },
    hasPendingRealmRecoveryWork: async () => dataSync.hasPendingOfflineRecoveryWork(),
    flushChatOutbox: async () => dataSync.flushChatOutbox(),
    flushSocialOutbox: async () => dataSync.flushSocialOutbox(),
    invalidateQueries: async () => queryClient.invalidateQueries(),
    rebootstrapRuntime: async () => {
      await rebootstrapRuntime();
    },
  });
}

export function rebootstrapRuntime(): Promise<void> {
  bootstrapPromise = null;
  return bootstrapRuntime();
}

function runtimeDaemonUnavailable(status: { running: boolean; lastError?: string }): boolean {
  return !status.running && Boolean(String(status.lastError || '').trim());
}

export function bootstrapRuntime(): Promise<void> {
  bindOfflineCoordinator();
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const flowId = createRendererFlowId('renderer-bootstrap');
    const startedAt = performance.now();
    const flags = getShellFeatureFlags();
    const appStore = useAppStore.getState();
    appStore.setAuthBootstrapping();
    appStore.setBootstrapReady(false);

    setRuntimeLogger((payload) => {
      desktopBridge.logRendererEvent({
        level: payload.level,
        area: payload.area,
        message: toRendererLogMessage(payload.message),
        traceId: payload.traceId,
        flowId: payload.flowId,
        source: payload.source,
        costMs: payload.costMs,
        details: payload.details,
      });
    });

    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:runtime-defaults:start',
      flowId,
    });

    let releaseInfo: Awaited<ReturnType<typeof desktopBridge.getDesktopReleaseInfo>> | null = null;
    if (desktopBridge.hasTauriInvoke()) {
      try {
        releaseInfo = await desktopBridge.getDesktopReleaseInfo();
        useAppStore.getState().setDesktopReleaseInfo(releaseInfo);
        useAppStore.getState().setDesktopReleaseError(null);
      } catch (error) {
        const message = safeErrorMessage(error);
        useAppStore.getState().setDesktopReleaseInfo(null);
        useAppStore.getState().setDesktopReleaseError(message);
        useAppStore.getState().setStatusBanner({
          kind: 'warning',
          message,
        });
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:desktop-release:read-failed',
          flowId,
          details: { error: message },
        });
      }
    }
    const defaults = await desktopBridge.getRuntimeDefaults();
    let daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
    const runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
    if (desktopBridge.hasTauriInvoke() && !runtimeUnavailable) {
      daemonStatus = await syncRuntimeJwtConfig({
        daemonStatus,
        realmDefaults: defaults.realm,
        bridge: {
          getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
          setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
          restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
        },
      });
    }
    const versionResult = checkDaemonVersion(
      daemonStatus.version,
      releaseInfo?.desktopVersion,
      {
        strictExactMatch: daemonStatus.launchMode === 'RELEASE' && !runtimeUnavailable,
      },
    );
    if (!runtimeUnavailable && !versionResult.ok) {
      throw new Error(versionResult.message);
    }
    registerExitHandler({ managed: daemonStatus.managed });

    const resolveCurrentAccessToken = () => {
      const store = useAppStore.getState();
      const authToken = String(store.auth.token || '').trim();
      if (authToken) {
        return authToken;
      }

      // During initial auth bootstrapping we may still rely on env-provided token defaults.
      if (store.auth.status === 'bootstrapping') {
        const runtimeDefaultsAccessToken = String(store.runtimeDefaults?.realm?.accessToken || '').trim();
        return runtimeDefaultsAccessToken || defaults.realm.accessToken;
      }
      return '';
    };

    const resolveCurrentSubjectUserId = () => {
      const store = useAppStore.getState();
      const authUser = store.auth.user;
      if (!authUser || typeof authUser !== 'object' || Array.isArray(authUser)) {
        return '';
      }
      const user = authUser as Record<string, unknown>;
      const id = String(user.id || '').trim();
      if (id) {
        return id;
      }
      const userId = String(user.userId || '').trim();
      if (userId) {
        return userId;
      }
      return String(user.accountId || '').trim();
    };

    await initializePlatformClient({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken: defaults.realm.accessToken,
      accessTokenProvider: resolveCurrentAccessToken,
      subjectUserIdProvider: resolveCurrentSubjectUserId,
    });
    await reconcileLocalRuntimeBootstrapState({ flowId });
    const proxyFetch = createProxyFetch();
    useAppStore.getState().setRuntimeDefaults(defaults);

    dataSync.initApi({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken: defaults.realm.accessToken,
      fetchImpl: proxyFetch,
    });

    dataSync.setAuthCallbacks({
      setAuth: (user, token, refreshToken) => {
        useAppStore.getState().setAuthSession(user, token, refreshToken);
      },
      clearAuth: () => {
        useAppStore.getState().clearAuthSession();
      },
      getCurrentUser: () => {
        return useAppStore.getState().auth.user;
      },
      isFriend: (userId: string) => isFriendInContacts(getCachedContacts(), userId),
    });

    startAuthStateWatcher();

    let runtimeModFailures: RuntimeModRegisterFailure[] = [];
    let manifestCount = 0;

    if (flags.enableRuntimeBootstrap) {
      setRuntimeHttpContextProvider(() => {
        const store = useAppStore.getState();
        const runtimeDefaultsRealmBaseUrl = String(store.runtimeDefaults?.realm?.realmBaseUrl || '').trim();
        return {
          realmBaseUrl: runtimeDefaultsRealmBaseUrl || defaults.realm.realmBaseUrl,
          accessToken: resolveCurrentAccessToken(),
          fetchImpl: proxyFetch,
        };
      });

      const runtimeHostCapabilities = buildRuntimeHostCapabilities({
        checkLocalLlmHealth,
        executeLocalKernelTurn,
        withOpenApiContextLock: async <T>(
          context: { realmBaseUrl: string; accessToken?: string; fetchImpl?: typeof fetch },
          task: () => Promise<T>,
        ) => withOpenApiContextLock<T>(context, task),
        getRuntimeHookRuntime: () => getRuntimeHookRuntime(),
      });
      setInternalModSdkHost(runtimeHostCapabilities);
      setRuntimeModSdkContextProvider(() => ({
        runtimeHost: runtimeHostCapabilities.runtime,
        runtime: runtimeHostCapabilities.runtime.getRuntimeHookRuntime(),
      }));

      const hookRuntime = getRuntimeHookRuntime();
      hookRuntime.setMissingDataCapabilityResolver(async (capability) => {
        if (!isCoreWorldDataCapability(capability)) {
          return false;
        }
        await ensureCoreWorldDataCapabilitiesRegistered();
        return hookRuntime.listDataCapabilities().includes(capability);
      });
      await ensureCoreWorldDataCapabilitiesRegistered();

      const runtimeModResult = await registerBootstrapRuntimeMods({
        flowId,
      });
      runtimeModFailures = runtimeModResult.runtimeModFailures;
      manifestCount = runtimeModResult.manifestCount;
      registerExternalAgentTier1Actions(hookRuntime);
      await startExternalAgentActionBridge();
      await resyncExternalAgentActionDescriptors();
    } else {
      appStore.setLocalManifestSummaries([]);
      appStore.setRegisteredRuntimeModIds([]);
      appStore.setRuntimeModFailures([]);
    }

    await bootstrapAuthSession({
      flowId,
      accessToken: defaults.realm.accessToken,
    });

    getOfflineCoordinator().markRuntimeReachable(daemonStatus.running);

    if (runtimeUnavailable) {
      appStore.setStatusBanner({
        kind: 'warning',
        message: daemonStatus.lastError || 'Runtime unavailable',
      });
    }

    useAppStore.getState().setBootstrapReady(true);
    useAppStore.getState().setBootstrapError(null);
    logRendererEvent({
      level: runtimeModFailures.length > 0 ? 'warn' : 'info',
      area: 'renderer-bootstrap',
      message: runtimeModFailures.length > 0 ? 'phase:bootstrap:done-with-mod-failures' : 'phase:bootstrap:done',
      flowId,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        runtimeModCount: flags.enableRuntimeBootstrap ? listRegisteredRuntimeModIds().length : 0,
        manifestCount,
        runtimeModFailureCount: runtimeModFailures.length,
      },
    });
  })().catch((error) => {
    // D-BOOT-008 + D-OFFLINE-001: Bootstrap failure → L2 degradation
    getOfflineCoordinator().markRuntimeReachable(false);
    const message = safeErrorMessage(error);
    useAppStore.getState().setBootstrapError(message);
    useAppStore.getState().setBootstrapReady(false);
    useAppStore.getState().clearAuthSession();
    logRendererEvent({
      level: 'error',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap:failed',
      details: {
        error: message,
      },
    });
    throw error;
  });

  return bootstrapPromise;
}
