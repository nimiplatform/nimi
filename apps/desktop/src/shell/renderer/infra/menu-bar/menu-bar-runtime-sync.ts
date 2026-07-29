import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { projectNimiRuntimeHealthStatusName } from '@nimiplatform/sdk/runtime';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import { desktopBridge } from '../../bridge';
import {
  NimiRuntimeHealthCoordinator,
  type NimiRuntimeHealthCoordinatorState,
} from '../../features/runtime-config/runtime-health-coordinator';
import type { MenuBarRuntimeHealthSyncPayload } from '../../bridge/runtime-bridge/menu-bar';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port';

const MENU_BAR_SYNC_DEBOUNCE_MS = 250;
export const MENU_BAR_SYNC_HEARTBEAT_MS = 10_000;

export type MenuBarRuntimeSyncState = Pick<
  NimiRuntimeHealthCoordinatorState,
  'runtimeHealth' | 'providerHealth' | 'lastFetchedAt' | 'lastStreamAt' | 'error' | 'streamError'
>;

export function buildMenuBarRuntimeSyncPayload(
  healthState: MenuBarRuntimeSyncState,
): MenuBarRuntimeHealthSyncPayload {
  const runtimeHealthStatus = healthState.runtimeHealth
    ? projectNimiRuntimeHealthStatusName(healthState.runtimeHealth.status)
    : undefined;
  const runtimeHealthReason = boundedHealthReason(
    healthState.runtimeHealth?.reason
      || healthState.error
      || healthState.streamError,
  );
  return {
    ...(runtimeHealthStatus ? { runtimeHealthStatus } : {}),
    ...(runtimeHealthReason ? { runtimeHealthReason } : {}),
    ...(healthState.providerHealth.length > 0
      ? { providerSummary: summarizeProviderStates(healthState.providerHealth) }
      : {}),
    updatedAt: healthState.lastStreamAt || healthState.lastFetchedAt || new Date().toISOString(),
  };
}

export function buildMenuBarRuntimeSyncKey(payload: MenuBarRuntimeHealthSyncPayload): string {
  return JSON.stringify({
    runtimeHealthStatus: payload.runtimeHealthStatus ?? null,
    runtimeHealthReason: payload.runtimeHealthReason ?? null,
    providerSummary: payload.providerSummary ?? null,
  });
}

export function shouldSyncMenuBarRuntimeHealth(
  payload: MenuBarRuntimeHealthSyncPayload,
  lastSync: { readonly key: string | null; readonly syncedAtMs: number },
  nowMs: number,
  heartbeatMs = MENU_BAR_SYNC_HEARTBEAT_MS,
): boolean {
  if (lastSync.key !== buildMenuBarRuntimeSyncKey(payload)) {
    return true;
  }
  return nowMs - lastSync.syncedAtMs >= heartbeatMs;
}

export function connectMenuBarRuntimeSync(
  lifecycle: Pick<DesktopRendererLifecyclePort, 'bootstrap' | 'subscribeBootstrap'>,
  coordinator: NimiRuntimeHealthCoordinator,
): () => void {
  const flags = getShellFeatureFlags();
  if (!flags.enableMenuBarShell || !desktopBridge.hasElectronInvoke()) {
    return () => {};
  }

  let active = true;
  let syncGeneration = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastSync: { key: string | null; syncedAtMs: number } = {
    key: null,
    syncedAtMs: 0,
  };

  const sync = (): void => {
    if (!active || !lifecycle.bootstrap().bootstrapReady) return;
    const payload = buildMenuBarRuntimeSyncPayload(coordinator.getSnapshot());
    const nowMs = Date.now();
    if (!shouldSyncMenuBarRuntimeHealth(payload, lastSync, nowMs)) return;
    const key = buildMenuBarRuntimeSyncKey(payload);
    const generation = syncGeneration;
    void desktopBridge.syncMenuBarRuntimeHealth(payload).then(() => {
      if (
        !active
        || generation !== syncGeneration
        || !lifecycle.bootstrap().bootstrapReady
      ) {
        return;
      }
      lastSync = { key, syncedAtMs: nowMs };
    }, () => {
      logRendererEvent({
        level: 'warn',
        area: 'menu-bar',
        message: 'action:runtime-health-sync-failed',
        details: { retry: 'next-health-change-or-heartbeat' },
      });
    });
  };

  const reconcile = (): void => {
    const rendererReady = lifecycle.bootstrap().bootstrapReady;
    if (!rendererReady) {
      syncGeneration += 1;
      lastSync = { key: null, syncedAtMs: 0 };
      if (debounceTimer) clearTimeout(debounceTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      debounceTimer = null;
      heartbeatTimer = null;
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      sync();
    }, MENU_BAR_SYNC_DEBOUNCE_MS);
    heartbeatTimer ??= setInterval(sync, MENU_BAR_SYNC_HEARTBEAT_MS);
  };

  const unsubscribeBootstrap = lifecycle.subscribeBootstrap(reconcile);
  const unsubscribeHealth = coordinator.subscribe(reconcile);
  reconcile();
  return () => {
    active = false;
    syncGeneration += 1;
    unsubscribeHealth();
    unsubscribeBootstrap();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };
}

function summarizeProviderStates(providers: Array<{ state?: unknown }>): {
  healthy: number;
  unhealthy: number;
  unknown: number;
  total: number;
} {
  const summary = {
    healthy: 0,
    unhealthy: 0,
    unknown: 0,
    total: providers.length,
  };
  for (const provider of providers) {
    const state = String(provider.state || '').trim().toLowerCase();
    if (state === 'healthy') {
      summary.healthy += 1;
    } else if (state === 'unhealthy') {
      summary.unhealthy += 1;
    } else {
      summary.unknown += 1;
    }
  }
  return summary;
}

function boundedHealthReason(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text ? text.slice(0, 256) : undefined;
}
