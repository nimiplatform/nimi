import { realmWorldData } from './data/realm-world-data';
import { queryClient } from '@renderer/infra/query-client/query-client';
import type {
  WorldAgent,
  WorldAgentStats,
  WorldAuditItem,
  WorldBindingItem,
  WorldDetailData,
  WorldHistoryBundle,
  WorldHistoryEvidenceRef,
  WorldHistoryItem,
  WorldHistorySummary,
  WorldLorebookItem,
  WorldPublicAssetsData,
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
} from './world-detail-types';
import { toWorldListItem, type WorldListItem } from './world-list-model';

type JsonRecord = Record<string, unknown>;
type WorldDetailWithAgentsResponse = Awaited<ReturnType<typeof realmWorldData.loadWorldDetailWithAgents>>;
type WorldPrimaryDetailRecord = NonNullable<WorldDetailWithAgentsResponse>;

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

function normalizeWorldId(worldId: string): string {
  return String(worldId || '').trim();
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function readStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readString(record: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = readStringValue(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function readNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readStringValue(item)).filter(Boolean)
    : [];
}

function readRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item) => Object.keys(item).length > 0)
    : [];
}

function formatMixedLabel(source: string): string {
  return String(source || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeDisplayType(value: unknown): 'OASIS' | 'CREATOR' {
  return readStringValue(value) === 'OASIS' ? 'OASIS' : 'CREATOR';
}

function normalizeDisplayStatus(value: unknown): WorldDetailData['status'] {
  const normalized = readStringValue(value);
  return normalized === 'DRAFT'
    || normalized === 'PENDING_REVIEW'
    || normalized === 'ACTIVE'
    || normalized === 'SUSPENDED'
    || normalized === 'ARCHIVED'
    ? normalized
    : 'DRAFT';
}

function normalizeDisplayNativeCreationState(value: unknown): WorldDetailData['nativeCreationState'] {
  return readStringValue(value) === 'NATIVE_CREATION_FROZEN' ? 'NATIVE_CREATION_FROZEN' : 'OPEN';
}

function normalizeDisplayFreezeReason(value: unknown): WorldDetailData['freezeReason'] {
  const normalized = readStringValue(value);
  return normalized === 'QUOTA_OVERFLOW' || normalized === 'WORLD_INACTIVE' || normalized === 'GOVERNANCE_LOCK'
    ? normalized
    : null;
}

function toWorldDisplayData(detailValue: unknown): WorldDetailData {
  const listItem = toWorldListItem(asRecord(detailValue));
  return {
    id: listItem.id,
    name: listItem.name || 'Unknown World',
    description: listItem.description,
    tagline: listItem.tagline ?? null,
    motto: listItem.motto ?? null,
    overview: listItem.overview ?? null,
    contentRating: listItem.contentRating ?? null,
    iconUrl: listItem.iconUrl,
    bannerUrl: listItem.bannerUrl,
    type: normalizeDisplayType(listItem.type),
    status: normalizeDisplayStatus(listItem.status),
    level: listItem.level,
    levelUpdatedAt: listItem.levelUpdatedAt,
    agentCount: listItem.agentCount,
    createdAt: listItem.createdAt,
    creatorId: listItem.creatorId,
    freezeReason: normalizeDisplayFreezeReason(listItem.freezeReason),
    lorebookEntryLimit: listItem.lorebookEntryLimit,
    nativeAgentLimit: listItem.nativeAgentLimit,
    nativeCreationState: normalizeDisplayNativeCreationState(listItem.nativeCreationState),
    scoreA: listItem.scoreA,
    scoreC: listItem.scoreC,
    scoreE: listItem.scoreE,
    scoreEwma: listItem.scoreEwma || listItem.computed.score.scoreEwma,
    scoreQ: listItem.scoreQ,
    flowRatio: listItem.computed.time.flowRatio,
    isPaused: listItem.computed.time.isPaused,
    transitInLimit: listItem.transitInLimit,
    genre: listItem.genre,
    era: listItem.era,
    themes: listItem.themes,
    currentWorldTime: listItem.computed.time.currentWorldTime,
    currentTimeLabel: listItem.computed.time.currentLabel,
    eraLabel: listItem.computed.time.eraLabel,
    primaryLanguage: listItem.computed.languages.primary,
    commonLanguages: listItem.computed.languages.common,
    recommendedAgents: listItem.computed.entry.recommendedAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      handle: agent.handle ?? null,
      avatarUrl: agent.avatarUrl ?? null,
      importance: null,
      display: null,
    })),
  };
}

