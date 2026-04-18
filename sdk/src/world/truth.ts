import { asRecord, readString } from '../internal/utils.js';
import { createNimiError } from '../runtime/errors.js';
import { ReasonCode } from '../types/index.js';
import type { PlatformClient } from '../platform-client.js';
import type {
  WorldTruthAnchor,
  WorldTruthListComputed,
  WorldTruthListItem,
  WorldTruthListRecommendedAgent,
  WorldTruthDetail,
  WorldTruthRecommendedAgent,
  WorldTruthSummary,
  WorldTruthWorldview,
} from './types.js';

function normalizeWorldId(record: Record<string, unknown>): string {
  return readString(record, ['worldId', 'world_id', 'id']);
}

function normalizeWorldTitle(record: Record<string, unknown>): string {
  return readString(record, ['displayName', 'display_name', 'title', 'name']);
}

function normalizeWorldSummary(record: Record<string, unknown>): string {
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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizeWorldStatus(value: unknown): WorldTruthSummary['status'] | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case 'DRAFT':
    case 'PENDING_REVIEW':
    case 'ACTIVE':
    case 'SUSPENDED':
    case 'ARCHIVED':
      return normalized;
    default:
      return undefined;
  }
}

function normalizeWorldType(value: unknown): WorldTruthSummary['type'] | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case 'OASIS':
    case 'CREATOR':
      return normalized;
    default:
      return undefined;
  }
}

function normalizeContentRating(value: unknown): WorldTruthDetail['contentRating'] | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case 'UNRATED':
    case 'G':
    case 'PG13':
    case 'R18':
    case 'EXPLICIT':
      return normalized;
    default:
      return undefined;
  }
}

function normalizeNativeCreationState(value: unknown): WorldTruthDetail['nativeCreationState'] | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case 'OPEN':
    case 'NATIVE_CREATION_FROZEN':
      return normalized;
    default:
      return undefined;
  }
}

function normalizeWorldviewLifecycle(value: unknown): WorldTruthWorldview['lifecycle'] | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case 'ACTIVE':
    case 'MAINTENANCE':
    case 'FROZEN':
    case 'ARCHIVED':
      return normalized;
    default:
      return undefined;
  }
}

function countArrayEntries(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function normalizeWorldTruthWorldview(
  value: unknown,
): WorldTruthWorldview | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const languages = asRecord(record.languages);
  const locations = asRecord(record.locations);
  const normalized: WorldTruthWorldview = {
    ...(normalizeWorldviewLifecycle(record.lifecycle) ? { lifecycle: normalizeWorldviewLifecycle(record.lifecycle) } : {}),
    ...(normalizeNumber(record.version) != null ? { version: normalizeNumber(record.version) } : {}),
    ...(normalizeString(record.updatedAt) ? { updatedAt: normalizeString(record.updatedAt) } : {}),
    ...(countArrayEntries(languages.languages) != null ? { languageCount: countArrayEntries(languages.languages) } : {}),
    ...(countArrayEntries(locations.regions) != null ? { regionCount: countArrayEntries(locations.regions) } : {}),
    ...(countArrayEntries(locations.landmarks) != null ? { landmarkCount: countArrayEntries(locations.landmarks) } : {}),
    ...(countArrayEntries(record.truthRules) != null ? { truthRuleCount: countArrayEntries(record.truthRules) } : {}),
    ...(record.visualGuide != null ? { hasVisualGuide: true } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeRecommendedAgent(
  value: unknown,
): WorldTruthRecommendedAgent | null {
  const record = asRecord(value);
  const display = asRecord(record.display);
  const agentId = normalizeString(record.id);
  const name = normalizeString(record.name) || normalizeWorldTitle(record);
  if (!agentId || !name) {
    return null;
  }
  const importance = normalizeString(record.importance);
  return {
    agentId,
    name,
    ...(normalizeString(record.handle) ? { handle: normalizeString(record.handle) } : {}),
    ...(normalizeString(record.avatarUrl) ? { avatarUrl: normalizeString(record.avatarUrl) } : {}),
    ...(importance === 'PRIMARY' || importance === 'SECONDARY' || importance === 'BACKGROUND'
      ? { importance }
      : {}),
    ...(normalizeString(display.role) ? { role: normalizeString(display.role) } : {}),
    ...(normalizeString(display.faction) ? { faction: normalizeString(display.faction) } : {}),
    ...(normalizeString(display.location) ? { location: normalizeString(display.location) } : {}),
    ...(normalizeString(display.statusSummary) ? { statusSummary: normalizeString(display.statusSummary) } : {}),
  };
}

function normalizeRecommendedAgents(value: unknown): WorldTruthRecommendedAgent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeRecommendedAgent(item))
    .filter((item): item is WorldTruthRecommendedAgent => Boolean(item));
}

function normalizeListRecommendedAgent(
  value: unknown,
): WorldTruthListRecommendedAgent | null {
  const record = asRecord(value);
  const agentId = normalizeString(record.id);
  const name = normalizeString(record.name) || normalizeWorldTitle(record);
  if (!agentId || !name) {
    return null;
  }
  return {
    agentId,
    name,
    ...(normalizeString(record.handle) ? { handle: normalizeString(record.handle) } : {}),
    ...(normalizeString(record.avatarUrl) ? { avatarUrl: normalizeString(record.avatarUrl) } : {}),
  };
}

function normalizeListRecommendedAgents(
  value: unknown,
): WorldTruthListRecommendedAgent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeListRecommendedAgent(item))
    .filter((item): item is WorldTruthListRecommendedAgent => Boolean(item));
}

