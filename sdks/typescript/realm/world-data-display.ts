import type { JsonObject } from '../types';
import {
  asRecord,
  readBoolean,
  readNumber,
  readStringArray,
  readStringValue,
  requireRecord,
  requireWorldError,
} from './world-data-primitives';
import {
  normalizeNimiRealmWorldTruthDetail,
  normalizeWorldStatus,
} from './world-data-truth';
import type {
  NimiRealmWorldAgent,
  NimiRealmWorldAgentStats,
  NimiRealmWorldAuditItem,
  NimiRealmWorldBindingItem,
  NimiRealmWorldDetailData,
  NimiRealmWorldDisplayComputed,
  NimiRealmWorldHistoryItem,
  NimiRealmWorldHistorySummary,
  NimiRealmWorldHistoryBundle,
  NimiRealmWorldLorebookItem,
  NimiRealmWorldPrimaryDetailRecord,
  NimiRealmWorldRecommendedAgent,
  NimiRealmWorldSceneItem,
  NimiRealmWorldSemanticData,
  NimiRealmWorldSemanticLanguage,
  NimiRealmWorldSemanticLevel,
  NimiRealmWorldSemanticPowerSystem,
  NimiRealmWorldSemanticRealm,
  NimiRealmWorldSemanticRule,
  NimiRealmWorldSemanticSnapshotItem,
  NimiRealmWorldSemanticTaboo,
  NimiRealmWorldSemanticTimelineItem,
  NimiRealmWorldSemanticTopology,
  NimiRealmWorldTruthDetail,
  NimiRealmWorldTruthRecommendedAgent,
} from './world-data-types';

