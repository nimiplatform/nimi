import { createWorldEvolutionSelectorReadFacade } from '../internal/world-evolution-selector-read.js';
import type {
  WorldEvolutionCheckpointReadResult,
  WorldEvolutionCheckpointSelector,
  WorldEvolutionCommitRequestReadResult,
  WorldEvolutionCommitRequestSelector,
  WorldEvolutionExecutionEventReadResult,
  WorldEvolutionExecutionEventSelector,
  WorldEvolutionReplayReadResult,
  WorldEvolutionReplaySelector,
  WorldEvolutionSupervisionReadResult,
  WorldEvolutionSupervisionSelector,
} from '../runtime/world-evolution-selector-read.js';
import { getWorldEvolutionHost } from './internal/runtime-access.js';

type ModWorldEvolutionFacade = {
  executionEvents: {
    read: (selector: WorldEvolutionExecutionEventSelector) => Promise<WorldEvolutionExecutionEventReadResult>;
  };
  replays: {
    read: (selector: WorldEvolutionReplaySelector) => Promise<WorldEvolutionReplayReadResult>;
  };
  checkpoints: {
    read: (selector: WorldEvolutionCheckpointSelector) => Promise<WorldEvolutionCheckpointReadResult>;
  };
  supervision: {
    read: (selector: WorldEvolutionSupervisionSelector) => Promise<WorldEvolutionSupervisionReadResult>;
  };
  commitRequests: {
    read: (selector: WorldEvolutionCommitRequestSelector) => Promise<WorldEvolutionCommitRequestReadResult>;
  };
};

export const worldEvolution: ModWorldEvolutionFacade = createWorldEvolutionSelectorReadFacade(() => getWorldEvolutionHost());
