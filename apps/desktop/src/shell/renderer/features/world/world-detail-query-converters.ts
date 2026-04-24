import { dataSync } from '@runtime/data-sync';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@runtime/net/json';
import type { WorldTruthDetail, WorldTruthRecommendedAgent } from '@nimiplatform/sdk/world';
import type {
  WorldAuditItem,
  WorldBindingItem,
  WorldHistoryBundle,
  WorldHistoryItem,
  WorldLorebookItem,
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
type WorldDetailWithAgentsResponse = Awaited<ReturnType<typeof dataSync.loadWorldDetailWithAgents>>;
type WorldDetailWithAgentsDto = NonNullable<WorldDetailWithAgentsResponse>;
type WorldSemanticBundleDto = Awaited<ReturnType<typeof dataSync.loadWorldSemanticBundle>>;
type WorldviewDetailDto = NonNullable<WorldSemanticBundleDto['worldview']>;
type PowerSystemDto = RealmModel<'PowerSystemDto'>;
type PowerSystemLevelDto = RealmModel<'PowerSystemLevelDto'>;
type PowerSystemTabooDto = RealmModel<'PowerSystemTabooDto'>;
type SpaceRealmDto = RealmModel<'SpaceRealmDto'>;
type WorldLanguageDto = RealmModel<'WorldLanguageDto'>;
type PublicWorldLorebookDto = Awaited<ReturnType<typeof dataSync.loadWorldLorebooks>>['items'][number];
type PublicBindingDto = Awaited<ReturnType<typeof dataSync.loadWorldBindings>>['items'][number];
export type WorldPrimaryDetailRecord = WorldDetailWithAgentsDto & { worldTruth: WorldTruthDetail };
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
  const result = readString(value);
  if (!result) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
  return result;
}
function requireNumber(value: unknown, fieldName: string): number {
  const result = readNumber(value);
  if (result == null) {
    throw new Error(`WORLD_DETAIL_${fieldName.toUpperCase()}_INVALID`);
  }
  return result;
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
function formatLabel(source: string): string {
  return source.split(/[_-]+/g).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
}
function stringifyLoose(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
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
export function toSemanticBundle(raw: WorldSemanticBundleDto): WorldSemanticData {
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
export function toWorldAuditItem(raw: WorldLevelAuditEventDto): WorldAuditItem {
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
export function toWorldLorebookItem(raw: PublicWorldLorebookDto): WorldLorebookItem {
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
export function toWorldBindingItem(raw: PublicBindingDto): WorldBindingItem {
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
export function buildWorldHistorySummary(items: WorldHistoryItem[]): WorldHistoryBundle['summary'] {
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
export function mergeWorldPrimaryDetailTruth(
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