export function formatNimiRealmWorldDisplayLabel(source: string): string {
  return String(source || '')
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatMixedLabel(source: string): string {
  return String(source || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function requireString(value: unknown, fieldName: string): string {
  const normalized = readStringValue(value);
  if (!normalized) {
    requireWorldError(`SDK_REALM_WORLD_DISPLAY_${fieldName.toUpperCase()}_INVALID`, 'World display field is invalid.', 'check_realm_world_response');
  }
  return normalized;
}

function requireNumber(value: unknown, fieldName: string): number {
  const normalized = readNumber(value);
  if (normalized == null) {
    requireWorldError(`SDK_REALM_WORLD_DISPLAY_${fieldName.toUpperCase()}_INVALID`, 'World display numeric field is invalid.', 'check_realm_world_response');
  }
  return normalized;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    requireWorldError(`SDK_REALM_WORLD_DISPLAY_${fieldName.toUpperCase()}_INVALID`, 'World display string array is invalid.', 'check_realm_world_response');
  }
  return value.map((item, index) => requireString(item, `${fieldName}_${index}`));
}

function requireObjectArray(value: unknown, fieldName: string): JsonObject[] {
  if (!Array.isArray(value)) {
    requireWorldError(`SDK_REALM_WORLD_DISPLAY_${fieldName.toUpperCase()}_INVALID`, 'World display record array is invalid.', 'check_realm_world_response');
  }
  return value.map((item, index) => requireRecord(item, `SDK_REALM_WORLD_DISPLAY_${fieldName.toUpperCase()}_${index}_INVALID`));
}

export function toNimiRealmWorldDisplayHistoryItem(rawValue: unknown, index: number): NimiRealmWorldHistoryItem {
  const raw = requireRecord(rawValue, 'SDK_REALM_WORLD_DISPLAY_EVENT_INVALID');
  const id = requireString(raw.id, 'event_id');
  const title = requireString(raw.title, 'event_title');
  const eventType = readStringValue(raw.eventType);
  const happenedAt = requireString(raw.happenedAt, 'event_happened_at');
  const eventTypeLower = eventType.toLowerCase();
  const parsedHappenedAt = new Date(happenedAt);
  const eventHorizon = eventTypeLower.includes('future')
    ? 'FUTURE'
    : eventTypeLower.includes('ongoing')
      ? 'ONGOING'
      : !Number.isNaN(parsedHappenedAt.getTime()) && parsedHappenedAt.getTime() > Date.now()
        ? 'FUTURE'
        : 'PAST';
  const evidenceRefs = Array.isArray(raw.evidenceRefs)
    ? raw.evidenceRefs.map((item) => {
        const evidence = requireRecord(item, 'SDK_REALM_WORLD_DISPLAY_EVENT_EVIDENCE_INVALID');
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
    description: readStringValue(raw.summary) || readStringValue(raw.cause) || readStringValue(raw.process) || readStringValue(raw.result),
    time: readStringValue(raw.timeRef) || happenedAt,
    tag: eventType ? formatMixedLabel(eventType) : ({ PAST: 'Past', ONGOING: 'Ongoing', FUTURE: 'Future' }[eventHorizon]),
    level: eventTypeLower.includes('secondary') ? 'SECONDARY' : 'PRIMARY',
    eventHorizon,
    summary: readStringValue(raw.summary) || null,
    cause: readStringValue(raw.cause) || null,
    process: readStringValue(raw.process) || null,
    result: readStringValue(raw.result) || null,
    locationRefs: requireStringArray(raw.locationRefs, 'event_location_refs'),
    characterRefs: requireStringArray(raw.characterRefs, 'event_character_refs'),
    evidenceRefs,
    confidence: evidenceRefs.length > 0
      ? evidenceRefs.reduce((sum, item) => sum + item.confidence, 0) / evidenceRefs.length
      : 0,
    needsEvidence: evidenceRefs.length === 0,
  };
}

export function buildNimiRealmWorldHistorySummary(
  items: readonly NimiRealmWorldHistoryItem[],
): NimiRealmWorldHistorySummary | null {
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

export function toNimiRealmWorldDisplayHistoryBundle(raw: { readonly items?: readonly unknown[] }): NimiRealmWorldHistoryBundle {
  const items = (raw.items ?? [])
    .map((item, index) => toNimiRealmWorldDisplayHistoryItem(item, index))
    .sort((left, right) => left.timelineSeq - right.timelineSeq || left.id.localeCompare(right.id));
  return {
    items,
    summary: buildNimiRealmWorldHistorySummary(items),
  };
}

function toSemanticRules(raw: unknown): NimiRealmWorldSemanticRule[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
        const record = requireRecord(item, 'SDK_REALM_WORLD_SEMANTIC_RULE_INVALID');
        return {
          key: requireString(record.key, 'semantic_rule_key'),
          title: requireString(record.title, 'semantic_rule_title'),
          value: requireString(record.value, 'semantic_rule_value'),
        };
      })
    : [];
}

function toSemanticLevels(raw: unknown): NimiRealmWorldSemanticLevel[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
        const record = requireRecord(item, 'SDK_REALM_WORLD_SEMANTIC_LEVEL_INVALID');
        return {
          name: requireString(record.name, 'semantic_level_name'),
          description: readStringValue(record.description) || null,
          extra: readStringValue(record.breakthroughCondition) || null,
        };
      })
    : [];
}

function toSemanticTaboos(raw: unknown): NimiRealmWorldSemanticTaboo[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
        const record = requireRecord(item, 'SDK_REALM_WORLD_SEMANTIC_TABOO_INVALID');
        const name = readStringValue(record.name) || readStringValue(record.title);
        if (!name) {
          requireWorldError('SDK_REALM_WORLD_SEMANTIC_TABOO_NAME_INVALID', 'World semantic taboo name is invalid.', 'check_realm_world_response');
        }
        return {
          name,
          description: readStringValue(record.description) || null,
          severity: readStringValue(record.severity) || null,
        };
      })
    : [];
}

