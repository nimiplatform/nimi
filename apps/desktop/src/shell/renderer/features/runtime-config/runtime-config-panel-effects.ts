import { useEffect } from 'react';
import { startLocalAiRuntimePolling, type LocalAiRuntimeSnapshot } from '@runtime/local-ai-runtime';
import type { Dispatch, SetStateAction } from 'react';
import type { RuntimeFieldMap, StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/types';
import { useRuntimeConfigHydrationEffect } from './effects/hydration';
import { useRuntimeConfigVaultSyncEffect } from './effects/vault-sync';
import { useRuntimeConfigRouteInitEffect } from './effects/route-init';
import { useRuntimeConfigSetupAutodiscoverEffect } from './effects/setup-autodiscover';
import { checkLocalRuntimeHealth } from './domain/provider-connectors/discovery';

const LOCAL_RUNTIME_SNAPSHOT_POLL_INTERVAL_MS = 30_000;
const LOCAL_RUNTIME_HEALTH_POLL_INTERVAL_MS = 30_000;

type RuntimeConfigPanelEffectsInput = {
  bootstrapReady: boolean;
  hydrated: boolean;
  setHydrated: (next: boolean) => void;
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  runtimeFields: RuntimeFieldMap;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
  setStatusBanner: (banner: StatusBanner | null) => void;
  setVaultEntryCount: (count: number) => void;
  vaultVersion: number;
  discoverLocalRuntimeModels: () => Promise<void>;
};

function mergeLocalRuntimeSnapshot(
  previous: RuntimeConfigStateV11,
  snapshot: LocalAiRuntimeSnapshot,
): RuntimeConfigStateV11 {
  const nextModels = snapshot.models
    .filter((item) => item.status !== 'removed')
    .map((item) => ({
      localModelId: item.localModelId,
      engine: item.engine,
      model: item.modelId,
      endpoint: item.endpoint,
      capabilities: item.capabilities
        .filter((capability): capability is 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' => (
          capability === 'chat'
          || capability === 'image'
          || capability === 'video'
          || capability === 'tts'
          || capability === 'stt'
          || capability === 'embedding'
        )),
      status: item.status,
    }));
  const models = nextModels.length > 0 ? nextModels : previous.localRuntime.models;

  return {
    ...previous,
    localRuntime: {
      ...previous.localRuntime,
      models,
      status: previous.localRuntime.status,
      lastCheckedAt: previous.localRuntime.lastCheckedAt || snapshot.generatedAt,
      lastDetail: previous.localRuntime.lastDetail,
    },
  };
}

export function useRuntimeConfigPanelEffects(input: RuntimeConfigPanelEffectsInput) {
  useRuntimeConfigHydrationEffect({
    bootstrapReady: input.bootstrapReady,
    hydrated: input.hydrated,
    setHydrated: input.setHydrated,
    setState: input.setState,
    runtimeFields: input.runtimeFields,
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
    setRuntimeFields: input.setRuntimeFields,
  });

  useRuntimeConfigSetupAutodiscoverEffect({
    state: input.state,
    hydrated: input.hydrated,
    discoverLocalRuntimeModels: input.discoverLocalRuntimeModels,
  });

  useEffect(() => {
    if (!input.hydrated) return;
    const stop = startLocalAiRuntimePolling({
      intervalMs: LOCAL_RUNTIME_SNAPSHOT_POLL_INTERVAL_MS,
      onSnapshot: (snapshot) => {
        input.setState((previous) => {
          if (!previous) return previous;
          return mergeLocalRuntimeSnapshot(previous, snapshot);
        });
      },
    });
    return () => {
      stop();
    };
  }, [input.hydrated, input.setState]);

  useEffect(() => {
    if (!input.hydrated) return;
    let cancelled = false;

    const runHealthCheck = async () => {
      try {
        const { health, normalizedStatus } = await checkLocalRuntimeHealth();
        if (cancelled) return;
        input.setState((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            localRuntime: {
              ...previous.localRuntime,
              status: normalizedStatus,
              lastCheckedAt: health.checkedAt,
              lastDetail: health.detail,
            },
          };
        });
      } catch {
        // keep last known runtime health snapshot on polling failure
      }
    };

    void runHealthCheck();
    const timer = setInterval(() => {
      void runHealthCheck();
    }, LOCAL_RUNTIME_HEALTH_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [input.hydrated, input.setState]);
}
