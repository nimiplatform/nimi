import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/types';

export type RuntimeConfigStateUpdater = (
  updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11,
) => void;