function toSemanticRealms(raw: unknown): NimiRealmWorldSemanticRealm[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
        const record = requireRecord(item, 'SDK_REALM_WORLD_SEMANTIC_REALM_INVALID');
        return {
          name: requireString(record.name, 'semantic_realm_name'),
          description: readStringValue(record.description) || null,
          accessibility: readStringValue(record.accessibility) || null,
        };
      })
    : [];
}

function toSemanticLanguages(raw: unknown): NimiRealmWorldSemanticLanguage[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
        const record = requireRecord(item, 'SDK_REALM_WORLD_SEMANTIC_LANGUAGE_INVALID');
        return {
          name: requireString(record.name, 'semantic_language_name'),
          category: readStringValue(record.category) || null,
          description: readStringValue(record.description) || null,
          writingSample: readStringValue(record.writingSample) || null,
          spokenSample: readStringValue(record.spokenSample) || null,
          isCommon: readBoolean(record.isCommon) ?? null,
        };
      })
    : [];
}

function toWorldviewEvents(raw: readonly JsonObject[]): NimiRealmWorldSemanticTimelineItem[] {
  return raw.map((item, index) => ({
    id: readStringValue(item.id) || `worldview-event-${index + 1}`,
    title: readStringValue(item.title) || readStringValue(item.summary) || 'Worldview event',
    summary: readStringValue(item.summary) || null,
    eventType: readStringValue(item.eventType) || null,
    createdAt: readStringValue(item.createdAt) || null,
  }));
}

function toWorldviewSnapshots(raw: readonly JsonObject[]): NimiRealmWorldSemanticSnapshotItem[] {
  return raw.map((item, index) => ({
    id: readStringValue(item.id) || `worldview-snapshot-${index + 1}`,
    versionLabel: readStringValue(item.versionLabel) || readStringValue(item.version) || `v${index + 1}`,
    summary: readStringValue(item.summary) || null,
    createdAt: readStringValue(item.createdAt) || null,
  }));
}

export function toNimiRealmWorldDisplaySemanticBundle(raw: unknown): NimiRealmWorldSemanticData {
  const bundle = asRecord(raw);
  const worldview = asRecord(bundle.worldview);
  const truth = asRecord(worldview.truth);
  const operation = asRecord(truth.operation);
  const geography = asRecord(truth.geography);
  const metaphysics = asRecord(truth.metaphysics);
  const coreSystem = asRecord(truth.coreSystem);
  const languages = asRecord(worldview.languages);
  const powerSystems = Array.isArray(coreSystem.powerSystems)
    ? coreSystem.powerSystems.map((item) => {
        const record = requireRecord(item, 'SDK_REALM_WORLD_SEMANTIC_POWER_SYSTEM_INVALID');
        return {
          name: requireString(record.name, 'semantic_power_system_name'),
          description: readStringValue(record.description) || null,
          levels: toSemanticLevels(record.levels),
          rules: readStringArray(record.rules),
        };
      })
    : [];
  const standaloneLevels = toSemanticLevels(coreSystem.levels);
  const taboos = toSemanticTaboos(coreSystem.taboos);
  const topologyRecord = asRecord(geography.topology);
  const topology = Object.keys(topologyRecord).length > 0
    ? {
        type: readStringValue(topologyRecord.type) || null,
        boundary: readStringValue(topologyRecord.boundary) || null,
        dimensions: readStringValue(topologyRecord.dimensions) || null,
        realms: toSemanticRealms(topologyRecord.realms),
      }
    : null;
  const causalityRecord = asRecord(metaphysics.causality);
  const causality = Object.keys(causalityRecord).length > 0
    ? {
        type: readStringValue(causalityRecord.type) || null,
        karmaEnabled: readBoolean(causalityRecord.karmaEnabled) ?? null,
        fateWeight: readNumber(causalityRecord.fateWeight) ?? null,
      }
    : null;
  const data: NimiRealmWorldSemanticData = {
    operationTitle: readStringValue(operation.title) || readStringValue(truth.title) || null,
    operationDescription: readStringValue(operation.description) || readStringValue(truth.description) || null,
    operationRules: toSemanticRules(operation.rules),
    powerSystems,
    standaloneLevels,
    taboos,
    topology,
    causality,
    languages: toSemanticLanguages(languages.languages),
    worldviewEvents: toWorldviewEvents(requireObjectArray(bundle.worldviewEvents ?? [], 'worldview_events')),
    worldviewSnapshots: toWorldviewSnapshots(requireObjectArray(bundle.worldviewSnapshots ?? [], 'worldview_snapshots')),
    hasContent: false,
  };
  return {
    ...data,
    hasContent: Boolean(
      data.operationTitle
      || data.operationDescription
      || data.operationRules.length
      || data.powerSystems.length
      || data.standaloneLevels.length
      || data.taboos.length
      || data.topology
      || data.causality
      || data.languages.length
      || data.worldviewEvents.length
      || data.worldviewSnapshots.length,
    ),
  };
}

