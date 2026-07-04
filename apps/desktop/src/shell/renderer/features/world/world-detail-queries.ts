import {
  projectWorldPublicSourceCard,
  requireWorldPublicSourceCardDto,
} from './data/world-public-projection';
import { realmWorldData } from './data/realm-world-data';
import type {
  WorldCharacter,
  WorldCharacterMediaAssets,
  WorldCharacterStats,
  WorldAssetExternalRef,
  WorldAssetIntent,
  WorldPublicMediaAsset,
  WorldAssetResourceRef,
  WorldAuditItem,
  WorldDetailData,
  WorldHistoryBundle,
  WorldHistoryEvidenceRef,
  WorldHistoryItem,
  WorldHistorySummary,
  WorldPublicAssetsData,
  WorldSceneItem,
  WorldSceneCounts,
  WorldSceneEntity,
  WorldSceneResource,
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
type WorldDetailWithCharactersResponse = Awaited<ReturnType<typeof realmWorldData.loadWorldDetailWithCharacters>>;
type WorldPrimaryDetailRecord = NonNullable<WorldDetailWithCharactersResponse>;

export type WorldDisplayDetail = {
  primary: WorldPrimaryDetailRecord;
  world: WorldDetailData;
  characters: WorldCharacter[];
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

export type WorldPrimaryDisplayDetail = Pick<WorldDisplayDetail, 'primary' | 'world' | 'characters'>;
export type WorldSupplementalDisplayDetail = Pick<WorldDisplayDetail, 'history' | 'semantic' | 'audits' | 'publicAssets' | 'sections'>;

const DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT = 4;

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
  resourceRefs: [],
  externalRefs: [],
  intents: [],
  scenes: [],
};

export function worldPublicHighlightRefs(publicAssets: WorldPublicAssetsData): WorldAssetExternalRef[] {
  return publicAssets.externalRefs
    .filter((ref) => ref.kind === 'highlight' || ref.kind.startsWith('highlight-'))
    .map((ref) => ({ ...ref, uri: readStringValue(ref.uri) }))
    .filter((ref) => Boolean(ref.uri));
}

export function worldPublicHighlightImages(publicAssets: WorldPublicAssetsData): string[] {
  return worldPublicHighlightRefs(publicAssets).map((ref) => ref.uri);
}

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

function readPublicUrlValue(value: unknown): string {
  const normalized = readStringValue(value);
  return /^https?:\/\//i.test(normalized) ? normalized : '';
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

function readPublicMediaAsset(value: unknown): WorldPublicMediaAsset | null {
  const record = asRecord(value);
  const id = readString(record, 'id');
  const kind = readString(record, 'kind');
  const url = readPublicUrlValue(record.url);
  if (!id || !kind || !url) {
    return null;
  }
  return {
    id,
    kind,
    url,
    provider: readString(record, 'provider') || null,
    mimeType: readString(record, 'mimeType') || null,
    width: readNumber(record.width) ?? null,
    height: readNumber(record.height) ?? null,
    durationSec: readNumber(record.durationSec) ?? null,
    sha256: readString(record, 'sha256') || null,
    provenance: Object.keys(asRecord(record.provenance)).length > 0
      ? asRecord(record.provenance)
      : null,
  };
}

function readCharacterMediaAssets(record: JsonRecord): WorldCharacterMediaAssets | null {
  const mediaAssets = asRecord(record.mediaAssets);
  const avatar = readPublicMediaAsset(mediaAssets.avatar);
  const portrait = readPublicMediaAsset(mediaAssets.portrait);
  const profileCover = readPublicMediaAsset(mediaAssets.profileCover);
  const referenceImage = readPublicMediaAsset(mediaAssets.referenceImage);
  const voiceSample = readPublicMediaAsset(mediaAssets.voiceSample);
  if (!avatar && !portrait && !profileCover && !referenceImage && !voiceSample) {
    return null;
  }
  return {
    avatar,
    portrait,
    profileCover,
    referenceImage,
    voiceSample,
  };
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
  return normalized === 'PUBLIC'
    || normalized === 'SYSTEM'
    || normalized === 'DISCOVERABLE'
    ? normalized
    : 'DISCOVERABLE';
}

function normalizeDisplayFreezeReason(value: unknown): WorldDetailData['freezeReason'] {
  const normalized = readStringValue(value);
  return normalized === 'QUOTA_OVERFLOW' || normalized === 'WORLD_INACTIVE' || normalized === 'GOVERNANCE_LOCK'
    ? normalized
    : null;
}

function worldListItemToDisplayData(listItem: WorldListItem): WorldDetailData {
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
    characterCount: listItem.characterCount,
    createdAt: listItem.createdAt,
    creatorId: listItem.creatorId,
    freezeReason: normalizeDisplayFreezeReason(listItem.freezeReason),
    scoreA: listItem.scoreA,
    scoreC: listItem.scoreC,
    scoreE: listItem.scoreE,
    scoreEwma: listItem.scoreEwma || listItem.computed.score.scoreEwma,
    scoreQ: listItem.scoreQ,
    flowRatio: listItem.computed.time.flowRatio,
    isPaused: listItem.computed.time.isPaused,
    genre: listItem.genre,
    era: listItem.era,
    themes: listItem.themes,
    currentWorldTime: listItem.computed.time.currentWorldTime,
    currentTimeLabel: listItem.computed.time.currentLabel,
    eraLabel: listItem.computed.time.eraLabel,
    entityCount: listItem.entityCount,
    relationshipCount: listItem.relationshipCount,
    personaCount: listItem.personaCount,
    sceneCount: listItem.sceneCount,
    systemCount: listItem.systemCount,
    timelineEventCount: listItem.timelineEventCount,
    primaryLanguage: listItem.computed.languages.primary,
    commonLanguages: listItem.computed.languages.common,
    recommendedCharacters: listItem.computed.entry.recommendedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      handle: character.handle ?? null,
      avatarUrl: character.avatarUrl ?? null,
      importance: null,
      display: null,
    })),
  };
}

