import { useEffect, useRef } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

type SetupAutodiscoverEffectInput = {
  state: RuntimeConfigStateV11 | null;
  hydrated: boolean;
  discoverLocalModels: () => Promise<void>;
  activePage: string;
};

const PAGES_REQUIRING_DISCOVERY: ReadonlySet<string> = new Set([
  'overview', 'local', 'recommend', 'mods', 'catalog', 'runtime', 'cloud',
]);

export function useRuntimeConfigSetupAutodiscoverEffect(input: SetupAutodiscoverEffectInput) {
  const autoDiscoverTriggeredRef = useRef(false);

  useEffect(() => {
    if (!input.state || !input.hydrated) return;
    if (autoDiscoverTriggeredRef.current) return;
    if (!PAGES_REQUIRING_DISCOVERY.has(input.activePage)) return;

    autoDiscoverTriggeredRef.current = true;
    const timer = setTimeout(() => {
      void input.discoverLocalModels();
    }, 2_000);
    return () => clearTimeout(timer);
  }, [input.discoverLocalModels, input.hydrated, input.state, input.activePage]);
}