function toDisplayRecommendedAgent(agent: NimiRealmWorldTruthRecommendedAgent): NimiRealmWorldRecommendedAgent {
  return {
    id: agent.agentId,
    name: agent.name,
    handle: agent.handle ?? null,
    avatarUrl: agent.avatarUrl ?? null,
    importance: agent.importance ?? null,
    display: {
      role: agent.role ?? null,
      faction: agent.faction ?? null,
      location: agent.location ?? null,
    },
  };
}

export function mergeNimiRealmWorldPrimaryDetailTruth<T extends object>(
  detail: T,
  worldTruth: NimiRealmWorldTruthDetail,
): NimiRealmWorldPrimaryDetailRecord<T> {
  return {
    ...detail,
    worldTruth,
  };
}

function normalizeDisplayType(value: unknown): 'OASIS' | 'CREATOR' {
  return readStringValue(value) === 'OASIS' ? 'OASIS' : 'CREATOR';
}

function normalizeDisplayStatus(value: unknown): 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' {
  return normalizeWorldStatus(value) ?? 'DRAFT';
}

function normalizeDisplayNativeCreationState(value: unknown): 'OPEN' | 'NATIVE_CREATION_FROZEN' {
  return readStringValue(value) === 'NATIVE_CREATION_FROZEN' ? 'NATIVE_CREATION_FROZEN' : 'OPEN';
}

function normalizeDisplayFreezeReason(value: unknown): 'QUOTA_OVERFLOW' | 'WORLD_INACTIVE' | 'GOVERNANCE_LOCK' | null {
  const normalized = readStringValue(value);
  return normalized === 'QUOTA_OVERFLOW' || normalized === 'WORLD_INACTIVE' || normalized === 'GOVERNANCE_LOCK'
    ? normalized
    : null;
}

export function toNimiRealmWorldDisplayComputed(raw: unknown): NimiRealmWorldDisplayComputed {
  const record = asRecord(raw);
  const time = asRecord(record.time);
  const languages = asRecord(record.languages);
  const entry = asRecord(record.entry);
  const score = asRecord(record.score);
  const recommendedAgents = Array.isArray(entry.recommendedAgents)
    ? entry.recommendedAgents.map((item) => {
        const agent = asRecord(item);
        return {
          id: readStringValue(agent.id) || readStringValue(agent.agentId),
          name: readStringValue(agent.name) || 'Unknown',
          handle: readStringValue(agent.handle) || null,
          avatarUrl: readStringValue(agent.avatarUrl) || null,
        };
      }).filter((agent) => Boolean(agent.id))
    : [];
  return {
    time: {
      currentWorldTime: readStringValue(time.currentWorldTime) || null,
      currentLabel: readStringValue(time.currentLabel) || null,
      eraLabel: readStringValue(time.eraLabel) || null,
      flowRatio: Math.max(0.0001, readNumber(time.flowRatio) ?? 1),
      isPaused: readBoolean(time.isPaused) ?? false,
    },
    languages: {
      primary: readStringValue(languages.primary) || null,
      common: readStringArray(languages.common),
    },
    entry: { recommendedAgents },
    score: { scoreEwma: readNumber(score.scoreEwma) ?? 0 },
    featuredAgentCount: readNumber(record.featuredAgentCount) ?? 0,
  };
}