function toWorldDisplayData(detailValue: unknown): WorldDetailData {
  const listItem = toWorldListItem(asRecord(detailValue));
  return worldListItemToDisplayData(listItem);
}

export function toWorldDisplayFallback(world: WorldListItem): WorldDetailData {
  return worldListItemToDisplayData(world);
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
    DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT,
  ] as const;
}

export function worldPrimaryDisplayDetailQueryKey(worldId: string) {
  return [
    'world-primary-display-detail',
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT,
  ] as const;
}

export function worldSupplementalDisplayDetailQueryKey(worldId: string) {
  return ['world-supplemental-display-detail', normalizeWorldId(worldId)] as const;
}

export function worldHistoryQueryKey(worldId: string) {
  return ['world-history', normalizeWorldId(worldId)] as const;
}

export function worldSemanticBundleQueryKey(worldId: string) {
  return ['world-semantic-bundle', normalizeWorldId(worldId)] as const;
}

export function worldPublicAssetsQueryKey(worldId: string) {
  return ['world-public-assets', normalizeWorldId(worldId)] as const;
}

export async function fetchWorldDetailWithCharacters(worldId: string): Promise<WorldPrimaryDetailRecord> {
  const detail = await realmWorldData.loadWorldDetailWithCharacters(
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT,
  );
  if (!detail) {
    throw new Error('WORLD_DETAIL_NOT_FOUND');
  }
  return detail;
}

