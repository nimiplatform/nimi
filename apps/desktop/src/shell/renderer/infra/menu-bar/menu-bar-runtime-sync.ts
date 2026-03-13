import { useEffect } from 'react';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useRuntimeHealthCoordinatorState } from '@renderer/features/runtime-config/runtime-health-coordinator';

const MENU_BAR_SYNC_DEBOUNCE_MS = 250;

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

export function useMenuBarRuntimeSync(): void {
  const flags = getShellFeatureFlags();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const healthState = useRuntimeHealthCoordinatorState();

  useEffect(() => {
    if (!flags.enableMenuBarShell || !bootstrapReady || !desktopBridge.hasTauriInvoke()) {
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const runSync = async () => {
      const payload: {
        runtimeHealthStatus?: string;
        runtimeHealthReason?: string;
        providerSummary?: { healthy: number; unhealthy: number; unknown: number; total: number };
        updatedAt: string;
      } = {
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

      await desktopBridge.syncMenuBarRuntimeHealth(payload).catch(() => undefined);
    };

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSync();
    }, MENU_BAR_SYNC_DEBOUNCE_MS);

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [
    bootstrapReady,
    flags.enableMenuBarShell,
    healthState.error,
    healthState.lastFetchedAt,
    healthState.lastStreamAt,
    healthState.providerHealth,
    healthState.runtimeHealth,
    healthState.streamError,
  ]);
}
