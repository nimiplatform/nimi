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
import { createSelectorReadError, normalizeProviderError } from './world-evolution-selector-read-errors.js';
import { validateCheckpointSelector, validateCommitSelector, validateExecutionSelector, validateReplaySelector, validateSupervisionSelector } from './world-evolution-selector-read-selectors.js';
import { ensureArray } from './world-evolution-selector-read-shared.js';
import type { WorldEvolutionSelectorReadFacade, WorldEvolutionSelectorReadProvider } from './world-evolution-selector-read-types.js';
import { normalizeCheckpointView, normalizeCommitRequestView, normalizeExecutionEventView, normalizeReplayView, normalizeSupervisionView } from './world-evolution-selector-read-views.js';

async function readExecutionEvents(
  resolveProvider: () => WorldEvolutionSelectorReadProvider | null,
  selector: WorldEvolutionExecutionEventSelector,
): Promise<WorldEvolutionExecutionEventReadResult> {
  const methodId = 'worldEvolution.executionEvents.read';
  const validated = validateExecutionSelector(selector);
  const provider = resolveProvider();
  if (!provider) {
    throw createSelectorReadError({
      category: 'BOUNDARY_DENIED',
      methodId,
      message: `${methodId} is not available on this boundary`,
    });
  }
  let matches: unknown[];
  try {
    matches = ensureArray(await provider.executionEvents.read(validated.selector), methodId);
  } catch (error) {
    throw normalizeProviderError(error, methodId);
  }
  return {
    selector: validated.selector,
    matchMode: validated.matchMode,
    matches: matches.map((match) => normalizeExecutionEventView(match, methodId)),
  };
}

async function readReplays(
  resolveProvider: () => WorldEvolutionSelectorReadProvider | null,
  selector: WorldEvolutionReplaySelector,
): Promise<WorldEvolutionReplayReadResult> {
  const methodId = 'worldEvolution.replays.read';
  const validated = validateReplaySelector(selector);
  const provider = resolveProvider();
  if (!provider) {
    throw createSelectorReadError({
      category: 'BOUNDARY_DENIED',
      methodId,
      message: `${methodId} is not available on this boundary`,
    });
  }
  let matches: unknown[];
  try {
    matches = ensureArray(await provider.replays.read(validated.selector), methodId);
  } catch (error) {
    throw normalizeProviderError(error, methodId);
  }
  return {
    selector: validated.selector,
    matchMode: validated.matchMode,
    matches: matches.map((match) => normalizeReplayView(match, methodId)),
  };
}

async function readCheckpoints(
  resolveProvider: () => WorldEvolutionSelectorReadProvider | null,
  selector: WorldEvolutionCheckpointSelector,
): Promise<WorldEvolutionCheckpointReadResult> {
  const methodId = 'worldEvolution.checkpoints.read';
  const validated = validateCheckpointSelector(selector);
  const provider = resolveProvider();
  if (!provider) {
    throw createSelectorReadError({
      category: 'BOUNDARY_DENIED',
      methodId,
      message: `${methodId} is not available on this boundary`,
    });
  }
  let matches: unknown[];
  try {
    matches = ensureArray(await provider.checkpoints.read(validated.selector), methodId);
  } catch (error) {
    throw normalizeProviderError(error, methodId);
  }
  return {
    selector: validated.selector,
    matchMode: validated.matchMode,
    matches: matches.map((match) => normalizeCheckpointView(match, methodId)),
  };
}

async function readSupervision(
  resolveProvider: () => WorldEvolutionSelectorReadProvider | null,
  selector: WorldEvolutionSupervisionSelector,
): Promise<WorldEvolutionSupervisionReadResult> {
  const methodId = 'worldEvolution.supervision.read';
  const validated = validateSupervisionSelector(selector);
  const provider = resolveProvider();
  if (!provider) {
    throw createSelectorReadError({
      category: 'BOUNDARY_DENIED',
      methodId,
      message: `${methodId} is not available on this boundary`,
    });
  }
  let matches: unknown[];
  try {
    matches = ensureArray(await provider.supervision.read(validated.selector), methodId);
  } catch (error) {
    throw normalizeProviderError(error, methodId);
  }
  return {
    selector: validated.selector,
    matchMode: validated.matchMode,
    matches: matches.map((match) => normalizeSupervisionView(match, methodId)),
  };
}

async function readCommitRequests(
  resolveProvider: () => WorldEvolutionSelectorReadProvider | null,
  selector: WorldEvolutionCommitRequestSelector,
): Promise<WorldEvolutionCommitRequestReadResult> {
  const methodId = 'worldEvolution.commitRequests.read';
  const validated = validateCommitSelector(selector);
  const provider = resolveProvider();
  if (!provider) {
    throw createSelectorReadError({
      category: 'BOUNDARY_DENIED',
      methodId,
      message: `${methodId} is not available on this boundary`,
    });
  }
  let matches: unknown[];
  try {
    matches = ensureArray(await provider.commitRequests.read(validated.selector), methodId);
  } catch (error) {
    throw normalizeProviderError(error, methodId);
  }
  return {
    selector: validated.selector,
    matchMode: validated.matchMode,
    matches: matches.map((match) => normalizeCommitRequestView(match, methodId)),
  };
}

export function createWorldEvolutionSelectorReadFacade(
  resolveProvider: () => WorldEvolutionSelectorReadProvider | null,
): WorldEvolutionSelectorReadFacade {
  return {
    executionEvents: {
      read: (selector) => readExecutionEvents(resolveProvider, selector),
    },
    replays: {
      read: (selector) => readReplays(resolveProvider, selector),
    },
    checkpoints: {
      read: (selector) => readCheckpoints(resolveProvider, selector),
    },
    supervision: {
      read: (selector) => readSupervision(resolveProvider, selector),
    },
    commitRequests: {
      read: (selector) => readCommitRequests(resolveProvider, selector),
    },
  };
}