function normalizeWorldTruthListComputed(
  value: unknown,
): WorldTruthListComputed | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const time = asRecord(record.time);
  const languages = asRecord(record.languages);
  const entry = asRecord(record.entry);
  const score = asRecord(record.score);
  const recommendedAgents = normalizeListRecommendedAgents(entry.recommendedAgents);
  const normalized: WorldTruthListComputed = {
    ...(Object.keys(time).length > 0
      ? {
          time: {
            ...(normalizeString(time.currentWorldTime) ? { currentWorldTime: normalizeString(time.currentWorldTime) } : {}),
            ...(normalizeString(time.currentLabel) ? { currentLabel: normalizeString(time.currentLabel) } : {}),
            ...(normalizeString(time.eraLabel) ? { eraLabel: normalizeString(time.eraLabel) } : {}),
            ...(normalizeNumber(time.flowRatio) != null ? { flowRatio: normalizeNumber(time.flowRatio) } : {}),
            ...(typeof time.isPaused === 'boolean' ? { isPaused: time.isPaused } : {}),
          },
        }
      : {}),
    ...(Object.keys(languages).length > 0
      ? {
          languages: {
            ...(normalizeString(languages.primary) ? { primary: normalizeString(languages.primary) } : {}),
            ...(normalizeStringList(languages.common).length > 0 ? { common: normalizeStringList(languages.common) } : {}),
          },
        }
      : {}),
    ...(recommendedAgents.length > 0
      ? {
          entry: {
            recommendedAgents,
          },
        }
      : {}),
    ...(Object.keys(score).length > 0
      ? {
          score: {
            ...(normalizeNumber(score.scoreEwma) != null ? { scoreEwma: normalizeNumber(score.scoreEwma) } : {}),
          },
        }
      : {}),
    ...(normalizeNumber(record.featuredAgentCount) != null
      ? { featuredAgentCount: normalizeNumber(record.featuredAgentCount) }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeWorldTruthAnchor(
  value: unknown,
): WorldTruthAnchor | null {
  const root = asRecord(value);
  const world = asRecord(root.world);
  const worldview = asRecord(root.worldview);
  const worldRecord = Object.keys(world).length > 0 ? world : root;
  const worldviewRecord = Object.keys(worldview).length > 0 ? worldview : root;
  const worldId = normalizeWorldId(worldRecord) || normalizeWorldId(worldviewRecord);
  if (!worldId) {
    return null;
  }
  const title = normalizeWorldTitle(worldRecord);
  const summary = normalizeWorldSummary(worldRecord);
  const worldviewSummary = normalizeWorldSummary(worldviewRecord);
  return {
    worldId,
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(worldviewSummary ? { worldviewSummary } : {}),
  };
}

export function normalizeWorldTruthSummary(
  value: unknown,
): WorldTruthSummary | null {
  const root = asRecord(value);
  const world = asRecord(root.world);
  const worldview = asRecord(root.worldview);
  const worldRecord = Object.keys(world).length > 0 ? world : root;
  const worldviewRecord = Object.keys(worldview).length > 0 ? worldview : root;
  const anchor = normalizeWorldTruthAnchor({ world: worldRecord, worldview: worldviewRecord });
  if (!anchor) {
    return null;
  }
  return {
    ...anchor,
    ...(normalizeString(worldRecord.description) ? { description: normalizeString(worldRecord.description) } : {}),
    ...(normalizeString(worldRecord.tagline) ? { tagline: normalizeString(worldRecord.tagline) } : {}),
    ...(normalizeString(worldRecord.genre) ? { genre: normalizeString(worldRecord.genre) } : {}),
    ...(normalizeStringList(worldRecord.themes).length > 0 ? { themes: normalizeStringList(worldRecord.themes) } : {}),
    ...(normalizeWorldStatus(worldRecord.status) ? { status: normalizeWorldStatus(worldRecord.status) } : {}),
    ...(normalizeWorldType(worldRecord.type) ? { type: normalizeWorldType(worldRecord.type) } : {}),
    ...(normalizeString(worldRecord.createdAt) ? { createdAt: normalizeString(worldRecord.createdAt) } : {}),
    ...(normalizeString(worldRecord.updatedAt) ? { updatedAt: normalizeString(worldRecord.updatedAt) } : {}),
    ...(normalizeWorldTruthWorldview(worldviewRecord) ? { worldview: normalizeWorldTruthWorldview(worldviewRecord) } : {}),
  };
}

export function normalizeWorldTruthListItem(
  value: unknown,
): WorldTruthListItem | null {
  const record = asRecord(value);
  const summary = normalizeWorldTruthSummary({ world: record });
  if (!summary) {
    return null;
  }
  const computed = normalizeWorldTruthListComputed(record.computed);
  return {
    ...summary,
    ...(normalizeString(record.overview) ? { overview: normalizeString(record.overview) } : {}),
    ...(normalizeString(record.motto) ? { motto: normalizeString(record.motto) } : {}),
    ...(normalizeString(record.era) ? { era: normalizeString(record.era) } : {}),
    ...(normalizeString(record.iconUrl) ? { iconUrl: normalizeString(record.iconUrl) } : {}),
    ...(normalizeString(record.bannerUrl) ? { bannerUrl: normalizeString(record.bannerUrl) } : {}),
    ...(normalizeString(record.creatorId) ? { creatorId: normalizeString(record.creatorId) } : {}),
    ...(normalizeNumber(record.level) != null ? { level: normalizeNumber(record.level) } : {}),
    ...(normalizeString(record.levelUpdatedAt) ? { levelUpdatedAt: normalizeString(record.levelUpdatedAt) } : {}),
    ...(normalizeNumber(record.agentCount) != null ? { agentCount: normalizeNumber(record.agentCount) } : {}),
    ...(normalizeString(record.freezeReason) ? { freezeReason: normalizeString(record.freezeReason) } : {}),
    ...(normalizeNumber(record.lorebookEntryLimit) != null
      ? { lorebookEntryLimit: normalizeNumber(record.lorebookEntryLimit) }
      : {}),
    ...(normalizeNumber(record.nativeAgentLimit) != null
      ? { nativeAgentLimit: normalizeNumber(record.nativeAgentLimit) }
      : {}),
    ...(normalizeContentRating(record.contentRating) ? { contentRating: normalizeContentRating(record.contentRating) } : {}),
    ...(normalizeNativeCreationState(record.nativeCreationState)
      ? { nativeCreationState: normalizeNativeCreationState(record.nativeCreationState) }
      : {}),
    ...(normalizeNumber(record.scoreA) != null ? { scoreA: normalizeNumber(record.scoreA) } : {}),
    ...(normalizeNumber(record.scoreC) != null ? { scoreC: normalizeNumber(record.scoreC) } : {}),
    ...(normalizeNumber(record.scoreE) != null ? { scoreE: normalizeNumber(record.scoreE) } : {}),
    ...(normalizeNumber(record.scoreEwma) != null ? { scoreEwma: normalizeNumber(record.scoreEwma) } : {}),
    ...(normalizeNumber(record.scoreQ) != null ? { scoreQ: normalizeNumber(record.scoreQ) } : {}),
    ...(normalizeNumber(record.transitInLimit) != null ? { transitInLimit: normalizeNumber(record.transitInLimit) } : {}),
    ...(computed ? { computed } : {}),
  };
}

export function normalizeWorldTruthDetail(
  value: unknown,
): WorldTruthDetail | null {
  const root = asRecord(value);
  const detail = asRecord(root.detail);
  const world = asRecord(root.world);
  const worldview = asRecord(root.worldview);
  const detailRecord = Object.keys(detail).length > 0
    ? detail
    : (Object.keys(world).length > 0 ? world : root);
  const summary = normalizeWorldTruthSummary({
    world: detailRecord,
    worldview,
  });
  if (!summary) {
    return null;
  }
  const computed = asRecord(detailRecord.computed);
  const entry = asRecord(computed.entry);
  const recommendedAgents = normalizeRecommendedAgents(entry.recommendedAgents);
  return {
    ...summary,
    ...(normalizeString(detailRecord.overview) ? { overview: normalizeString(detailRecord.overview) } : {}),
    ...(normalizeString(detailRecord.motto) ? { motto: normalizeString(detailRecord.motto) } : {}),
    ...(normalizeString(detailRecord.era) ? { era: normalizeString(detailRecord.era) } : {}),
    ...(normalizeString(detailRecord.iconUrl) ? { iconUrl: normalizeString(detailRecord.iconUrl) } : {}),
    ...(normalizeString(detailRecord.bannerUrl) ? { bannerUrl: normalizeString(detailRecord.bannerUrl) } : {}),
    ...(normalizeString(detailRecord.creatorId) ? { creatorId: normalizeString(detailRecord.creatorId) } : {}),
    ...(normalizeNumber(detailRecord.level) != null ? { level: normalizeNumber(detailRecord.level) } : {}),
    ...(normalizeNumber(detailRecord.agentCount) != null ? { agentCount: normalizeNumber(detailRecord.agentCount) } : {}),
    ...(normalizeNumber(computed.featuredAgentCount) != null
      ? { featuredAgentCount: normalizeNumber(computed.featuredAgentCount) }
      : {}),
    ...(normalizeContentRating(detailRecord.contentRating) ? { contentRating: normalizeContentRating(detailRecord.contentRating) } : {}),
    ...(normalizeNativeCreationState(detailRecord.nativeCreationState)
      ? { nativeCreationState: normalizeNativeCreationState(detailRecord.nativeCreationState) }
      : {}),
    ...(recommendedAgents.length > 0 ? { recommendedAgents } : {}),
  };
}

export async function readWorldTruthAnchor(
  client: Pick<PlatformClient, 'domains'>,
  worldId: string,
): Promise<WorldTruthAnchor> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw createNimiError({
      message: 'worldId is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_world_id',
      source: 'sdk',
    });
  }
  const [world, worldview] = await Promise.all([
    client.domains.world.getWorld(normalizedWorldId),
    client.domains.world.getWorldview(normalizedWorldId),
  ]);
  return normalizeWorldTruthAnchor({ world, worldview }) || { worldId: normalizedWorldId };
}

