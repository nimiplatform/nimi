import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  WorldEvolutionCheckpointSelector,
  WorldEvolutionCheckpointView,
  WorldEvolutionCommitRequestSelector,
  WorldEvolutionCommitRequestView,
  WorldEvolutionExecutionEventSelector,
  WorldEvolutionExecutionEventView,
  WorldEvolutionReplaySelector,
  WorldEvolutionReplayView,
  WorldEvolutionSelectorReadMethodId,
  WorldEvolutionSelectorReadRejectionCategory,
  WorldEvolutionSupervisionSelector,
  WorldEvolutionSupervisionView,
} from '@nimiplatform/sdk/runtime';
import { queryDesktopWorldEvolutionCommitRequests } from './commit-requests.js';
import { queryDesktopWorldEvolutionExecutionEvents } from './execution-events.js';
import { queryDesktopWorldEvolutionReplays } from './replays.js';

export type DesktopWorldEvolutionSelectorReadAdapter = {
  executionEvents: {
    read: (selector: WorldEvolutionExecutionEventSelector) => Promise<WorldEvolutionExecutionEventView[]>;
  };
  replays: {
    read: (selector: WorldEvolutionReplaySelector) => Promise<WorldEvolutionReplayView[]>;
  };
  checkpoints: {
    read: (selector: WorldEvolutionCheckpointSelector) => Promise<WorldEvolutionCheckpointView[]>;
  };
  supervision: {
    read: (selector: WorldEvolutionSupervisionSelector) => Promise<WorldEvolutionSupervisionView[]>;
  };
  commitRequests: {
    read: (selector: WorldEvolutionCommitRequestSelector) => Promise<WorldEvolutionCommitRequestView[]>;
  };
};

function createMissingEvidenceError(
  methodId: WorldEvolutionSelectorReadMethodId,
  missingKind: string,
): Error {
  const rejectionCategory: WorldEvolutionSelectorReadRejectionCategory = 'MISSING_REQUIRED_EVIDENCE';
  return createNimiError({
    message: `desktop runtime does not expose ${missingKind} required by ${methodId}`,
    reasonCode: ReasonCode.ACTION_NOT_FOUND,
    actionHint: 'provide_world_evolution_evidence',
    source: 'sdk',
    details: {
      rejectionCategory,
      methodId,
      backingBoundary: 'desktop-private-world-evolution-adapter',
    },
  });
}

function rejectMissingEvidence(methodId: WorldEvolutionSelectorReadMethodId, missingKind: string): Promise<never> {
  return Promise.reject(createMissingEvidenceError(methodId, missingKind));
}

export function createDesktopWorldEvolutionSelectorReadAdapter(): DesktopWorldEvolutionSelectorReadAdapter {
  return {
    executionEvents: {
      read: async (selector) => queryDesktopWorldEvolutionExecutionEvents(selector),
    },
    replays: {
      read: async (selector) => queryDesktopWorldEvolutionReplays(selector),
    },
    checkpoints: {
      read: async (_selector) => rejectMissingEvidence(
        'worldEvolution.checkpoints.read',
        'world evolution checkpoint evidence',
      ),
    },
    supervision: {
      read: async (_selector) => rejectMissingEvidence(
        'worldEvolution.supervision.read',
        'world evolution supervision evidence',
      ),
    },
    commitRequests: {
      read: async (selector) => queryDesktopWorldEvolutionCommitRequests(selector),
    },
  };
}
