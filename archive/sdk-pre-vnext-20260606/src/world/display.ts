import { asRecord, type JsonObject } from '../internal/utils.js';
import type {
  WorldTruthDetail,
  WorldTruthRecommendedAgent,
} from './types.js';
import type {
  WorldAgent,
  WorldAuditItem,
  WorldBindingItem,
  WorldDetailData,
  WorldDisplayComputed,
  WorldHistoryBundle,
  WorldHistoryItem,
  WorldLorebookItem,
  WorldPrimaryDetailRecord,
  WorldRecommendedAgent,
  WorldSceneItem,
  WorldSemanticData,
  WorldSemanticLanguage,
  WorldSemanticLevel,
  WorldSemanticPowerSystem,
  WorldSemanticRealm,
  WorldSemanticRule,
  WorldSemanticSnapshotItem,
  WorldSemanticTaboo,
  WorldSemanticTimelineItem,
} from './display-types.js';

export type * from './display-types.js';

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function assertRecord(value: unknown, fieldName: string): JsonObject {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
  return record;
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
  if (value != null && !Array.isArray(value)) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
}

function stringifyLoose(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function formatWorldDisplayLabel(source: string): string {
  return String(source || '')
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatWorldDisplayMixedLabel(source: string): string {
  return String(source || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferWorldHistoryEventHorizon(raw: JsonObject): WorldHistoryItem['eventHorizon'] {
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

function inferWorldHistoryEventLevel(raw: JsonObject): WorldHistoryItem['level'] {
  const eventType = readString(raw.eventType)?.toLowerCase() ?? '';
  return eventType.includes('secondary') ? 'SECONDARY' : 'PRIMARY';
}

export function toWorldDisplayHistoryItem(rawValue: unknown, index: number): WorldHistoryItem {
  const raw = assertRecord(rawValue, 'event');
  const id = requireString(raw.id, 'event_id');
  const title = requireString(raw.title, 'event_title');
  const horizon = inferWorldHistoryEventHorizon(raw);
  const happenedAt = requireString(raw.happenedAt, 'event_happened_at');
  const eventType = readString(raw.eventType);
  const evidenceRefs = Array.isArray(raw.evidenceRefs)
    ? raw.evidenceRefs.map((item) => {
      const evidence = asRecord(item);
      return {
        segmentId: requireString(evidence.segmentId, 'event_evidence_segment_id'),
        offsetStart: requireNumber(evidence.offsetStart, 'event_evidence_offset_start'),
        offsetEnd: requireNumber(evidence.offsetEnd, 'event_evidence_offset_end'),
        excerpt: requireString(evidence.excerpt, 'event_evidence_excerpt'),
        confidence: requireNumber(evidence.confidence, 'event_evidence_confidence'),
        sourceType: requireString(evidence.sourceType, 'event_evidence_source_type'),
      };
    })
    : [];
  return {
    id,
    timelineSeq: index + 1,
    title,
    description: readString(raw.summary) ?? readString(raw.cause) ?? readString(raw.process) ?? readString(raw.result) ?? '',
    time: readString(raw.timeRef) ?? happenedAt,
    tag: eventType ? formatWorldDisplayMixedLabel(eventType) : ({ PAST: 'Past', ONGOING: 'Ongoing', FUTURE: 'Future' }[horizon]),
    level: inferWorldHistoryEventLevel(raw),
    eventHorizon: horizon,
    summary: readString(raw.summary),
    cause: readString(raw.cause),
    process: readString(raw.process),
    result: readString(raw.result),
    locationRefs: requireStringArray(raw.locationRefs, 'event_location_refs'),
    characterRefs: requireStringArray(raw.characterRefs, 'event_character_refs'),
    evidenceRefs,
    confidence: evidenceRefs.length > 0
      ? evidenceRefs.reduce((sum, item) => sum + item.confidence, 0) / evidenceRefs.length
      : 0,
    needsEvidence: evidenceRefs.length === 0,
  };
}

export function buildWorldHistorySummary(items: readonly WorldHistoryItem[]): WorldHistoryBundle['summary'] {
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

export function toWorldDisplayHistoryBundle(raw: { items?: readonly unknown[] }): WorldHistoryBundle {
  const items = (raw.items ?? [])
    .map((item, index) => toWorldDisplayHistoryItem(item, index))
    .sort((left, right) => left.timelineSeq - right.timelineSeq || left.id.localeCompare(right.id));
  return {
    items,
    summary: buildWorldHistorySummary(items),
  };
}

function toOperationRules(raw: unknown): WorldSemanticRule[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
      const record = asRecord(item);
      return {
        key: requireString(record.key, 'semantic_rule_key'),
        title: requireString(record.title, 'semantic_rule_title'),
        value: requireString(record.value, 'semantic_rule_value'),
      };
    })
    : [];
}

function toSemanticLevels(raw: unknown): WorldSemanticLevel[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
      const record = asRecord(item);
      return {
        name: requireString(record.name, 'semantic_level_name'),
        description: readString(record.description),
        extra: readString(record.breakthroughCondition),
      };
    })
    : [];
}

function toTaboos(raw: unknown): WorldSemanticTaboo[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
      const record = asRecord(item);
      const name = readString(record.name) ?? readString(record.title);
      if (!name) {
        throw new Error('WORLD_DETAIL_SEMANTIC_TABOO_NAME_INVALID');
      }
      return {
        name,
        description: readString(record.description),
        severity: readString(record.severity),
      };
    })
    : [];
}