function toWorldDisplayHistoryItem(rawValue: unknown, index: number): WorldHistoryItem {
  const raw = asRecord(rawValue);
  const id = readString(raw, 'id', 'eventId') || `world-history-${index + 1}`;
  const eventType = readString(raw, 'eventType', 'type');
  const happenedAt = readString(raw, 'happenedAt', 'timestamp', 'timeRef', 'time', 'createdAt') || new Date(0).toISOString();
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
    timelineSeq: readNumber(raw.timelineSeq) ?? readNumber(raw.sequence) ?? index + 1,
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
    locationRefs: readStringArray(raw.locationRefs).length ? readStringArray(raw.locationRefs) : readStringArray(raw.sceneRefs),
    characterRefs: readStringArray(raw.characterRefs).length ? readStringArray(raw.characterRefs) : readStringArray(raw.entityRefs),
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

function toWorldDisplayResourceRef(rawValue: unknown, index: number): WorldAssetResourceRef {
  const raw = asRecord(rawValue);
  const refId = readString(raw, 'refId') || `resource-ref-${index + 1}`;
  return {
    refId,
    kind: readString(raw, 'kind') || 'resource',
    purpose: readString(raw, 'purpose') || null,
    label: readString(raw, 'label') || null,
  };
}

function toWorldDisplayExternalRef(rawValue: unknown, index: number): WorldAssetExternalRef | null {
  const raw = asRecord(rawValue);
  const uri = readString(raw, 'uri');
  if (!uri) {
    return null;
  }
  return {
    ...toWorldDisplayResourceRef(raw, index),
    uri,
  };
}

function toWorldDisplayAssetIntent(rawValue: unknown, index: number): WorldAssetIntent {
  const raw = asRecord(rawValue);
  const intentId = readString(raw, 'intentId') || `asset-intent-${index + 1}`;
  return {
    intentId,
    kind: readString(raw, 'kind') || 'asset',
    summary: readString(raw, 'summary') || null,
  };
}

function toWorldDisplaySceneEntity(rawValue: unknown, index: number): WorldSceneEntity {
  const raw = asRecord(rawValue);
  const id = readString(raw, 'id', 'entityId') || readString(raw, 'label', 'name') || `scene-entity-${index + 1}`;
  return {
    id,
    kind: readString(raw, 'kind') || 'entity',
    label: readString(raw, 'label', 'name') || null,
    summary: readString(raw, 'summary') || null,
  };
}

function toWorldDisplaySceneCharacter(rawValue: unknown): WorldCharacter {
  const raw = asRecord(rawValue);
  const sourceRef = asRecord(raw.sourceRef);
  const worldId = readString(raw, 'worldId') || readString(sourceRef, 'worldId');
  const projected = projectWorldPublicSourceCard(requireWorldPublicSourceCardDto(raw, worldId));
  return toWorldDisplayCharacter(projected, readString(raw, 'updatedAt', 'createdAt') || new Date(0).toISOString());
}

function toWorldDisplaySceneResource(rawValue: unknown, index: number): WorldSceneResource {
  const raw = asRecord(rawValue);
  const id = readString(raw, 'id') || `scene-resource-${index + 1}`;
  return {
    id,
    kind: readString(raw, 'kind') || 'resource',
    title: readString(raw, 'title', 'label') || id,
    summary: readString(raw, 'summary') || null,
    entityRefs: readStringArray(raw.entityRefs),
    eventRefs: readStringArray(raw.eventRefs),
  };
}

function toWorldDisplaySceneCounts(
  rawValue: unknown,
  lengths: {
    readonly activeEntities: number;
    readonly relatedCharacters: number;
    readonly relatedEvents: number;
    readonly relatedResources: number;
  },
): WorldSceneCounts {
  const raw = asRecord(rawValue);
  return {
    activeEntityCount: readNumber(raw.activeEntityCount) ?? lengths.activeEntities,
    relatedCharacterCount: readNumber(raw.relatedCharacterCount) ?? lengths.relatedCharacters,
    relatedEventCount: readNumber(raw.relatedEventCount) ?? lengths.relatedEvents,
    relatedResourceCount: readNumber(raw.relatedResourceCount) ?? lengths.relatedResources,
  };
}

function toWorldDisplaySceneItem(rawValue: unknown, index: number): WorldSceneItem {
  const raw = asRecord(rawValue);
  const activeEntities = readRecordArray(raw.activeEntities)
    .map(toWorldDisplaySceneEntity);
  const relatedCharacters = readRecordArray(raw.relatedCharacters)
    .map(toWorldDisplaySceneCharacter);
  const relatedEvents = readRecordArray(raw.relatedEvents)
    .map((event, eventIndex) => toWorldDisplayHistoryItem(event, eventIndex));
  const relatedResources = readRecordArray(raw.relatedResources)
    .map(toWorldDisplaySceneResource);
  const media = readRecordArray(raw.media)
    .map(readPublicMediaAsset)
    .filter((asset): asset is WorldPublicMediaAsset => asset !== null);
  return {
    id: readString(raw, 'sceneId', 'id') || `scene-${index + 1}`,
    name: readString(raw, 'name', 'title') || 'Unnamed scene',
    description: readString(raw, 'summary', 'description'),
    activeEntities,
    relatedCharacters,
    relatedEvents,
    relatedResources,
    counts: toWorldDisplaySceneCounts(raw.counts, {
      activeEntities: activeEntities.length,
      relatedCharacters: relatedCharacters.length,
      relatedEvents: relatedEvents.length,
      relatedResources: relatedResources.length,
    }),
    media,
  };
}

export async function fetchWorldPublicAssets(worldId: string): Promise<WorldPublicAssetsData> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [assetsPayload, scenesPayload] = await Promise.all([
    realmWorldData.loadWorldAssets(normalizedWorldId),
    realmWorldData.loadWorldScenes(normalizedWorldId),
  ]);
  return {
    resourceRefs: assetsPayload.resourceRefs.map(toWorldDisplayResourceRef),
    externalRefs: assetsPayload.externalRefs
      .map(toWorldDisplayExternalRef)
      .filter((item): item is WorldAssetExternalRef => item !== null),
    intents: assetsPayload.intents.map(toWorldDisplayAssetIntent),
    scenes: scenesPayload.items.map(toWorldDisplaySceneItem),
  };
}