export function toNimiRealmWorldDisplayData(detailValue: unknown): NimiRealmWorldDetailData {
  const detail = requireRecord(detailValue, 'SDK_REALM_WORLD_DISPLAY_DETAIL_INVALID');
  const worldTruth = normalizeNimiRealmWorldTruthDetail({ detail }) ?? undefined;
  const computed = toNimiRealmWorldDisplayComputed(detail.computed);
  const recommendedAgents = worldTruth?.recommendedAgents?.map(toDisplayRecommendedAgent)
    ?? computed.entry.recommendedAgents;
  return {
    id: requireString(detail.id, 'id'),
    name: readStringValue(detail.name) || readStringValue(detail.title) || 'Unknown World',
    description: readStringValue(detail.description) || worldTruth?.description || null,
    tagline: readStringValue(detail.tagline) || null,
    motto: readStringValue(detail.motto) || null,
    overview: readStringValue(detail.overview) || null,
    contentRating: readStringValue(detail.contentRating) || null,
    iconUrl: readStringValue(detail.iconUrl) || null,
    bannerUrl: readStringValue(detail.bannerUrl) || null,
    type: normalizeDisplayType(detail.type),
    status: normalizeDisplayStatus(detail.status),
    level: readNumber(detail.level) ?? 1,
    levelUpdatedAt: readStringValue(detail.levelUpdatedAt) || null,
    agentCount: readNumber(detail.agentCount) ?? 0,
    createdAt: readStringValue(detail.createdAt),
    creatorId: readStringValue(detail.creatorId) || null,
    freezeReason: normalizeDisplayFreezeReason(detail.freezeReason),
    lorebookEntryLimit: readNumber(detail.lorebookEntryLimit) ?? 0,
    nativeAgentLimit: readNumber(detail.nativeAgentLimit) ?? 0,
    nativeCreationState: normalizeDisplayNativeCreationState(detail.nativeCreationState),
    scoreA: readNumber(detail.scoreA) ?? 0,
    scoreC: readNumber(detail.scoreC) ?? 0,
    scoreE: readNumber(detail.scoreE) ?? 0,
    scoreEwma: readNumber(detail.scoreEwma) ?? computed.score.scoreEwma,
    scoreQ: readNumber(detail.scoreQ) ?? 0,
    flowRatio: computed.time.flowRatio,
    isPaused: computed.time.isPaused,
    transitInLimit: readNumber(detail.transitInLimit) ?? 0,
    genre: readStringValue(detail.genre) || null,
    era: readStringValue(detail.era) || null,
    themes: readStringArray(detail.themes),
    currentWorldTime: computed.time.currentWorldTime,
    currentTimeLabel: computed.time.currentLabel,
    eraLabel: computed.time.eraLabel,
    primaryLanguage: computed.languages.primary,
    commonLanguages: computed.languages.common,
    recommendedAgents,
  };
}

export function toNimiRealmWorldDisplayFallback(worldValue: unknown): NimiRealmWorldDetailData {
  return toNimiRealmWorldDisplayData(worldValue);
}

