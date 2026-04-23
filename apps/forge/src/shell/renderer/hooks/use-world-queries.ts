/**
 * Forge World Resource Queries (FG-WORLD-002)
 *
 * Replaces World-Studio's useWorldStudioResourceQueries hook.
 * Uses direct SDK realm client calls via world-data-client instead of hookClient.
 */

import { useQuery } from '@tanstack/react-query';
import {
  listOfficialFactoryBatchRuns,
  listMyWorlds,
  listWorldDrafts,
  listWorldHistory,
  listWorldReleases,
  getWorldState,
  getWorldDetail,
  listWorldLorebooks,
  listWorldResourceBindings,
  listWorldTitleLineage,
  type ForgeOfficialFactoryBatchRun,
  type ForgeOfficialWorldTitleLineage,
  type ForgeWorldRelease,
} from '@renderer/data/world-data-client.js';
import {
  WORLD_DELIVERABLE_REGISTRY,
  type WorldDeliverableBindingPoint,
  type WorldDeliverableFamily,
} from '@renderer/features/asset-ops/deliverable-registry.js';

type WorldDraftListPayload = Awaited<ReturnType<typeof listWorldDrafts>>;
type WorldListPayload = Awaited<ReturnType<typeof listMyWorlds>>;
type WorldStatePayload = Awaited<ReturnType<typeof getWorldState>>;
type WorldHistoryListPayload = Awaited<ReturnType<typeof listWorldHistory>>;
type WorldResourceBindingsPayload = Awaited<ReturnType<typeof listWorldResourceBindings>>;
type WorldHistoryListItem = WorldHistoryListPayload extends { items?: Array<infer Item> } ? Item : never;
type WorldHistoryEvidenceRef = WorldHistoryListItem extends { evidenceRefs?: Array<infer Ref> } ? Ref : never;

type BindingRecord = {
  id: string | null;
  hostId: string | null;
  hostType: string | null;
  bindingPoint: string | null;
  bindingKind: string | null;
  objectId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  priority: number | null;
};

type DeliverableCurrentState = 'MISSING' | 'PRESENT' | 'BOUND';
type DeliverableOpsState = 'MISSING' | 'BOUND';
type CompletenessState = 'MISSING' | 'PARTIAL' | 'COMPLETE';

export type WorldDeliverableStatus = {
  family: WorldDeliverableFamily;
  label: string;
  required: boolean;
  currentState: DeliverableCurrentState;
  opsState: DeliverableOpsState;
  bindingPoint: WorldDeliverableBindingPoint;
  objectId: string | null;
  value: string | null;
};

export type WorldDeliverableCompletenessSummary = {
  requiredFamilyCount: number;
  currentReadyCount: number;
  opsReadyCount: number;
  boundCount: number;
  unverifiedCount: number;
  missingCount: number;
  currentState: CompletenessState;
  opsState: CompletenessState;
};

function toStringOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function toUnknownStringOrNull(value: unknown): string | null {
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

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toBindingRecordList(payload: WorldResourceBindingsPayload | undefined): BindingRecord[] {
  const root = toObjectRecord(payload);
  const items = Array.isArray(root?.items) ? root.items : [];
  return items
    .map((entry) => {
      const item = toObjectRecord(entry);
      if (!item) {
        return null;
      }
      const priority =
        typeof item.priority === 'number'
          ? item.priority
          : Number.isFinite(Number(item.priority))
            ? Number(item.priority)
            : null;
      return {
        id: toUnknownStringOrNull(item.id),
        hostId: toUnknownStringOrNull(item.hostId),
        hostType: toUnknownStringOrNull(item.hostType),
        bindingPoint: toUnknownStringOrNull(item.bindingPoint),
        bindingKind: toUnknownStringOrNull(item.bindingKind),
        objectId: toUnknownStringOrNull(item.objectId),
        createdAt: toUnknownStringOrNull(item.createdAt),
        updatedAt: toUnknownStringOrNull(item.updatedAt),
        priority,
      } satisfies BindingRecord;
    })
    .filter((item): item is BindingRecord => item !== null);
}

function compareBindingPriority(left: BindingRecord, right: BindingRecord): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  return leftPriority - rightPriority
    || (right.updatedAt || '').localeCompare(left.updatedAt || '')
    || (right.createdAt || '').localeCompare(left.createdAt || '')
    || (right.id || '').localeCompare(left.id || '');
}

function findWorldBinding(
  bindings: BindingRecord[],
  input: {
    worldId: string;
    bindingPoint: WorldDeliverableBindingPoint;
  },
): BindingRecord | null {
  return bindings
    .filter((item) =>
      item.hostId === input.worldId
      && item.hostType === 'WORLD'
      && item.bindingPoint === input.bindingPoint
      && item.bindingKind === 'PRESENTATION',
    )
    .sort(compareBindingPriority)[0] ?? null;
}

function toCompletenessState(readyCount: number, requiredFamilyCount: number): CompletenessState {
  if (requiredFamilyCount <= 0 || readyCount <= 0) {
    return 'MISSING';
  }
  if (readyCount >= requiredFamilyCount) {
    return 'COMPLETE';
  }
  return 'PARTIAL';
}

