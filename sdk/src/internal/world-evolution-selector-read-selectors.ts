import { asRecord } from './utils.js';
import type {
  WorldEvolutionCheckpointSelector,
  WorldEvolutionCommitRequestSelector,
  WorldEvolutionExecutionEventSelector,
  WorldEvolutionMatchMode,
  WorldEvolutionReplaySelector,
  WorldEvolutionSupervisionSelector,
} from '../runtime/world-evolution-selector-read.js';
import { createSelectorReadError } from './world-evolution-selector-read-errors.js';
import {
  assertNoUnexpectedKeys,
  countPresentKeys,
  hasAnyKey,
  normalizeActorRefs,
  normalizeEffectClass,
  normalizeEvidenceRef,
  normalizeEvidenceRefs,
  normalizeReplayMode,
  normalizeRequiredText,
  normalizeStage,
  normalizeStringArray,
  normalizeSupervisionOutcome,
  normalizeTick,
} from './world-evolution-selector-read-shared.js';

const EXECUTION_SELECTOR_KEYS = new Set([
  'eventId',
  'worldId',
  'appId',
  'sessionId',
  'traceId',
  'tick',
  'eventKind',
  'stage',
  'actorRefs',
  'causation',
  'correlation',
  'effectClass',
  'reason',
  'evidenceRefs',
]);

const REPLAY_SELECTOR_KEYS = new Set([
  'replayRef',
  'replayMode',
  'worldId',
  'sessionId',
  'traceId',
  'eventId',
  'tick',
]);

const CHECKPOINT_SELECTOR_KEYS = new Set([
  'checkpointId',
  'checkpointRef',
  'restoreStatus',
  'worldId',
  'sessionId',
  'traceId',
  'eventId',
  'tick',
]);

const SUPERVISION_SELECTOR_KEYS = new Set([
  'worldId',
  'sessionId',
  'traceId',
  'eventId',
  'tick',
  'supervisionOutcome',
]);

const COMMIT_SELECTOR_KEYS = new Set([
  'worldId',
  'appId',
  'sessionId',
  'effectClass',
  'scope',
  'schemaId',
  'schemaVersion',
  'actorRefs',
  'reason',
  'evidenceRefs',
  'sourceEventIds',
  'traceId',
  'tick',
  'causation',
  'correlation',
  'checkpointRefs',
  'supervisionRefs',
]);

export type ValidatedSelector<TSelector> = {
  selector: TSelector;
  matchMode: WorldEvolutionMatchMode;
};

