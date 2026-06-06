import type { JsonObject } from '../types';
import {
  asRecord,
  readNumber,
  readString,
  readStringArray,
  readStringValue,
} from './world-data-primitives';
import type {
  NimiRealmWorldStatus,
  NimiRealmWorldTruthAnchor,
  NimiRealmWorldTruthContentRating,
  NimiRealmWorldTruthDetail,
  NimiRealmWorldTruthListComputed,
  NimiRealmWorldTruthListItem,
  NimiRealmWorldTruthListRecommendedAgent,
  NimiRealmWorldTruthNativeCreationState,
  NimiRealmWorldTruthRecommendedAgent,
  NimiRealmWorldTruthSummary,
  NimiRealmWorldTruthWorldType,
  NimiRealmWorldTruthWorldview,
  NimiRealmWorldTruthWorldviewLifecycle,
} from './world-data-types';

function normalizeWorldTitle(record: JsonObject): string {
  return readString(record, ['displayName', 'display_name', 'title', 'name']);
}

function normalizeWorldSummary(record: JsonObject): string {
  return readString(record, [
    'summary',
    'worldSummary',
    'world_summary',
    'description',
    'intro',
    'prompt',
    'worldPrompt',
  ]);
}

export function normalizeWorldStatus(value: unknown): NimiRealmWorldStatus | undefined {
  const normalized = readStringValue(value);
  return normalized === 'DRAFT'
    || normalized === 'PENDING_REVIEW'
    || normalized === 'ACTIVE'
    || normalized === 'SUSPENDED'
    || normalized === 'ARCHIVED'
    ? normalized
    : undefined;
}

function normalizeWorldType(value: unknown): NimiRealmWorldTruthWorldType | undefined {
  const normalized = readStringValue(value);
  return normalized === 'OASIS' || normalized === 'CREATOR' ? normalized : undefined;
}

function normalizeContentRating(value: unknown): NimiRealmWorldTruthContentRating | undefined {
  const normalized = readStringValue(value);
  return normalized === 'UNRATED'
    || normalized === 'G'
    || normalized === 'PG13'
    || normalized === 'R18'
    || normalized === 'EXPLICIT'
    ? normalized
    : undefined;
}

function normalizeNativeCreationState(value: unknown): NimiRealmWorldTruthNativeCreationState | undefined {
  const normalized = readStringValue(value);
  return normalized === 'OPEN' || normalized === 'NATIVE_CREATION_FROZEN' ? normalized : undefined;
}

function normalizeWorldviewLifecycle(value: unknown): NimiRealmWorldTruthWorldviewLifecycle | undefined {
  const normalized = readStringValue(value);
  return normalized === 'ACTIVE'
    || normalized === 'MAINTENANCE'
    || normalized === 'FROZEN'
    || normalized === 'ARCHIVED'
    ? normalized
    : undefined;
}

