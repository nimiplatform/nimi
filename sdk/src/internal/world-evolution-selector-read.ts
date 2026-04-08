import { asRecord, normalizeText } from './utils.js';
import type { JsonObject } from './utils.js';
import { createNimiError, asNimiError } from '../runtime/errors.js';
import { ReasonCode } from '../types/index.js';
import type {
  WorldEvolutionActorRef,
  WorldEvolutionCheckpointReadResult,
  WorldEvolutionCheckpointSelector,
  WorldEvolutionCheckpointView,
  WorldEvolutionCommitRequestReadResult,
  WorldEvolutionCommitRequestSelector,
  WorldEvolutionCommitRequestView,
  WorldEvolutionEffectClass,
  WorldEvolutionEvidenceRef,
  WorldEvolutionExecutionEventReadResult,
  WorldEvolutionExecutionEventSelector,
  WorldEvolutionExecutionEventView,
  WorldEvolutionExecutionStage,
  WorldEvolutionMatchMode,
  WorldEvolutionReplayReadResult,
  WorldEvolutionReplaySelector,
  WorldEvolutionReplayView,
  WorldEvolutionSelectorReadMethodId,
  WorldEvolutionSelectorReadRejectionCategory,
  WorldEvolutionSupervisionOutcome,
  WorldEvolutionSupervisionReadResult,
  WorldEvolutionSupervisionSelector,
  WorldEvolutionSupervisionView,
} from '../runtime/world-evolution-selector-read.js';

const EXECUTION_STAGES = new Set<WorldEvolutionExecutionStage>([
  'INGRESS',
  'NORMALIZE',
  'SCHEDULE',
  'DISPATCH',
  'TRANSITION',
  'EFFECT',
  'COMMIT_REQUEST',
  'CHECKPOINT',
  'TERMINAL',
]);

const EFFECT_CLASSES = new Set<WorldEvolutionEffectClass>([
  'NONE',
  'MEMORY_ONLY',
  'STATE_ONLY',
  'STATE_AND_HISTORY',
]);

const SUPERVISION_OUTCOMES = new Set<WorldEvolutionSupervisionOutcome>([
  'CONTINUE',
  'DEFER',
  'ABORT',
  'QUARANTINE',
]);

const REPLAY_MODES = new Set([
  'RECORDED',
]);

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

const COMMON_FORBIDDEN_VIEW_KEYS = new Set([
  'workflow',
  'task',
  'node',
  'edge',
  'callback_ref',
  'external_async',
  'route_policy',
  'fallback',
  'runMode',
]);

const RUNTIME_PROVIDER_REGISTRY = new WeakMap<object, WorldEvolutionSelectorReadProvider>();

type ProviderMatches<T> = Promise<T[] | ReadonlyArray<T>>;

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

type WorldEvolutionSelectorReadFacade = {
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

type RejectionInput = {
  category: WorldEvolutionSelectorReadRejectionCategory;
  methodId: WorldEvolutionSelectorReadMethodId;
  message: string;
  details?: JsonObject;
};

function mapReasonCode(category: WorldEvolutionSelectorReadRejectionCategory): string {
  switch (category) {
    case 'INVALID_SELECTOR':
    case 'INCOMPLETE_SELECTOR':
      return ReasonCode.ACTION_INPUT_INVALID;
    case 'MISSING_REQUIRED_EVIDENCE':
      return ReasonCode.ACTION_NOT_FOUND;
    case 'UNSUPPORTED_PROJECTION_SHAPE':
      return ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED;
    case 'BOUNDARY_DENIED':
      return ReasonCode.ACTION_PERMISSION_DENIED;
  }
}

function mapActionHint(category: WorldEvolutionSelectorReadRejectionCategory): string {
  switch (category) {
    case 'INVALID_SELECTOR':
      return 'fix_world_evolution_selector';
    case 'INCOMPLETE_SELECTOR':
      return 'complete_world_evolution_selector';
    case 'MISSING_REQUIRED_EVIDENCE':
      return 'provide_world_evolution_evidence';
    case 'UNSUPPORTED_PROJECTION_SHAPE':
      return 'check_world_evolution_projection_shape';
    case 'BOUNDARY_DENIED':
      return 'ensure_world_evolution_read_boundary';
  }
}

function createSelectorReadError(input: RejectionInput): Error {
  return createNimiError({
    message: input.message,
    reasonCode: mapReasonCode(input.category),
    actionHint: mapActionHint(input.category),
    source: 'sdk',
    details: {
      rejectionCategory: input.category,
      methodId: input.methodId,
      ...(input.details || {}),
    },
  });
}

export function createWorldEvolutionSelectorReadError(
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
  message: string,
  details?: JsonObject,
): Error {
  return createSelectorReadError({
    category,
    methodId,
    message,
    details,
  });
}

export function setRuntimeWorldEvolutionSelectorReadProvider(
  runtime: object,
  provider: WorldEvolutionSelectorReadProvider | null,
): void {
  if (!provider) {
    RUNTIME_PROVIDER_REGISTRY.delete(runtime);
    return;
  }
  RUNTIME_PROVIDER_REGISTRY.set(runtime, provider);
}

export function getRuntimeWorldEvolutionSelectorReadProvider(runtime: object): WorldEvolutionSelectorReadProvider | null {
  return RUNTIME_PROVIDER_REGISTRY.get(runtime) || null;
}

function listUnexpectedKeys(record: JsonObject, allowed: Set<string>): string[] {
  return Object.keys(record).filter((key) => !allowed.has(key));
}

function normalizeRequiredText(
  value: unknown,
  fieldName: string,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} requires ${fieldName}`,
    });
  }
  return normalized;
}

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeReplayMode(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): string {
  const replayMode = normalizeRequiredText(value, 'replayMode', category, methodId);
  if (!REPLAY_MODES.has(replayMode)) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} only admits replayMode RECORDED`,
    });
  }
  return replayMode;
}

