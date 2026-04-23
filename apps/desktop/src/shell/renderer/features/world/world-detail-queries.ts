import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createWorldFacade,
  normalizeWorldTruthDetail,
  type WorldTruthListItem,
  type WorldTruthDetail,
  type WorldTruthRecommendedAgent,
} from '@nimiplatform/sdk/world';
import { dataSync } from '@runtime/data-sync';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@runtime/net/json';
import { queryClient } from '@renderer/infra/query-client/query-client';
import type {
  WorldAgent,
  WorldAuditItem,
  WorldBindingItem,
  WorldDetailData,
  WorldHistoryBundle,
  WorldHistoryItem,
  WorldLorebookItem,
  WorldPublicAssetsData,
  WorldRecommendedAgent,
  WorldSceneItem,
  WorldSemanticData,
  WorldSemanticLanguage,
  WorldSemanticLevel,
  WorldSemanticRealm,
  WorldSemanticRule,
  WorldSemanticSnapshotItem,
  WorldSemanticTaboo,
  WorldSemanticTimelineItem,
} from './world-detail-types';
import type { WorldListItem } from './world-list-model';

type WorldLevelAuditEventDto = RealmModel<'WorldLevelAuditEventDto'>;
type WorldDetailWithAgentsResponse = Awaited<ReturnType<typeof dataSync.loadWorldDetailWithAgents>>;
type WorldDetailWithAgentsDto = NonNullable<WorldDetailWithAgentsResponse>;
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
type PublicBindingDto = Awaited<ReturnType<typeof dataSync.loadWorldBindings>>['items'][number];
type PublicWorldSceneDto = Awaited<ReturnType<typeof dataSync.loadWorldScenes>>['items'][number];

export type WorldPrimaryDetailRecord = WorldDetailWithAgentsDto & {
  worldTruth: WorldTruthDetail;
};

type WorldDisplayComputed = {
  time: {
    currentWorldTime: string | null;
    currentLabel: string | null;
    eraLabel: string | null;
    flowRatio: number;
    isPaused: boolean;
  };
  languages: {
    primary: string | null;
    common: string[];
  };
  entry: {
    recommendedAgents: WorldRecommendedAgent[];
  };
  score: {
    scoreEwma: number;
  };
  featuredAgentCount: number;
};

export type WorldDisplayDetail = {
  primary: WorldPrimaryDetailRecord;
  world: WorldDetailData;
  agents: WorldAgent[];
  history: WorldHistoryBundle;
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  sections: {
    history: 'success' | 'error';
    semantic: 'success' | 'error';
    audits: 'success' | 'error';
    publicAssets: 'success' | 'error';
  };
};

const DEFAULT_WORLD_PREFETCH_STALE_TIME_MS = 30_000;
const DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT = 4;
const EMPTY_WORLD_HISTORY: WorldHistoryBundle = {
  items: [],
  summary: null,
};
const EMPTY_WORLD_SEMANTIC: WorldSemanticData = {
  operationTitle: null,
  operationDescription: null,
  operationRules: [],
  powerSystems: [],
  standaloneLevels: [],
  taboos: [],
  topology: null,
  causality: null,
  languages: [],
  worldviewEvents: [],
  worldviewSnapshots: [],
  hasContent: false,
};
const EMPTY_WORLD_PUBLIC_ASSETS: WorldPublicAssetsData = {
  lorebooks: [],
  scenes: [],
  bindings: [],
};

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

