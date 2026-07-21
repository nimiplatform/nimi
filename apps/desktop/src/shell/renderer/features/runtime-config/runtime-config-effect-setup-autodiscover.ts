import { useEffect } from 'react';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

type SetupAutodiscoverEffectInput = {
  state: RuntimeConfigStateV11 | null;
  hydrated: boolean;
  discoverLocalModels: (options?: { visible?: boolean }) => Promise<void>;
  activePage: string;
};

const PAGES_REQUIRING_DISCOVERY: readonly string[] = [
  'overview', 'models', 'cloud', 'environment',
];

export function useRuntimeConfigSetupAutodiscoverEffect(input: SetupAutodiscoverEffectInput) {
  const progress = useDesktopRendererCommands().localModelProgress;
  useEffect(() => {
    if (!input.state || !input.hydrated) return;
    if (!PAGES_REQUIRING_DISCOVERY.includes(input.activePage)) return;
    if (!progress.claimSetupAutodiscover()) return;

    void input.discoverLocalModels({ visible: false });
  }, [input.discoverLocalModels, input.hydrated, input.state, input.activePage, progress]);
}