export async function readWorldTruthSummary(
  client: Pick<PlatformClient, 'domains'>,
  worldId: string,
): Promise<WorldTruthSummary> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw createNimiError({
      message: 'worldId is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_world_id',
      source: 'sdk',
    });
  }
  const [world, worldview] = await Promise.all([
    client.domains.world.getWorld(normalizedWorldId),
    client.domains.world.getWorldview(normalizedWorldId),
  ]);
  return normalizeWorldTruthSummary({ world, worldview }) || { worldId: normalizedWorldId };
}

export async function readWorldTruthDetail(
  client: Pick<PlatformClient, 'domains'>,
  worldId: string,
  recommendedAgentLimit = 4,
): Promise<WorldTruthDetail> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw createNimiError({
      message: 'worldId is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_world_id',
      source: 'sdk',
    });
  }
  const [detail, worldview] = await Promise.all([
    client.domains.world.getWorldDetailWithAgents(normalizedWorldId, recommendedAgentLimit),
    client.domains.world.getWorldview(normalizedWorldId),
  ]);
  return normalizeWorldTruthDetail({ detail, worldview }) || { worldId: normalizedWorldId };
}

export async function readWorldTruthList(
  client: Pick<PlatformClient, 'domains'>,
  status?: WorldTruthSummary['status'],
): Promise<WorldTruthListItem[]> {
  const worlds = await client.domains.world.listWorlds(status);
  if (!Array.isArray(worlds)) {
    return [];
  }
  return worlds
    .map((world) => normalizeWorldTruthListItem(world))
    .filter((world): world is WorldTruthListItem => Boolean(world));
}

export const truth = {
  normalize: normalizeWorldTruthSummary,
  normalizeAnchor: normalizeWorldTruthAnchor,
  normalizeListItem: normalizeWorldTruthListItem,
  normalizeSummary: normalizeWorldTruthSummary,
  normalizeDetail: normalizeWorldTruthDetail,
  list: readWorldTruthList,
  read: readWorldTruthSummary,
  readAnchor: readWorldTruthAnchor,
  readList: readWorldTruthList,
  readSummary: readWorldTruthSummary,
  readDetail: readWorldTruthDetail,
};