function toWorldDisplayCharacter(characterValue: unknown, worldCreatedAt: string): WorldCharacter {
  const character = asRecord(characterValue);
  const display = asRecord(character.display);
  const stats = asRecord(character.stats);
  const importance = readStringValue(character.importance);
  const sourceRef = asRecord(character.sourceRef);
  const sourceKind = readString(sourceRef, 'kind');
  const sourceWorldId = readString(sourceRef, 'worldId');
  const sourceId = readString(sourceRef, 'sourceId');
  const sourceContentHash = readString(sourceRef, 'sourceContentHash');
  if (
    (sourceKind !== 'worldCharacter' && sourceKind !== 'realmPersona')
    || !sourceWorldId
    || !sourceId
    || !sourceContentHash
  ) {
    throw new Error('World source display requires a hash-bearing sourceRef');
  }
  const relation = asRecord(character.relation);
  const relationState = readString(relation, 'state');
  const ownership = readString(character, 'ownership');
  const mediaAssets = readCharacterMediaAssets(character);
  return {
    id: readString(character, 'id'),
    name: readString(character, 'name', 'displayName') || 'Unknown',
    handle: readString(character, 'handle'),
    bio: readString(character, 'bio', 'description'),
    sourceRef: {
      kind: sourceKind,
      worldId: sourceWorldId,
      sourceId,
      sourceContentHash,
    },
    sourceKind,
    ownership: ownership === 'userOwned' ? 'userOwned' : 'worldOwned',
    relation: {
      state: relationState === 'unavailable'
          ? 'unavailable'
          : 'connectable',
      connectionId: null,
      runtimeSourceRef: null,
    },
    role: readString(display, 'role') || null,
    faction: readString(display, 'faction') || null,
    rank: readString(display, 'rank') || null,
    sceneName: readString(display, 'sceneName') || null,
    location: readString(display, 'location') || null,
    tags: readStringArray(display.tags),
    createdAt: readString(character, 'createdAt') || worldCreatedAt,
    avatarUrl: readPublicUrlValue(character.avatarUrl)
      || mediaAssets?.avatar?.url
      || mediaAssets?.portrait?.url
      || mediaAssets?.referenceImage?.url
      || null,
    portraitUrl: readPublicUrlValue(character.portraitUrl) || mediaAssets?.portrait?.url || null,
    profileCoverUrl: readPublicUrlValue(character.profileCoverUrl) || mediaAssets?.profileCover?.url || null,
    referenceImageUrl: readPublicUrlValue(character.referenceImageUrl) || mediaAssets?.referenceImage?.url || null,
    voiceSampleUrl: readPublicUrlValue(character.voiceSampleUrl) || mediaAssets?.voiceSample?.url || null,
    mediaAssets,
    importance: importance === 'SECONDARY' || importance === 'BACKGROUND' ? importance : 'PRIMARY',
    stats: Object.keys(stats).length > 0 ? stats as WorldCharacterStats : null,
  };
}

