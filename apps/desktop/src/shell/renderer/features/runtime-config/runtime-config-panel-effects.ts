import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { useRuntimeConfigHydrationEffect } from './runtime-config-effect-hydration';
import { useRuntimeConfigVaultSyncEffect } from './runtime-config-effect-vault-sync';
import { normalizeRuntimeHealthResult } from './runtime-config-connector-discovery';
import { useRuntimeHealthCoordinatorState } from './runtime-health-coordinator';

type RuntimeConfigPanelEffectsInput = {
  bootstrapReady: boolean;
  hydrated: boolean;
  setHydrated: (next: boolean) => void;
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  setVaultEntryCount: (count: number) => void;
  vaultVersion: number;
};

export function useRuntimeConfigPanelEffects(input: RuntimeConfigPanelEffectsInput) {
  const runtimeHealthState = useRuntimeHealthCoordinatorState();

  useRuntimeConfigHydrationEffect({
    bootstrapReady: input.bootstrapReady,
    hydrated: input.hydrated,
    setHydrated: input.setHydrated,
    setState: input.setState,
  });

  useRuntimeConfigVaultSyncEffect({
    state: input.state,
    setVaultEntryCount: input.setVaultEntryCount,
    vaultVersion: input.vaultVersion,
  });

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
