import type { JsonObject } from './utils.js';
import type {
  WorldEvolutionCheckpointReadResult,
  WorldEvolutionCheckpointSelector,
  WorldEvolutionCommitRequestReadResult,
  WorldEvolutionCommitRequestSelector,
  WorldEvolutionExecutionEventReadResult,
  WorldEvolutionExecutionEventSelector,
  WorldEvolutionReplayReadResult,
  WorldEvolutionReplaySelector,
  WorldEvolutionSelectorReadMethodId,
  WorldEvolutionSelectorReadRejectionCategory,
  WorldEvolutionSupervisionReadResult,
  WorldEvolutionSupervisionSelector,
} from '../runtime/world-evolution-selector-read.js';

export type ProviderMatches<T> = Promise<T[] | ReadonlyArray<T>>;

export type WorldEvolutionSelectorReadProvider = {
  executionEvents: {
    read: (selector: WorldEvolutionExecutionEventSelector) => ProviderMatches<unknown>;
  };
  replays: {
    read: (selector: WorldEvolutionReplaySelector) => ProviderMatches<unknown>;
  };
  checkpoints: {
    read: (selector: WorldEvolutionCheckpointSelector) => ProviderMatches<unknown>;
  };
  supervision: {
    read: (selector: WorldEvolutionSupervisionSelector) => ProviderMatches<unknown>;
  };
  commitRequests: {
    read: (selector: WorldEvolutionCommitRequestSelector) => ProviderMatches<unknown>;
  };
};

export type WorldEvolutionSelectorReadFacade = {
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

export type RejectionInput = {
  category: WorldEvolutionSelectorReadRejectionCategory;
  methodId: WorldEvolutionSelectorReadMethodId;
  message: string;
  details?: JsonObject;
};