export function toWorldDisplayFallback(world: WorldListItem): WorldDetailData {
  return toWorldDisplayData(world);
}

export function worldListQueryKey() {
  return ['worlds-list'] as const;
}

export async function fetchWorldListItems(
  status?: WorldListItem['status'],
): Promise<WorldListItem[]> {
  const worlds = await realmWorldData.loadWorlds(status as Parameters<typeof realmWorldData.loadWorlds>[0]);
  return worlds.map((world) => toWorldListItem(world));
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
  const detail = await realmWorldData.loadWorldDetailWithAgents(
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT,
  );
  if (!detail) {
    throw new Error('WORLD_DETAIL_NOT_FOUND');
  }
  return detail;
}

function toWorldDisplayHistoryItem(rawValue: unknown, index: number): WorldHistoryItem {
  const raw = asRecord(rawValue);
  const id = readString(raw, 'id') || `world-history-${index + 1}`;
  const eventType = readString(raw, 'eventType', 'type');
  const happenedAt = readString(raw, 'happenedAt', 'timeRef', 'time', 'createdAt') || new Date(0).toISOString();
  const eventTypeLower = eventType.toLowerCase();
  const parsedHappenedAt = new Date(happenedAt);
  const eventHorizon = eventTypeLower.includes('future')
    ? 'FUTURE'
    : eventTypeLower.includes('ongoing')
      ? 'ONGOING'
      : !Number.isNaN(parsedHappenedAt.getTime()) && parsedHappenedAt.getTime() > Date.now()
        ? 'FUTURE'
        : 'PAST';
  const evidenceRefs: WorldHistoryEvidenceRef[] = readRecordArray(raw.evidenceRefs).map((evidence, evidenceIndex) => ({
    segmentId: readString(evidence, 'segmentId') || `${id}-evidence-${evidenceIndex + 1}`,
    offsetStart: readNumber(evidence.offsetStart) ?? 0,
    offsetEnd: readNumber(evidence.offsetEnd) ?? 0,
    excerpt: readString(evidence, 'excerpt'),
    confidence: readNumber(evidence.confidence) ?? 0,
    sourceType: readString(evidence, 'sourceType') || 'WORLD_CORE',
  }));
  return {
    id,
    timelineSeq: readNumber(raw.timelineSeq) ?? index + 1,
    title: readString(raw, 'title', 'name', 'summary') || 'World event',
    description: readString(raw, 'description', 'summary', 'cause', 'process', 'result'),
    time: readString(raw, 'timeRef', 'time') || happenedAt,
    tag: eventType ? formatMixedLabel(eventType) : ({ PAST: 'Past', ONGOING: 'Ongoing', FUTURE: 'Future' }[eventHorizon]),
    level: eventTypeLower.includes('secondary') ? 'SECONDARY' : 'PRIMARY',
    eventHorizon,
    summary: readString(raw, 'summary') || null,
    cause: readString(raw, 'cause') || null,
    process: readString(raw, 'process') || null,
    result: readString(raw, 'result') || null,
    locationRefs: readStringArray(raw.locationRefs),
    characterRefs: readStringArray(raw.characterRefs),
    evidenceRefs,
    confidence: evidenceRefs.length > 0
      ? evidenceRefs.reduce((sum, item) => sum + item.confidence, 0) / evidenceRefs.length
      : 0,
    needsEvidence: evidenceRefs.length === 0,
  };
}

