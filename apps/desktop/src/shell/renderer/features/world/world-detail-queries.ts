import { dataSync } from '@runtime/data-sync';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@runtime/net/json';
import { queryClient } from '@renderer/infra/query-client/query-client';
import type {
  WorldAuditItem,
  WorldHistoryBundle,
  WorldHistoryItem,
  WorldLorebookItem,
  WorldResourceBindingItem,
  WorldPublicAssetsData,
  WorldSemanticData,
  WorldSemanticLanguage,
  WorldSemanticLevel,
  WorldSemanticRealm,
  WorldSemanticRule,
  WorldSemanticSnapshotItem,
  WorldSemanticTaboo,
  WorldSemanticTimelineItem,
} from './world-detail-types';

type WorldLevelAuditEventDto = RealmModel<'WorldLevelAuditEventDto'>;
type WorldHistoryPayload = Awaited<ReturnType<typeof dataSync.loadWorldHistory>>;
type WorldHistoryDetailDto = WorldHistoryPayload['items'][number];
type WorldSemanticBundleDto = Awaited<ReturnType<typeof dataSync.loadWorldSemanticBundle>>;
type WorldviewDetailDto = NonNullable<WorldSemanticBundleDto['worldview']>;
type PowerSystemDto = RealmModel<'PowerSystemDto'>;
type PowerSystemLevelDto = RealmModel<'PowerSystemLevelDto'>;
type PowerSystemTabooDto = RealmModel<'PowerSystemTabooDto'>;
type SpaceRealmDto = RealmModel<'SpaceRealmDto'>;
type WorldLanguageDto = RealmModel<'WorldLanguageDto'>;
type PublicWorldLorebookDto = Awaited<ReturnType<typeof dataSync.loadWorldLorebooks>>['items'][number];
type PublicWorldResourceBindingDto = Awaited<ReturnType<typeof dataSync.loadWorldResourceBindings>>['items'][number];

const DEFAULT_WORLD_PREFETCH_STALE_TIME_MS = 30_000;
const DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT = 4;

