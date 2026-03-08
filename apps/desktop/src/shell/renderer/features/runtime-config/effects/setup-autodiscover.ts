import { useEffect, useRef } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

type SetupAutodiscoverEffectInput = {
  state: RuntimeConfigStateV11 | null;
  hydrated: boolean;
  discoverLocalRuntimeModels: () => Promise<void>;
};

export function useRuntimeConfigSetupAutodiscoverEffect(input: SetupAutodiscoverEffectInput) {
  const autoDiscoverTriggeredRef = useRef(false);

  useEffect(() => {
    if (!input.state || !input.hydrated) return;
    if (autoDiscoverTriggeredRef.current) return;

    autoDiscoverTriggeredRef.current = true;
    void input.discoverLocalRuntimeModels();
  }, [input.discoverLocalRuntimeModels, input.hydrated, input.state]);
}