function normalizeTick(
  value: unknown,
  fieldName: string,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} requires ${fieldName} to be a non-negative integer`,
    });
  }
  return value;
}

function normalizeOptionalTick(
  value: unknown,
  fieldName: string,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeTick(value, fieldName, category, methodId);
}

function normalizeActorRefs(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionActorRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} requires actorRefs to be a non-empty array`,
    });
  }
  return value.map((item) => {
    const record = asRecord(item);
    const actorId = normalizeRequiredText(record.actorId, 'actorRefs.actorId', category, methodId);
    const actorType = normalizeRequiredText(record.actorType, 'actorRefs.actorType', category, methodId);
    const role = normalizeOptionalText(record.role);
    return role ? { actorId, actorType, role } : { actorId, actorType };
  });
}

function normalizeOptionalActorRefs(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionActorRef[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeActorRefs(value, category, methodId);
}

function normalizeEvidenceRefs(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionEvidenceRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} requires evidenceRefs to be a non-empty array`,
    });
  }
  return value.map((item) => normalizeEvidenceRef(item, category, methodId));
}

function normalizeOptionalEvidenceRefs(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionEvidenceRef[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeEvidenceRefs(value, category, methodId);
}

function normalizeEvidenceRef(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionEvidenceRef {
  const record = asRecord(value);
  const kind = normalizeRequiredText(record.kind, 'evidenceRef.kind', category, methodId);
  const refId = normalizeRequiredText(record.refId, 'evidenceRef.refId', category, methodId);
  const uri = normalizeOptionalText(record.uri);
  return uri ? { kind, refId, uri } : { kind, refId };
}

function normalizeStringArray(
  value: unknown,
  fieldName: string,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} requires ${fieldName} to be a non-empty array`,
    });
  }
  return value.map((entry) => normalizeRequiredText(entry, fieldName, category, methodId));
}

function normalizeOptionalStringArray(
  value: unknown,
  fieldName: string,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeStringArray(value, fieldName, category, methodId);
}

function normalizeEffectClass(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionEffectClass {
  const normalized = normalizeRequiredText(value, 'effectClass', category, methodId) as WorldEvolutionEffectClass;
  if (!EFFECT_CLASSES.has(normalized)) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} received unsupported effectClass`,
    });
  }
  return normalized;
}

function normalizeOptionalEffectClass(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionEffectClass | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeEffectClass(value, category, methodId);
}

function normalizeStage(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionExecutionStage {
  const normalized = normalizeRequiredText(value, 'stage', category, methodId) as WorldEvolutionExecutionStage;
  if (!EXECUTION_STAGES.has(normalized)) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} received unsupported stage`,
    });
  }
  return normalized;
}

function normalizeOptionalStage(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionExecutionStage | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeStage(value, category, methodId);
}

function normalizeSupervisionOutcome(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionSupervisionOutcome {
  const normalized = normalizeRequiredText(value, 'supervisionOutcome', category, methodId) as WorldEvolutionSupervisionOutcome;
  if (!SUPERVISION_OUTCOMES.has(normalized)) {
    throw createSelectorReadError({
      category,
      methodId,
      message: `${methodId} received unsupported supervision outcome`,
    });
  }
  return normalized;
}

function normalizeOptionalSupervisionOutcome(
  value: unknown,
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
): WorldEvolutionSupervisionOutcome | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeSupervisionOutcome(value, category, methodId);
}

function assertNoUnexpectedKeys(
  input: JsonObject,
  allowed: Set<string>,
  methodId: WorldEvolutionSelectorReadMethodId,
): void {
  const unexpectedKeys = listUnexpectedKeys(input, allowed);
  if (unexpectedKeys.length > 0) {
    throw createSelectorReadError({
      category: 'INVALID_SELECTOR',
      methodId,
      message: `${methodId} received unsupported selector primitive`,
      details: {
        unexpectedKeys,
      },
    });
  }
}