export function validateExecutionSelector(
  selector: WorldEvolutionExecutionEventSelector,
): ValidatedSelector<WorldEvolutionExecutionEventSelector> {
  const methodId = 'worldEvolution.executionEvents.read';
  const input = asRecord(selector);
  assertNoUnexpectedKeys(input, EXECUTION_SELECTOR_KEYS, methodId);

  const normalized: WorldEvolutionExecutionEventSelector = {};
  if (input.eventId !== undefined) normalized.eventId = normalizeRequiredText(input.eventId, 'eventId', 'INVALID_SELECTOR', methodId);
  if (input.worldId !== undefined) normalized.worldId = normalizeRequiredText(input.worldId, 'worldId', 'INVALID_SELECTOR', methodId);
  if (input.appId !== undefined) normalized.appId = normalizeRequiredText(input.appId, 'appId', 'INVALID_SELECTOR', methodId);
  if (input.sessionId !== undefined) normalized.sessionId = normalizeRequiredText(input.sessionId, 'sessionId', 'INVALID_SELECTOR', methodId);
  if (input.traceId !== undefined) normalized.traceId = normalizeRequiredText(input.traceId, 'traceId', 'INVALID_SELECTOR', methodId);
  if (input.tick !== undefined) normalized.tick = normalizeTick(input.tick, 'tick', 'INVALID_SELECTOR', methodId);
  if (input.eventKind !== undefined) normalized.eventKind = normalizeRequiredText(input.eventKind, 'eventKind', 'INVALID_SELECTOR', methodId);
  if (input.stage !== undefined) normalized.stage = normalizeStage(input.stage, 'INVALID_SELECTOR', methodId);
  if (input.actorRefs !== undefined) normalized.actorRefs = normalizeActorRefs(input.actorRefs, 'INVALID_SELECTOR', methodId);
  if (input.causation !== undefined) normalized.causation = normalizeRequiredText(input.causation, 'causation', 'INVALID_SELECTOR', methodId);
  if (input.correlation !== undefined) normalized.correlation = normalizeRequiredText(input.correlation, 'correlation', 'INVALID_SELECTOR', methodId);
  if (input.effectClass !== undefined) normalized.effectClass = normalizeEffectClass(input.effectClass, 'INVALID_SELECTOR', methodId);
  if (input.reason !== undefined) normalized.reason = normalizeRequiredText(input.reason, 'reason', 'INVALID_SELECTOR', methodId);
  if (input.evidenceRefs !== undefined) normalized.evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs, 'INVALID_SELECTOR', methodId);

  if (normalized.eventId) {
    if (Object.keys(normalized).length !== 1) {
      throw createSelectorReadError({
        category: 'INVALID_SELECTOR',
        methodId,
        message: `${methodId} does not allow eventId with additional selector primitives`,
      });
    }
    return { selector: normalized, matchMode: 'exact' };
  }

  if (normalized.tick !== undefined) {
    const hasExactTriple = Boolean(normalized.worldId && normalized.sessionId);
    const exactKeyCount = countPresentKeys(normalized, ['worldId', 'sessionId', 'tick']);
    if (!hasExactTriple) {
      throw createSelectorReadError({
        category: 'INCOMPLETE_SELECTOR',
        methodId,
        message: `${methodId} requires worldId + sessionId + tick for exact-match tick selectors`,
      });
    }
    if (hasExactTriple && Object.keys(normalized).length === 3) {
      return { selector: normalized, matchMode: 'exact' };
    }
    if (hasExactTriple && exactKeyCount === 3) {
      throw createSelectorReadError({
        category: 'INVALID_SELECTOR',
        methodId,
        message: `${methodId} does not allow mixing exact tick selectors with filter refinements`,
      });
    }
  }

  if (normalized.tick !== undefined) {
    throw createSelectorReadError({
      category: 'INVALID_SELECTOR',
      methodId,
      message: `${methodId} does not allow tick in filter selectors`,
    });
  }

  const hasAnchor = Boolean(normalized.worldId || normalized.sessionId || normalized.traceId);
  const hasRefinement = hasAnyKey(normalized, [
    'eventKind',
    'stage',
    'actorRefs',
    'causation',
    'correlation',
    'effectClass',
    'reason',
    'evidenceRefs',
  ]);
  if (normalized.appId && Object.keys(normalized).length === 1) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires an anchor when appId is provided`,
    });
  }
  if (hasRefinement && !hasAnchor) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires worldId, sessionId, or traceId before refinements`,
    });
  }
  if (!hasAnchor) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires at least one anchor selector`,
    });
  }
  return { selector: normalized, matchMode: 'filter' };
}

export function validateReplaySelector(
  selector: WorldEvolutionReplaySelector,
): ValidatedSelector<WorldEvolutionReplaySelector> {
  const methodId = 'worldEvolution.replays.read';
  const input = asRecord(selector);
  assertNoUnexpectedKeys(input, REPLAY_SELECTOR_KEYS, methodId);

  const normalized: WorldEvolutionReplaySelector = {};
  if (input.replayRef !== undefined) normalized.replayRef = normalizeEvidenceRef(input.replayRef, 'INVALID_SELECTOR', methodId);
  if (input.replayMode !== undefined) normalized.replayMode = normalizeReplayMode(input.replayMode, 'INVALID_SELECTOR', methodId);
  if (input.worldId !== undefined) normalized.worldId = normalizeRequiredText(input.worldId, 'worldId', 'INVALID_SELECTOR', methodId);
  if (input.sessionId !== undefined) normalized.sessionId = normalizeRequiredText(input.sessionId, 'sessionId', 'INVALID_SELECTOR', methodId);
  if (input.traceId !== undefined) normalized.traceId = normalizeRequiredText(input.traceId, 'traceId', 'INVALID_SELECTOR', methodId);
  if (input.eventId !== undefined) normalized.eventId = normalizeRequiredText(input.eventId, 'eventId', 'INVALID_SELECTOR', methodId);
  if (input.tick !== undefined) normalized.tick = normalizeTick(input.tick, 'tick', 'INVALID_SELECTOR', methodId);

  if (normalized.replayRef && Object.keys(normalized).length === 1) {
    return { selector: normalized, matchMode: 'exact' };
  }
  if (normalized.replayRef) {
    const allowedKeys = ['replayRef', 'replayMode'];
    if (Object.keys(normalized).some((key) => !allowedKeys.includes(key))) {
      throw createSelectorReadError({
        category: 'INVALID_SELECTOR',
        methodId,
        message: `${methodId} only allows replayRef with optional replayMode`,
      });
    }
    return { selector: normalized, matchMode: 'filter' };
  }

  const hasAnchor = Boolean(normalized.worldId || normalized.sessionId || normalized.traceId);
  if ((normalized.replayMode || normalized.eventId || normalized.tick !== undefined) && !hasAnchor) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires a replay reference or execution-context anchor`,
    });
  }
  if (!hasAnchor) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires replayRef or an execution-context anchor`,
    });
  }
  return { selector: normalized, matchMode: 'filter' };
}

export function validateCheckpointSelector(
  selector: WorldEvolutionCheckpointSelector,
): ValidatedSelector<WorldEvolutionCheckpointSelector> {
  const methodId = 'worldEvolution.checkpoints.read';
  const input = asRecord(selector);
  assertNoUnexpectedKeys(input, CHECKPOINT_SELECTOR_KEYS, methodId);

  const normalized: WorldEvolutionCheckpointSelector = {};
  if (input.checkpointId !== undefined) normalized.checkpointId = normalizeRequiredText(input.checkpointId, 'checkpointId', 'INVALID_SELECTOR', methodId);
  if (input.checkpointRef !== undefined) normalized.checkpointRef = normalizeRequiredText(input.checkpointRef, 'checkpointRef', 'INVALID_SELECTOR', methodId);
  if (input.restoreStatus !== undefined) normalized.restoreStatus = normalizeRequiredText(input.restoreStatus, 'restoreStatus', 'INVALID_SELECTOR', methodId);
  if (input.worldId !== undefined) normalized.worldId = normalizeRequiredText(input.worldId, 'worldId', 'INVALID_SELECTOR', methodId);
  if (input.sessionId !== undefined) normalized.sessionId = normalizeRequiredText(input.sessionId, 'sessionId', 'INVALID_SELECTOR', methodId);
  if (input.traceId !== undefined) normalized.traceId = normalizeRequiredText(input.traceId, 'traceId', 'INVALID_SELECTOR', methodId);
  if (input.eventId !== undefined) normalized.eventId = normalizeRequiredText(input.eventId, 'eventId', 'INVALID_SELECTOR', methodId);
  if (input.tick !== undefined) normalized.tick = normalizeTick(input.tick, 'tick', 'INVALID_SELECTOR', methodId);

  if (normalized.checkpointId && Object.keys(normalized).length === 1) {
    return { selector: normalized, matchMode: 'exact' };
  }
  if (normalized.checkpointRef && Object.keys(normalized).length === 1) {
    return { selector: normalized, matchMode: 'exact' };
  }
  if (normalized.checkpointId || normalized.checkpointRef) {
    const allowedKeys = new Set(['checkpointId', 'checkpointRef', 'restoreStatus']);
    if (Object.keys(normalized).some((key) => !allowedKeys.has(key))) {
      throw createSelectorReadError({
        category: 'INVALID_SELECTOR',
        methodId,
        message: `${methodId} only allows checkpointId or checkpointRef with optional restoreStatus`,
      });
    }
    return { selector: normalized, matchMode: 'filter' };
  }

  const hasAnchor = Boolean(normalized.worldId || normalized.sessionId || normalized.traceId);
  if ((normalized.restoreStatus || normalized.eventId || normalized.tick !== undefined) && !hasAnchor) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires checkpoint identity or an execution-context anchor`,
    });
  }
  if (!hasAnchor) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires checkpoint identity or an execution-context anchor`,
    });
  }
  return { selector: normalized, matchMode: 'filter' };
}

export function validateSupervisionSelector(
  selector: WorldEvolutionSupervisionSelector,
): ValidatedSelector<WorldEvolutionSupervisionSelector> {
  const methodId = 'worldEvolution.supervision.read';
  const input = asRecord(selector);
  assertNoUnexpectedKeys(input, SUPERVISION_SELECTOR_KEYS, methodId);

  const normalized: WorldEvolutionSupervisionSelector = {};
  if (input.worldId !== undefined) normalized.worldId = normalizeRequiredText(input.worldId, 'worldId', 'INVALID_SELECTOR', methodId);
  if (input.sessionId !== undefined) normalized.sessionId = normalizeRequiredText(input.sessionId, 'sessionId', 'INVALID_SELECTOR', methodId);
  if (input.traceId !== undefined) normalized.traceId = normalizeRequiredText(input.traceId, 'traceId', 'INVALID_SELECTOR', methodId);
  if (input.eventId !== undefined) normalized.eventId = normalizeRequiredText(input.eventId, 'eventId', 'INVALID_SELECTOR', methodId);
  if (input.tick !== undefined) normalized.tick = normalizeTick(input.tick, 'tick', 'INVALID_SELECTOR', methodId);
  if (input.supervisionOutcome !== undefined) normalized.supervisionOutcome = normalizeSupervisionOutcome(input.supervisionOutcome, 'INVALID_SELECTOR', methodId);

  const hasAnchor = Boolean(normalized.worldId || normalized.sessionId || normalized.traceId);
  if ((normalized.supervisionOutcome || normalized.eventId || normalized.tick !== undefined) && !hasAnchor) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires an execution-context anchor`,
    });
  }
  if (!hasAnchor) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires worldId, sessionId, or traceId`,
    });
  }
  return { selector: normalized, matchMode: 'filter' };
}

export function validateCommitSelector(
  selector: WorldEvolutionCommitRequestSelector,
): ValidatedSelector<WorldEvolutionCommitRequestSelector> {
  const methodId = 'worldEvolution.commitRequests.read';
  const input = asRecord(selector);
  assertNoUnexpectedKeys(input, COMMIT_SELECTOR_KEYS, methodId);

  const normalized: WorldEvolutionCommitRequestSelector = {};
  if (input.worldId !== undefined) normalized.worldId = normalizeRequiredText(input.worldId, 'worldId', 'INVALID_SELECTOR', methodId);
  if (input.appId !== undefined) normalized.appId = normalizeRequiredText(input.appId, 'appId', 'INVALID_SELECTOR', methodId);
  if (input.sessionId !== undefined) normalized.sessionId = normalizeRequiredText(input.sessionId, 'sessionId', 'INVALID_SELECTOR', methodId);
  if (input.effectClass !== undefined) normalized.effectClass = normalizeEffectClass(input.effectClass, 'INVALID_SELECTOR', methodId);
  if (input.scope !== undefined) normalized.scope = normalizeRequiredText(input.scope, 'scope', 'INVALID_SELECTOR', methodId);
  if (input.schemaId !== undefined) normalized.schemaId = normalizeRequiredText(input.schemaId, 'schemaId', 'INVALID_SELECTOR', methodId);
  if (input.schemaVersion !== undefined) normalized.schemaVersion = normalizeRequiredText(input.schemaVersion, 'schemaVersion', 'INVALID_SELECTOR', methodId);
  if (input.actorRefs !== undefined) normalized.actorRefs = normalizeActorRefs(input.actorRefs, 'INVALID_SELECTOR', methodId);
  if (input.reason !== undefined) normalized.reason = normalizeRequiredText(input.reason, 'reason', 'INVALID_SELECTOR', methodId);
  if (input.evidenceRefs !== undefined) normalized.evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs, 'INVALID_SELECTOR', methodId);
  if (input.sourceEventIds !== undefined) normalized.sourceEventIds = normalizeStringArray(input.sourceEventIds, 'sourceEventIds', 'INVALID_SELECTOR', methodId);
  if (input.traceId !== undefined) normalized.traceId = normalizeRequiredText(input.traceId, 'traceId', 'INVALID_SELECTOR', methodId);
  if (input.tick !== undefined) normalized.tick = normalizeTick(input.tick, 'tick', 'INVALID_SELECTOR', methodId);
  if (input.causation !== undefined) normalized.causation = normalizeRequiredText(input.causation, 'causation', 'INVALID_SELECTOR', methodId);
  if (input.correlation !== undefined) normalized.correlation = normalizeRequiredText(input.correlation, 'correlation', 'INVALID_SELECTOR', methodId);
  if (input.checkpointRefs !== undefined) normalized.checkpointRefs = normalizeStringArray(input.checkpointRefs, 'checkpointRefs', 'INVALID_SELECTOR', methodId);
  if (input.supervisionRefs !== undefined) normalized.supervisionRefs = normalizeStringArray(input.supervisionRefs, 'supervisionRefs', 'INVALID_SELECTOR', methodId);

  if (!normalized.worldId || !normalized.appId || !normalized.sessionId) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires worldId + appId + sessionId`,
    });
  }
  if (Boolean(normalized.schemaId) !== Boolean(normalized.schemaVersion)) {
    throw createSelectorReadError({
      category: 'INCOMPLETE_SELECTOR',
      methodId,
      message: `${methodId} requires schemaId + schemaVersion as a pair`,
    });
  }
  return { selector: normalized, matchMode: 'filter' };
}
