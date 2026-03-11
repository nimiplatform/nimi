import { useEffect } from 'react';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { fetchProviderHealth, fetchRuntimeHealth, subscribeProviderHealth, subscribeRuntimeHealth } from '@renderer/features/runtime-config/runtime-config-audit-sdk-service';

const MENU_BAR_SYNC_INTERVAL_MS = 10_000;
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

  useEffect(() => {
    if (!flags.enableMenuBarShell || !bootstrapReady || !desktopBridge.hasTauriInvoke()) {
      return;
    }

    let disposed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const runSync = async () => {
      const updatedAt = new Date().toISOString();
      const payload: {
        runtimeHealthStatus?: string;
        runtimeHealthReason?: string;
        providerSummary?: { healthy: number; unhealthy: number; unknown: number; total: number };
        updatedAt: string;
      } = {
        updatedAt,
      };

      const [healthResult, providerResult] = await Promise.allSettled([
        fetchRuntimeHealth(),
        fetchProviderHealth(),
      ]);

      if (healthResult.status === 'fulfilled') {
        payload.runtimeHealthStatus = normalizeRuntimeHealthStatus(healthResult.value.status);
        if (healthResult.value.reason) {
          payload.runtimeHealthReason = String(healthResult.value.reason);
        }
      } else {
        payload.runtimeHealthReason = healthResult.reason instanceof Error
          ? healthResult.reason.message
          : String(healthResult.reason || 'runtime health unavailable');
      }

      if (providerResult.status === 'fulfilled') {
        payload.providerSummary = summarizeProviderStates(providerResult.value.providers || []);
      }

      if (!disposed) {
        await desktopBridge.syncMenuBarRuntimeHealth(payload).catch(() => undefined);
      }
    };

    const queueSync = () => {
      if (disposed) {
        return;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runSync();
      }, MENU_BAR_SYNC_DEBOUNCE_MS);
    };

    void runSync();
    intervalId = setInterval(() => {
      void runSync();
    }, MENU_BAR_SYNC_INTERVAL_MS);

    void subscribeRuntimeHealth()
      .then(async (stream) => {
        for await (const _event of stream) {
          if (disposed) {
            break;
          }
          queueSync();
        }
      })
      .catch(() => undefined);

    void subscribeProviderHealth()
      .then(async (stream) => {
        for await (const _event of stream) {
          if (disposed) {
            break;
          }
          queueSync();
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [bootstrapReady, flags.enableMenuBarShell]);
}
