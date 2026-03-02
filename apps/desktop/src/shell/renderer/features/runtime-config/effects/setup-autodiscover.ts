import { useEffect, useRef } from 'react';
import {
  shouldAutoDiscoverOnSetupEnterV11,
  type RuntimeConfigStateV11,
  type RuntimeSectionIdV11,
} from '@renderer/features/runtime-config/state/types';

type SetupAutodiscoverEffectInput = {
  state: RuntimeConfigStateV11 | null;
  hydrated: boolean;
  discoverLocalRuntimeModels: () => Promise<void>;
};

export function useRuntimeConfigSetupAutodiscoverEffect(input: SetupAutodiscoverEffectInput) {
  const autoDiscoverTriggeredRef = useRef(false);
  const previousSectionRef = useRef<RuntimeSectionIdV11 | null>(null);

  useEffect(() => {
    if (!input.state || !input.hydrated) return;

    const shouldAuto = shouldAutoDiscoverOnSetupEnterV11(
      previousSectionRef.current,
      input.state.activeSection,
      autoDiscoverTriggeredRef.current,
    );

    if (shouldAuto) {
      autoDiscoverTriggeredRef.current = true;
      void input.discoverLocalRuntimeModels();
    }

    previousSectionRef.current = input.state.activeSection;
  }, [input.discoverLocalRuntimeModels, input.hydrated, input.state]);
}