function toRealms(raw: unknown): WorldSemanticRealm[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
      const record = asRecord(item);
      return {
        name: requireString(record.name, 'semantic_realm_name'),
        description: readString(record.description),
        accessibility: readString(record.accessibility),
      };
    })
    : [];
}

function toLanguages(raw: unknown): WorldSemanticLanguage[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
      const record = asRecord(item);
      return {
        name: requireString(record.name, 'semantic_language_name'),
        category: readString(record.category),
        description: readString(record.description),
        writingSample: readString(record.writingSample),
        spokenSample: readString(record.spokenSample),
        isCommon: readBoolean(record.isCommon),
      };
    })
    : [];
}

function toWorldviewEvents(raw: readonly JsonObject[]): WorldSemanticTimelineItem[] {
  return raw.map((item) => {
    const id = requireString(item.id, 'worldview_event_id');
    return {
      id,
      title: readString(item.title) ?? readString(item.name) ?? formatWorldDisplayLabel(readString(item.eventType) ?? 'Update'),
      summary: readString(item.summary) ?? readString(item.description),
      eventType: readString(item.eventType),
      createdAt: readString(item.createdAt) ?? readString(item.occurredAt),
    };
  });
}

function toWorldviewSnapshots(raw: readonly JsonObject[]): WorldSemanticSnapshotItem[] {
  return raw.map((item, index) => {
    const id = requireString(item.id, 'worldview_snapshot_id');
    const version = readString(item.versionLabel) ?? readString(item.version) ?? readString(item.snapshotVersion);
    return {
      id,
      versionLabel: version ?? `Snapshot ${index + 1}`,
      summary: readString(item.summary) ?? readString(item.description),
      createdAt: readString(item.createdAt),
    };
  });
}

