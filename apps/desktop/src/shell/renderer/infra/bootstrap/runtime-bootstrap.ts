import { isRealmOfflineErrorLike as isRealmOfflineError } from '@nimiplatform/sdk/types';
import { AccountReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import { setRuntimeLogger } from '@nimiplatform/kit/telemetry';
import { desktopBridge, toRendererLogMessage } from '../../bridge';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { getOfflineCoordinator } from '../offline/coordinator';
import {
  DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
  checkRuntimeDaemonVersion,
  isRuntimeDaemonReachable,
  safeBootstrapErrorMessage,
  withBootstrapStepTimeout,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
import { attachOfflineCoordinatorBindings } from './runtime-bootstrap-offline';
import {
  applyRuntimeAccountUnavailableProjection,
  startAuthStateWatcher,
  stopAuthStateWatcher,
} from './auth-state-watcher';
import { DESKTOP_VERSION_FALLBACK } from './desktop-version';
import {
  clearDesktopNimiClientSession,
  configureDesktopRuntimeRealmSession,
  getDesktopRealm,
  isDesktopNimiClientSessionReady,
  type DesktopRuntimeTransport,
} from '../sdk/desktop-nimi-client-session';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port.js';
import { retrySourceRuntimeTransport } from '../../../shared/source-runtime-retry';
import { RUNTIME_STORED_DATA_UNSUPPORTED } from '../../../shared/runtime-maintenance';


let bootstrapPromise: Promise<void> | null = null;
let rebootstrapPromise: Promise<void> | null = null;
let offlineCoordinatorBinding: { lifecycle: DesktopRendererLifecyclePort; unsubscribe: () => void } | null = null;
let pendingRebootstrap = false;

function bindOfflineCoordinator(lifecycle: DesktopRendererLifecyclePort): void {
  if (offlineCoordinatorBinding?.lifecycle === lifecycle) {
    return;
  }
  offlineCoordinatorBinding?.unsubscribe();
  const coordinator = getOfflineCoordinator();
  const setOfflineTier = (tier: ReturnType<typeof coordinator.getTier>) => {
    lifecycle.setOfflineTier(tier);
  };
  const unsubscribe = attachOfflineCoordinatorBindings({
    coordinator,
    setOfflineTier,
    probeRealmReachability: async () => {
      const auth = lifecycle.auth();
      if (
        auth.status !== 'authenticated'
        || auth.accountReasonCode === AccountReasonCode.REFRESH_OUTCOME_AMBIGUOUS
        || !isDesktopNimiClientSessionReady()
      ) {
        return false;
      }
      try {
        await getDesktopRealm().worldPublic.worldPublicControllerListWorldCatalog({
          path: {},
          query: { limit: 1 },
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
    hasPendingRealmRecoveryWork: async () => false,
    invalidateRealmQueries: async () => {
      await lifecycle.invalidateQueries([
        ['chats'],
        ['contacts'],
        ['topbar-currency-balances'],
        ['topbar-notification-unread-count'],
        ['notification-unread-count'],
        ['notification-page'],
      ]);
    },
    refreshAccountProfile: async () => {
      await lifecycle.invalidateQueries([['current-user-profile']]);
    },
    rebootstrapRuntime: async () => {
      await rebootstrapRuntime(lifecycle);
    },
  });
  offlineCoordinatorBinding = { lifecycle, unsubscribe };
}

function resolveDesktopRuntimeTransport(): DesktopRuntimeTransport {
  if (desktopBridge.hasElectronInvoke()) {
    return { type: 'electron-ipc' };
  }
  throw new Error('Desktop Runtime transport requires a standard shell host invoke.');
}

// @nimi-authority: rule.nimi.desktop.shell-runtime.r011
export function rebootstrapRuntime(lifecycle: DesktopRendererLifecyclePort): Promise<void> {
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
      await startBootstrapRuntime(lifecycle);
    }
  })().finally(() => {
    rebootstrapPromise = null;
  });
  return rebootstrapPromise;
}

async function teardownBootstrapState(): Promise<void> {
  stopAuthStateWatcher();
  clearDesktopNimiClientSession();
}

export async function disposeRuntimeBootstrap(): Promise<void> {
  offlineCoordinatorBinding?.unsubscribe();
  offlineCoordinatorBinding = null;
  pendingRebootstrap = false;
  const activeBootstrap = bootstrapPromise;
  if (activeBootstrap) {
    await activeBootstrap.catch(() => undefined);
  }
  await teardownBootstrapState();
  bootstrapPromise = null;
}

// @nimi-authority: definition.nimi.desktop.shell-runtime.bootstrap-phase-plane
// @nimi-authority: rule.nimi.desktop.shell-runtime.r002
export function bootstrapRuntime(lifecycle: DesktopRendererLifecyclePort): Promise<void> {
  bindOfflineCoordinator(lifecycle);
  if (rebootstrapPromise) {
    return rebootstrapPromise;
  }
  return startBootstrapRuntime(lifecycle);
}

function startBootstrapRuntime(lifecycle: DesktopRendererLifecyclePort): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const flowId = createRendererFlowId('renderer-bootstrap');
    const startedAt = performance.now();
    lifecycle.setAuthBootstrapping();
    lifecycle.setBootstrapReady(false);

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

    const defaults = await desktopBridge.getRuntimeDefaults();
    lifecycle.setRuntimeDefaults(defaults);
    let daemonStatus = await retrySourceRuntimeTransport(
      () => desktopBridge.getRuntimeBridgeStatus(),
      {
        onRetry: ({ attempt, reasonCode, retryDelayMs }) => {
          logRendererEvent({
            level: 'warn',
            area: 'renderer-bootstrap',
            message: 'phase:runtime-status:retry',
            flowId,
            details: { attempt, reasonCode, retryDelayMs },
          });
        },
      },
    );
    if (desktopBridge.hasElectronInvoke() && !daemonStatus.running && daemonStatus.launchMode !== 'SOURCE'
      && daemonStatus.lastError !== RUNTIME_STORED_DATA_UNSUPPORTED) {
      try {
        daemonStatus = await desktopBridge.startRuntimeBridge();
        if (!daemonStatus.running && !daemonStatus.lastError) {
          // A fixed-service start can return pending. Read the owner's status
          // once rather than dispatching another start into that transition.
          daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
        }
        logRendererEvent({
          level: daemonStatus.running ? 'info' : 'warn',
          area: 'renderer-bootstrap',
          message: daemonStatus.running ? 'phase:runtime-bridge:started' : 'phase:runtime-bridge:start-unavailable',
          flowId,
          details: { running: daemonStatus.running, managed: daemonStatus.managed,
            grpcAddr: daemonStatus.grpcAddr, launchMode: daemonStatus.launchMode, lastError: daemonStatus.lastError || null },
        });
      } catch (error) {
        daemonStatus = { ...daemonStatus, running: false, lastError: safeBootstrapErrorMessage(error) };
        logRendererEvent({
          level: 'warn', area: 'renderer-bootstrap', message: 'phase:runtime-bridge:start-failed',
          flowId, details: { error: daemonStatus.lastError },
        });
      }
    }
    // @nimi-authority: rule.nimi.desktop.shell-runtime.r025
    // A Runtime that refused its stored data serves only its maintenance
    // surface: Home shows the startup recovery page and opens no account,
    // Realm session, or other owner work against it.
    if (daemonStatus.lastError === RUNTIME_STORED_DATA_UNSUPPORTED) {
      getOfflineCoordinator().markRuntimeReachability('unreachable');
      lifecycle.setRuntimeMaintenance(RUNTIME_STORED_DATA_UNSUPPORTED);
      lifecycle.setBootstrapError(null);
      lifecycle.setBootstrapReady(true);
      logRendererEvent({
        level: 'warn',
        area: 'renderer-bootstrap',
        message: 'phase:runtime-maintenance',
        flowId,
        details: { reasonCode: RUNTIME_STORED_DATA_UNSUPPORTED },
      });
      return;
    }
    lifecycle.setRuntimeMaintenance(null);
    const runtimeUnavailable = !daemonStatus.running;
    const versionResult = checkRuntimeDaemonVersion(
      daemonStatus.version,
      DESKTOP_VERSION_FALLBACK,
      {
        strictExactMatch: daemonStatus.launchMode === 'RELEASE' && !runtimeUnavailable,
        expectedMissing: daemonStatus.launchMode === 'SOURCE',
        logEvent: logRendererEvent,
      },
    );
    if (!runtimeUnavailable && !versionResult.ok) {
      throw new Error(versionResult.message);
    }
    clearDesktopNimiClientSession();

    let accountStatus: Awaited<ReturnType<
      typeof desktopBridge.getRuntimeAccountSessionStatus
    >> | null = null;
    try {
      // The daemon accepts its owner-only socket before protected services
      // finish their ready transition, so a cold boot can leave this call
      // unanswered indefinitely. Bound it well under the bootstrap watchdog;
      // the auth state watcher retries in the background and self-heals the
      // session once Runtime is actually serving.
      accountStatus = await withBootstrapStepTimeout(
        'protected account status',
        desktopBridge.getRuntimeAccountSessionStatus(),
        DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
      );
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
    if (!accountStatus) applyRuntimeAccountUnavailableProjection(lifecycle);

    // These clients bind the existing Electron transport without calling Runtime.
    // Account observation can recover after an unavailable initial handshake.
    await configureDesktopRuntimeRealmSession({
      appId: 'nimi.desktop',
      runtimeTransport: resolveDesktopRuntimeTransport(),
    });
    if (!runtimeUnavailable) {
      // agentHandle values are scoped to the protected Runtime session. A
      // Runtime restart must remint them before an attached Conversation can
      // issue its next canonical Agent operation.
      await lifecycle.invalidateQueries([
        ['desktop-local-app-agent-references'],
      ]);
    }
    if (!accountStatus) getOfflineCoordinator().markRuntimeReachability('unreachable');
    startAuthStateWatcher(lifecycle, accountStatus ?? undefined);

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
    lifecycle.setBootstrapReady(true);
    lifecycle.setBootstrapError(null);
    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap:done',
      flowId,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
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
    lifecycle.setBootstrapError(message);
    lifecycle.setBootstrapReady(false);
    applyRuntimeAccountUnavailableProjection(lifecycle, message);
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
