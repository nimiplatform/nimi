import type {
  EventNodeDraft,
} from '@world-engine/contracts.js';
import type { JsonObject } from '@renderer/bridge/types.js';
import {
  FORGE_WORLD_HISTORY_EVENT_TYPE,
  FORGE_WORLD_WORKSPACE_TARGET_PATH,
} from '@renderer/data/world-data-client.js';

export type MaintainTab = 'WORLD' | 'WORLDVIEW' | 'EVENTS' | 'LOREBOOKS';

export function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function requireWorkspaceSessionId(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('FORGE_WORKSPACE_SESSION_ID_REQUIRED');
  }
  return normalized;
}

export function getTimeFlowRatioFromWorldviewPatch(worldviewPatch: JsonObject): string {
  const timeModel = asRecord(worldviewPatch.timeModel);
  const ratio = timeModel.timeFlowRatio;
  if (typeof ratio === 'number' && Number.isFinite(ratio)) {
    return String(ratio);
  }
  return '1';
}

export function toEventNodeDraft(event: {
  id: string;
  timelineSeq: number;
  level: 'PRIMARY' | 'SECONDARY';
  eventHorizon: 'PAST' | 'ONGOING' | 'FUTURE';
  parentEventId: string | null;
  title: string;
  summary: string | null;
  cause: string | null;
  process: string | null;
  result: string | null;
  timeRef: string | null;
  locationRefs: string[];
  characterRefs: string[];
  dependsOnEventIds: string[];
  evidenceRefs: unknown[];
  confidence: number;
  needsEvidence: boolean;
}): EventNodeDraft {
  return {
    ...event,
    summary: event.summary ?? undefined,
    cause: event.cause ?? undefined,
    process: event.process ?? undefined,
    result: event.result ?? undefined,
    timeRef: event.timeRef ?? undefined,
  } as EventNodeDraft;
}

export function getWorkspaceStateDraft(
  payload: unknown,
): { workspaceVersion: string; worldStateDraft: JsonObject } | null {
  const record = asRecord(payload);
  const items = Array.isArray(record.items) ? record.items : [];
  const workspaceItem = items.find((item) => (
    asRecord(item).targetPath === FORGE_WORLD_WORKSPACE_TARGET_PATH
  ));
  if (!workspaceItem) {
    return null;
  }
  const itemRecord = asRecord(workspaceItem);
  const worldStateDraft = asRecord(itemRecord.payload);
  if (Object.keys(worldStateDraft).length === 0) {
    return null;
  }
  return {
    workspaceVersion: String(record.version || ''),
    worldStateDraft,
  };
}

export function requireNonEmptyString(value: unknown, code: string): string {
  if (typeof value !== 'string') {
    throw new Error(code);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

export function requireWorkspaceStateRef(payload: unknown): {
  recordId: string;
  scope: 'WORLD' | 'ENTITY' | 'RELATION';
  scopeKey: string;
  version?: string;
} {
  const record = asRecord(payload);
  const items = Array.isArray(record.items) ? record.items : [];
  const workspaceItem = items.find((item) => (
    asRecord(item).targetPath === FORGE_WORLD_WORKSPACE_TARGET_PATH
  ));
  if (!workspaceItem) {
    throw new Error('FORGE_WORLD_HISTORY_RELATED_STATE_REF_REQUIRED');
  }
  const itemRecord = asRecord(workspaceItem);
  const version = typeof itemRecord.version === 'string' && itemRecord.version.trim()
    ? itemRecord.version.trim()
    : undefined;
  const scope = requireNonEmptyString(itemRecord.scope, 'FORGE_WORLD_HISTORY_RELATED_STATE_SCOPE_REQUIRED');
  if (scope !== 'WORLD' && scope !== 'ENTITY' && scope !== 'RELATION') {
    throw new Error('FORGE_WORLD_HISTORY_RELATED_STATE_SCOPE_REQUIRED');
  }
  return {
    recordId: requireNonEmptyString(itemRecord.id, 'FORGE_WORLD_HISTORY_RELATED_STATE_ID_REQUIRED'),
    scope,
    scopeKey: requireNonEmptyString(itemRecord.scopeKey, 'FORGE_WORLD_HISTORY_RELATED_STATE_SCOPE_KEY_REQUIRED'),
    ...(version ? { version } : {}),
  };
}

export function toHistoryAppend(
  event: EventNodeDraft,
  relatedStateRefs: Array<{
    recordId: string;
    scope: 'WORLD' | 'ENTITY' | 'RELATION';
    scopeKey: string;
    version?: string;
  }>,
) {
  return {
    eventId: typeof event.id === 'string' ? event.id : undefined,
    eventType: FORGE_WORLD_HISTORY_EVENT_TYPE,
    title: String(event.title || '').trim(),
    happenedAt: String(event.timeRef || new Date().toISOString()),
    operation: 'APPEND' as const,
    visibility: 'WORLD' as const,
    summary: typeof event.summary === 'string' ? event.summary : undefined,
    cause: typeof event.cause === 'string' ? event.cause : undefined,
    process: typeof event.process === 'string' ? event.process : undefined,
    result: typeof event.result === 'string' ? event.result : undefined,
    timeRef: typeof event.timeRef === 'string' ? event.timeRef : undefined,
    locationRefs: Array.isArray(event.locationRefs) ? event.locationRefs : [],
    characterRefs: Array.isArray(event.characterRefs) ? event.characterRefs : [],
    dependsOnEventIds: Array.isArray(event.dependsOnEventIds) ? event.dependsOnEventIds : [],
    evidenceRefs: Array.isArray(event.evidenceRefs) ? event.evidenceRefs : [],
    relatedStateRefs,
    payload: {
      timelineSeq: Number(event.timelineSeq || 0),
      level: event.level === 'SECONDARY' ? 'SECONDARY' : 'PRIMARY',
      eventHorizon: event.eventHorizon === 'ONGOING'
        ? 'ONGOING'
        : event.eventHorizon === 'FUTURE'
          ? 'FUTURE'
          : 'PAST',
      parentEventId: typeof event.parentEventId === 'string' ? event.parentEventId : null,
      confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : 0.5,
      needsEvidence: Boolean(event.needsEvidence),
    },
  };
}
