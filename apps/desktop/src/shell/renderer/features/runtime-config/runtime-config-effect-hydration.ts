import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { loadRuntimeConfigStateV11 } from './runtime-config-storage-persist';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

type HydrationEffectInput = {
  bootstrapReady: boolean;
  hydrated: boolean;
  setHydrated: (next: boolean) => void;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
};

export function useRuntimeConfigHydrationEffect(input: HydrationEffectInput) {
  useEffect(() => {
    if (!input.bootstrapReady || input.hydrated) return;
    // Local storage restores UI preferences. Runtime owns the actual bindings.
    input.setState(loadRuntimeConfigStateV11());
    input.setHydrated(true);
  }, [input.bootstrapReady, input.hydrated, input.setHydrated, input.setState]);
}
