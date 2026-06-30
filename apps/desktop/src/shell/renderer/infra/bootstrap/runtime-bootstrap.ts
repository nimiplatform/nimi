import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { isRealmOfflineErrorLike as isRealmOfflineError } from '@nimiplatform/sdk/types';
import { setRuntimeLogger } from '@nimiplatform/kit/telemetry';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { desktopBridge, toRendererLogMessage } from '@renderer/bridge';
import { createProxyFetch } from '@renderer/infra/bridge/proxy-fetch';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { initializeBuiltInChatScopesFromProductControl } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';
import {
  DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
  checkRuntimeDaemonVersion,
  isRuntimeDaemonReachable,
  safeBootstrapErrorMessage,
  withBootstrapStepTimeout,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
import { createNimiDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/generated';
import { reconcileLocalRuntimeBootstrapState } from './runtime-bootstrap-local-ai';
import { attachOfflineCoordinatorBindings } from './runtime-bootstrap-offline';
import { startAuthStateWatcher, stopAuthStateWatcher } from './auth-state-watcher';
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
  configureDesktopRealmOnlySession,
  configureDesktopRuntimeRealmSession,
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
    useAppStore.getState().setOfflineTier(tier);
  };
  attachOfflineCoordinatorBindings({
    coordinator,
    setOfflineTier,
    suspendRuntimeCallbacksForL2,
    probeRealmReachability: async () => {
      const authStatus = useAppStore.getState().auth.status;
      if (authStatus !== 'authenticated') {
        return false;
      }
      await realmSocialData.loadCurrentUser();
      return true;
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

function createObservedRealmFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    try {
      const response = await fetchImpl(input, init);
      if (response.ok) {
        getOfflineCoordinator().markRealmRestReachable(true);
      }
      return response;
    } catch (error) {
      if (
        isRealmOfflineError(error)
        || error instanceof TypeError
        || (typeof DOMException !== 'undefined' && error instanceof DOMException)
      ) {
        getOfflineCoordinator().markRealmRestReachable(false);
      }
      throw error;
    }
  };
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
      await bootstrapRuntime();
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
        const message = safeBootstrapErrorMessage(error);
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
      preserveLocalRuntimeStatePath: macosSmokeContext.scenarioId === 'chat.live2d-avatar-product-smoke',
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
    const proxyFetch = createProxyFetch();
    const observedRealmFetch = createObservedRealmFetch(proxyFetch);
    void pingDesktopMacosSmoke('bootstrap-platform-client-start', {
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});
    clearDesktopNimiClientSession();
    unsubscribeRealmConnectivityEvents?.();
    unsubscribeRealmConnectivityEvents = null;
    if (runtimeUnavailable) {
      await configureDesktopRealmOnlySession({
        appId: 'nimi.desktop',
        realmBaseUrl: defaults.realm.realmBaseUrl,
        accessToken: defaults.realm.accessToken,
        fetchImpl: observedRealmFetch,
      });
      clearDesktopConversationCapabilityRouteRuntime();
      useAppStore.getState().clearAuthSession();
    } else {
      const desktopSession = await configureDesktopRuntimeRealmSession({
        appId: 'nimi.desktop',
        realmBaseUrl: defaults.realm.realmBaseUrl,
        realmFetchImpl: observedRealmFetch,
        runtimeTransport: resolveDesktopRuntimeTransport(),
      });
      bindDesktopConversationCapabilityRouteRuntime();
      const accountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId: 'nimi.desktop' });
      const accountStatus = await desktopSession.accountRuntime.account.getAccountSessionStatus({
        caller: accountCaller,
      });
      const accountProjection = accountStatus.accountProjection;
      let accountTokenAvailable = false;
      if (
        accountStatus.state === AccountSessionState.AUTHENTICATED
        && accountProjection?.accountId
      ) {
        const tokenStatus = await desktopSession.accountRuntime.account.getAccessToken({
          caller: accountCaller,
          requestedScopes: [],
        });
        accountTokenAvailable = Boolean(tokenStatus.accepted && tokenStatus.accessToken);
        if (!accountTokenAvailable) {
          logRendererEvent({
            level: 'warn',
            area: 'renderer-bootstrap',
            message: 'phase:runtime-account-token-unavailable',
            flowId,
            details: {
              accountReasonCode: tokenStatus.accountReasonCode || null,
              reasonCode: tokenStatus.reasonCode || null,
            },
          });
        }
      }
      if (accountProjection?.accountId && accountTokenAvailable) {
        useAppStore.getState().setAuthSession({
          id: accountProjection.accountId,
          displayName: accountProjection.displayName,
          realmEnvironmentId: accountProjection.realmEnvironmentId,
        });
      } else {
        useAppStore.getState().clearAuthSession();
      }
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
      if (accountProjection?.accountId) {
        if (accountTokenAvailable) {
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
        }
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
    getOfflineCoordinator().markRuntimeReachable(false);
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
