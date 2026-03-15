import { useEffect, useRef } from 'react';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  useRuntimeHealthCoordinatorState,
  type RuntimeHealthCoordinatorState,
} from '@renderer/features/runtime-config/runtime-health-coordinator';
import type { MenuBarRuntimeHealthSyncPayload } from '@renderer/bridge/runtime-bridge/types';

const MENU_BAR_SYNC_DEBOUNCE_MS = 250;
export const MENU_BAR_SYNC_HEARTBEAT_MS = 10_000;

function normalizeRuntimeHealthStatus(status: number | undefined): string | undefined {
  if (status === 1) return 'STOPPED';
  if (status === 2) return 'STARTING';
  if (status === 3) return 'READY';
  if (status === 4) return 'DEGRADED';
  if (status === 5) return 'STOPPING';
  return undefined;
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
      continue;
    }
    if (state === 'unhealthy') {
      summary.unhealthy += 1;
      continue;
    }
    summary.unknown += 1;
  }
  return summary;
}

export type MenuBarRuntimeSyncState = Pick<
  RuntimeHealthCoordinatorState,
  'runtimeHealth' | 'providerHealth' | 'lastFetchedAt' | 'lastStreamAt' | 'error' | 'streamError'
>;

export function buildMenuBarRuntimeSyncPayload(
  healthState: MenuBarRuntimeSyncState,
): MenuBarRuntimeHealthSyncPayload {
  const payload: MenuBarRuntimeHealthSyncPayload = {
    updatedAt: healthState.lastStreamAt || healthState.lastFetchedAt || new Date().toISOString(),
  };

  if (healthState.runtimeHealth) {
    payload.runtimeHealthStatus = normalizeRuntimeHealthStatus(healthState.runtimeHealth.status);
    if (healthState.runtimeHealth.reason) {
      payload.runtimeHealthReason = String(healthState.runtimeHealth.reason);
    }
  }

  if (!payload.runtimeHealthReason && (healthState.error || healthState.streamError)) {
    payload.runtimeHealthReason = healthState.error || healthState.streamError || undefined;
  }

  if (healthState.providerHealth.length > 0) {
    payload.providerSummary = summarizeProviderStates(healthState.providerHealth);
  }

  return payload;
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
  lastSync: { key: string | null; syncedAtMs: number },
  nowMs: number,
  heartbeatMs = MENU_BAR_SYNC_HEARTBEAT_MS,
): boolean {
  const nextKey = buildMenuBarRuntimeSyncKey(payload);
  if (lastSync.key !== nextKey) {
    return true;
  }
  return nowMs - lastSync.syncedAtMs >= heartbeatMs;
}

export function useMenuBarRuntimeSync(): void {
  const flags = getShellFeatureFlags();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const healthState = useRuntimeHealthCoordinatorState();
  const lastSyncRef = useRef<{ key: string | null; syncedAtMs: number }>({
    key: null,
    syncedAtMs: 0,
  });

  const enabled = flags.enableMenuBarShell && bootstrapReady && desktopBridge.hasTauriInvoke();
  const payload = buildMenuBarRuntimeSyncPayload(healthState);
  const payloadKey = buildMenuBarRuntimeSyncKey(payload);
  const latestPayloadRef = useRef<MenuBarRuntimeHealthSyncPayload>(payload);
  latestPayloadRef.current = payload;

  useEffect(() => {
    if (!enabled) {
      lastSyncRef.current = { key: null, syncedAtMs: 0 };
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    const debounceTimer = setTimeout(() => {
      const nextPayload = latestPayloadRef.current;
      const nowMs = Date.now();
      if (!shouldSyncMenuBarRuntimeHealth(nextPayload, lastSyncRef.current, nowMs)) {
        return;
      }
      const nextKey = buildMenuBarRuntimeSyncKey(nextPayload);
      void desktopBridge.syncMenuBarRuntimeHealth(nextPayload).then(() => {
        if (cancelled) {
          return;
        }
        lastSyncRef.current = {
          key: nextKey,
          syncedAtMs: nowMs,
        };
      }).catch(() => undefined);
    }, MENU_BAR_SYNC_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [enabled, payloadKey]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const heartbeatHandle = window.setInterval(() => {
      const nextPayload = latestPayloadRef.current;
      const nowMs = Date.now();
      if (!shouldSyncMenuBarRuntimeHealth(nextPayload, lastSyncRef.current, nowMs)) {
        return;
      }
      const nextKey = buildMenuBarRuntimeSyncKey(nextPayload);
      void desktopBridge.syncMenuBarRuntimeHealth(nextPayload).then(() => {
        lastSyncRef.current = {
          key: nextKey,
          syncedAtMs: nowMs,
        };
      }).catch(() => undefined);
    }, MENU_BAR_SYNC_HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeatHandle);
    };
  }, [enabled]);
}
