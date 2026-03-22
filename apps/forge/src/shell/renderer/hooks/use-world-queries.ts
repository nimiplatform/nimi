/**
 * Forge World Resource Queries (FG-WORLD-002)
 *
 * Replaces World-Studio's useWorldStudioResourceQueries hook.
 * Uses direct SDK realm client calls via world-data-client instead of hookClient.
 */

import { useQuery } from '@tanstack/react-query';
import {
  listMyWorlds,
  listWorldDrafts,
  listWorldHistory,
  getWorldState,
  listWorldLorebooks,
  listWorldMediaBindings,
  listWorldMutations,
} from '@renderer/data/world-data-client.js';

type WorldDraftListPayload = Awaited<ReturnType<typeof listWorldDrafts>>;
type WorldListPayload = Awaited<ReturnType<typeof listMyWorlds>>;
type WorldMutationListPayload = Awaited<ReturnType<typeof listWorldMutations>>;
type WorldHistoryListPayload = Awaited<ReturnType<typeof listWorldHistory>>;
type WorldHistoryListItem = WorldHistoryListPayload extends { items?: Array<infer Item> } ? Item : never;
type WorldHistoryEvidenceRef = WorldHistoryListItem extends { evidenceRefs?: Array<infer Ref> } ? Ref : never;

function toStringOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function requireNonEmptyString(value: unknown, code: string): string {
  if (typeof value !== 'string') {
    throw new Error(code);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function requireFiniteNumber(value: unknown, code: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

function requireEnumValue<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
  code: string,
): Values[number] {
  const normalized = requireNonEmptyString(value, code);
  if (!allowed.includes(normalized)) {
    throw new Error(code);
  }
  return normalized as Values[number];
}

export type WorldDraftSummary = {
  id: string;
  targetWorldId: string | null;
  status: 'DRAFT' | 'SYNTHESIZE' | 'REVIEW' | 'PUBLISH' | 'FAILED';
  sourceType: 'TEXT' | 'FILE';
  sourceRef: string | null;
  updatedAt: string;
  publishedAt: string | null;
};

export type WorldSummary = {
  id: string;
  name: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  description: string | null;
  updatedAt: string;
};

export type WorldMutationSummary = {
  id: string;
  worldId: string;
  mutationType:
    | 'SETTING_CHANGE'
    | 'RULE_UPDATE'
    | 'LOREBOOK_OVERRIDE'
    | 'TABOO_CHANGE'
    | 'LOCATION_CHANGE'
    | 'EVENT_CREATE'
    | 'EVENT_UPDATE'
    | 'EVENT_DELETE'
    | 'EVENT_BATCH_UPSERT';
  targetPath: string;
  reason: string | null;
  creatorId: string;
  createdAt: string;
};

export type WorldHistorySummary = {
  id: string;
  worldId: string;
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
  evidenceRefs: WorldHistoryEvidenceRef[];
  confidence: number;
  needsEvidence: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

function toDraftSummaryList(payload: WorldDraftListPayload): WorldDraftSummary[] {
  const items = payload.items ?? [];
  return items
    .map((item) => ({
      id: String(item.id || ''),
      targetWorldId: toStringOrNull(item.targetWorldId),
      status: String(item.status || 'DRAFT') as WorldDraftSummary['status'],
      sourceType: String(item.sourceType || 'TEXT') as WorldDraftSummary['sourceType'],
      sourceRef: toStringOrNull(item.sourceRef),
      updatedAt: String(item.updatedAt || ''),
      publishedAt: toStringOrNull(item.publishedAt),
    }))
    .filter((item) => Boolean(item.id));
}

function toWorldSummaryList(payload: WorldListPayload): WorldSummary[] {
  const items = payload.items ?? [];
  return items
    .map((item) => ({
      id: requireNonEmptyString(item.id, 'FORGE_WORLD_ID_INVALID'),
      name: requireNonEmptyString(item.name, 'FORGE_WORLD_NAME_INVALID'),
      status: requireEnumValue(
        item.status,
        ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const,
        'FORGE_WORLD_STATUS_INVALID',
      ),
      description: toStringOrNull(item.description),
      updatedAt: requireNonEmptyString(item.updatedAt, 'FORGE_WORLD_UPDATED_AT_INVALID'),
    }))
    .filter((item) => Boolean(item.id));
}

function toMutationSummaryList(payload: WorldMutationListPayload): WorldMutationSummary[] {
  const items = payload.items ?? [];
  return items
    .map((item) => ({
      id: requireNonEmptyString(item.id, 'FORGE_WORLD_MUTATION_ID_INVALID'),
      worldId: requireNonEmptyString(item.worldId, 'FORGE_WORLD_MUTATION_WORLD_ID_INVALID'),
      mutationType: requireEnumValue(
        item.mutationType,
        [
          'SETTING_CHANGE',
          'RULE_UPDATE',
          'LOREBOOK_OVERRIDE',
          'TABOO_CHANGE',
          'LOCATION_CHANGE',
          'EVENT_CREATE',
          'EVENT_UPDATE',
          'EVENT_DELETE',
          'EVENT_BATCH_UPSERT',
        ] as const,
        'FORGE_WORLD_MUTATION_TYPE_INVALID',
      ),
      targetPath: requireNonEmptyString(item.targetPath, 'FORGE_WORLD_MUTATION_TARGET_PATH_INVALID'),
      reason: toStringOrNull(item.reason),
      creatorId: requireNonEmptyString(item.creatorId, 'FORGE_WORLD_MUTATION_CREATOR_ID_INVALID'),
      createdAt: requireNonEmptyString(item.createdAt, 'FORGE_WORLD_MUTATION_CREATED_AT_INVALID'),
    }))
    .filter((item) => Boolean(item.id));
}

function toHistorySummaryList(payload: WorldHistoryListPayload): WorldHistorySummary[] {
  const items = Array.isArray(payload.items)
    ? payload.items as Array<Record<string, unknown>>
    : [];

  return items
    .map((item, index) => {
      const metadata = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
        ? item.payload as Record<string, unknown>
        : {};
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const happenedAt =
        typeof item.happenedAt === 'string' && item.happenedAt.trim()
          ? item.happenedAt.trim()
          : null;
      const eventType =
        typeof item.eventType === 'string' && item.eventType.trim()
          ? item.eventType.trim()
          : null;
      if (!title) {
        throw new Error('FORGE_WORLD_EVENT_TITLE_INVALID');
      }
      if (!happenedAt) {
        throw new Error('FORGE_WORLD_EVENT_HAPPENED_AT_INVALID');
      }
      const level: WorldHistorySummary['level'] = eventType?.toLowerCase().includes('secondary')
        ? 'SECONDARY'
        : 'PRIMARY';
      const eventHorizon: WorldHistorySummary['eventHorizon'] = eventType?.toLowerCase().includes('future')
        ? 'FUTURE'
        : 'PAST';
      return {
        id: requireNonEmptyString(item.eventId, 'FORGE_WORLD_HISTORY_EVENT_ID_INVALID'),
        worldId: requireNonEmptyString(item.worldId, 'FORGE_WORLD_EVENT_WORLD_ID_INVALID'),
        timelineSeq: index + 1,
        level,
        eventHorizon,
        parentEventId: null,
        title,
        summary: toStringOrNull(typeof item.summary === 'string' ? item.summary : null),
        cause: toStringOrNull(typeof item.cause === 'string' ? item.cause : null),
        process: toStringOrNull(typeof item.process === 'string' ? item.process : null),
        result: toStringOrNull(typeof item.result === 'string' ? item.result : null),
        timeRef: toStringOrNull(typeof item.timeRef === 'string' ? item.timeRef : happenedAt),
        locationRefs: Array.isArray(item.locationRefs)
          ? item.locationRefs.map((entry) => String(entry || '')).filter(Boolean)
          : [],
        characterRefs: Array.isArray(item.characterRefs)
          ? item.characterRefs.map((entry) => String(entry || '')).filter(Boolean)
          : [],
        dependsOnEventIds: Array.isArray(item.dependsOnEventIds)
          ? item.dependsOnEventIds.map((entry) => String(entry || '')).filter(Boolean)
          : [],
        evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs as WorldHistoryEvidenceRef[] : [],
        confidence:
          Array.isArray(item.evidenceRefs) && item.evidenceRefs.length > 0
            ? item.evidenceRefs.reduce((sum, entry) => sum + requireFiniteNumber(entry.confidence, 'FORGE_WORLD_EVENT_CONFIDENCE_INVALID'), 0) / item.evidenceRefs.length
            : 0,
        needsEvidence: !Array.isArray(item.evidenceRefs) || item.evidenceRefs.length === 0,
        createdBy: requireNonEmptyString(item.createdBy, 'FORGE_WORLD_EVENT_CREATED_BY_INVALID'),
        updatedBy: requireNonEmptyString(item.createdBy, 'FORGE_WORLD_EVENT_UPDATED_BY_INVALID'),
        createdAt: requireNonEmptyString(item.committedAt || item.createdAt, 'FORGE_WORLD_EVENT_CREATED_AT_INVALID'),
        updatedAt: requireNonEmptyString(
          item.committedAt || item.updatedAt || item.createdAt,
          'FORGE_WORLD_EVENT_UPDATED_AT_INVALID',
        ),
      };
    })
    .filter((item) => Boolean(item.id));
}

export function useWorldResourceQueries(input: {
  enabled: boolean;
  worldId: string;
  enableCollections?: boolean;
}) {
  const enableCollections = input.enableCollections !== false;

  const draftsQuery = useQuery({
    queryKey: ['forge', 'world', 'drafts'],
    enabled: input.enabled && enableCollections,
    retry: false,
    queryFn: async () => toDraftSummaryList(await listWorldDrafts()),
  });

  const worldsQuery = useQuery({
    queryKey: ['forge', 'world', 'worlds-mine'],
    enabled: input.enabled && enableCollections,
    retry: false,
    queryFn: async () => toWorldSummaryList(await listMyWorlds()),
  });

  const stateQuery = useQuery({
    queryKey: ['forge', 'world', 'state', input.worldId],
    enabled: input.enabled && Boolean(input.worldId),
    retry: false,
    queryFn: async () => await getWorldState(input.worldId),
  });

  const lorebooksQuery = useQuery({
    queryKey: ['forge', 'world', 'lorebooks', input.worldId],
    enabled: input.enabled && Boolean(input.worldId),
    retry: false,
    queryFn: async () => await listWorldLorebooks(input.worldId),
  });

  const historyQuery = useQuery({
    queryKey: ['forge', 'world', 'history', input.worldId],
    enabled: input.enabled && Boolean(input.worldId),
    retry: false,
    queryFn: async () => toHistorySummaryList(await listWorldHistory(input.worldId)),
  });

  const mutationsQuery = useQuery({
    queryKey: ['forge', 'world', 'mutations', input.worldId],
    enabled: input.enabled && Boolean(input.worldId),
    retry: false,
    queryFn: async () => toMutationSummaryList(await listWorldMutations(input.worldId)),
  });

  const mediaBindingsQuery = useQuery({
    queryKey: ['forge', 'world', 'media-bindings', input.worldId],
    enabled: input.enabled && Boolean(input.worldId),
    retry: false,
    queryFn: async () => await listWorldMediaBindings(input.worldId),
  });

  return {
    draftsQuery,
    worldsQuery,
    stateQuery,
    historyQuery,
    lorebooksQuery,
    mutationsQuery,
    mediaBindingsQuery,
  };
}
