import { asRecord, normalizeText } from './utils.js';
import type { JsonObject } from './utils.js';
import type {
  WorldEvolutionActorRef,
  WorldEvolutionEffectClass,
  WorldEvolutionExecutionStage,
  WorldEvolutionSelectorReadMethodId,
  WorldEvolutionSelectorReadRejectionCategory,
  WorldEvolutionSupervisionOutcome,
  WorldEvolutionEvidenceRef,
} from '../runtime/world-evolution-selector-read.js';
import { createSelectorReadError } from './world-evolution-selector-read-errors.js';

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
  'STATE_ONLY',
  'STATE_AND_HISTORY',
]);

const SUPERVISION_OUTCOMES = new Set<WorldEvolutionSupervisionOutcome>([
  'CONTINUE',
  'DEFER',
  'ABORT',
  'QUARANTINE',
]);

const REPLAY_MODES = new Set(['RECORDED']);

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

function listUnexpectedKeys(record: JsonObject, allowed: Set<string>): string[] {
  return Object.keys(record).filter((key) => !allowed.has(key));
}

export function normalizeRequiredText(
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

export function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function normalizeReplayMode(
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

export function normalizeTick(
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

export function normalizeActorRefs(
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

export function normalizeEvidenceRefs(
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

export function normalizeEvidenceRef(
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

export function normalizeStringArray(
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

export function normalizeEffectClass(
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

export function normalizeStage(
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

export function normalizeSupervisionOutcome(
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

export function assertNoUnexpectedKeys(
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
      details: { unexpectedKeys },
    });
  }
}

export function hasAnyKey(input: JsonObject, keys: string[]): boolean {
  return keys.some((key) => input[key] !== undefined);
}

export function countPresentKeys(input: JsonObject, keys: string[]): number {
  return keys.filter((key) => input[key] !== undefined).length;
}

export function ensureArray(value: unknown, methodId: WorldEvolutionSelectorReadMethodId): unknown[] {
  if (!Array.isArray(value)) {
    throw createSelectorReadError({
      category: 'UNSUPPORTED_PROJECTION_SHAPE',
      methodId,
      message: `${methodId} requires an array of matches`,
    });
  }
  return value;
}

export function assertAllowedViewKeys(
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