function toWorldDisplayComputed(raw: unknown): WorldDisplayComputed {
  const record = asRecord(raw);
  const time = asRecord(record?.time);
  const languages = asRecord(record?.languages);
  const entry = asRecord(record?.entry);
  const score = asRecord(record?.score);

  return {
    time: {
      currentWorldTime: readString(time?.currentWorldTime),
      currentLabel: readString(time?.currentLabel),
      eraLabel: readString(time?.eraLabel),
      flowRatio: Math.max(0.0001, readNumber(time?.flowRatio) ?? 1),
      isPaused: readBoolean(time?.isPaused) ?? false,
    },
    languages: {
      primary: readString(languages?.primary),
      common: Array.isArray(languages?.common)
        ? languages.common.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [],
    },
    entry: {
      recommendedAgents: Array.isArray(entry?.recommendedAgents)
        ? entry.recommendedAgents.reduce<WorldRecommendedAgent[]>((acc, item) => {
          const agent = asRecord(item);
          if (!agent?.id) {
            return acc;
          }
          const display = asRecord(agent.display);
          acc.push({
            id: String(agent.id),
            name: String(agent.name || 'Unknown'),
            handle: readString(agent.handle),
            avatarUrl: readString(agent.avatarUrl),
            importance: agent.importance === 'PRIMARY' || agent.importance === 'BACKGROUND' ? agent.importance : 'SECONDARY',
            display: display
              ? {
                  role: readString(display.role),
                  faction: readString(display.faction),
                  rank: readString(display.rank),
                  sceneName: readString(display.sceneName),
                  location: readString(display.location),
                }
              : null,
          });
          return acc;
        }, [])
        : [],
    },
    score: {
      scoreEwma: readNumber(score?.scoreEwma) ?? 0,
    },
    featuredAgentCount: readNumber(record?.featuredAgentCount) ?? 0,
  };
}

function formatAgentHandle(agent: Record<string, unknown>, display: Record<string, unknown> | null, name: string): string {
  const raw = readString(agent.handle)
    ? String(agent.handle)
    : (readString(display?.role) ? String(display?.role) : name);
  return raw.startsWith('@') || raw.startsWith('~') ? raw : `@${raw}`;
}

function toWorldAgent(agent: Record<string, unknown>, worldCreatedAt: string): WorldAgent {
  const display = asRecord(agent.display);
  const stats = asRecord(agent.stats);
  const name = String(agent.name || 'Unknown');

  return {
    id: String(agent.id || ''),
    name,
    handle: formatAgentHandle(agent, display, name),
    bio: String(agent.bio || 'No description available.'),
    role: readString(display?.role),
    faction: readString(display?.faction),
    rank: readString(display?.rank),
    sceneName: readString(display?.sceneName),
    location: readString(display?.location),
    createdAt: typeof agent.createdAt === 'string' ? agent.createdAt : worldCreatedAt,
    avatarUrl: agent.avatarUrl ? String(agent.avatarUrl) : undefined,
    importance: agent.importance === 'PRIMARY' || agent.importance === 'BACKGROUND' ? agent.importance : 'SECONDARY',
    stats: stats
      ? {
          vitalityScore: readNumber(stats.vitalityScore),
          influenceTier: readString(stats.influenceTier),
          interactionTier: readString(stats.interactionTier),
          engagementCount: readNumber(stats.engagementCount),
          lastActiveAt: readString(stats.lastActiveAt),
        }
      : null,
  };
}

