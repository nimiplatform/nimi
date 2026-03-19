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
  listWorldEvents,
  getWorldMaintenance,
  listWorldLorebooks,
  listWorldMediaBindings,
  listWorldMutations,
} from '@renderer/data/world-data-client.js';

type WorldDraftListPayload = Awaited<ReturnType<typeof listWorldDrafts>>;
type WorldListPayload = Awaited<ReturnType<typeof listMyWorlds>>;
type WorldMutationListPayload = Awaited<ReturnType<typeof listWorldMutations>>;
type WorldEventListPayload = Awaited<ReturnType<typeof listWorldEvents>>;
type WorldEventListItem = WorldEventListPayload extends { items?: Array<infer Item> } ? Item : never;
type WorldEventEvidenceRef = WorldEventListItem extends { evidenceRefs?: Array<infer Ref> } ? Ref : never;

function toStringOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
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

export type WorldEventSummary = {
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
  evidenceRefs: WorldEventEvidenceRef[];
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
      id: String(item.id || ''),
      name: String(item.name || 'Untitled World'),
      status: String(item.status || 'DRAFT') as WorldSummary['status'],
      description: toStringOrNull(item.description),
      updatedAt: String(item.updatedAt || ''),
    }))
    .filter((item) => Boolean(item.id));
}

function toMutationSummaryList(payload: WorldMutationListPayload): WorldMutationSummary[] {
  const items = payload.items ?? [];
  return items
    .map((item) => ({
      id: String(item.id || ''),
      worldId: String(item.worldId || ''),
      mutationType: String(item.mutationType || 'SETTING_CHANGE') as WorldMutationSummary['mutationType'],
      targetPath: String(item.targetPath || ''),
      reason: toStringOrNull(item.reason),
      creatorId: String(item.creatorId || ''),
      createdAt: String(item.createdAt || ''),
    }))
    .filter((item) => Boolean(item.id));
}

function toEventSummaryList(payload: WorldEventListPayload): WorldEventSummary[] {
  const items = payload.items ?? [];
  return items
    .map((item) => ({
      id: String(item.id || ''),
      worldId: String(item.worldId || ''),
      timelineSeq: Number.isFinite(Number(item.timelineSeq)) ? Number(item.timelineSeq) : 0,
      level: String(item.level || 'PRIMARY') as WorldEventSummary['level'],
      eventHorizon: String(item.eventHorizon || 'PAST') as WorldEventSummary['eventHorizon'],
      parentEventId: toStringOrNull(item.parentEventId),
      title: String(item.title || 'Untitled Event'),
      summary: toStringOrNull(item.summary),
      cause: toStringOrNull(item.cause),
      process: toStringOrNull(item.process),
      result: toStringOrNull(item.result),
      timeRef: toStringOrNull(item.timeRef),
      locationRefs: Array.isArray(item.locationRefs)
        ? item.locationRefs.map((entry) => String(entry || '')).filter(Boolean)
        : [],
      characterRefs: Array.isArray(item.characterRefs)
        ? item.characterRefs.map((entry) => String(entry || '')).filter(Boolean)
        : [],
      dependsOnEventIds: Array.isArray(item.dependsOnEventIds)
        ? item.dependsOnEventIds.map((entry) => String(entry || '')).filter(Boolean)
        : [],
      evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs as WorldEventEvidenceRef[] : [],
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.5,
      needsEvidence: Boolean(item.needsEvidence),
      createdBy: String(item.createdBy || ''),
      updatedBy: String(item.updatedBy || ''),
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || ''),
    }))
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

  const maintenanceQuery = useQuery({
    queryKey: ['forge', 'world', 'maintenance', input.worldId],
    enabled: input.enabled && Boolean(input.worldId),
    retry: false,
    queryFn: async () => await getWorldMaintenance(input.worldId),
  });

  const lorebooksQuery = useQuery({
    queryKey: ['forge', 'world', 'lorebooks', input.worldId],
    enabled: input.enabled && Boolean(input.worldId),
    retry: false,
    queryFn: async () => await listWorldLorebooks(input.worldId),
  });

  const eventsQuery = useQuery({
    queryKey: ['forge', 'world', 'events', input.worldId],
    enabled: input.enabled && Boolean(input.worldId),
    retry: false,
    queryFn: async () => toEventSummaryList(await listWorldEvents(input.worldId)),
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
    maintenanceQuery,
    eventsQuery,
    lorebooksQuery,
    mutationsQuery,
    mediaBindingsQuery,
  };
}
