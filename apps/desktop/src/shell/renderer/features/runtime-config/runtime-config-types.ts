import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

export type RuntimeConfigStateUpdater = (
  updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11,
) => void;
