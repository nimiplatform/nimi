import { useEffect } from 'react';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

type SetupAutodiscoverEffectInput = {
  state: RuntimeConfigStateV11 | null;
  hydrated: boolean;
  discoverLocalModels: (options?: { visible?: boolean }) => Promise<void>;
  activePage: string;
};

const PAGES_REQUIRING_DISCOVERY: ReadonlySet<string> = new Set([
  'overview', 'models', 'cloud', 'environment',
]);

let runtimeConfigSetupAutodiscoverTriggered = false;

export function useRuntimeConfigSetupAutodiscoverEffect(input: SetupAutodiscoverEffectInput) {
  useEffect(() => {
    if (!input.state || !input.hydrated) return;
    if (runtimeConfigSetupAutodiscoverTriggered) return;
    if (!PAGES_REQUIRING_DISCOVERY.has(input.activePage)) return;

    runtimeConfigSetupAutodiscoverTriggered = true;
    void input.discoverLocalModels({ visible: false });
  }, [input.discoverLocalModels, input.hydrated, input.state, input.activePage]);
}