export function toNimiRealmWorldDisplayAgent(agentValue: unknown, worldCreatedAt: string): NimiRealmWorldAgent {
  const agent = requireRecord(agentValue, 'SDK_REALM_WORLD_DISPLAY_AGENT_INVALID');
  const display = asRecord(agent.display);
  const importance = readStringValue(agent.importance);
  return {
    id: requireString(agent.id, 'agent_id'),
    name: readStringValue(agent.name) || 'Unknown',
    handle: readStringValue(agent.handle),
    bio: readStringValue(agent.bio),
    role: readStringValue(display.role) || null,
    faction: readStringValue(display.faction) || null,
    rank: readStringValue(display.rank) || null,
    sceneName: readStringValue(display.sceneName) || null,
    location: readStringValue(display.location) || null,
    createdAt: readStringValue(agent.createdAt) || worldCreatedAt,
    avatarUrl: readStringValue(agent.avatarUrl) || null,
    importance: importance === 'SECONDARY' || importance === 'BACKGROUND' ? importance : 'PRIMARY',
    stats: Object.keys(asRecord(agent.stats)).length > 0 ? asRecord(agent.stats) as NimiRealmWorldAgentStats : null,
  };
}

export function toNimiRealmWorldDisplayAuditItem(rawValue: unknown): NimiRealmWorldAuditItem {
  const raw = requireRecord(rawValue, 'SDK_REALM_WORLD_DISPLAY_AUDIT_INVALID');
  return {
    id: requireString(raw.id, 'audit_id'),
    label: readStringValue(raw.label) || readStringValue(raw.eventType) || 'World audit',
    eventType: readStringValue(raw.eventType) || null,
    occurredAt: readStringValue(raw.occurredAt) || readStringValue(raw.createdAt),
    prevLevel: readNumber(raw.prevLevel) ?? null,
    nextLevel: readNumber(raw.nextLevel) ?? null,
    ewmaScore: readNumber(raw.ewmaScore) ?? null,
    freezeReason: readStringValue(raw.freezeReason) || null,
  };
}

export function toNimiRealmWorldDisplayLorebookItem(rawValue: unknown): NimiRealmWorldLorebookItem {
  const raw = requireRecord(rawValue, 'SDK_REALM_WORLD_DISPLAY_LOREBOOK_INVALID');
  return {
    id: requireString(raw.id, 'lorebook_id'),
    key: readStringValue(raw.key) || readStringValue(raw.id),
    name: readStringValue(raw.name) || null,
    content: readStringValue(raw.content) || readStringValue(raw.summary),
    keywords: readStringArray(raw.keywords),
    priority: readNumber(raw.priority) ?? null,
  };
}

export function toNimiRealmWorldDisplaySceneItem(rawValue: unknown): NimiRealmWorldSceneItem {
  const raw = requireRecord(rawValue, 'SDK_REALM_WORLD_DISPLAY_SCENE_INVALID');
  return {
    id: requireString(raw.id, 'scene_id'),
    name: readStringValue(raw.name) || 'Unnamed scene',
    description: readStringValue(raw.description),
    activeEntities: readStringArray(raw.activeEntities),
  };
}

export function toNimiRealmWorldDisplayBindingItem(rawValue: unknown): NimiRealmWorldBindingItem {
  const raw = requireRecord(rawValue, 'SDK_REALM_WORLD_DISPLAY_BINDING_INVALID');
  const resource = requireRecord(raw.resource, 'SDK_REALM_WORLD_DISPLAY_BINDING_RESOURCE_INVALID');
  return {
    id: requireString(raw.id, 'binding_id'),
    objectType: requireString(raw.objectType, 'binding_object_type'),
    objectId: requireString(raw.objectId, 'binding_object_id'),
    hostType: requireString(raw.hostType, 'binding_host_type'),
    hostId: requireString(raw.hostId, 'binding_host_id'),
    bindingKind: requireString(raw.bindingKind, 'binding_kind'),
    bindingPoint: readStringValue(raw.bindingPoint) || null,
    priority: requireNumber(raw.priority, 'binding_priority'),
    tags: readStringArray(raw.tags),
    resource: {
      id: requireString(resource.id, 'binding_resource_id'),
      url: requireString(resource.url, 'binding_resource_url'),
      resourceType: requireString(resource.resourceType, 'binding_resource_type'),
      label: readStringValue(resource.label) || null,
    },
  };
}