const EVENT_HORIZON_TAG: Record<'PAST' | 'ONGOING' | 'FUTURE', string> = {
  PAST: 'Past',
  ONGOING: 'Ongoing',
  FUTURE: 'Future',
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function assertRecord(value: unknown, fieldName: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
  return value as JsonObject;
}

function requireString(value: unknown, fieldName: string): string {
  const normalized = readString(value);
  if (!normalized) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function requireNumber(value: unknown, fieldName: string): number {
  const normalized = readNumber(value);
  if (normalized === null) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
  return value.map((item, index) => requireString(item, `${fieldName}_${index}`));
}

function requireRecordArray(value: unknown, fieldName: string): JsonObject[] {
  if (!Array.isArray(value)) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
  return value.map((item, index) => assertRecord(item, `${fieldName}_${index}`));
}

function assertArrayIfPresent(value: unknown, fieldName: string): void {
  if (value == null) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
}

function normalizeWorldId(worldId: string): string {
  return String(worldId || '').trim();
}

function formatLabel(source: string): string {
  return source
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stringifyLoose(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function inferEventHorizon(raw: WorldHistoryDetailDto): 'PAST' | 'ONGOING' | 'FUTURE' {
  const eventType = readString(raw.eventType)?.toLowerCase() ?? '';
  if (eventType.includes('future')) return 'FUTURE';
  if (eventType.includes('ongoing')) return 'ONGOING';
  const happenedAt = readString(raw.happenedAt);
  if (happenedAt) {
    const parsed = new Date(happenedAt);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
      return 'FUTURE';
    }
  }
  return 'PAST';
}

function inferEventLevel(raw: WorldHistoryDetailDto): 'PRIMARY' | 'SECONDARY' {
  const eventType = readString(raw.eventType)?.toLowerCase() ?? '';
  return eventType.includes('secondary') ? 'SECONDARY' : 'PRIMARY';
}

function toWorldHistoryItem(raw: WorldHistoryDetailDto, index: number): WorldHistoryItem {
  const id = requireString(raw.id, 'event_id');
  const title = requireString(raw.title, 'event_title');
  const horizon = inferEventHorizon(raw);
  const happenedAt = requireString(raw.happenedAt, 'event_happened_at');
  const eventType = readString(raw.eventType);
  const evidenceRefs = Array.isArray(raw.evidenceRefs)
    ? raw.evidenceRefs.map((item) => ({
      segmentId: requireString(item.segmentId, 'event_evidence_segment_id'),
      offsetStart: requireNumber(item.offsetStart, 'event_evidence_offset_start'),
      offsetEnd: requireNumber(item.offsetEnd, 'event_evidence_offset_end'),
      excerpt: requireString(item.excerpt, 'event_evidence_excerpt'),
      confidence: requireNumber(item.confidence, 'event_evidence_confidence'),
      sourceType: requireString(item.sourceType, 'event_evidence_source_type'),
    }))
    : [];
  return {
    id,
    timelineSeq: index + 1,
    title,
    description: readString(raw.summary) ?? readString(raw.cause) ?? readString(raw.process) ?? readString(raw.result) ?? '',
    time: readString(raw.timeRef) ?? happenedAt,
    tag: eventType ? formatLabel(eventType) : EVENT_HORIZON_TAG[horizon],
    level: inferEventLevel(raw),
    eventHorizon: horizon,
    summary: readString(raw.summary),
    cause: readString(raw.cause),
    process: readString(raw.process),
    result: readString(raw.result),
    locationRefs: requireStringArray(raw.locationRefs, 'event_location_refs'),
    characterRefs: requireStringArray(raw.characterRefs, 'event_character_refs'),
    evidenceRefs,
    confidence:
      evidenceRefs.length > 0
        ? evidenceRefs.reduce((sum, item) => sum + item.confidence, 0) / evidenceRefs.length
        : 0,
    needsEvidence: evidenceRefs.length === 0,
  };
}

function toOperationRules(raw?: PowerSystemDto['rules']): WorldSemanticRule[] {
  return (raw ?? []).reduce<WorldSemanticRule[]>((acc, item) => {
    const key = requireString(item.key, 'semantic_rule_key');
    const title = requireString(item.title, 'semantic_rule_title');
    const value = requireString(item.value, 'semantic_rule_value');
    acc.push({ key, title, value });
    return acc;
  }, []);
}

function toSemanticLevels(raw?: PowerSystemLevelDto[]): WorldSemanticLevel[] {
  return (raw ?? []).reduce<WorldSemanticLevel[]>((acc, item) => {
    const name = requireString(item.name, 'semantic_level_name');
    acc.push({
      name,
      description: readString(item.description),
      extra: readString(item.breakthroughCondition),
    });
    return acc;
  }, []);
}

function toTaboos(raw?: PowerSystemTabooDto[]): WorldSemanticTaboo[] {
  return (raw ?? []).reduce<WorldSemanticTaboo[]>((acc, item) => {
    const name = readString(item.name) ?? readString(item.title);
    if (!name) {
      throw new Error('WORLD_DETAIL_SEMANTIC_TABOO_NAME_INVALID');
    }
    acc.push({
      name,
      description: readString(item.description),
      severity: readString(item.severity),
    });
    return acc;
  }, []);
}

function toRealms(raw?: SpaceRealmDto[]): WorldSemanticRealm[] {
  return (raw ?? []).reduce<WorldSemanticRealm[]>((acc, item) => {
    const name = requireString(item.name, 'semantic_realm_name');
    acc.push({
      name,
      description: readString(item.description),
      accessibility: readString(item.accessibility),
    });
    return acc;
  }, []);
}

function toLanguages(raw?: WorldLanguageDto[]): WorldSemanticLanguage[] {
  return (raw ?? []).reduce<WorldSemanticLanguage[]>((acc, item) => {
    const name = requireString(item.name, 'semantic_language_name');
    acc.push({
      name,
      category: readString(item.category),
      description: readString(item.description),
      writingSample: readString(item.writingSample),
      spokenSample: readString(item.spokenSample),
      isCommon: readBoolean(item.isCommon),
    });
    return acc;
  }, []);
}

function toWorldviewEvents(raw: JsonObject[]): WorldSemanticTimelineItem[] {
  return raw.reduce<WorldSemanticTimelineItem[]>((acc, item) => {
    const id = requireString(item.id, 'worldview_event_id');
    acc.push({
      id,
      title: readString(item.title) ?? readString(item.name) ?? formatLabel(readString(item.eventType) ?? 'Update'),
      summary: readString(item.summary) ?? readString(item.description),
      eventType: readString(item.eventType),
      createdAt: readString(item.createdAt) ?? readString(item.occurredAt),
    });
    return acc;
  }, []);
}

function toWorldviewSnapshots(raw: JsonObject[]): WorldSemanticSnapshotItem[] {
  return raw.reduce<WorldSemanticSnapshotItem[]>((acc, item) => {
    const id = requireString(item.id, 'worldview_snapshot_id');
    const version = readString(item.versionLabel) ?? readString(item.version) ?? readString(item.snapshotVersion);
    acc.push({
      id,
      versionLabel: version ?? `Snapshot ${acc.length + 1}`,
      summary: readString(item.summary) ?? readString(item.description),
      createdAt: readString(item.createdAt),
    });
    return acc;
  }, []);
}

function toSemanticBundle(raw: WorldSemanticBundleDto): WorldSemanticData {
  assertArrayIfPresent(raw.worldviewEvents, 'worldview_events');
  assertArrayIfPresent(raw.worldviewSnapshots, 'worldview_snapshots');
  if (raw.worldview != null) {
    assertRecord(raw.worldview, 'worldview');
  }
  const worldview: WorldviewDetailDto | null = raw.worldview;
  const coreSystem = worldview?.coreSystem;
  const spaceTopology = worldview?.spaceTopology;
  const causality = worldview?.causality;
  const languages = worldview?.languages;

  const operationRules = toOperationRules(coreSystem?.rules);
  const powerSystems = (coreSystem?.powerSystems ?? []).reduce<WorldSemanticData['powerSystems']>((acc, item) => {
    const name = readString(item.name);
    if (!name) return acc;
    acc.push({
      name,
      description: readString(item.description),
      levels: toSemanticLevels(item.levels),
      rules: Array.isArray(item.rules)
        ? item.rules.map((value) => stringifyLoose(value)).filter((value): value is string => Boolean(value))
        : [],
    });
    return acc;
  }, []);
  const standaloneLevels = toSemanticLevels(coreSystem?.levels);
  const taboos = toTaboos(coreSystem?.taboos);
  const topology = spaceTopology
    ? {
        type: readString(spaceTopology.type),
        boundary: readString(spaceTopology.boundary),
        dimensions: stringifyLoose(spaceTopology.dimensions),
        realms: toRealms(spaceTopology.realms),
      }
    : null;
  const causalityModel = causality
    ? {
        type: readString(causality.type),
        karmaEnabled: readBoolean(causality.karmaEnabled),
        fateWeight: readNumber(causality.fateWeight),
      }
    : null;
  const languageList = toLanguages(languages?.languages);
  const worldviewEvents = toWorldviewEvents(requireRecordArray(raw.worldviewEvents ?? [], 'worldview_events'));
  const worldviewSnapshots = toWorldviewSnapshots(
    requireRecordArray(raw.worldviewSnapshots ?? [], 'worldview_snapshots'),
  );

  const hasContent = Boolean(
    readString(coreSystem?.name) ||
    readString(coreSystem?.description) ||
    operationRules.length ||
    powerSystems.length ||
    standaloneLevels.length ||
    taboos.length ||
    topology?.realms.length ||
    topology?.type ||
    topology?.boundary ||
    topology?.dimensions ||
    causalityModel?.type ||
    causalityModel?.karmaEnabled != null ||
    causalityModel?.fateWeight != null ||
    languageList.length,
  );

  return {
    operationTitle: readString(coreSystem?.name),
    operationDescription: readString(coreSystem?.description),
    operationRules,
    powerSystems,
    standaloneLevels,
    taboos,
    topology,
    causality: causalityModel,
    languages: languageList,
    worldviewEvents,
    worldviewSnapshots,
    hasContent,
  };
}

function toWorldAuditItem(raw: WorldLevelAuditEventDto): WorldAuditItem {
  const id = requireString(raw.id, 'audit_id');
  const occurredAt = raw.occurredAt as unknown;
  const eventType = readString(raw.eventType);
  return {
    id,
    label: formatLabel(eventType || 'Audit'),
    eventType,
    occurredAt: typeof occurredAt === 'string'
      ? occurredAt
      : occurredAt instanceof Date
        ? occurredAt.toISOString()
        : '',
    prevLevel: raw.prevLevel ?? null,
    nextLevel: raw.nextLevel ?? null,
    ewmaScore: raw.ewmaScore ?? null,
    freezeReason: readString(raw.freezeReason),
  };
}

function toWorldLorebookItem(raw: PublicWorldLorebookDto): WorldLorebookItem {
  const id = requireString(raw.id, 'lorebook_id');
  return {
    id,
    key: requireString(raw.key, 'lorebook_key'),
    name: readString(raw.name),
    content: requireString(raw.content, 'lorebook_content'),
    keywords: raw.keywords == null ? [] : requireStringArray(raw.keywords, 'lorebook_keywords'),
    priority: readNumber(raw.priority),
  };
}

function toWorldResourceBindingItem(raw: PublicWorldResourceBindingDto): WorldResourceBindingItem {
  const id = requireString(raw.id, 'resource_binding_id');
  const resourceRecord = assertRecord(raw.resource, 'resource_binding_resource');
  const resourceId = requireString(resourceRecord.id, 'resource_binding_resource_id');
  const resourceUrl = requireString(resourceRecord.url, 'resource_binding_resource_url');
  return {
    id,
    targetType: requireString(raw.targetType, 'resource_binding_target_type'),
    targetId: requireString(raw.targetId, 'resource_binding_target_id'),
    slot: requireString(raw.slot, 'resource_binding_slot'),
    priority: requireNumber(raw.priority, 'resource_binding_priority'),
    tags: requireStringArray(raw.tags, 'resource_binding_tags'),
    resource: {
      id: resourceId,
      url: resourceUrl,
      resourceType: requireString(resourceRecord.resourceType, 'resource_binding_resource_type'),
      label: readString(resourceRecord.label),
    },
  };
}

function buildWorldHistorySummary(items: WorldHistoryItem[]): WorldHistoryBundle['summary'] {
  if (items.length === 0) {
    return null;
  }

  const primaryCount = items.filter((item) => item.level === 'PRIMARY').length;
  const secondaryCount = items.length - primaryCount;

  return {
    primaryCount,
    secondaryCount,
    totalCount: items.length,
    eventCharacterCoverage: items.filter((item) => item.characterRefs.length > 0).length / items.length,
    eventLocationCoverage: items.filter((item) => item.locationRefs.length > 0).length / items.length,
  };
}

export function worldListQueryKey() {
  return ['worlds-list'] as const;
}

export function worldDetailWithAgentsQueryKey(worldId: string) {
  return [
    'world-detail-with-agents',
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT,
  ] as const;
}

export function worldHistoryQueryKey(worldId: string) {
  return ['world-history', normalizeWorldId(worldId)] as const;
}

export function worldSemanticBundleQueryKey(worldId: string) {
  return ['world-semantic-bundle', normalizeWorldId(worldId)] as const;
}

export function worldLevelAuditsQueryKey(worldId: string) {
  return ['world-level-audits', normalizeWorldId(worldId)] as const;
}

export function worldPublicAssetsQueryKey(worldId: string) {
  return ['world-public-assets', normalizeWorldId(worldId)] as const;
}

export async function fetchWorldDetailWithAgents(worldId: string) {
  return dataSync.loadWorldDetailWithAgents(
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT,
  );
}

export async function fetchWorldHistory(worldId: string): Promise<WorldHistoryBundle> {
  const payload = await dataSync.loadWorldHistory(normalizeWorldId(worldId));
  const items = payload.items
    .map((item, index) => toWorldHistoryItem(item, index))
    .sort((left, right) => left.timelineSeq - right.timelineSeq || left.id.localeCompare(right.id));
  return {
    items,
    summary: buildWorldHistorySummary(items),
  };
}

export async function fetchWorldSemanticBundle(worldId: string): Promise<WorldSemanticData> {
  const payload = await dataSync.loadWorldSemanticBundle(normalizeWorldId(worldId));
  return toSemanticBundle(payload);
}

export async function fetchWorldLevelAudits(worldId: string): Promise<WorldAuditItem[]> {
  const payload = await dataSync.loadWorldLevelAudits(normalizeWorldId(worldId), 20);
  return payload.map(toWorldAuditItem);
}

export async function fetchWorldPublicAssets(worldId: string): Promise<WorldPublicAssetsData> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [lorebooksPayload, resourceBindingsPayload] = await Promise.all([
    dataSync.loadWorldLorebooks(normalizedWorldId),
    dataSync.loadWorldResourceBindings(normalizedWorldId),
  ]);

  return {
    lorebooks: lorebooksPayload.items.map(toWorldLorebookItem),
    scenes: [],
    resourceBindings: resourceBindingsPayload.items.map(toWorldResourceBindingItem),
  };
}

export function prefetchWorldDetailAndHistory(worldId: string): void {
  const normalizedWorldId = normalizeWorldId(worldId);
  if (!normalizedWorldId) {
    return;
  }

  void queryClient.prefetchQuery({
    queryKey: worldDetailWithAgentsQueryKey(normalizedWorldId),
    queryFn: () => fetchWorldDetailWithAgents(normalizedWorldId),
    staleTime: DEFAULT_WORLD_PREFETCH_STALE_TIME_MS,
  });

  void queryClient.prefetchQuery({
    queryKey: worldHistoryQueryKey(normalizedWorldId),
    queryFn: () => fetchWorldHistory(normalizedWorldId),
    staleTime: DEFAULT_WORLD_PREFETCH_STALE_TIME_MS,
  });

  void queryClient.prefetchQuery({
    queryKey: worldSemanticBundleQueryKey(normalizedWorldId),
    queryFn: () => fetchWorldSemanticBundle(normalizedWorldId),
    staleTime: DEFAULT_WORLD_PREFETCH_STALE_TIME_MS,
  });
}