function toWorldDisplayData(detail: WorldPrimaryDetailRecord): WorldDetailData {
  const computed = toWorldDisplayComputed(detail.computed);
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description ?? null,
    tagline: detail.tagline ?? null,
    motto: detail.motto ?? null,
    overview: detail.overview ?? null,
    contentRating: detail.contentRating ?? null,
    iconUrl: detail.iconUrl ?? null,
    bannerUrl: detail.bannerUrl ?? null,
    type: detail.type === 'OASIS' ? 'OASIS' : 'CREATOR',
    status: detail.status,
    level: detail.level,
    levelUpdatedAt: detail.levelUpdatedAt ?? null,
    agentCount: detail.agentCount,
    createdAt: detail.createdAt,
    creatorId: detail.creatorId ?? null,
    freezeReason: detail.freezeReason ?? null,
    lorebookEntryLimit: detail.lorebookEntryLimit,
    nativeAgentLimit: detail.nativeAgentLimit,
    nativeCreationState: detail.nativeCreationState,
    scoreA: detail.scoreA,
    scoreC: detail.scoreC,
    scoreE: detail.scoreE,
    scoreEwma: detail.scoreEwma,
    scoreQ: detail.scoreQ,
    flowRatio: computed.time.flowRatio,
    isPaused: computed.time.isPaused,
    transitInLimit: detail.transitInLimit,
    genre: detail.genre ?? null,
    era: detail.era ?? null,
    themes: detail.themes ?? null,
    currentWorldTime: computed.time.currentWorldTime,
    currentTimeLabel: computed.time.currentLabel,
    eraLabel: computed.time.eraLabel,
    primaryLanguage: computed.languages.primary,
    commonLanguages: computed.languages.common,
    recommendedAgents: computed.entry.recommendedAgents,
  };
}

export function toWorldDisplayFallback(world: WorldListItem): WorldDetailData {
  return {
    id: world.id,
    name: world.name,
    description: world.description,
    tagline: world.tagline ?? null,
    motto: world.motto ?? null,
    overview: world.overview ?? null,
    contentRating: world.contentRating ?? null,
    iconUrl: world.iconUrl,
    bannerUrl: world.bannerUrl,
    type: world.type === 'OASIS' ? 'OASIS' : 'CREATOR',
    status: world.status as WorldDetailData['status'],
    level: world.level,
    levelUpdatedAt: world.levelUpdatedAt,
    agentCount: world.agentCount,
    createdAt: world.createdAt,
    creatorId: world.creatorId,
    freezeReason: world.freezeReason as WorldDetailData['freezeReason'],
    lorebookEntryLimit: world.lorebookEntryLimit,
    nativeAgentLimit: world.nativeAgentLimit,
    nativeCreationState: world.nativeCreationState as WorldDetailData['nativeCreationState'],
    scoreA: world.scoreA,
    scoreC: world.scoreC,
    scoreE: world.scoreE,
    scoreEwma: world.scoreEwma,
    scoreQ: world.scoreQ,
    flowRatio: world.computed.time.flowRatio,
    isPaused: world.computed.time.isPaused,
    transitInLimit: world.transitInLimit,
    genre: world.genre,
    era: world.era,
    themes: world.themes,
    currentWorldTime: world.computed.time.currentWorldTime,
    currentTimeLabel: world.computed.time.currentLabel,
    eraLabel: world.computed.time.eraLabel,
    primaryLanguage: world.computed.languages.primary,
    commonLanguages: world.computed.languages.common,
    recommendedAgents: world.computed.entry.recommendedAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      handle: agent.handle ?? null,
      avatarUrl: agent.avatarUrl ?? null,
      importance: 'SECONDARY',
      display: null,
    })),
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

