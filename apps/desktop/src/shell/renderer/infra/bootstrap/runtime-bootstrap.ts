import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import {
  clearPlatformClient,
  createLocalFirstPartyRuntimePlatformClient,
  unstable_attachPlatformWorldEvolutionSelectorReadProvider,
} from '@nimiplatform/sdk';
import { setRuntimeLogger } from '@runtime/telemetry/logger';
import { createDesktopWorldEvolutionSelectorReadAdapter } from '@runtime/world-evolution/selector-read-adapter';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { desktopBridge, toRendererLogMessage } from '@renderer/bridge';
import { createProxyFetch } from '@renderer/infra/bridge/proxy-fetch';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { initializeBuiltInChatScopesFromProductControl } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { getOfflineCoordinator } from '@renderer/infra/offline';
import { safeErrorMessage } from './runtime-bootstrap-utils';
import { syncRuntimeStorageConfig } from './runtime-bootstrap-local-models-sync';
import { syncRuntimeJwtConfig } from './runtime-bootstrap-jwt-sync';
import { syncRuntimeDeveloperRegistrationConfig } from './runtime-bootstrap-developer-registration-sync';
import { isDeveloperModeEnabled } from '@renderer/features/developer/developer-mode';
import { isRuntimeConfigManualRestartRequiredError } from './runtime-bootstrap-config-errors';
import { reconcileLocalRuntimeBootstrapState } from './runtime-bootstrap-local-ai';
import { attachOfflineCoordinatorBindings } from './runtime-bootstrap-offline';
import { startAuthStateWatcher, stopAuthStateWatcher } from './auth-state-watcher';
import { checkDaemonVersion } from './version-check';
import { registerExitHandler } from './exit-handler';
import { isRuntimeDaemonReachable } from './runtime-bootstrap-runtime-availability';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/browser';
import { getDesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/macos-smoke';
import { pingDesktopMacosSmoke } from '@renderer/bridge/runtime-bridge/macos-smoke';
import { hydrateDesktopAccountProfile } from './runtime-bootstrap-account-profile';
import { NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS, withBootstrapStepTimeout } from './runtime-bootstrap-step-timeout';
import {
  bindDesktopConversationCapabilityRouteRuntime,
  clearDesktopConversationCapabilityRouteRuntime,
} from './runtime-bootstrap-conversation-route-runtime';
import {
  countPendingChatOutboxEntries,
  flushPendingChatOutbox,
} from '@renderer/features/chat/data/realm-human-chat-data';

let bootstrapPromise: Promise<void> | null = null;
let rebootstrapPromise: Promise<void> | null = null;
let offlineCoordinatorBindingsReady = false;
let pendingRebootstrap = false;

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
      return isRuntimeDaemonReachable(daemonStatus);
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
  return !status.running;
}

async function shouldDegradeRuntimeConfigManualRestartForProductSetup(flowId: string): Promise<boolean> {
  if (!desktopBridge.hasTauriInvoke()) {
    return false;
  }
  try {
    const projection = await desktopBridge.getProductControlRecord();
    return projection.state !== 'ready_for_use';
  } catch (error) {
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:product-control:read-for-config-restart-gate-failed',
      flowId,
      details: {
        error: safeErrorMessage(error),
      },
    });
    return false;
  }
}

function isFirstRunDataRootSelectionPendingMessage(message: string): boolean {
  return message.includes('selected nimi_data is not ready')
    || message.includes('first-run data-root selection has not initialized product control')
    || message.includes('has no selected absolute dataRoot.path');
}

async function shouldSkipRuntimeStorageConfigWarningForFirstRun(input: {
  errorMessage: string;
  flowId: string;
  step: string;
}): Promise<boolean> {
  if (
    input.step !== 'runtime local storage config sync'
    || !desktopBridge.hasTauriInvoke()
    || !isFirstRunDataRootSelectionPendingMessage(input.errorMessage)
  ) {
    return false;
  }
  try {
    const projection = await desktopBridge.getProductControlRecord();
    const pendingFirstRunDataRoot =
      projection.state === 'config_missing' || projection.state === 'data_root_missing';
    if (pendingFirstRunDataRoot) {
      logRendererEvent({
        level: 'info',
        area: 'renderer-bootstrap',
        message: 'phase:runtime-config-sync:skipped-first-run-data-root',
        flowId: input.flowId,
        details: {
          step: input.step,
          productControlState: projection.state,
        },
      });
    }
    return pendingFirstRunDataRoot;
  } catch (error) {
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:product-control:read-for-storage-sync-skip-failed',
      flowId: input.flowId,
      details: {
        error: safeErrorMessage(error),
      },
    });
    return false;
  }
}

async function handleRuntimeConfigSyncError(input: {
  error: unknown;
  flowId: string;
  step: string;
}): Promise<string | null> {
  const message = safeErrorMessage(input.error);
  if (isRuntimeConfigManualRestartRequiredError(input.error)) {
    const degradeForProductSetup = await shouldDegradeRuntimeConfigManualRestartForProductSetup(input.flowId);
    if (!degradeForProductSetup) {
      throw input.error;
    }
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:runtime-config-sync:degraded',
      flowId: input.flowId,
      details: {
        error: message,
        step: input.step,
        productStateReady: false,
      },
    });
    return message;
  }
  if (await shouldSkipRuntimeStorageConfigWarningForFirstRun({
    errorMessage: message,
    flowId: input.flowId,
    step: input.step,
  })) {
    return null;
  }
  logRendererEvent({
    level: 'warn',
    area: 'renderer-bootstrap',
    message: 'phase:runtime-config-sync:degraded',
    flowId: input.flowId,
    details: {
      error: message,
      step: input.step,
    },
  });
  return message;
}