export function toWorldDisplaySemanticBundle(raw: unknown): WorldSemanticData {
  const record = asRecord(raw);
  assertArrayIfPresent(record.worldviewEvents, 'worldview_events');
  assertArrayIfPresent(record.worldviewSnapshots, 'worldview_snapshots');
  if (record.worldview != null) {
    assertRecord(record.worldview, 'worldview');
  }
  const worldview = asRecord(record.worldview);
  const coreSystem = asRecord(worldview.coreSystem);
  const spaceTopology = asRecord(worldview.spaceTopology);
  const causality = asRecord(worldview.causality);
  const languages = asRecord(worldview.languages);
  const operationRules = toOperationRules(coreSystem.rules);
  const powerSystems = Array.isArray(coreSystem.powerSystems)
    ? coreSystem.powerSystems.reduce<WorldSemanticData['powerSystems']>((acc, item) => {
      const powerSystem = asRecord(item);
      const name = readString(powerSystem.name);
      if (!name) return acc;
      acc.push({
        name,
        description: readString(powerSystem.description),
        levels: toSemanticLevels(powerSystem.levels),
        rules: Array.isArray(powerSystem.rules)
          ? powerSystem.rules.map((value) => stringifyLoose(value)).filter((value): value is string => Boolean(value))
          : [],
      });
      return acc;
    }, [])
    : [];
  const standaloneLevels = toSemanticLevels(coreSystem.levels);
  const taboos = toTaboos(coreSystem.taboos);
  const topology = Object.keys(spaceTopology).length > 0
    ? {
        type: readString(spaceTopology.type),
        boundary: readString(spaceTopology.boundary),
        dimensions: stringifyLoose(spaceTopology.dimensions),
        realms: toRealms(spaceTopology.realms),
      }
    : null;
  const causalityModel = Object.keys(causality).length > 0
    ? {
        type: readString(causality.type),
        karmaEnabled: readBoolean(causality.karmaEnabled),
        fateWeight: readNumber(causality.fateWeight),
      }
    : null;
  const languageList = toLanguages(languages.languages);
  const worldviewEvents = toWorldviewEvents(requireRecordArray(record.worldviewEvents ?? [], 'worldview_events'));
  const worldviewSnapshots = toWorldviewSnapshots(
    requireRecordArray(record.worldviewSnapshots ?? [], 'worldview_snapshots'),
  );
  const hasContent = Boolean(
    readString(coreSystem.name) ||
    readString(coreSystem.description) ||
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
    operationTitle: readString(coreSystem.name),
    operationDescription: readString(coreSystem.description),
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

function toPrimaryRecommendedAgents(
  agents: WorldTruthRecommendedAgent[] | undefined,
): JsonObject[] | undefined {
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

export function mergeWorldPrimaryDetailTruth<T extends JsonObject>(
  detail: T,
  worldTruth: WorldTruthDetail,
): WorldPrimaryDetailRecord<T> {
  const detailComputed = asRecord(detail.computed);
  const detailEntry = asRecord(detailComputed.entry);
  const recommendedAgents = toPrimaryRecommendedAgents(worldTruth.recommendedAgents);
  const mergedComputed = recommendedAgents
    ? {
        ...detailComputed,
        entry: {
          ...detailEntry,
          recommendedAgents,
        },
      }
    : detailComputed;
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

export function toWorldDisplayComputed(raw: unknown): WorldDisplayComputed {
  const record = asRecord(raw);
  const time = asRecord(record.time);
  const languages = asRecord(record.languages);
  const entry = asRecord(record.entry);
  const score = asRecord(record.score);
  return {
    time: {
      currentWorldTime: readString(time.currentWorldTime),
      currentLabel: readString(time.currentLabel),
      eraLabel: readString(time.eraLabel),
      flowRatio: Math.max(0.0001, readNumber(time.flowRatio) ?? 1),
      isPaused: readBoolean(time.isPaused) ?? false,
    },
    languages: {
      primary: readString(languages.primary),
      common: readStringArray(languages.common),
    },
    entry: {
      recommendedAgents: Array.isArray(entry.recommendedAgents)
        ? entry.recommendedAgents.reduce<WorldRecommendedAgent[]>((acc, item) => {
          const agent = asRecord(item);
          if (!agent.id) {
            return acc;
          }
          const display = asRecord(agent.display);
          acc.push({
            id: String(agent.id),
            name: String(agent.name || 'Unknown'),
            handle: readString(agent.handle),
            avatarUrl: readString(agent.avatarUrl),
            importance: agent.importance === 'PRIMARY' || agent.importance === 'BACKGROUND' ? agent.importance : 'SECONDARY',
            display: Object.keys(display).length > 0
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
      scoreEwma: readNumber(score.scoreEwma) ?? 0,
    },
    featuredAgentCount: readNumber(record.featuredAgentCount) ?? 0,
  };
}

function normalizeWorldType(value: unknown): WorldDetailData['type'] {
  return value === 'OASIS' ? 'OASIS' : 'CREATOR';
}

function normalizeWorldStatus(value: unknown): WorldDetailData['status'] {
  return value === 'PENDING_REVIEW'
    || value === 'ACTIVE'
    || value === 'SUSPENDED'
    || value === 'ARCHIVED'
    ? value
    : 'DRAFT';
}

function normalizeFreezeReason(value: unknown): WorldDetailData['freezeReason'] {
  return value === 'QUOTA_OVERFLOW' || value === 'WORLD_INACTIVE' || value === 'GOVERNANCE_LOCK'
    ? value
    : null;
}

function normalizeNativeCreationState(value: unknown): WorldDetailData['nativeCreationState'] {
  return value === 'NATIVE_CREATION_FROZEN' ? 'NATIVE_CREATION_FROZEN' : 'OPEN';
}

export function toWorldDisplayData(detailValue: unknown): WorldDetailData {
  const detail = assertRecord(detailValue, 'detail');
  const computed = toWorldDisplayComputed(detail.computed);
  return {
    id: requireString(detail.id, 'world_id'),
    name: requireString(detail.name, 'world_name'),
    description: readString(detail.description),
    tagline: readString(detail.tagline),
    motto: readString(detail.motto),
    overview: readString(detail.overview),
    contentRating: readString(detail.contentRating),
    iconUrl: readString(detail.iconUrl),
    bannerUrl: readString(detail.bannerUrl),
    type: normalizeWorldType(detail.type),
    status: normalizeWorldStatus(detail.status),
    level: readNumber(detail.level) ?? 1,
    levelUpdatedAt: readString(detail.levelUpdatedAt),
    agentCount: readNumber(detail.agentCount) ?? 0,
    createdAt: readString(detail.createdAt) ?? '',
    creatorId: readString(detail.creatorId),
    freezeReason: normalizeFreezeReason(detail.freezeReason),
    lorebookEntryLimit: readNumber(detail.lorebookEntryLimit) ?? 0,
    nativeAgentLimit: readNumber(detail.nativeAgentLimit) ?? 0,
    nativeCreationState: normalizeNativeCreationState(detail.nativeCreationState),
    scoreA: readNumber(detail.scoreA) ?? 0,
    scoreC: readNumber(detail.scoreC) ?? 0,
    scoreE: readNumber(detail.scoreE) ?? 0,
    scoreEwma: readNumber(detail.scoreEwma) ?? 0,
    scoreQ: readNumber(detail.scoreQ) ?? 0,
    flowRatio: computed.time.flowRatio,
    isPaused: computed.time.isPaused,
    transitInLimit: readNumber(detail.transitInLimit) ?? 0,
    genre: readString(detail.genre),
    era: readString(detail.era),
    themes: Array.isArray(detail.themes) ? readStringArray(detail.themes) : null,
    currentWorldTime: computed.time.currentWorldTime,
    currentTimeLabel: computed.time.currentLabel,
    eraLabel: computed.time.eraLabel,
    primaryLanguage: computed.languages.primary,
    commonLanguages: computed.languages.common,
    recommendedAgents: computed.entry.recommendedAgents,
  };
}

export function toWorldDisplayFallback(worldValue: unknown): WorldDetailData {
  const world = asRecord(worldValue);
  const computed = asRecord(world.computed);
  const time = asRecord(computed.time);
  const languages = asRecord(computed.languages);
  const entry = asRecord(computed.entry);
  const score = asRecord(computed.score);
  return {
    id: readString(world.worldId) ?? readString(world.id) ?? '',
    name: readString(world.title) ?? readString(world.name) ?? 'Unknown World',
    description: readString(world.description),
    tagline: readString(world.tagline),
    motto: readString(world.motto),
    overview: readString(world.overview),
    contentRating: readString(world.contentRating),
    iconUrl: readString(world.iconUrl),
    bannerUrl: readString(world.bannerUrl),
    type: normalizeWorldType(world.type),
    status: normalizeWorldStatus(world.status),
    level: readNumber(world.level) ?? 1,
    levelUpdatedAt: readString(world.levelUpdatedAt),
    agentCount: readNumber(world.agentCount) ?? 0,
    createdAt: readString(world.createdAt) ?? '',
    creatorId: readString(world.creatorId),
    freezeReason: normalizeFreezeReason(world.freezeReason),
    lorebookEntryLimit: readNumber(world.lorebookEntryLimit) ?? 0,
    nativeAgentLimit: readNumber(world.nativeAgentLimit) ?? 0,
    nativeCreationState: normalizeNativeCreationState(world.nativeCreationState),
    scoreA: readNumber(world.scoreA) ?? 0,
    scoreC: readNumber(world.scoreC) ?? 0,
    scoreE: readNumber(world.scoreE) ?? 0,
    scoreEwma: readNumber(world.scoreEwma) ?? readNumber(score.scoreEwma) ?? 0,
    scoreQ: readNumber(world.scoreQ) ?? 0,
    flowRatio: Math.max(0.0001, readNumber(time.flowRatio) ?? readNumber(world.flowRatio) ?? 1),
    isPaused: readBoolean(time.isPaused) ?? readBoolean(world.isPaused) ?? false,
    transitInLimit: readNumber(world.transitInLimit) ?? 0,
    genre: readString(world.genre),
    era: readString(world.era),
    themes: Array.isArray(world.themes) ? readStringArray(world.themes) : null,
    currentWorldTime: readString(time.currentWorldTime) ?? readString(world.currentWorldTime),
    currentTimeLabel: readString(time.currentLabel) ?? readString(world.currentTimeLabel),
    eraLabel: readString(time.eraLabel) ?? readString(world.eraLabel),
    primaryLanguage: readString(languages.primary) ?? readString(world.primaryLanguage),
    commonLanguages: readStringArray(languages.common).length > 0
      ? readStringArray(languages.common)
      : readStringArray(world.commonLanguages),
    recommendedAgents: (Array.isArray(entry.recommendedAgents) ? entry.recommendedAgents : (Array.isArray(world.recommendedAgents) ? world.recommendedAgents : []))
      .map((value): WorldRecommendedAgent => {
        const agent = asRecord(value);
        const importance: WorldRecommendedAgent['importance'] =
          agent.importance === 'PRIMARY' || agent.importance === 'BACKGROUND' ? agent.importance : 'SECONDARY';
        return {
          id: readString(agent.agentId) ?? readString(agent.id) ?? '',
          name: readString(agent.name) ?? 'Unknown',
          handle: readString(agent.handle),
          avatarUrl: readString(agent.avatarUrl),
          importance,
          display: asRecord(agent.display),
        };
      })
      .filter((agent) => agent.id),
  };
}

export function toWorldDisplayAgent(agentValue: unknown, worldCreatedAt: string): WorldAgent {
  const agent = assertRecord(agentValue, 'agent');
  const display = asRecord(agent.display);
  const stats = asRecord(agent.stats);
  const name = String(agent.name || 'Unknown');
  const rawHandle = readString(agent.handle) ?? readString(display.role) ?? name;
  return {
    id: String(agent.id || ''),
    name,
    handle: rawHandle.startsWith('@') || rawHandle.startsWith('~') ? rawHandle : `@${rawHandle}`,
    bio: String(agent.bio || 'No description available.'),
    role: readString(display.role),
    faction: readString(display.faction),
    rank: readString(display.rank),
    sceneName: readString(display.sceneName),
    location: readString(display.location),
    createdAt: readString(agent.createdAt) ?? worldCreatedAt,
    avatarUrl: readString(agent.avatarUrl),
    importance: agent.importance === 'PRIMARY' || agent.importance === 'BACKGROUND' ? agent.importance : 'SECONDARY',
    stats: Object.keys(stats).length > 0
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

export function toWorldDisplayAuditItem(rawValue: unknown): WorldAuditItem {
  const raw = assertRecord(rawValue, 'audit');
  const occurredAt = raw.occurredAt;
  const eventType = readString(raw.eventType);
  return {
    id: requireString(raw.id, 'audit_id'),
    label: formatWorldDisplayLabel(eventType || 'Audit'),
    eventType,
    occurredAt: typeof occurredAt === 'string'
      ? occurredAt
      : occurredAt instanceof Date
        ? occurredAt.toISOString()
        : '',
    prevLevel: readNumber(raw.prevLevel),
    nextLevel: readNumber(raw.nextLevel),
    ewmaScore: readNumber(raw.ewmaScore),
    freezeReason: readString(raw.freezeReason),
  };
}

export function toWorldDisplayLorebookItem(rawValue: unknown): WorldLorebookItem {
  const raw = assertRecord(rawValue, 'lorebook');
  return {
    id: requireString(raw.id, 'lorebook_id'),
    key: requireString(raw.key, 'lorebook_key'),
    name: readString(raw.name),
    content: requireString(raw.content, 'lorebook_content'),
    keywords: raw.keywords == null ? [] : requireStringArray(raw.keywords, 'lorebook_keywords'),
    priority: readNumber(raw.priority),
  };
}

export function toWorldDisplaySceneItem(rawValue: unknown): WorldSceneItem {
  const raw = assertRecord(rawValue, 'scene');
  return {
    id: requireString(raw.id, 'scene_id'),
    name: requireString(raw.name, 'scene_name'),
    description: readString(raw.description) ?? '',
    activeEntities: readStringArray(raw.activeEntities),
  };
}

export function toWorldDisplayBindingItem(rawValue: unknown): WorldBindingItem {
  const raw = assertRecord(rawValue, 'binding');
  const resourceRecord = assertRecord(raw.resource, 'binding_resource');
  return {
    id: requireString(raw.id, 'binding_id'),
    objectType: requireString(raw.objectType, 'binding_object_type'),
    objectId: requireString(raw.objectId, 'binding_object_id'),
    hostType: requireString(raw.hostType, 'binding_host_type'),
    hostId: requireString(raw.hostId, 'binding_host_id'),
    bindingKind: requireString(raw.bindingKind, 'binding_kind'),
    bindingPoint: readString(raw.bindingPoint),
    priority: requireNumber(raw.priority, 'binding_priority'),
    tags: requireStringArray(raw.tags, 'binding_tags'),
    resource: {
      id: requireString(resourceRecord.id, 'binding_resource_id'),
      url: requireString(resourceRecord.url, 'binding_resource_url'),
      resourceType: requireString(resourceRecord.resourceType, 'binding_resource_type'),
      label: readString(resourceRecord.label),
    },
  };
}

export const display = {
  buildHistorySummary: buildWorldHistorySummary,
  formatLabel: formatWorldDisplayLabel,
  mergePrimaryDetailTruth: mergeWorldPrimaryDetailTruth,
  toAgent: toWorldDisplayAgent,
  toAuditItem: toWorldDisplayAuditItem,
  toBindingItem: toWorldDisplayBindingItem,
  toData: toWorldDisplayData,
  toFallback: toWorldDisplayFallback,
  toHistoryBundle: toWorldDisplayHistoryBundle,
  toHistoryItem: toWorldDisplayHistoryItem,
  toLorebookItem: toWorldDisplayLorebookItem,
  toSceneItem: toWorldDisplaySceneItem,
  toSemanticBundle: toWorldDisplaySemanticBundle,
};