function projectWorldPrimaryDisplayDetail(primary: WorldPrimaryDetailRecord): WorldPrimaryDisplayDetail {
  const world = toWorldDisplayData(primary);
  const characterRecords = Array.isArray(primary.characters) ? primary.characters : [];
  return {
    primary,
    world,
    characters: characterRecords.map((character) => toWorldDisplayCharacter(character, world.createdAt)),
  };
}

export function toWorldPrimaryDisplayDetail(display: WorldDisplayDetail): WorldPrimaryDisplayDetail {
  return {
    primary: display.primary,
    world: display.world,
    characters: display.characters,
  };
}

export function toWorldSupplementalDisplayDetail(display: WorldDisplayDetail): WorldSupplementalDisplayDetail {
  return {
    history: display.history,
    semantic: display.semantic,
    audits: display.audits,
    publicAssets: display.publicAssets,
    sections: display.sections,
  };
}

export function mergeWorldDisplayDetail(
  primary: WorldPrimaryDisplayDetail,
  supplemental: WorldSupplementalDisplayDetail,
): WorldDisplayDetail {
  return {
    ...primary,
    history: supplemental.history,
    semantic: supplemental.semantic,
    audits: supplemental.audits,
    publicAssets: supplemental.publicAssets,
    sections: supplemental.sections,
  };
}

export async function fetchWorldPrimaryDisplayDetail(worldId: string): Promise<WorldPrimaryDisplayDetail> {
  const primary = await fetchWorldDetailWithCharacters(worldId);
  return projectWorldPrimaryDisplayDetail(primary);
}

export async function fetchWorldSupplementalDisplayDetail(worldId: string): Promise<WorldSupplementalDisplayDetail> {
  const [historyResult, semanticResult, publicAssetsResult] = await Promise.allSettled([
    fetchWorldHistory(worldId),
    fetchWorldSemanticBundle(worldId),
    fetchWorldPublicAssets(worldId),
  ]);
  return {
    history: historyResult.status === 'fulfilled' ? historyResult.value : EMPTY_WORLD_HISTORY,
    semantic: semanticResult.status === 'fulfilled' ? semanticResult.value : EMPTY_WORLD_SEMANTIC,
    audits: [],
    publicAssets: publicAssetsResult.status === 'fulfilled' ? publicAssetsResult.value : EMPTY_WORLD_PUBLIC_ASSETS,
    sections: {
      history: historyResult.status === 'fulfilled' ? 'success' : 'error',
      semantic: semanticResult.status === 'fulfilled' ? 'success' : 'error',
      audits: 'success',
      publicAssets: publicAssetsResult.status === 'fulfilled' ? 'success' : 'error',
    },
  };
}

export async function fetchWorldDisplayDetail(worldId: string): Promise<WorldDisplayDetail> {
  const primary = await fetchWorldPrimaryDisplayDetail(worldId);
  const supplemental = await fetchWorldSupplementalDisplayDetail(worldId);
  return mergeWorldDisplayDetail(primary, supplemental);
}