function buildWorldHistorySummary(items: readonly WorldHistoryItem[]): WorldHistorySummary | null {
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

function toWorldDisplayHistoryBundle(raw: { readonly items?: readonly unknown[] }): WorldHistoryBundle {
  const items = (raw.items ?? [])
    .map((item, index) => toWorldDisplayHistoryItem(item, index))
    .sort((left, right) => left.timelineSeq - right.timelineSeq || left.id.localeCompare(right.id));
  return {
    items,
    summary: buildWorldHistorySummary(items),
  };
}

export async function fetchWorldHistory(worldId: string): Promise<WorldHistoryBundle> {
  const payload = await realmWorldData.loadWorldHistory(normalizeWorldId(worldId));
  return toWorldDisplayHistoryBundle(payload);
}

function toSemanticRules(raw: unknown): WorldSemanticRule[] {
  return readRecordArray(raw).map((record, index) => ({
    key: readString(record, 'key', 'id') || `rule-${index + 1}`,
    title: readString(record, 'title', 'name') || `Rule ${index + 1}`,
    value: readString(record, 'value', 'description', 'summary'),
  }));
}

function toSemanticLevels(raw: unknown): WorldSemanticLevel[] {
  return readRecordArray(raw).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Level ${index + 1}`,
    description: readString(record, 'description') || null,
    extra: readString(record, 'breakthroughCondition', 'extra') || null,
  }));
}

function toSemanticTaboos(raw: unknown): WorldSemanticTaboo[] {
  return readRecordArray(raw).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Taboo ${index + 1}`,
    description: readString(record, 'description') || null,
    severity: readString(record, 'severity') || null,
  }));
}

function toSemanticRealms(raw: unknown): WorldSemanticRealm[] {
  return readRecordArray(raw).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Realm ${index + 1}`,
    description: readString(record, 'description') || null,
    accessibility: readString(record, 'accessibility') || null,
  }));
}

function toSemanticLanguages(raw: unknown): WorldSemanticLanguage[] {
  return readRecordArray(raw).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Language ${index + 1}`,
    category: readString(record, 'category') || null,
    description: readString(record, 'description') || null,
    writingSample: readString(record, 'writingSample') || null,
    spokenSample: readString(record, 'spokenSample') || null,
    isCommon: readBoolean(record.isCommon) ?? null,
  }));
}

function toWorldviewEvents(raw: unknown): WorldSemanticTimelineItem[] {
  return readRecordArray(raw).map((item, index) => ({
    id: readString(item, 'id') || `worldview-event-${index + 1}`,
    title: readString(item, 'title', 'summary') || 'Worldview event',
    summary: readString(item, 'summary') || null,
    eventType: readString(item, 'eventType') || null,
    createdAt: readString(item, 'createdAt') || null,
  }));
}

function toWorldviewSnapshots(raw: unknown): WorldSemanticSnapshotItem[] {
  return readRecordArray(raw).map((item, index) => ({
    id: readString(item, 'id') || `worldview-snapshot-${index + 1}`,
    versionLabel: readString(item, 'versionLabel', 'version') || `v${index + 1}`,
    summary: readString(item, 'summary') || null,
    createdAt: readString(item, 'createdAt') || null,
  }));
}

