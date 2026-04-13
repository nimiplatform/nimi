import { asRecord } from './utils.js';
import type {
  WorldEvolutionCheckpointView,
  WorldEvolutionCommitRequestView,
  WorldEvolutionExecutionEventView,
  WorldEvolutionReplayView,
  WorldEvolutionSelectorReadMethodId,
  WorldEvolutionSupervisionView,
} from '../runtime/world-evolution-selector-read.js';
import { createSelectorReadError } from './world-evolution-selector-read-errors.js';
import {
  assertAllowedViewKeys,
  normalizeActorRefs,
  normalizeEffectClass,
  normalizeEvidenceRef,
  normalizeEvidenceRefs,
  normalizeOptionalText,
  normalizeReplayMode,
  normalizeRequiredText,
  normalizeStage,
  normalizeStringArray,
  normalizeSupervisionOutcome,
  normalizeTick,
} from './world-evolution-selector-read-shared.js';

export function normalizeExecutionEventView(
  value: unknown,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionExecutionEventView {
  const record = asRecord(value);
  assertAllowedViewKeys(record, new Set([
    'eventId',
    'worldId',
    'appId',
    'sessionId',
    'traceId',
    'tick',
    'timestamp',
    'eventKind',
    'stage',
    'actorRefs',
    'causation',
    'correlation',
    'effectClass',
    'reason',
    'evidenceRefs',
    'detail',
  ]), methodId);
  const detailRecord = record.detail === undefined ? undefined : asRecord(record.detail, { allowArray: false });
  const detail = detailRecord && Object.keys(detailRecord).length > 0
    ? {
      ...detailRecord,
      kind: normalizeRequiredText(detailRecord.kind, 'detail.kind', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    }
    : undefined;
  return {
    eventId: normalizeRequiredText(record.eventId, 'eventId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    worldId: normalizeRequiredText(record.worldId, 'worldId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    appId: normalizeRequiredText(record.appId, 'appId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    sessionId: normalizeRequiredText(record.sessionId, 'sessionId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    traceId: normalizeRequiredText(record.traceId, 'traceId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    tick: normalizeTick(record.tick, 'tick', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    timestamp: normalizeRequiredText(record.timestamp, 'timestamp', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    eventKind: normalizeRequiredText(record.eventKind, 'eventKind', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    stage: normalizeStage(record.stage, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    actorRefs: normalizeActorRefs(record.actorRefs, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    causation: record.causation === null ? null : normalizeRequiredText(record.causation, 'causation', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    correlation: record.correlation === null ? null : normalizeRequiredText(record.correlation, 'correlation', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    effectClass: normalizeEffectClass(record.effectClass, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    reason: normalizeRequiredText(record.reason, 'reason', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    ...(detail ? { detail } : {}),
  };
}

export function normalizeReplayView(value: unknown, methodId: WorldEvolutionSelectorReadMethodId): WorldEvolutionReplayView {
  const record = asRecord(value);
  assertAllowedViewKeys(record, new Set([
    'replayRef',
    'replayMode',
    'replayResult',
    'worldId',
    'sessionId',
    'traceId',
    'eventId',
    'tick',
  ]), methodId);
  return {
    replayRef: normalizeEvidenceRef(record.replayRef, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    replayMode: normalizeReplayMode(record.replayMode, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    ...(normalizeOptionalText(record.replayResult) ? { replayResult: normalizeRequiredText(record.replayResult, 'replayResult', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.worldId) ? { worldId: normalizeRequiredText(record.worldId, 'worldId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.sessionId) ? { sessionId: normalizeRequiredText(record.sessionId, 'sessionId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.traceId) ? { traceId: normalizeRequiredText(record.traceId, 'traceId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.eventId) ? { eventId: normalizeRequiredText(record.eventId, 'eventId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(record.tick !== undefined ? { tick: normalizeTick(record.tick, 'tick', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
  };
}

export function normalizeCheckpointView(
  value: unknown,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionCheckpointView {
  const record = asRecord(value);
  assertAllowedViewKeys(record, new Set([
    'checkpointId',
    'checkpointRef',
    'restoreStatus',
    'worldId',
    'sessionId',
    'traceId',
    'eventId',
    'tick',
  ]), methodId);
  return {
    checkpointId: normalizeRequiredText(record.checkpointId, 'checkpointId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    ...(normalizeOptionalText(record.checkpointRef) ? { checkpointRef: normalizeRequiredText(record.checkpointRef, 'checkpointRef', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.restoreStatus) ? { restoreStatus: normalizeRequiredText(record.restoreStatus, 'restoreStatus', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.worldId) ? { worldId: normalizeRequiredText(record.worldId, 'worldId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.sessionId) ? { sessionId: normalizeRequiredText(record.sessionId, 'sessionId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.traceId) ? { traceId: normalizeRequiredText(record.traceId, 'traceId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.eventId) ? { eventId: normalizeRequiredText(record.eventId, 'eventId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(record.tick !== undefined ? { tick: normalizeTick(record.tick, 'tick', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
  };
}

export function normalizeSupervisionView(
  value: unknown,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionSupervisionView {
  const record = asRecord(value);
  assertAllowedViewKeys(record, new Set([
    'supervisionOutcome',
    'worldId',
    'sessionId',
    'traceId',
    'eventId',
    'tick',
    'evidenceRefs',
    'checkpointRefs',
  ]), methodId);
  const worldId = normalizeOptionalText(record.worldId);
  const sessionId = normalizeOptionalText(record.sessionId);
  const traceId = normalizeOptionalText(record.traceId);
  if (!worldId && !sessionId && !traceId) {
    throw createSelectorReadError({
      category: 'UNSUPPORTED_PROJECTION_SHAPE',
      methodId,
      message: `${methodId} requires at least one supervision anchor in every match`,
    });
  }
  return {
    supervisionOutcome: normalizeSupervisionOutcome(record.supervisionOutcome, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    ...(worldId ? { worldId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(normalizeOptionalText(record.eventId) ? { eventId: normalizeRequiredText(record.eventId, 'eventId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(record.tick !== undefined ? { tick: normalizeTick(record.tick, 'tick', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(record.evidenceRefs !== undefined ? { evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs, 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(record.checkpointRefs !== undefined ? { checkpointRefs: normalizeStringArray(record.checkpointRefs, 'checkpointRefs', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
  };
}

export function normalizeCommitRequestView(
  value: unknown,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionCommitRequestView {
  const record = asRecord(value);
  assertAllowedViewKeys(record, new Set([
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
  ]), methodId);
  return {
    worldId: normalizeRequiredText(record.worldId, 'worldId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    appId: normalizeRequiredText(record.appId, 'appId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    sessionId: normalizeRequiredText(record.sessionId, 'sessionId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    effectClass: normalizeEffectClass(record.effectClass, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    scope: normalizeRequiredText(record.scope, 'scope', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    schemaId: normalizeRequiredText(record.schemaId, 'schemaId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    schemaVersion: normalizeRequiredText(record.schemaVersion, 'schemaVersion', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    actorRefs: normalizeActorRefs(record.actorRefs, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    reason: normalizeRequiredText(record.reason, 'reason', 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs, 'UNSUPPORTED_PROJECTION_SHAPE', methodId),
    ...(record.sourceEventIds !== undefined ? { sourceEventIds: normalizeStringArray(record.sourceEventIds, 'sourceEventIds', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.traceId) ? { traceId: normalizeRequiredText(record.traceId, 'traceId', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(record.tick !== undefined ? { tick: normalizeTick(record.tick, 'tick', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.causation) ? { causation: normalizeRequiredText(record.causation, 'causation', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(normalizeOptionalText(record.correlation) ? { correlation: normalizeRequiredText(record.correlation, 'correlation', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(record.checkpointRefs !== undefined ? { checkpointRefs: normalizeStringArray(record.checkpointRefs, 'checkpointRefs', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
    ...(record.supervisionRefs !== undefined ? { supervisionRefs: normalizeStringArray(record.supervisionRefs, 'supervisionRefs', 'UNSUPPORTED_PROJECTION_SHAPE', methodId) } : {}),
  };
}
