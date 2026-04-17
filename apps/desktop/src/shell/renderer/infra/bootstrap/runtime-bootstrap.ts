import {
  dataSync,
  getCachedContacts,
  isFriendInContacts,
} from '@runtime/data-sync';
import {
  checkLocalLlmHealth,
  executeLocalKernelTurn,
} from '@runtime/llm-adapter';
import {
  createPlatformClient,
  unstable_attachPlatformWorldEvolutionSelectorReadProvider,
  withRealmContextLock,
} from '@nimiplatform/sdk';
import {
  getRuntimeHookRuntime,
  listRegisteredRuntimeModIds,
  clearInternalModSdkHost,
  resetRuntimeHostState,
  setRuntimeModSdkContextProvider,
  setRuntimeHttpContextProvider,
  setInternalModSdkHost,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { setRuntimeLogger } from '@runtime/telemetry/logger';
import { createDesktopWorldEvolutionSelectorReadAdapter } from '@runtime/world-evolution/selector-read-adapter';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { desktopBridge, toRendererLogMessage } from '@renderer/bridge';
import { createProxyFetch } from '@renderer/infra/bridge/proxy-fetch';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getOfflineCoordinator } from '@runtime/offline';
import {
  clearSharedDesktopSession,
  loadResolvedSharedDesktopBootstrapAuthSession,
  persistSharedDesktopSession,
} from '@renderer/features/auth/shared-auth-session';
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
import { syncRuntimeLocalModelsConfig } from './runtime-bootstrap-local-models-sync';
import { syncRuntimeJwtConfig } from './runtime-bootstrap-jwt-sync';
import { reconcileLocalRuntimeBootstrapState } from './runtime-bootstrap-local-ai';
import { attachOfflineCoordinatorBindings } from './runtime-bootstrap-offline';
import {
  startExternalAgentActionBridge,
  resyncExternalAgentActionDescriptors,
  stopExternalAgentActionBridge,
} from '@runtime/external-agent';
import { registerExternalAgentTier1Actions } from '@runtime/external-agent/tier1-actions';
import { startAuthStateWatcher, stopAuthStateWatcher } from './auth-state-watcher';
import { checkDaemonVersion } from './version-check';
import { registerExitHandler } from './exit-handler';
import { isRuntimeDaemonReachable } from './runtime-bootstrap-runtime-availability';
import { getDesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/macos-smoke';
import { pingDesktopMacosSmoke } from '@renderer/bridge/runtime-bridge/macos-smoke';

let bootstrapPromise: Promise<void> | null = null;
let rebootstrapPromise: Promise<void> | null = null;
let offlineCoordinatorBindingsReady = false;
let pendingRebootstrap = false;
const NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS = 5_000;

function createBootstrapStepTimeoutError(step: string, timeoutMs: number): Error {
  return new Error(`${step} timed out after ${timeoutMs}ms`);
}

async function withBootstrapStepTimeout<T>(
  step: string,
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createBootstrapStepTimeoutError(step, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function startNonCriticalBootstrapStep(input: {
  flowId: string;
  step: string;
  task: Promise<unknown>;
  timeoutMs?: number;
}): void {
  void withBootstrapStepTimeout(
    input.step,
    input.task,
    input.timeoutMs ?? NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
  ).catch((error) => {
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap:non-critical-step-deferred',
      flowId: input.flowId,
      details: {
        step: input.step,
        error: safeErrorMessage(error),
      },
    });
  });
}

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
    invalidateRealmQueries: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        queryClient.invalidateQueries({ queryKey: ['topbar-currency-balances'] }),
        queryClient.invalidateQueries({ queryKey: ['topbar-notification-unread-count'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-page'] }),
      ]);
    },
    rebootstrapRuntime: async () => {
      await rebootstrapRuntime();
    },
  });
}

export function rebootstrapRuntime(): Promise<void> {
  pendingRebootstrap = true;
  if (rebootstrapPromise) {
    return rebootstrapPromise;
  }
  rebootstrapPromise = (async () => {
    while (pendingRebootstrap) {
      pendingRebootstrap = false;
      const activeBootstrap = bootstrapPromise;
      if (activeBootstrap) {
        try {
          await activeBootstrap;
        } catch {
          // The failed bootstrap already emitted telemetry; restart from a clean slate below.
        }
      }
      await teardownBootstrapState();
      bootstrapPromise = null;
      await bootstrapRuntime();
    }
  })().finally(() => {
    rebootstrapPromise = null;
  });
  return rebootstrapPromise;
}

function runtimeDaemonUnavailable(status: { running: boolean; lastError?: string }): boolean {
  return !status.running && Boolean(String(status.lastError || '').trim());
}

async function teardownBootstrapState(): Promise<void> {
  stopAuthStateWatcher();
  stopExternalAgentActionBridge();
  resetRuntimeHostState();
  clearInternalModSdkHost();
}

