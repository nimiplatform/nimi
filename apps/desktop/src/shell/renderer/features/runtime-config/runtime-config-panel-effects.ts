import { useEffect } from 'react';
import { startLocalAiRuntimePolling, type LocalAiRuntimeSnapshot } from '@runtime/local-ai-runtime';
import type { Dispatch, SetStateAction } from 'react';
import type { RuntimeFieldMap, StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { useRuntimeConfigHydrationEffect } from './runtime-config-effect-hydration';
import { useRuntimeConfigVaultSyncEffect } from './runtime-config-effect-vault-sync';
import { useRuntimeConfigRouteInitEffect } from './runtime-config-effect-route-init';
import { useRuntimeConfigSetupAutodiscoverEffect } from './runtime-config-effect-setup-autodiscover';
import { checkLocalHealth } from './runtime-config-connector-discovery';

const LOCAL_SNAPSHOT_POLL_INTERVAL_MS = 30_000;
const LOCAL_HEALTH_POLL_INTERVAL_MS = 30_000;

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
  discoverLocalModels: () => Promise<void>;
};

function mergeLocalSnapshot(
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
  const models = nextModels.length > 0 ? nextModels : previous.local.models;

  return {
    ...previous,
    local: {
      ...previous.local,
      models,
      status: previous.local.status,
      lastCheckedAt: previous.local.lastCheckedAt || snapshot.generatedAt,
      lastDetail: previous.local.lastDetail,
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
    discoverLocalModels: input.discoverLocalModels,
  });

  useEffect(() => {
    if (!input.hydrated) return;
    const stop = startLocalAiRuntimePolling({
      intervalMs: LOCAL_SNAPSHOT_POLL_INTERVAL_MS,
      onSnapshot: (snapshot) => {
        input.setState((previous) => {
          if (!previous) return previous;
          return mergeLocalSnapshot(previous, snapshot);
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
        const { health, normalizedStatus } = await checkLocalHealth();
        if (cancelled) return;
        input.setState((previous) => {
          if (!previous) return previous;
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
      } catch {
        // keep last known runtime health snapshot on polling failure
      }
    };

    void runHealthCheck();
    const timer = setInterval(() => {
      void runHealthCheck();
    }, LOCAL_HEALTH_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [input.hydrated, input.setState]);
}