function countArrayEntries(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function normalizeNimiRealmWorldTruthWorldview(value: unknown): NimiRealmWorldTruthWorldview | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const languages = asRecord(record.languages);
  const locations = asRecord(record.locations);
  const normalized: NimiRealmWorldTruthWorldview = {
    ...(normalizeWorldviewLifecycle(record.lifecycle) ? { lifecycle: normalizeWorldviewLifecycle(record.lifecycle) } : {}),
    ...(readNumber(record.version) != null ? { version: readNumber(record.version) } : {}),
    ...(readStringValue(record.updatedAt) ? { updatedAt: readStringValue(record.updatedAt) } : {}),
    ...(countArrayEntries(languages.languages) != null ? { languageCount: countArrayEntries(languages.languages) } : {}),
    ...(countArrayEntries(locations.regions) != null ? { regionCount: countArrayEntries(locations.regions) } : {}),
    ...(countArrayEntries(locations.landmarks) != null ? { landmarkCount: countArrayEntries(locations.landmarks) } : {}),
    ...(countArrayEntries(record.truthRules) != null ? { truthRuleCount: countArrayEntries(record.truthRules) } : {}),
    ...(record.visualGuide != null ? { hasVisualGuide: true } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeNimiRealmWorldTruthRecommendedAgent(value: unknown): NimiRealmWorldTruthRecommendedAgent | null {
  const record = asRecord(value);
  const display = asRecord(record.display);
  const agentId = readStringValue(record.id);
  const name = readStringValue(record.name) || normalizeWorldTitle(record);
  if (!agentId || !name) {
    return null;
  }
  const importance = readStringValue(record.importance);
  return {
    agentId,
    name,
    ...(readStringValue(record.handle) ? { handle: readStringValue(record.handle) } : {}),
    ...(readStringValue(record.avatarUrl) ? { avatarUrl: readStringValue(record.avatarUrl) } : {}),
    ...(importance === 'PRIMARY' || importance === 'SECONDARY' || importance === 'BACKGROUND'
      ? { importance }
      : {}),
    ...(readStringValue(display.role) ? { role: readStringValue(display.role) } : {}),
    ...(readStringValue(display.faction) ? { faction: readStringValue(display.faction) } : {}),
    ...(readStringValue(display.location) ? { location: readStringValue(display.location) } : {}),
    ...(readStringValue(display.statusSummary) ? { statusSummary: readStringValue(display.statusSummary) } : {}),
  };
}

function normalizeNimiRealmWorldTruthListRecommendedAgent(
  value: unknown,
): NimiRealmWorldTruthListRecommendedAgent | null {
  const record = asRecord(value);
  const agentId = readStringValue(record.id);
  const name = readStringValue(record.name) || normalizeWorldTitle(record);
  if (!agentId || !name) {
    return null;
  }
  return {
    agentId,
    name,
    ...(readStringValue(record.handle) ? { handle: readStringValue(record.handle) } : {}),
    ...(readStringValue(record.avatarUrl) ? { avatarUrl: readStringValue(record.avatarUrl) } : {}),
  };
}

function normalizeNimiRealmWorldTruthListComputed(value: unknown): NimiRealmWorldTruthListComputed | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const time = asRecord(record.time);
  const languages = asRecord(record.languages);
  const entry = asRecord(record.entry);
  const score = asRecord(record.score);
  const recommendedAgents = Array.isArray(entry.recommendedAgents)
    ? entry.recommendedAgents
      .map(normalizeNimiRealmWorldTruthListRecommendedAgent)
      .filter((item): item is NimiRealmWorldTruthListRecommendedAgent => Boolean(item))
    : [];
  const normalized: NimiRealmWorldTruthListComputed = {
    ...(Object.keys(time).length > 0
      ? {
          time: {
            ...(readStringValue(time.currentWorldTime) ? { currentWorldTime: readStringValue(time.currentWorldTime) } : {}),
            ...(readStringValue(time.currentLabel) ? { currentLabel: readStringValue(time.currentLabel) } : {}),
            ...(readStringValue(time.eraLabel) ? { eraLabel: readStringValue(time.eraLabel) } : {}),
            ...(readNumber(time.flowRatio) != null ? { flowRatio: readNumber(time.flowRatio) } : {}),
            ...(typeof time.isPaused === 'boolean' ? { isPaused: time.isPaused } : {}),
          },
        }
      : {}),
    ...(Object.keys(languages).length > 0
      ? {
          languages: {
            ...(readStringValue(languages.primary) ? { primary: readStringValue(languages.primary) } : {}),
            ...(readStringArray(languages.common).length > 0 ? { common: readStringArray(languages.common) } : {}),
          },
        }
      : {}),
    ...(recommendedAgents.length > 0 ? { entry: { recommendedAgents } } : {}),
    ...(Object.keys(score).length > 0
      ? { score: { ...(readNumber(score.scoreEwma) != null ? { scoreEwma: readNumber(score.scoreEwma) } : {}) } }
      : {}),
    ...(readNumber(record.featuredAgentCount) != null ? { featuredAgentCount: readNumber(record.featuredAgentCount) } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeNimiRealmWorldTruthAnchor(value: unknown): NimiRealmWorldTruthAnchor | null {
  const record = asRecord(value);
  const world = asRecord(record.world);
  const worldview = asRecord(record.worldview);
  const source = Object.keys(world).length > 0 ? world : record;
  const worldId = readString(source, ['worldId', 'world_id', 'id']);
  if (!worldId) {
    return null;
  }
  const title = normalizeWorldTitle(source);
  const summary = normalizeWorldSummary(source);
  const worldviewSummary = normalizeWorldSummary(worldview);
  return {
    worldId,
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(worldviewSummary ? { worldviewSummary } : {}),
  };
}

export function normalizeNimiRealmWorldTruthSummary(value: unknown): NimiRealmWorldTruthSummary | null {
  const record = asRecord(value);
  const world = asRecord(record.world);
  const worldview = asRecord(record.worldview);
  const source = Object.keys(world).length > 0 ? world : record;
  const anchor = normalizeNimiRealmWorldTruthAnchor({ world: source, worldview });
  if (!anchor) {
    return null;
  }
  return {
    ...anchor,
    ...(normalizeWorldSummary(source) ? { description: normalizeWorldSummary(source) } : {}),
    ...(readStringValue(source.tagline) ? { tagline: readStringValue(source.tagline) } : {}),
    ...(readStringValue(source.genre) ? { genre: readStringValue(source.genre) } : {}),
    ...(readStringArray(source.themes).length > 0 ? { themes: readStringArray(source.themes) } : {}),
    ...(normalizeWorldStatus(source.status) ? { status: normalizeWorldStatus(source.status) } : {}),
    ...(normalizeWorldType(source.type) ? { type: normalizeWorldType(source.type) } : {}),
    ...(readStringValue(source.createdAt) ? { createdAt: readStringValue(source.createdAt) } : {}),
    ...(readStringValue(source.updatedAt) ? { updatedAt: readStringValue(source.updatedAt) } : {}),
    ...(normalizeNimiRealmWorldTruthWorldview(worldview)
      ? { worldview: normalizeNimiRealmWorldTruthWorldview(worldview) }
      : {}),
  };
}

export function normalizeNimiRealmWorldTruthListItem(value: unknown): NimiRealmWorldTruthListItem | null {
  const record = asRecord(value);
  const summary = normalizeNimiRealmWorldTruthSummary({ world: record });
  if (!summary) {
    return null;
  }
  const computed = normalizeNimiRealmWorldTruthListComputed(record.computed);
  return {
    ...summary,
    ...(readStringValue(record.overview) ? { overview: readStringValue(record.overview) } : {}),
    ...(readStringValue(record.motto) ? { motto: readStringValue(record.motto) } : {}),
    ...(readStringValue(record.era) ? { era: readStringValue(record.era) } : {}),
    ...(readStringValue(record.iconUrl) ? { iconUrl: readStringValue(record.iconUrl) } : {}),
    ...(readStringValue(record.bannerUrl) ? { bannerUrl: readStringValue(record.bannerUrl) } : {}),
    ...(readStringValue(record.creatorId) ? { creatorId: readStringValue(record.creatorId) } : {}),
    ...(readNumber(record.level) != null ? { level: readNumber(record.level) } : {}),
    ...(readStringValue(record.levelUpdatedAt) ? { levelUpdatedAt: readStringValue(record.levelUpdatedAt) } : {}),
    ...(readNumber(record.agentCount) != null ? { agentCount: readNumber(record.agentCount) } : {}),
    ...(readStringValue(record.freezeReason) ? { freezeReason: readStringValue(record.freezeReason) } : {}),
    ...(readNumber(record.lorebookEntryLimit) != null ? { lorebookEntryLimit: readNumber(record.lorebookEntryLimit) } : {}),
    ...(readNumber(record.nativeAgentLimit) != null ? { nativeAgentLimit: readNumber(record.nativeAgentLimit) } : {}),
    ...(normalizeContentRating(record.contentRating) ? { contentRating: normalizeContentRating(record.contentRating) } : {}),
    ...(normalizeNativeCreationState(record.nativeCreationState)
      ? { nativeCreationState: normalizeNativeCreationState(record.nativeCreationState) }
      : {}),
    ...(readNumber(record.scoreA) != null ? { scoreA: readNumber(record.scoreA) } : {}),
    ...(readNumber(record.scoreC) != null ? { scoreC: readNumber(record.scoreC) } : {}),
    ...(readNumber(record.scoreE) != null ? { scoreE: readNumber(record.scoreE) } : {}),
    ...(readNumber(record.scoreEwma) != null ? { scoreEwma: readNumber(record.scoreEwma) } : {}),
    ...(readNumber(record.scoreQ) != null ? { scoreQ: readNumber(record.scoreQ) } : {}),
    ...(readNumber(record.transitInLimit) != null ? { transitInLimit: readNumber(record.transitInLimit) } : {}),
    ...(computed ? { computed } : {}),
  };
}

export function normalizeNimiRealmWorldTruthDetail(value: unknown): NimiRealmWorldTruthDetail | null {
  const record = asRecord(value);
  const detail = asRecord(record.detail);
  const world = Object.keys(detail).length > 0 ? detail : asRecord(record.world);
  const source = Object.keys(world).length > 0 ? world : record;
  const worldview = asRecord(record.worldview);
  const summary = normalizeNimiRealmWorldTruthSummary({ world: source, worldview });
  if (!summary) {
    return null;
  }
  const agents = Array.isArray(source.agents)
    ? source.agents
      .map(normalizeNimiRealmWorldTruthRecommendedAgent)
      .filter((item): item is NimiRealmWorldTruthRecommendedAgent => Boolean(item))
    : [];
  return {
    ...summary,
    ...(readStringValue(source.overview) ? { overview: readStringValue(source.overview) } : {}),
    ...(readStringValue(source.motto) ? { motto: readStringValue(source.motto) } : {}),
    ...(readStringValue(source.era) ? { era: readStringValue(source.era) } : {}),
    ...(readStringValue(source.iconUrl) ? { iconUrl: readStringValue(source.iconUrl) } : {}),
    ...(readStringValue(source.bannerUrl) ? { bannerUrl: readStringValue(source.bannerUrl) } : {}),
    ...(readStringValue(source.creatorId) ? { creatorId: readStringValue(source.creatorId) } : {}),
    ...(readNumber(source.level) != null ? { level: readNumber(source.level) } : {}),
    ...(readNumber(source.agentCount) != null ? { agentCount: readNumber(source.agentCount) } : {}),
    ...(readNumber(source.featuredAgentCount) != null ? { featuredAgentCount: readNumber(source.featuredAgentCount) } : {}),
    ...(normalizeContentRating(source.contentRating) ? { contentRating: normalizeContentRating(source.contentRating) } : {}),
    ...(normalizeNativeCreationState(source.nativeCreationState)
      ? { nativeCreationState: normalizeNativeCreationState(source.nativeCreationState) }
      : {}),
    ...(agents.length > 0 ? { recommendedAgents: agents } : {}),
  };
}
