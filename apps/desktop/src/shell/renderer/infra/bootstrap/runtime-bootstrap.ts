import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { isRealmOfflineErrorLike as isRealmOfflineError } from '@nimiplatform/sdk/types';
import { setRuntimeLogger } from '@nimiplatform/kit/telemetry';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { desktopBridge, toRendererLogMessage } from '@renderer/bridge';
import { productionQueryClient } from '@renderer/infra/query-client/production-query-client';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { productionAppStore } from '@renderer/app-shell/providers/production-app-store';
import { initializeBuiltInChatScopesFromProductControl } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';
import {
  DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
  checkRuntimeDaemonVersion,
  isRuntimeDaemonReachable,
  safeBootstrapErrorMessage,
  withBootstrapStepTimeout,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
import { reconcileLocalRuntimeBootstrapState } from './runtime-bootstrap-local-ai';
import { attachOfflineCoordinatorBindings } from './runtime-bootstrap-offline';
import {
  applyRuntimeAccountStatusProjection,
  applyRuntimeAccountUnavailableProjection,
  startAuthStateWatcher,
  stopAuthStateWatcher,
} from './auth-state-watcher';
import { registerExitHandler } from './exit-handler';
import { getDesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/macos-smoke';
import { pingDesktopMacosSmoke } from '@renderer/bridge/runtime-bridge/macos-smoke';
import { hydrateDesktopAccountProfile } from './runtime-bootstrap-account-profile';
import { DESKTOP_VERSION_FALLBACK } from './desktop-version';
import {
  bindDesktopConversationCapabilityRouteRuntime,
  clearDesktopConversationCapabilityRouteRuntime,
} from './runtime-bootstrap-conversation-route-runtime';
import {
  countPendingChatOutboxEntries,
  flushPendingChatOutbox,
} from '@renderer/features/chat/data/realm-human-chat-data';
import {
  runtimeDaemonUnavailable,
  syncDesktopRuntimeBootstrapConfig,
} from './runtime-bootstrap-config-sync';
import {
  clearDesktopNimiClientSession,
  configureDesktopRuntimeRealmSession,
  getDesktopRealm,
  isDesktopNimiClientSessionReady,
  type DesktopRuntimeTransport,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

let bootstrapPromise: Promise<void> | null = null;
let rebootstrapPromise: Promise<void> | null = null;
let offlineCoordinatorBindingsReady = false;
let pendingRebootstrap = false;
let unsubscribeRealmConnectivityEvents: (() => void) | null = null;

function suspendRuntimeCallbacksForL2(): void {
}

function bindOfflineCoordinator(): void {
  if (offlineCoordinatorBindingsReady) {
    return;
  }
  offlineCoordinatorBindingsReady = true;
  const coordinator = getOfflineCoordinator();
  const setOfflineTier = (tier: ReturnType<typeof coordinator.getTier>) => {
    productionAppStore.getState().setOfflineTier(tier);
  };
  attachOfflineCoordinatorBindings({
    coordinator,
    setOfflineTier,
    suspendRuntimeCallbacksForL2,
    probeRealmReachability: async () => {
      const authStatus = productionAppStore.getState().auth.status;
      if (authStatus !== 'authenticated' || !isDesktopNimiClientSessionReady()) {
        return false;
      }
      try {
        await getDesktopRealm().worldPublic.worldPublicControllerListWorlds({
          path: {},
          query: {},
        });
        return true;
      } catch (error) {
        // A permission, validation, rate-limit, or contract response proves the
        // Realm transport is reachable. Only the typed Realm transport failure
        // keeps L1 active.
        return !isRealmOfflineError(error);
      }
    },
    probeRuntimeReachability: async () => {
      const daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
      return isRuntimeDaemonReachable(daemonStatus, {
        appVersion: DESKTOP_VERSION_FALLBACK,
        logEvent: logRendererEvent,
      });
    },
    hasPendingRealmRecoveryWork: async () => (
      await countPendingChatOutboxEntries()
    ) > 0 || await realmSocialData.hasPendingOfflineRecoveryWork(),
    flushChatOutbox: async () => { await flushPendingChatOutbox(); },
    flushSocialOutbox: async () => realmSocialData.flushSocialOutbox(),
    invalidateRealmQueries: async () => {
      await Promise.all([
        productionQueryClient.invalidateQueries({ queryKey: ['chats'] }),
        productionQueryClient.invalidateQueries({ queryKey: ['contacts'] }),
        productionQueryClient.invalidateQueries({ queryKey: ['topbar-currency-balances'] }),
        productionQueryClient.invalidateQueries({ queryKey: ['topbar-notification-unread-count'] }),
        productionQueryClient.invalidateQueries({ queryKey: ['notification-unread-count'] }),
        productionQueryClient.invalidateQueries({ queryKey: ['notification-page'] }),
      ]);
    },
    rebootstrapRuntime: async () => {
      await rebootstrapRuntime();
    },
  });
}

function resolveDesktopRuntimeTransport(): DesktopRuntimeTransport {
  if (desktopBridge.hasTauriInvoke()) {
    return {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    };
  }
  if (desktopBridge.hasShellHostInvoke()) {
    return { type: 'electron-ipc' };
  }
  throw new Error('Desktop Runtime transport requires a standard shell host invoke.');
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
      await startBootstrapRuntime();
    }
  })().finally(() => {
    rebootstrapPromise = null;
  });
  return rebootstrapPromise;
}

