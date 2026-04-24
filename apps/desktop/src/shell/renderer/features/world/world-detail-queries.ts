import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createWorldFacade,
  normalizeWorldTruthDetail,
  type WorldTruthListItem,
  type WorldTruthDetail,
} from '@nimiplatform/sdk/world';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { buildWorldHistorySummary, mergeWorldPrimaryDetailTruth, toSemanticBundle, toWorldAuditItem, toWorldBindingItem, toWorldLorebookItem } from './world-detail-query-converters';
import type {
  WorldAgent,
  WorldAuditItem,
  WorldDetailData,
  WorldHistoryBundle,
  WorldHistoryItem,
  WorldPublicAssetsData,
  WorldRecommendedAgent,
  WorldSceneItem,
  WorldSemanticData,
} from './world-detail-types';
import type { WorldListItem } from './world-list-model';
type WorldDetailWithAgentsResponse = Awaited<ReturnType<typeof dataSync.loadWorldDetailWithAgents>>;
type WorldDetailWithAgentsDto = NonNullable<WorldDetailWithAgentsResponse>;
type WorldHistoryPayload = Awaited<ReturnType<typeof dataSync.loadWorldHistory>>;
type WorldHistoryDetailDto = WorldHistoryPayload['items'][number];
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