function hasAnyKey(input: JsonObject, keys: string[]): boolean {
  return keys.some((key) => input[key] !== undefined);
}

function countPresentKeys(input: JsonObject, keys: string[]): number {
  return keys.filter((key) => input[key] !== undefined).length;
}

function validateExecutionSelector(selector: WorldEvolutionExecutionEventSelector): {
  selector: WorldEvolutionExecutionEventSelector;
  matchMode: WorldEvolutionMatchMode;
} {
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
    const exactKeyCount = countPresentKeys(normalized as JsonObject, ['worldId', 'sessionId', 'tick']);
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
  const hasRefinement = hasAnyKey(normalized as JsonObject, [
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

function validateReplaySelector(selector: WorldEvolutionReplaySelector): {
  selector: WorldEvolutionReplaySelector;
  matchMode: WorldEvolutionMatchMode;
} {
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

function validateCheckpointSelector(selector: WorldEvolutionCheckpointSelector): {
  selector: WorldEvolutionCheckpointSelector;
  matchMode: WorldEvolutionMatchMode;
} {
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

function validateSupervisionSelector(selector: WorldEvolutionSupervisionSelector): {
  selector: WorldEvolutionSupervisionSelector;
  matchMode: WorldEvolutionMatchMode;
} {
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

function validateCommitSelector(selector: WorldEvolutionCommitRequestSelector): {
  selector: WorldEvolutionCommitRequestSelector;
  matchMode: WorldEvolutionMatchMode;
} {
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

function ensureArray(value: unknown, methodId: WorldEvolutionSelectorReadMethodId): unknown[] {
  if (!Array.isArray(value)) {
    throw createSelectorReadError({
      category: 'UNSUPPORTED_PROJECTION_SHAPE',
      methodId,
      message: `${methodId} requires an array of matches`,
    });
  }
  return value;
}

function assertAllowedViewKeys(
  record: JsonObject,
  allowed: Set<string>,
  methodId: WorldEvolutionSelectorReadMethodId,
): void {
  const keys = Object.keys(record);
  const forbiddenKeys = keys.filter((key) => COMMON_FORBIDDEN_VIEW_KEYS.has(key));
  if (forbiddenKeys.length > 0) {
    throw createSelectorReadError({
      category: 'UNSUPPORTED_PROJECTION_SHAPE',
      methodId,
      message: `${methodId} received forbidden projection keys`,
      details: { forbiddenKeys },
    });
  }
  const unexpectedKeys = keys.filter((key) => !allowed.has(key));
  if (unexpectedKeys.length > 0) {
    throw createSelectorReadError({
      category: 'UNSUPPORTED_PROJECTION_SHAPE',
      methodId,
      message: `${methodId} received unsupported projection keys`,
      details: { unexpectedKeys },
    });
  }
}

function normalizeExecutionEventView(value: unknown, methodId: WorldEvolutionSelectorReadMethodId): WorldEvolutionExecutionEventView {
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

function normalizeReplayView(value: unknown, methodId: WorldEvolutionSelectorReadMethodId): WorldEvolutionReplayView {
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

function normalizeCheckpointView(value: unknown, methodId: WorldEvolutionSelectorReadMethodId): WorldEvolutionCheckpointView {
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

function normalizeSupervisionView(value: unknown, methodId: WorldEvolutionSelectorReadMethodId): WorldEvolutionSupervisionView {
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

function normalizeCommitRequestView(value: unknown, methodId: WorldEvolutionSelectorReadMethodId): WorldEvolutionCommitRequestView {
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

function normalizeProviderError(
  error: unknown,
  methodId: WorldEvolutionSelectorReadMethodId,
): Error {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.ACTION_PERMISSION_DENIED,
    actionHint: 'ensure_world_evolution_read_boundary',
    source: 'sdk',
  });
  const category = normalizeText(asRecord(normalized.details).rejectionCategory) as WorldEvolutionSelectorReadRejectionCategory;
  if (
    category === 'INVALID_SELECTOR'
    || category === 'INCOMPLETE_SELECTOR'
    || category === 'MISSING_REQUIRED_EVIDENCE'
    || category === 'UNSUPPORTED_PROJECTION_SHAPE'
    || category === 'BOUNDARY_DENIED'
  ) {
    return createSelectorReadError({
      category,
      methodId,
      message: normalized.message,
      details: asRecord(normalized.details),
    });
  }
  return createSelectorReadError({
    category: 'BOUNDARY_DENIED',
    methodId,
    message: normalized.message || `${methodId} denied by provider boundary`,
    details: {
      providerReasonCode: normalized.reasonCode,
    },
  });
}

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