async function teardownBootstrapState(): Promise<void> {
  stopAuthStateWatcher();
  clearDesktopConversationCapabilityRouteRuntime();
  clearPlatformClient();
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
    let runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
    let bootstrapRuntimeConfigWarning: string | null = null;
    if (desktopBridge.hasTauriInvoke()) {
      try {
        daemonStatus = await syncRuntimeJwtConfig({
          daemonStatus,
          realmDefaults: defaults.realm,
          bridge: {
            getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
            setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
            restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
          },
        });
        runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
      } catch (error) {
        const warning = await handleRuntimeConfigSyncError({
          error,
          flowId,
          step: 'runtime account auth config sync',
        });
        if (warning) bootstrapRuntimeConfigWarning = bootstrapRuntimeConfigWarning ?? warning;
      }
      try {
        const preserveMacosSmokeRuntimeStatePath =
          macosSmokeContext.scenarioId === 'chat.live2d-avatar-product-smoke';
        // On a fresh install the user has not yet selected nimi_data, so
        // `getDesktopStorageDirs` fails closed here; the first-run Storage
        // phase re-runs `syncRuntimeStorageConfig` after `selectProductDataRoot`
        // so the runtime config carries the data root before materialization.
        daemonStatus = await syncRuntimeStorageConfig({
          daemonStatus,
          preserveLocalRuntimeStatePath: preserveMacosSmokeRuntimeStatePath,
          bridge: {
            getRuntimeBridgeStatus: () => desktopBridge.getRuntimeBridgeStatus(),
            getDesktopStorageDirs: () => desktopBridge.getDesktopStorageDirs(),
            getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
            setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
            restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
          },
        });
        runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
      } catch (error) {
        const warning = await handleRuntimeConfigSyncError({
          error,
          flowId,
          step: 'runtime local storage config sync',
        });
        if (warning) bootstrapRuntimeConfigWarning = bootstrapRuntimeConfigWarning ?? warning;
      }
      try {
        // Local app testing (K-AUTHSVC-014): mirror the discoverable Developer
        // Mode switch (D-DEV-002) into the runtime developer-registration gate.
        daemonStatus = await syncRuntimeDeveloperRegistrationConfig({
          daemonStatus,
          enabled: isDeveloperModeEnabled(),
          bridge: {
            getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
            setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
            restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
          },
        });
        runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
      } catch (error) {
        const warning = await handleRuntimeConfigSyncError({
          error,
          flowId,
          step: 'runtime developer-registration config sync',
        });
        if (warning) bootstrapRuntimeConfigWarning = bootstrapRuntimeConfigWarning ?? warning;
      }
    }
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
          lastError: safeErrorMessage(error),
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
    const proxyFetch = createProxyFetch();
    void pingDesktopMacosSmoke('bootstrap-platform-client-start', {
      skipHeavyBootstrapForMacosSmoke,
    }).catch(() => {});
    clearPlatformClient();
    const platformClient = await createLocalFirstPartyRuntimePlatformClient({
      appId: 'nimi.desktop',
      realmBaseUrl: defaults.realm.realmBaseUrl,
      realmFetchImpl: proxyFetch,
      runtimeTransport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });
    bindDesktopConversationCapabilityRouteRuntime();
    const accountCaller = {
      appId: 'nimi.desktop',
      appInstanceId: 'nimi.desktop.local-first-party',
      deviceId: 'desktop-shell',
      mode: 2,
      scopes: [],
    };
    const accountStatus = await platformClient.runtime.account.getAccountSessionStatus({
      caller: accountCaller,
    });
    const accountProjection = accountStatus.accountProjection;
    let accountTokenAvailable = false;
    if (
      accountStatus.state === AccountSessionState.AUTHENTICATED
      && accountProjection?.accountId
    ) {
      const tokenStatus = await platformClient.runtime.account.getAccessToken({
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
      }, '', '');
    } else {
      useAppStore.getState().clearAuthSession();
    }
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

    if (accountProjection?.accountId) {
      if (accountTokenAvailable) {
        await withBootstrapStepTimeout(
          'account profile hydrate',
          hydrateDesktopAccountProfile({
            accountProjection,
            flowId,
          }),
          NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
        ).catch((error) => {
          logRendererEvent({
            level: 'warn',
            area: 'renderer-bootstrap',
            message: 'phase:account-profile:hydrate-deferred',
            flowId,
            details: {
              accountId: accountProjection.accountId,
              error: safeErrorMessage(error),
            },
          });
        });
      }
      await withBootstrapStepTimeout(
        'built-in chat AIConfig init',
        initializeBuiltInChatScopesAfterReadyAdmission(flowId),
        NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
      ).catch((error) => {
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:built-in-ai-config:init-deferred',
          flowId,
          details: {
            accountId: accountProjection.accountId,
            error: safeErrorMessage(error),
          },
        });
      });
    }

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
