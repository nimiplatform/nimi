import { useEffect } from 'react';
import type { NimiRuntimeLocalSnapshot } from '@nimiplatform/sdk/runtime';
import { isNimiRuntimeLocalRunnableAssetKindId } from '@nimiplatform/sdk/runtime';
import type { Dispatch, SetStateAction } from 'react';
import type { StatusBanner } from '../../app-shell/providers/app-store';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import {
  useRuntimeConfigLocalModelCenterClient,
  type RuntimeConfigLocalModelCenterClient,
} from './runtime-config-local-model-center-sdk-service';
import { useRuntimeConfigHydrationEffect } from './runtime-config-effect-hydration';
import { useRuntimeConfigVaultSyncEffect } from './runtime-config-effect-vault-sync';
import { useRuntimeConfigRouteInitEffect } from './runtime-config-effect-route-init';
import { useRuntimeConfigSetupAutodiscoverEffect } from './runtime-config-effect-setup-autodiscover';
import { normalizeRuntimeHealthResult } from './runtime-config-connector-discovery';
import { useRuntimeHealthCoordinatorState } from './runtime-health-coordinator';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { DesktopRendererClockView } from '../../renderer/contract.js';

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
  discoverLocalModels: (options?: { visible?: boolean }) => Promise<void>;
};

function mergeLocalSnapshot(
  previous: RuntimeConfigStateV11,
  snapshot: NimiRuntimeLocalSnapshot,
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
        .filter(isNimiRuntimeLocalRunnableAssetKindId),
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

async function fetchRuntimeConfigLocalSnapshot(
  client: RuntimeConfigLocalModelCenterClient,
  now: () => number,
): Promise<NimiRuntimeLocalSnapshot> {
  const assets = await client.listAssets();
  return {
    assets,
    health: [],
    generatedAt: new Date(now()).toISOString(),
  };
}

function startRuntimeConfigSnapshotPolling(options: {
  client: RuntimeConfigLocalModelCenterClient;
  clock: DesktopRendererClockView;
  intervalMs: number;
  onSnapshot: (snapshot: NimiRuntimeLocalSnapshot) => void;
  onError: (error: unknown) => void;
}): () => void {
  let cancelled = false;
  let cancelScheduled: (() => void) | null = null;
  const scheduleNext = () => {
    cancelScheduled = options.clock.schedule(options.intervalMs, (result) => {
      cancelScheduled = null;
      if (cancelled) return;
      if (!result.ok) {
        options.onError(new Error(result.error));
        return;
      }
      void run();
    });
  };
  const run = async () => {
    if (cancelled) return;
    try {
      const snapshot = await fetchRuntimeConfigLocalSnapshot(options.client, options.clock.now);
      if (!cancelled) options.onSnapshot(snapshot);
    } catch (error) {
      if (!cancelled) options.onError(error);
    } finally {
      if (!cancelled) scheduleNext();
    }
  };
  void run();
  return () => {
    cancelled = true;
    cancelScheduled?.();
    cancelScheduled = null;
  };
}

export function useRuntimeConfigPanelEffects(input: RuntimeConfigPanelEffectsInput) {
  const runtimeConfigLocalModelCenterClient = useRuntimeConfigLocalModelCenterClient();
  const bindings = useDesktopRendererBindings();
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
      client: runtimeConfigLocalModelCenterClient,
      clock: bindings.clock,
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
  }, [bindings.clock, input.hydrated, input.setState, runtimeConfigLocalModelCenterClient]);

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
