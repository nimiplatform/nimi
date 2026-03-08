import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

export type RuntimeConfigStateUpdater = (
  updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11,
) => void;