function summarizeWorldDeliverables(deliverables: WorldDeliverableStatus[]): WorldDeliverableCompletenessSummary {
  const requiredFamilies = deliverables.filter((item) => item.required);
  const requiredFamilyCount = requiredFamilies.length;
  const currentReadyCount = requiredFamilies.filter((item) => item.currentState !== 'MISSING').length;
  const opsReadyCount = requiredFamilies.filter((item) => item.opsState !== 'MISSING').length;
  const boundCount = requiredFamilies.filter((item) => item.currentState === 'BOUND').length;
  const unverifiedCount = requiredFamilies.filter((item) => item.currentState !== 'MISSING' && item.opsState === 'MISSING').length;
  const missingCount = requiredFamilies.filter((item) => item.currentState === 'MISSING').length;
  return {
    requiredFamilyCount,
    currentReadyCount,
    opsReadyCount,
    boundCount,
    unverifiedCount,
    missingCount,
    currentState: toCompletenessState(currentReadyCount, requiredFamilyCount),
    opsState: toCompletenessState(opsReadyCount, requiredFamilyCount),
  };
}

function buildWorldDeliverables(input: {
  worldId: string;
  bannerUrl: string | null;
  iconUrl: string | null;
  bindingsPayload: WorldResourceBindingsPayload | undefined;
}): WorldDeliverableStatus[] {
  const bindings = toBindingRecordList(input.bindingsPayload);
  return WORLD_DELIVERABLE_REGISTRY.map((entry) => {
    const binding = findWorldBinding(bindings, { worldId: input.worldId, bindingPoint: entry.bindingPoint });
    const value =
      entry.family === 'world-icon'
        ? input.iconUrl
        : entry.family === 'world-cover'
          ? input.bannerUrl
          : null;
    return {
      family: entry.family,
      label: entry.label,
      required: entry.requiredForPublish,
      currentState: binding ? 'BOUND' : value ? 'PRESENT' : 'MISSING',
      opsState: binding ? 'BOUND' : 'MISSING',
      bindingPoint: entry.bindingPoint,
      objectId: binding?.objectId ?? null,
      value,
    };
  });
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

export type WorldMaintenanceTimelineItem = {
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
  title: string;
  summary: string;
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
  eventType: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type WorldReleaseSummary = ForgeWorldRelease;
export type WorldBatchRunSummary = ForgeOfficialFactoryBatchRun;
export type WorldTitleLineageSummary = ForgeOfficialWorldTitleLineage;

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
        eventType,
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

function toMaintenanceTimeline(
  statePayload: WorldStatePayload | undefined,
  historyItems: WorldHistorySummary[] | undefined,
): WorldMaintenanceTimelineItem[] {
  const stateItems = Array.isArray(statePayload?.items)
    ? statePayload.items
    : [];
  const stateTimeline = stateItems.map((item) => ({
    id: requireNonEmptyString(item.id, 'FORGE_WORLD_STATE_RECORD_ID_INVALID'),
    worldId: requireNonEmptyString(item.worldId, 'FORGE_WORLD_STATE_RECORD_WORLD_ID_INVALID'),
    mutationType: 'SETTING_CHANGE' as const,
    title: 'State commit',
    summary: requireNonEmptyString(item.targetPath, 'FORGE_WORLD_STATE_RECORD_TARGET_PATH_INVALID'),
    targetPath: requireNonEmptyString(item.targetPath, 'FORGE_WORLD_STATE_RECORD_TARGET_PATH_INVALID'),
    reason: toStringOrNull(
      item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
        ? item.metadata.reason as string | null | undefined
        : null,
    ),
    creatorId: requireNonEmptyString(item.createdBy, 'FORGE_WORLD_STATE_RECORD_CREATED_BY_INVALID'),
    createdAt: requireNonEmptyString(item.committedAt, 'FORGE_WORLD_STATE_RECORD_COMMITTED_AT_INVALID'),
  }));

  const historyTimeline = (historyItems ?? []).map((item) => ({
    id: requireNonEmptyString(item.id, 'FORGE_WORLD_HISTORY_TIMELINE_ID_INVALID'),
    worldId: requireNonEmptyString(item.worldId, 'FORGE_WORLD_HISTORY_TIMELINE_WORLD_ID_INVALID'),
    mutationType: 'EVENT_BATCH_UPSERT' as const,
    title: requireNonEmptyString(item.title, 'FORGE_WORLD_HISTORY_TIMELINE_TITLE_INVALID'),
    summary: item.summary ?? item.eventType ?? item.timeRef ?? item.title,
    targetPath: `history:${item.eventType || 'WORLD_EVENT'}`,
    reason: null,
    creatorId: requireNonEmptyString(item.createdBy, 'FORGE_WORLD_HISTORY_TIMELINE_CREATED_BY_INVALID'),
    createdAt: requireNonEmptyString(item.createdAt, 'FORGE_WORLD_HISTORY_TIMELINE_CREATED_AT_INVALID'),
  }));

  return [...stateTimeline, ...historyTimeline].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

function sortWorldReleases(releases: ForgeWorldRelease[]): WorldReleaseSummary[] {
  return [...releases].sort(
    (left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

function sortWorldTitleLineage(entries: ForgeOfficialWorldTitleLineage[]): WorldTitleLineageSummary[] {
  return [...entries].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

function sortWorldBatchRuns(entries: ForgeOfficialFactoryBatchRun[]): WorldBatchRunSummary[] {
  return [...entries].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
  );
}

export function useWorldResourceQueries(input: {
  enabled: boolean;
  worldId: string;
  enableCollections?: boolean;
  enableBindings?: boolean;
  enableGovernance?: boolean;
  enableDetailSnapshot?: boolean;
}) {
  const enableCollections = input.enableCollections !== false;
  const enableBindings = input.enableBindings !== false;
  const enableGovernance = input.enableGovernance !== false;
  const enableDetailSnapshot = input.enableDetailSnapshot !== false;

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

  const resourceBindingsQuery = useQuery({
    queryKey: ['forge', 'world', 'resource-bindings', input.worldId],
    enabled: input.enabled && enableBindings && Boolean(input.worldId),
    retry: false,
    queryFn: async () => await listWorldResourceBindings(input.worldId),
  });

  const releasesQuery = useQuery({
    queryKey: ['forge', 'world', 'releases', input.worldId],
    enabled: input.enabled && enableGovernance && Boolean(input.worldId),
    retry: false,
    queryFn: async () => sortWorldReleases(await listWorldReleases(input.worldId)),
  });

  const titleLineageQuery = useQuery({
    queryKey: ['forge', 'world', 'title-lineage', input.worldId],
    enabled: input.enabled && enableGovernance && Boolean(input.worldId),
    retry: false,
    queryFn: async () => sortWorldTitleLineage(await listWorldTitleLineage(input.worldId)),
  });

  const batchRunsQuery = useQuery({
    queryKey: ['forge', 'world', 'batch-runs', input.worldId],
    enabled: input.enabled && enableGovernance && Boolean(input.worldId),
    retry: false,
    queryFn: async () => sortWorldBatchRuns(await listOfficialFactoryBatchRuns()),
  });

  const worldDetailSnapshotQuery = useQuery({
    queryKey: ['forge', 'world', 'detail-snapshot', input.worldId],
    enabled: input.enabled && enableDetailSnapshot && Boolean(input.worldId),
    retry: false,
    queryFn: async () => await getWorldDetail(input.worldId),
  });

  const detailSnapshot = worldDetailSnapshotQuery.data && typeof worldDetailSnapshotQuery.data === 'object' && !Array.isArray(worldDetailSnapshotQuery.data)
    ? worldDetailSnapshotQuery.data as Record<string, unknown>
    : {};
  const worldDeliverables = enableDetailSnapshot
    ? buildWorldDeliverables({
      worldId: input.worldId,
      bannerUrl: toUnknownStringOrNull(detailSnapshot.bannerUrl),
      iconUrl: toUnknownStringOrNull(detailSnapshot.iconUrl),
      bindingsPayload: enableBindings ? resourceBindingsQuery.data : undefined,
    })
    : [];

  return {
    draftsQuery,
    worldsQuery,
    stateQuery,
    historyQuery,
    maintenanceTimeline: toMaintenanceTimeline(stateQuery.data, historyQuery.data),
    lorebooksQuery,
    resourceBindingsQuery,
    worldDeliverables,
    worldDeliverableCompleteness: summarizeWorldDeliverables(worldDeliverables),
    releasesQuery,
    titleLineageQuery,
    batchRunsQuery,
  };
}

// ── World Detail (includes bannerUrl, iconUrl) ──────────────

export type WorldDetail = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  bannerUrl: string | null;
  iconUrl: string | null;
  genre: string | null;
  era: string | null;
  motto: string | null;
  overview: string | null;
  contentRating: string;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
};

function toWorldDetail(payload: unknown): WorldDetail {
  const item = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  return {
    id: String(item.id || ''),
    name: String(item.name || ''),
    description: toStringOrNull(item.description as string | null | undefined),
    status: String(item.status || 'DRAFT'),
    bannerUrl: toStringOrNull(item.bannerUrl as string | null | undefined),
    iconUrl: toStringOrNull(item.iconUrl as string | null | undefined),
    genre: toStringOrNull(item.genre as string | null | undefined),
    era: toStringOrNull(item.era as string | null | undefined),
    motto: toStringOrNull(item.motto as string | null | undefined),
    overview: toStringOrNull(item.overview as string | null | undefined),
    contentRating: String(item.contentRating || 'UNRATED'),
    agentCount: Number(item.agentCount) || 0,
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
  };
}

export function useWorldDetailQuery(worldId: string) {
  return useQuery({
    queryKey: ['forge', 'world', 'detail', worldId],
    enabled: Boolean(worldId),
    retry: false,
    queryFn: async () => toWorldDetail(await getWorldDetail(worldId)),
  });
}