async function teardownBootstrapState(): Promise<void> {
  stopAuthStateWatcher();
  unsubscribeRealmConnectivityEvents?.();
  unsubscribeRealmConnectivityEvents = null;
  clearDesktopConversationCapabilityRouteRuntime();
  clearDesktopNimiClientSession();
}

async function initializeBuiltInChatScopesAfterReadyAdmission(flowId: string): Promise<void> {
  const projection = await desktopBridge.getProductControlRecord();
  if (projection.state !== 'ready_for_use') {
    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:built-in-ai-config:init-skipped-product-not-ready',
      flowId,
      details: {
        productState: projection.state,
      },
    });
    return;
  }
  await initializeBuiltInChatScopesFromProductControl();
}

export function bootstrapRuntime(): Promise<void> {
  bindOfflineCoordinator();
  if (rebootstrapPromise) {
    return rebootstrapPromise;
  }
  return startBootstrapRuntime();
}

function startBootstrapRuntime(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const flowId = createRendererFlowId('renderer-bootstrap');
    const startedAt = performance.now();
    const flags = getShellFeatureFlags();
    const macosSmokeContext = await getDesktopMacosSmokeContext();
    const skipHeavyBootstrapForMacosSmoke = Boolean(macosSmokeContext.disableRuntimeBootstrap);
    const appStore = productionAppStore.getState();
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
        productionAppStore.getState().setDesktopReleaseInfo(releaseInfo);
        productionAppStore.getState().setDesktopReleaseError(null);
      } catch (error) {
        const message = safeBootstrapErrorMessage(error);
        productionAppStore.getState().setDesktopReleaseInfo(null);
        productionAppStore.getState().setDesktopReleaseError(message);
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
    productionAppStore.getState().setRuntimeDefaults(defaults);
    let daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
    let runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
    if (desktopBridge.hasTauriInvoke() && runtimeUnavailable) {
      try {
        daemonStatus = await desktopBridge.startRuntimeBridge();
        runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
        logRendererEvent({
          level: runtimeUnavailable ? 'warn' : 'info',
          area: 'renderer-bootstrap',
          message: runtimeUnavailable
            ? 'phase:runtime-bridge:start-unavailable'
            : 'phase:runtime-bridge:started',
          flowId,
          details: {
            running: daemonStatus.running,
            managed: daemonStatus.managed,
            grpcAddr: daemonStatus.grpcAddr,
            launchMode: daemonStatus.launchMode,
            lastError: daemonStatus.lastError || null,
          },
        });
      } catch (error) {
        daemonStatus = {
          ...daemonStatus,
          running: false,
          lastError: safeBootstrapErrorMessage(error),
        };
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:runtime-bridge:start-failed',
          flowId,
          details: {
            error: daemonStatus.lastError,
          },
        });
      }
    }
    const configSync = await syncDesktopRuntimeBootstrapConfig({
      daemonStatus,
      realmDefaults: defaults.realm,
      flowId,
      preserveLocalRuntimeStatePath: false,
    });
    daemonStatus = configSync.daemonStatus;
    runtimeUnavailable = configSync.runtimeUnavailable;
    const bootstrapRuntimeConfigWarning = configSync.bootstrapRuntimeConfigWarning;
    if (desktopBridge.hasTauriInvoke() && runtimeUnavailable) {
      try {
        daemonStatus = await desktopBridge.startRuntimeBridge();
        runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
        logRendererEvent({
          level: runtimeUnavailable ? 'warn' : 'info',
          area: 'renderer-bootstrap',
          message: runtimeUnavailable
            ? 'phase:runtime-bridge:start-unavailable'
            : 'phase:runtime-bridge:started',
          flowId,
          details: {
            running: daemonStatus.running,
            managed: daemonStatus.managed,
            grpcAddr: daemonStatus.grpcAddr,
            launchMode: daemonStatus.launchMode,
            lastError: daemonStatus.lastError || null,
          },
        });
      } catch (error) {
        runtimeUnavailable = true;
        daemonStatus = {
          ...daemonStatus,
          running: false,
          lastError: safeBootstrapErrorMessage(error),
        };
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:runtime-bridge:start-failed',
          flowId,
          details: {
            error: daemonStatus.lastError,
          },
        });
      }
    }
    const versionResult = checkRuntimeDaemonVersion(
      daemonStatus.version,
      releaseInfo?.desktopVersion || DESKTOP_VERSION_FALLBACK,
      {
        strictExactMatch: daemonStatus.launchMode === 'RELEASE' && !runtimeUnavailable,
        logEvent: logRendererEvent,
      },
    );
    if (!runtimeUnavailable && !versionResult.ok) {
      throw new Error(versionResult.message);
    }
    registerExitHandler({ managed: daemonStatus.managed });
    void pingDesktopMacosSmoke('bootstrap-platform-client-start', {
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});
    clearDesktopNimiClientSession();
    unsubscribeRealmConnectivityEvents?.();
    unsubscribeRealmConnectivityEvents = null;

    let accountStatus: Awaited<ReturnType<
      typeof desktopBridge.getRuntimeAccountSessionStatus
    >> | null = null;
    try {
      accountStatus = await desktopBridge.getRuntimeAccountSessionStatus();
    } catch (error) {
      logRendererEvent({
        level: 'warn',
        area: 'renderer-bootstrap',
        message: 'phase:protected-account-status:unavailable',
        flowId,
        details: {
          error: safeBootstrapErrorMessage(error),
        },
      });
    }
    const accountProjection = accountStatus?.accountProjection;
    if (accountStatus) {
      applyRuntimeAccountStatusProjection(accountStatus);
    } else {
      applyRuntimeAccountUnavailableProjection();
    }

    if (runtimeUnavailable) {
      clearDesktopConversationCapabilityRouteRuntime();
    } else {
      await configureDesktopRuntimeRealmSession({
        appId: 'nimi.desktop',
        runtimeTransport: resolveDesktopRuntimeTransport(),
      });
      bindDesktopConversationCapabilityRouteRuntime();
      await withBootstrapStepTimeout(
        'local runtime reconcile',
        reconcileLocalRuntimeBootstrapState({ flowId }),
        DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
      ).catch((error) => {
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:local-reconcile:deferred',
          flowId,
          details: {
            error: safeBootstrapErrorMessage(error),
          },
        });
        return {
          reconciled: [],
          adopted: [],
        };
      });
      if (accountStatus?.state === 'authenticated' && accountProjection?.accountId) {
        await withBootstrapStepTimeout(
          'account profile hydrate',
          hydrateDesktopAccountProfile({
            accountProjection,
            flowId,
          }),
          DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
        ).catch((error) => {
          logRendererEvent({
            level: 'warn',
            area: 'renderer-bootstrap',
            message: 'phase:account-profile:hydrate-deferred',
            flowId,
            details: {
              accountId: accountProjection.accountId,
              error: safeBootstrapErrorMessage(error),
            },
          });
        });
        await withBootstrapStepTimeout(
          'built-in chat AIConfig init',
          initializeBuiltInChatScopesAfterReadyAdmission(flowId),
          DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
        ).catch((error) => {
          logRendererEvent({
            level: 'warn',
            area: 'renderer-bootstrap',
            message: 'phase:built-in-ai-config:init-deferred',
            flowId,
            details: {
              accountId: accountProjection.accountId,
              error: safeBootstrapErrorMessage(error),
            },
          });
        });
      }
    }
    void pingDesktopMacosSmoke('bootstrap-platform-client-done', {
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});

    startAuthStateWatcher();

    if (!flags.enableRuntimeBootstrap || macosSmokeContext.disableRuntimeBootstrap) {
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

    getOfflineCoordinator().markRuntimeReachability(
      !runtimeUnavailable && accountStatus ? 'reachable' : 'unreachable',
    );

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
      productionAppStore.getState().setStatusBanner({
        kind: 'warning',
        message: bootstrapRuntimeConfigWarning,
      });
    }

    productionAppStore.getState().setBootstrapReady(true);
    productionAppStore.getState().setBootstrapError(null);
    void pingDesktopMacosSmoke('bootstrap-ready', {
      scenarioId: macosSmokeContext.scenarioId || null,
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});
    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap:done',
      flowId,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        localAiRuntimeBootstrap: flags.enableRuntimeBootstrap && !macosSmokeContext.disableRuntimeBootstrap,
      },
    });
  })().catch(async (error) => {
    // D-BOOT-008 + D-OFFLINE-001: Bootstrap failure → L2 degradation
    getOfflineCoordinator().markRuntimeReachability('unreachable');
    bootstrapPromise = null;
    let failure: unknown = error;
    try {
      await teardownBootstrapState();
    } catch (teardownError) {
      failure = new Error(
        `${safeBootstrapErrorMessage(error)}; bootstrap teardown failed: ${safeBootstrapErrorMessage(teardownError)}`,
      );
    }
    const message = safeBootstrapErrorMessage(failure);
    productionAppStore.getState().setBootstrapError(message);
    productionAppStore.getState().setBootstrapReady(false);
    applyRuntimeAccountUnavailableProjection();
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