export function bootstrapRuntime(): Promise<void> {
  bindOfflineCoordinator();
  if (rebootstrapPromise) {
    return rebootstrapPromise;
  }
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const flowId = createRendererFlowId('renderer-bootstrap');
    const startedAt = performance.now();
    const flags = getShellFeatureFlags();
    const macosSmokeContext = await getDesktopMacosSmokeContext();
    const skipHeavyBootstrapForMacosSmoke = Boolean(macosSmokeContext.disableRuntimeBootstrap);
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
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:desktop-release:read-failed',
          flowId,
          details: { error: message },
        });
      }
    }
    void pingDesktopMacosSmoke('bootstrap-runtime-defaults-ready', {
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});
    const defaults = await desktopBridge.getRuntimeDefaults();
    useAppStore.getState().setRuntimeDefaults(defaults);
    let daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
    const runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
    let bootstrapRuntimeConfigWarning: string | null = null;
    if (desktopBridge.hasTauriInvoke() && !runtimeUnavailable) {
      try {
        const runtimeStorageDirs = await desktopBridge.getRuntimeModStorageDirs();
        daemonStatus = await syncRuntimeLocalModelsConfig({
          daemonStatus,
          localModelsPath: runtimeStorageDirs.localModelsDir,
          bridge: {
            getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
            setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
            restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
          },
        });
        daemonStatus = await syncRuntimeJwtConfig({
          daemonStatus,
          realmDefaults: defaults.realm,
          bridge: {
            getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
            setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
            restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
          },
        });
      } catch (error) {
        bootstrapRuntimeConfigWarning = safeErrorMessage(error);
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:runtime-config-sync:degraded',
          flowId,
          details: {
            error: bootstrapRuntimeConfigWarning,
          },
        });
      }
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
    const resolvedBootstrapAuthSession = await loadResolvedSharedDesktopBootstrapAuthSession({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      envAccessToken: defaults.realm.accessToken,
    });
    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap-auth-session:resolved',
      flowId,
      details: {
        source: resolvedBootstrapAuthSession.source,
        resolution: resolvedBootstrapAuthSession.resolution,
        hasSession: Boolean(resolvedBootstrapAuthSession.session),
        hasAccessToken: Boolean(String(resolvedBootstrapAuthSession.session?.accessToken || '').trim()),
        hasRefreshToken: Boolean(String(resolvedBootstrapAuthSession.session?.refreshToken || '').trim()),
        shouldClearPersistedSession: resolvedBootstrapAuthSession.shouldClearPersistedSession,
      },
    });
    let bootstrapAccessToken = String(resolvedBootstrapAuthSession.session?.accessToken || '').trim();
    let bootstrapRefreshToken = String(resolvedBootstrapAuthSession.session?.refreshToken || '').trim();
    const clearPersistedDesktopSession = async () => {
      bootstrapAccessToken = '';
      bootstrapRefreshToken = '';
      await clearSharedDesktopSession();
    };

    const resolveCurrentAccessToken = () => {
      const store = useAppStore.getState();
      const authToken = String(store.auth.token || '').trim();
      if (authToken) {
        return authToken;
      }
      if (store.auth.status === 'bootstrapping') {
        return bootstrapAccessToken;
      }
      return '';
    };
    const resolveCurrentRefreshToken = () => {
      const storeRefreshToken = String(useAppStore.getState().auth.refreshToken || '').trim();
      if (storeRefreshToken) {
        return storeRefreshToken;
      }
      if (useAppStore.getState().auth.status === 'bootstrapping') {
        return bootstrapRefreshToken;
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
    const proxyFetch = createProxyFetch();
    void pingDesktopMacosSmoke('bootstrap-platform-client-start', {
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});
    const platformClient = await createPlatformClient({
      appId: 'nimi.desktop',
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken: bootstrapAccessToken,
      refreshTokenProvider: resolveCurrentRefreshToken,
      realmFetchImpl: proxyFetch,
      runtimeTransport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      sessionStore: {
        getAccessToken: resolveCurrentAccessToken,
        getRefreshToken: resolveCurrentRefreshToken,
        getSubjectUserId: resolveCurrentSubjectUserId,
        getCurrentUser: () => useAppStore.getState().auth.user,
        setAuthSession: (user, accessToken, refreshToken) => {
          bootstrapAccessToken = String(accessToken || '').trim();
          if (refreshToken !== undefined) {
            bootstrapRefreshToken = String(refreshToken || '').trim();
          }
          useAppStore.getState().setAuthSession(user, accessToken, refreshToken);
          void persistSharedDesktopSession({
            realmBaseUrl: defaults.realm.realmBaseUrl,
            accessToken,
            refreshToken,
            user: (user as Record<string, unknown> | null | undefined) ?? null,
          });
        },
        clearAuthSession: () => {
          bootstrapAccessToken = '';
          bootstrapRefreshToken = '';
          useAppStore.getState().clearAuthSession();
          void clearPersistedDesktopSession();
        },
      },
    });
    unstable_attachPlatformWorldEvolutionSelectorReadProvider(
      platformClient,
      createDesktopWorldEvolutionSelectorReadAdapter(),
    );
    await withBootstrapStepTimeout(
      'local runtime reconcile',
      reconcileLocalRuntimeBootstrapState({ flowId }),
      NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
    ).catch((error) => {
      logRendererEvent({
        level: 'warn',
        area: 'renderer-bootstrap',
        message: 'phase:local-reconcile:deferred',
        flowId,
        details: {
          error: safeErrorMessage(error),
        },
      });
      return {
        reconciled: [],
        adopted: [],
      };
    });
    void pingDesktopMacosSmoke('bootstrap-platform-client-done', {
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});

    dataSync.initApi({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken: bootstrapAccessToken,
      refreshToken: bootstrapRefreshToken,
      fetchImpl: proxyFetch,
    });

    dataSync.setAuthCallbacks({
      setAuth: (user, token, refreshToken) => {
        bootstrapAccessToken = String(token || '').trim();
        if (refreshToken !== undefined) {
          bootstrapRefreshToken = String(refreshToken || '').trim();
        }
        useAppStore.getState().setAuthSession(user ?? null, token, refreshToken);
        void persistSharedDesktopSession({
          realmBaseUrl: defaults.realm.realmBaseUrl,
          accessToken: token,
          refreshToken,
          user: user ?? null,
        });
      },
      clearAuth: () => {
        bootstrapAccessToken = '';
        bootstrapRefreshToken = '';
        useAppStore.getState().clearAuthSession();
        void clearPersistedDesktopSession();
      },
      getCurrentUser: () => {
        return useAppStore.getState().auth.user;
      },
      isFriend: (userId: string) => isFriendInContacts(getCachedContacts(), userId),
    });

    await bootstrapAuthSession({
      flowId,
      accessToken: bootstrapAccessToken,
      refreshToken: bootstrapRefreshToken,
      source: resolvedBootstrapAuthSession.source,
      resolution: resolvedBootstrapAuthSession.resolution,
      clearPersistedSession: clearPersistedDesktopSession,
      skipWarmLoads: skipHeavyBootstrapForMacosSmoke,
    });

    startAuthStateWatcher();

    let runtimeModFailures: RuntimeModRegisterFailure[] = [];
    let manifestCount = 0;

    if (flags.enableRuntimeBootstrap && !macosSmokeContext.disableRuntimeBootstrap) {
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
        ) => withRealmContextLock<T>(context, task),
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

      const runtimeModResult = await withBootstrapStepTimeout(
        'runtime mod bootstrap registration',
        registerBootstrapRuntimeMods({
          flowId,
        }),
        NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
      ).catch((error) => {
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:register-runtime-mods:deferred',
          flowId,
          details: {
            error: safeErrorMessage(error),
          },
        });
        appStore.setLocalManifestSummaries([]);
        appStore.setRegisteredRuntimeModIds([]);
        appStore.setRuntimeModFailures([]);
        return {
          runtimeModFailures: [] as RuntimeModRegisterFailure[],
          manifestCount: 0,
        };
      });
      runtimeModFailures = runtimeModResult.runtimeModFailures;
      manifestCount = runtimeModResult.manifestCount;
      registerExternalAgentTier1Actions(hookRuntime);
      startNonCriticalBootstrapStep({
        flowId,
        step: 'external agent action bridge startup',
        task: startExternalAgentActionBridge(),
      });
      startNonCriticalBootstrapStep({
        flowId,
        step: 'external agent descriptor resync',
        task: resyncExternalAgentActionDescriptors(),
      });
    } else {
      appStore.setLocalManifestSummaries([]);
      appStore.setRegisteredRuntimeModIds([]);
      appStore.setRuntimeModFailures([]);
      if (macosSmokeContext.disableRuntimeBootstrap) {
        logRendererEvent({
          level: 'info',
          area: 'renderer-bootstrap',
          message: 'phase:runtime-bootstrap:skipped-for-macos-smoke',
          flowId,
          details: {
            scenarioId: macosSmokeContext.scenarioId || null,
          },
        });
      }
    }

    getOfflineCoordinator().markRuntimeReachable(daemonStatus.running);

    if (runtimeUnavailable) {
      logRendererEvent({
        level: 'warn',
        area: 'renderer-bootstrap',
        message: 'phase:runtime-unavailable:strip-only',
        flowId,
        details: {
          error: daemonStatus.lastError || 'Runtime unavailable',
        },
      });
    }
    if (bootstrapRuntimeConfigWarning) {
      useAppStore.getState().setStatusBanner({
        kind: 'warning',
        message: bootstrapRuntimeConfigWarning,
      });
    }

    useAppStore.getState().setBootstrapReady(true);
    useAppStore.getState().setBootstrapError(null);
    void pingDesktopMacosSmoke('bootstrap-ready', {
      scenarioId: macosSmokeContext.scenarioId || null,
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});
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
  })().catch(async (error) => {
    // D-BOOT-008 + D-OFFLINE-001: Bootstrap failure → L2 degradation
    getOfflineCoordinator().markRuntimeReachable(false);
    bootstrapPromise = null;
    let failure: unknown = error;
    try {
      await teardownBootstrapState();
    } catch (teardownError) {
      failure = new Error(
        `${safeErrorMessage(error)}; bootstrap teardown failed: ${safeErrorMessage(teardownError)}`,
      );
    }
    const message = safeErrorMessage(failure);
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
    throw failure;
  });

  return bootstrapPromise;
}