function toWorldBindingItem(raw: PublicBindingDto): WorldBindingItem {
  const id = requireString(raw.id, 'binding_id');
  const resourceRecord = assertRecord(raw.resource, 'binding_resource');
  const resourceId = requireString(resourceRecord.id, 'binding_resource_id');
  const resourceUrl = requireString(resourceRecord.url, 'binding_resource_url');
  return {
    id,
    objectType: requireString(raw.objectType, 'binding_object_type'),
    objectId: requireString(raw.objectId, 'binding_object_id'),
    hostType: requireString(raw.hostType, 'binding_host_type'),
    hostId: requireString(raw.hostId, 'binding_host_id'),
    bindingKind: requireString(raw.bindingKind, 'binding_kind'),
    bindingPoint: readString(raw.bindingPoint),
    priority: requireNumber(raw.priority, 'binding_priority'),
    tags: requireStringArray(raw.tags, 'binding_tags'),
    resource: {
      id: resourceId,
      url: resourceUrl,
      resourceType: requireString(resourceRecord.resourceType, 'binding_resource_type'),
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

function toPrimaryRecommendedAgents(
  agents: WorldTruthRecommendedAgent[] | undefined,
): WorldDetailWithAgentsDto['computed']['entry']['recommendedAgents'] | undefined {
  if (!agents?.length) {
    return undefined;
  }
  return agents.map((agent) => {
    const display = {
      isNative: false,
      isTransitGuest: false,
      ...(agent.role ? { role: agent.role } : {}),
      ...(agent.faction ? { faction: agent.faction } : {}),
      ...(agent.location ? { location: agent.location } : {}),
      ...(agent.statusSummary ? { statusSummary: agent.statusSummary } : {}),
    };
    return {
      id: agent.agentId,
      name: agent.name,
      ...(agent.handle ? { handle: agent.handle } : {}),
      ...(agent.avatarUrl ? { avatarUrl: agent.avatarUrl } : {}),
      importance: agent.importance ?? 'SECONDARY',
      ...(Object.keys(display).length > 0 ? { display } : {}),
    };
  });
}

function mergeWorldPrimaryDetailTruth(
  detail: WorldDetailWithAgentsDto,
  worldTruth: WorldTruthDetail,
): WorldPrimaryDetailRecord {
  const recommendedAgents = toPrimaryRecommendedAgents(worldTruth.recommendedAgents);
  const mergedComputed: WorldDetailWithAgentsDto['computed'] = recommendedAgents
    ? {
        ...detail.computed,
        entry: {
          ...detail.computed.entry,
          recommendedAgents,
        },
      }
    : detail.computed;

  return {
    ...detail,
    ...(worldTruth.worldId ? { id: worldTruth.worldId } : {}),
    ...(worldTruth.title ? { name: worldTruth.title } : {}),
    ...(worldTruth.description ? { description: worldTruth.description } : {}),
    ...(worldTruth.tagline ? { tagline: worldTruth.tagline } : {}),
    ...(worldTruth.overview ? { overview: worldTruth.overview } : {}),
    ...(worldTruth.motto ? { motto: worldTruth.motto } : {}),
    ...(worldTruth.contentRating ? { contentRating: worldTruth.contentRating } : {}),
    ...(worldTruth.iconUrl ? { iconUrl: worldTruth.iconUrl } : {}),
    ...(worldTruth.bannerUrl ? { bannerUrl: worldTruth.bannerUrl } : {}),
    ...(worldTruth.type ? { type: worldTruth.type } : {}),
    ...(worldTruth.status ? { status: worldTruth.status } : {}),
    ...(worldTruth.level != null ? { level: worldTruth.level } : {}),
    ...(worldTruth.agentCount != null ? { agentCount: worldTruth.agentCount } : {}),
    ...(worldTruth.createdAt ? { createdAt: worldTruth.createdAt } : {}),
    ...(worldTruth.updatedAt ? { updatedAt: worldTruth.updatedAt } : {}),
    ...(worldTruth.creatorId ? { creatorId: worldTruth.creatorId } : {}),
    ...(worldTruth.nativeCreationState ? { nativeCreationState: worldTruth.nativeCreationState } : {}),
    ...(worldTruth.genre ? { genre: worldTruth.genre } : {}),
    ...(worldTruth.era ? { era: worldTruth.era } : {}),
    ...(worldTruth.themes ? { themes: worldTruth.themes } : {}),
    computed: mergedComputed,
    worldTruth,
  };
}

export function worldListQueryKey() {
  return ['worlds-list'] as const;
}

export async function fetchWorldListItems(
  status?: WorldTruthListItem['status'],
): Promise<WorldTruthListItem[]> {
  return createWorldFacade(getPlatformClient()).truth.list(status);
}

export function worldDisplayDetailQueryKey(worldId: string) {
  return [
    'world-display-detail',
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

export async function fetchWorldDetailWithAgents(worldId: string): Promise<WorldPrimaryDetailRecord> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [detailResponse, worldview] = await Promise.all([
    dataSync.loadWorldDetailWithAgents(
      normalizedWorldId,
      DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT,
    ),
    getPlatformClient().domains.world.getWorldview(normalizedWorldId),
  ]);
  if (!detailResponse) {
    throw new Error('WORLD_DETAIL_NOT_FOUND');
  }
  const detail = detailResponse;
  const worldTruth = normalizeWorldTruthDetail({ detail, worldview });
  if (!worldTruth) {
    throw new Error('WORLD_DETAIL_WORLD_TRUTH_INVALID');
  }
  // SDK truth owns the normalized truth-bearing fields; Desktop keeps only the
  // bounded supplement the current primary lane still needs.
  return mergeWorldPrimaryDetailTruth(detail, worldTruth);
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

function toWorldSceneItem(raw: PublicWorldSceneDto): WorldSceneItem {
  return {
    id: requireString(raw.id, 'scene_id'),
    name: requireString(raw.name, 'scene_name'),
    description: readString(raw.description) ?? '',
    activeEntities: raw.activeEntities ?? [],
  };
}

export async function fetchWorldPublicAssets(worldId: string): Promise<WorldPublicAssetsData> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [lorebooksPayload, bindingsPayload, scenesPayload] = await Promise.all([
    dataSync.loadWorldLorebooks(normalizedWorldId),
    dataSync.loadWorldBindings(normalizedWorldId),
    dataSync.loadWorldScenes(normalizedWorldId),
  ]);

  return {
    lorebooks: lorebooksPayload.items.map(toWorldLorebookItem),
    scenes: scenesPayload.items.map(toWorldSceneItem),
    bindings: bindingsPayload.items.map(toWorldBindingItem),
  };
}

export async function fetchWorldDisplayDetail(worldId: string): Promise<WorldDisplayDetail> {
  const primary = await fetchWorldDetailWithAgents(worldId);
  const world = toWorldDisplayData(primary);
  const agentRecords = Array.isArray(primary.agents) ? (primary.agents as Array<Record<string, unknown>>) : [];
  const agents = agentRecords.map((agent) => toWorldAgent(agent, world.createdAt));

  const [historyResult, semanticResult, auditsResult, publicAssetsResult] = await Promise.allSettled([
    fetchWorldHistory(worldId),
    fetchWorldSemanticBundle(worldId),
    fetchWorldLevelAudits(worldId),
    fetchWorldPublicAssets(worldId),
  ]);

  return {
    primary,
    world,
    agents,
    history: historyResult.status === 'fulfilled' ? historyResult.value : EMPTY_WORLD_HISTORY,
    semantic: semanticResult.status === 'fulfilled' ? semanticResult.value : EMPTY_WORLD_SEMANTIC,
    audits: auditsResult.status === 'fulfilled' ? auditsResult.value : [],
    publicAssets: publicAssetsResult.status === 'fulfilled' ? publicAssetsResult.value : EMPTY_WORLD_PUBLIC_ASSETS,
    sections: {
      history: historyResult.status === 'fulfilled' ? 'success' : 'error',
      semantic: semanticResult.status === 'fulfilled' ? 'success' : 'error',
      audits: auditsResult.status === 'fulfilled' ? 'success' : 'error',
      publicAssets: publicAssetsResult.status === 'fulfilled' ? 'success' : 'error',
    },
  };
}

export function prefetchWorldDetailAndHistory(worldId: string): void {
  const normalizedWorldId = normalizeWorldId(worldId);
  if (!normalizedWorldId) {
    return;
  }

  void queryClient.prefetchQuery({
    queryKey: worldDisplayDetailQueryKey(normalizedWorldId),
    queryFn: () => fetchWorldDisplayDetail(normalizedWorldId),
    staleTime: DEFAULT_WORLD_PREFETCH_STALE_TIME_MS,
  });
}