function toWorldDisplaySemanticBundle(raw: unknown): WorldSemanticData {
  const bundle = asRecord(raw);
  const worldview = asRecord(bundle.worldview);
  const semanticRoot = asRecord(bundle.semantic ?? worldview ?? bundle);
  const operation = asRecord(semanticRoot.operation ?? bundle.operation);
  const geography = asRecord(semanticRoot.geography ?? bundle.geography);
  const metaphysics = asRecord(semanticRoot.metaphysics ?? bundle.metaphysics);
  const coreSystem = asRecord(semanticRoot.coreSystem ?? bundle.coreSystem);
  const languages = asRecord(semanticRoot.languages ?? worldview.languages ?? bundle.languages);
  const powerSystems: WorldSemanticPowerSystem[] = readRecordArray(coreSystem.powerSystems).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Power system ${index + 1}`,
    description: readString(record, 'description') || null,
    levels: toSemanticLevels(record.levels),
    rules: readStringArray(record.rules),
  }));
  const topologyRecord = asRecord(geography.topology);
  const causalityRecord = asRecord(metaphysics.causality);
  const data: WorldSemanticData = {
    operationTitle: readString(operation, 'title') || readString(semanticRoot, 'title') || null,
    operationDescription: readString(operation, 'description') || readString(semanticRoot, 'description') || null,
    operationRules: toSemanticRules(operation.rules),
    powerSystems,
    standaloneLevels: toSemanticLevels(coreSystem.levels),
    taboos: toSemanticTaboos(coreSystem.taboos),
    topology: Object.keys(topologyRecord).length > 0
      ? {
          type: readString(topologyRecord, 'type') || null,
          boundary: readString(topologyRecord, 'boundary') || null,
          dimensions: readString(topologyRecord, 'dimensions') || null,
          realms: toSemanticRealms(topologyRecord.realms),
        }
      : null,
    causality: Object.keys(causalityRecord).length > 0
      ? {
          type: readString(causalityRecord, 'type') || null,
          karmaEnabled: readBoolean(causalityRecord.karmaEnabled) ?? null,
          fateWeight: readNumber(causalityRecord.fateWeight) ?? null,
        }
      : null,
    languages: toSemanticLanguages(languages.languages ?? languages),
    worldviewEvents: toWorldviewEvents(bundle.worldviewEvents),
    worldviewSnapshots: toWorldviewSnapshots(bundle.worldviewSnapshots),
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

export async function fetchWorldSemanticBundle(worldId: string): Promise<WorldSemanticData> {
  const payload = await realmWorldData.loadWorldSemanticBundle(normalizeWorldId(worldId));
  return toWorldDisplaySemanticBundle(payload);
}

function toWorldDisplayAuditItem(rawValue: unknown, index: number): WorldAuditItem {
  const raw = asRecord(rawValue);
  return {
    id: readString(raw, 'id') || `audit-${index + 1}`,
    label: readString(raw, 'label', 'eventType') || 'World audit',
    eventType: readString(raw, 'eventType') || null,
    occurredAt: readString(raw, 'occurredAt', 'createdAt') || new Date(0).toISOString(),
    prevLevel: readNumber(raw.prevLevel) ?? null,
    nextLevel: readNumber(raw.nextLevel) ?? null,
    ewmaScore: readNumber(raw.ewmaScore) ?? null,
    freezeReason: readString(raw, 'freezeReason') || null,
  };
}

export async function fetchWorldLevelAudits(worldId: string): Promise<WorldAuditItem[]> {
  const payload = await realmWorldData.loadWorldLevelAudits(normalizeWorldId(worldId), 20);
  return payload.map(toWorldDisplayAuditItem);
}

function toWorldDisplayLorebookItem(rawValue: unknown, index: number): WorldLorebookItem {
  const raw = asRecord(rawValue);
  const id = readString(raw, 'id') || `lorebook-${index + 1}`;
  return {
    id,
    key: readString(raw, 'key') || id,
    name: readString(raw, 'name') || null,
    content: readString(raw, 'content', 'summary'),
    keywords: readStringArray(raw.keywords),
    priority: readNumber(raw.priority) ?? null,
  };
}

function toWorldDisplaySceneItem(rawValue: unknown, index: number): WorldSceneItem {
  const raw = asRecord(rawValue);
  return {
    id: readString(raw, 'id') || `scene-${index + 1}`,
    name: readString(raw, 'name', 'title') || 'Unnamed scene',
    description: readString(raw, 'description'),
    activeEntities: readStringArray(raw.activeEntities),
  };
}

function failWorldPublicAsset(reasonCode: string, message: string): never {
  const error = new Error(message) as Error & { reasonCode?: string };
  error.reasonCode = reasonCode;
  throw error;
}

function requireWorldAssetString(
  record: JsonRecord,
  field: string,
  reasonCode: string,
  message: string,
): string {
  const value = readString(record, field);
  if (!value) {
    failWorldPublicAsset(reasonCode, message);
  }
  return value;
}

function toWorldDisplayBindingItem(rawValue: unknown, index: number): WorldBindingItem {
  const raw = asRecord(rawValue);
  const resource = asRecord(raw.resource);
  const id = readString(raw, 'id') || `binding-${index + 1}`;
  return {
    id,
    objectType: readString(raw, 'objectType') || 'UNKNOWN',
    objectId: readString(raw, 'objectId') || '',
    hostType: readString(raw, 'hostType') || 'WORLD',
    hostId: readString(raw, 'hostId') || '',
    bindingKind: readString(raw, 'bindingKind') || 'RESOURCE',
    bindingPoint: readString(raw, 'bindingPoint') || null,
    priority: readNumber(raw.priority) ?? 0,
    tags: readStringArray(raw.tags),
    resource: {
      id: readString(resource, 'id') || `${id}-resource`,
      url: requireWorldAssetString(
        resource,
        'url',
        'SDK_REALM_WORLD_DISPLAY_BINDING_RESOURCE_URL_INVALID',
        `World display binding ${id} is missing resource.url`,
      ),
      resourceType: readString(resource, 'resourceType') || 'UNKNOWN',
      label: readString(resource, 'label') || null,
    },
  };
}

export async function fetchWorldPublicAssets(worldId: string): Promise<WorldPublicAssetsData> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [lorebooksPayload, bindingsPayload, scenesPayload] = await Promise.all([
    realmWorldData.loadWorldLorebooks(normalizedWorldId),
    realmWorldData.loadWorldBindings(normalizedWorldId),
    realmWorldData.loadWorldScenes(normalizedWorldId),
  ]);
  return {
    lorebooks: lorebooksPayload.items.map(toWorldDisplayLorebookItem),
    scenes: scenesPayload.items.map(toWorldDisplaySceneItem),
    bindings: bindingsPayload.items.map(toWorldDisplayBindingItem),
  };
}

function toWorldDisplayAgent(agentValue: unknown, worldCreatedAt: string): WorldAgent {
  const agent = asRecord(agentValue);
  const display = asRecord(agent.display);
  const stats = asRecord(agent.stats);
  const importance = readStringValue(agent.importance);
  return {
    id: readString(agent, 'id'),
    name: readString(agent, 'name', 'displayName') || 'Unknown',
    handle: readString(agent, 'handle'),
    bio: readString(agent, 'bio', 'description'),
    role: readString(display, 'role') || null,
    faction: readString(display, 'faction') || null,
    rank: readString(display, 'rank') || null,
    sceneName: readString(display, 'sceneName') || null,
    location: readString(display, 'location') || null,
    createdAt: readString(agent, 'createdAt') || worldCreatedAt,
    avatarUrl: readString(agent, 'avatarUrl') || null,
    importance: importance === 'SECONDARY' || importance === 'BACKGROUND' ? importance : 'PRIMARY',
    stats: Object.keys(stats).length > 0 ? stats as WorldAgentStats : null,
  };
}

export async function fetchWorldDisplayDetail(worldId: string): Promise<WorldDisplayDetail> {
  const primary = await fetchWorldDetailWithAgents(worldId);
  const world = toWorldDisplayData(primary);
  const agentRecords = Array.isArray(primary.agents) ? primary.agents : [];
  const agents = agentRecords.map((agent) => toWorldDisplayAgent(agent, world.createdAt));
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
