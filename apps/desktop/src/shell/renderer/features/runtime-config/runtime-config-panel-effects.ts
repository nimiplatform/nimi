import { useEffect } from 'react';
import { localRuntime, type LocalRuntimeSnapshot } from '@nimiplatform/sdk/runtime';
import { isLocalRuntimeRunnableAssetKindId } from '@nimiplatform/sdk/runtime';
import type { Dispatch, SetStateAction } from 'react';
import type { StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { useRuntimeConfigHydrationEffect } from './runtime-config-effect-hydration';
import { useRuntimeConfigVaultSyncEffect } from './runtime-config-effect-vault-sync';
import { useRuntimeConfigRouteInitEffect } from './runtime-config-effect-route-init';
import { useRuntimeConfigSetupAutodiscoverEffect } from './runtime-config-effect-setup-autodiscover';
import { normalizeRuntimeHealthResult } from './runtime-config-connector-discovery';
import { useRuntimeHealthCoordinatorState } from './runtime-health-coordinator';

const LOCAL_SNAPSHOT_POLL_INTERVAL_MS = 30_000;

type RuntimeConfigPanelEffectsInput = {
  bootstrapReady: boolean;
  hydrated: boolean;
  setHydrated: (next: boolean) => void;
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  setStatusBanner: (banner: StatusBanner | null) => void;
  setVaultEntryCount: (count: number) => void;
  vaultVersion: number;
  discoverLocalModels: () => Promise<void>;
};

function mergeLocalSnapshot(
  previous: RuntimeConfigStateV11,
  snapshot: LocalRuntimeSnapshot,
): RuntimeConfigStateV11 {
  const snapshotAssets = snapshot.assets ?? [];
  const nextModels = snapshotAssets
    .filter((item) => item.status !== 'removed')
    .map((item) => ({
      localModelId: item.localAssetId || '',
      engine: item.engine,
      model: item.assetId || '',
      endpoint: '',
      capabilities: (item.capabilities || [])
        .filter(isLocalRuntimeRunnableAssetKindId),
      status: item.status,
      integrityMode: item.integrityMode,
      recommendation: item.recommendation,
    }));

  return {
    ...previous,
    local: {
      ...previous.local,
      // Snapshot data is the live source of truth. When the runtime reports
      // no installed models, stale hydrated UI state must be cleared rather
      // than preserved.
      models: nextModels,
      status: previous.local.status,
      lastCheckedAt: snapshot.generatedAt,
      lastDetail: previous.local.lastDetail,
    },
  };
}

async function fetchRuntimeConfigLocalSnapshot(): Promise<LocalRuntimeSnapshot> {
  const assets = await localRuntime.listAssets();
  return {
    assets,
    health: [],
    generatedAt: new Date().toISOString(),
  };
}

function startRuntimeConfigSnapshotPolling(options: {
  intervalMs: number;
  onSnapshot: (snapshot: LocalRuntimeSnapshot) => void;
  onError: (error: unknown) => void;
}): () => void {
  let cancelled = false;
  const run = async () => {
    if (cancelled) return;
    try {
      const snapshot = await fetchRuntimeConfigLocalSnapshot();
      if (!cancelled) {
        options.onSnapshot(snapshot);
      }
    } catch (error) {
      if (!cancelled) {
        options.onError(error);
      }
    }
  };
  void run();
  const timer = setInterval(() => {
    void run();
  }, options.intervalMs);
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}

export function useRuntimeConfigPanelEffects(input: RuntimeConfigPanelEffectsInput) {
  const runtimeHealthState = useRuntimeHealthCoordinatorState();

  useRuntimeConfigHydrationEffect({
    bootstrapReady: input.bootstrapReady,
    hydrated: input.hydrated,
    setHydrated: input.setHydrated,
    setState: input.setState,
    setStatusBanner: input.setStatusBanner,
  });

  useRuntimeConfigVaultSyncEffect({
    state: input.state,
    setVaultEntryCount: input.setVaultEntryCount,
    vaultVersion: input.vaultVersion,
  });

  useRuntimeConfigRouteInitEffect({
    state: input.state,
    setState: input.setState,
  });

  useRuntimeConfigSetupAutodiscoverEffect({
    state: input.state,
    hydrated: input.hydrated,
    discoverLocalModels: input.discoverLocalModels,
    activePage: input.state?.activePage || 'overview',
  });

  useEffect(() => {
    if (!input.hydrated) return;
    const stop = startRuntimeConfigSnapshotPolling({
      intervalMs: LOCAL_SNAPSHOT_POLL_INTERVAL_MS,
      onSnapshot: (snapshot) => {
        input.setState((previous) => {
          if (!previous) return previous;
          return mergeLocalSnapshot(previous, snapshot);
        });
      },
      onError: () => {},
    });
    return () => {
      stop();
    };
  }, [input.hydrated, input.setState]);

  useEffect(() => {
    if (!input.hydrated || runtimeHealthState.stale || !runtimeHealthState.runtimeHealth) return;
    const { health, normalizedStatus } = normalizeRuntimeHealthResult(runtimeHealthState.runtimeHealth);
    input.setState((previous) => {
      if (!previous) return previous;
      if (
        previous.local.status === normalizedStatus
        && previous.local.lastCheckedAt === health.checkedAt
        && previous.local.lastDetail === health.detail
      ) {
        return previous;
      }
      return {
        ...previous,
        local: {
          ...previous.local,
          status: normalizedStatus,
          lastCheckedAt: health.checkedAt,
          lastDetail: health.detail,
        },
      };
    });
  }, [
    input.hydrated,
    input.setState,
    runtimeHealthState.runtimeHealth,
    runtimeHealthState.stale,
  ]);
}
