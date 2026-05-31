import {
  LocalHostSupportClass,
  LocalRecommendationBaseline,
  LocalRecommendationConfidence,
  LocalRecommendationFeedCacheState,
  LocalRecommendationFeedCapability,
  LocalRecommendationFeedSource,
  LocalRecommendationFormat,
  LocalRecommendationSource,
  LocalRecommendationTier,
} from './generated/runtime/v1/local_runtime_types.js';
import { asRecord, normalizeText } from '../internal/utils.js';
import {
  normalizeLocalRuntimeAssetKindId,
  normalizeLocalRuntimeAssetStatusId,
  type LocalRuntimeAssetKindId,
  type LocalRuntimeAssetStatusId,
} from './local-asset-kind.js';

export type LocalRecommendationSourceId = 'llmfit' | 'media-fit';
export type LocalRecommendationFormatId = 'gguf' | 'safetensors';
export type LocalRecommendationTierId = 'recommended' | 'runnable' | 'tight' | 'not_recommended';
export type LocalRecommendationHostSupportClassId = 'supported_supervised' | 'attached_only' | 'unsupported';
export type LocalRecommendationConfidenceId = 'high' | 'medium' | 'low';
export type LocalRecommendationBaselineId = 'image-default-v1' | 'video-default-v1';
export type LocalRecommendationFeedCacheStateId = 'fresh' | 'stale' | 'empty';
export type LocalRecommendationFeedSourceId = 'model-index';

export type LocalRecommendationFeedCapabilityId = 'chat' | 'image' | 'video';
export type LocalRecommendationRunGradeId = 'runs_great' | 'runs_well' | 'tight_fit' | 'not_recommended';

export type LocalRecommendationFeedEntryLike = {
  entry?: string;
  totalSizeBytes?: number;
};

export type LocalRecommendationFeedItemLike = {
  repo?: string;
  title?: string;
  description?: string;
  tags?: readonly unknown[];
  capabilities?: readonly unknown[];
  formats?: readonly unknown[];
  downloads?: number;
  likes?: number;
  lastModified?: string;
  recommendation?: {
    tier?: unknown;
    recommendedEntry?: string;
  } | null;
  installPayload?: {
    modelId?: string;
    license?: string;
  } | null;
  entries?: readonly LocalRecommendationFeedEntryLike[];
};

export type LocalRecommendationFeedLike = {
  cacheState?: unknown;
} | null | undefined;

export type LocalRecommendationSuggestedAssetProjection = {
  templateId?: string;
  assetId?: string;
  kind: string;
  family?: string;
};

export type LocalRecommendationCatalogProjection = {
  source: LocalRecommendationSourceId;
  format?: LocalRecommendationFormatId;
  tier?: LocalRecommendationTierId;
  hostSupportClass?: LocalRecommendationHostSupportClassId;
  confidence?: LocalRecommendationConfidenceId;
  reasonCodes: string[];
  recommendedEntry?: string;
  fallbackEntries: string[];
  suggestedAssets: LocalRecommendationSuggestedAssetProjection[];
  suggestedNotes: string[];
  baseline?: LocalRecommendationBaselineId;
};

export type LocalRecommendationFeedEntryProjection = {
  entryId: string;
  format: LocalRecommendationFormatId;
  entry: string;
  files: string[];
  totalSizeBytes: number;
  sha256?: string;
};

export type LocalRecommendationInstalledStateProjection = {
  installed: boolean;
  localAssetId?: string;
  status?: LocalRuntimeAssetStatusId;
};

export type LocalRecommendationActionStateProjection = {
  canReviewInstallPlan: boolean;
  canOpenVariants: boolean;
  canOpenLocalAsset: boolean;
};

export type LocalRecommendationInstallPayloadProjection = {
  modelId: string;
  kind: LocalRuntimeAssetKindId;
  repo: string;
  revision?: string;
  capabilities?: string[];
  engine?: string;
  entry?: string;
  files?: string[];
  license?: string;
  hashes?: Record<string, string>;
  endpoint?: string;
  engineConfig?: Record<string, unknown>;
};

export type LocalRecommendationFeedItemProjection = {
  itemId: string;
  source: LocalRecommendationFeedSourceId;
  repo: string;
  revision: string;
  title: string;
  description?: string;
  capabilities: string[];
  tags: string[];
  formats: LocalRecommendationFormatId[];
  downloads?: number;
  likes?: number;
  lastModified?: string;
  preferredEngine: string;
  verified: boolean;
  entries: LocalRecommendationFeedEntryProjection[];
  recommendation?: LocalRecommendationCatalogProjection;
  installedState: LocalRecommendationInstalledStateProjection;
  actionState: LocalRecommendationActionStateProjection;
  installPayload: LocalRecommendationInstallPayloadProjection;
};

export type LocalRecommendationFeedProjection<TDeviceProfile = unknown> = {
  deviceProfile: TDeviceProfile;
  activeCapability: LocalRecommendationFeedCapabilityId;
  generatedAt?: string;
  cacheState: LocalRecommendationFeedCacheStateId;
  items: LocalRecommendationFeedItemProjection[];
};

const LOCAL_RECOMMENDATION_SOURCE_PAIRS = [
  [LocalRecommendationSource.LLMFIT, 'llmfit'],
  [LocalRecommendationSource.MEDIA_FIT, 'media-fit'],
] as const satisfies readonly (readonly [
  LocalRecommendationSource,
  LocalRecommendationSourceId,
])[];

const LOCAL_RECOMMENDATION_FORMAT_PAIRS = [
  [LocalRecommendationFormat.GGUF, 'gguf'],
  [LocalRecommendationFormat.SAFETENSORS, 'safetensors'],
] as const satisfies readonly (readonly [
  LocalRecommendationFormat,
  LocalRecommendationFormatId,
])[];

const LOCAL_RECOMMENDATION_TIER_PAIRS = [
  [LocalRecommendationTier.RECOMMENDED, 'recommended'],
  [LocalRecommendationTier.RUNNABLE, 'runnable'],
  [LocalRecommendationTier.TIGHT, 'tight'],
  [LocalRecommendationTier.NOT_RECOMMENDED, 'not_recommended'],
] as const satisfies readonly (readonly [
  LocalRecommendationTier,
  LocalRecommendationTierId,
])[];

const LOCAL_RECOMMENDATION_HOST_SUPPORT_CLASS_PAIRS = [
  [LocalHostSupportClass.SUPPORTED_SUPERVISED, 'supported_supervised'],
  [LocalHostSupportClass.ATTACHED_ONLY, 'attached_only'],
  [LocalHostSupportClass.UNSUPPORTED, 'unsupported'],
] as const satisfies readonly (readonly [
  LocalHostSupportClass,
  LocalRecommendationHostSupportClassId,
])[];

const LOCAL_RECOMMENDATION_CONFIDENCE_PAIRS = [
  [LocalRecommendationConfidence.HIGH, 'high'],
  [LocalRecommendationConfidence.MEDIUM, 'medium'],
  [LocalRecommendationConfidence.LOW, 'low'],
] as const satisfies readonly (readonly [
  LocalRecommendationConfidence,
  LocalRecommendationConfidenceId,
])[];

const LOCAL_RECOMMENDATION_BASELINE_PAIRS = [
  [LocalRecommendationBaseline.IMAGE_DEFAULT_V1, 'image-default-v1'],
  [LocalRecommendationBaseline.VIDEO_DEFAULT_V1, 'video-default-v1'],
] as const satisfies readonly (readonly [
  LocalRecommendationBaseline,
  LocalRecommendationBaselineId,
])[];

const LOCAL_RECOMMENDATION_FEED_CACHE_STATE_PAIRS = [
  [LocalRecommendationFeedCacheState.FRESH, 'fresh'],
  [LocalRecommendationFeedCacheState.STALE, 'stale'],
  [LocalRecommendationFeedCacheState.EMPTY, 'empty'],
] as const satisfies readonly (readonly [
  LocalRecommendationFeedCacheState,
  LocalRecommendationFeedCacheStateId,
])[];

const LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS = [
  [LocalRecommendationFeedCapability.CHAT, 'chat'],
  [LocalRecommendationFeedCapability.IMAGE, 'image'],
  [LocalRecommendationFeedCapability.VIDEO, 'video'],
] as const satisfies readonly (readonly [
  LocalRecommendationFeedCapability,
  LocalRecommendationFeedCapabilityId,
])[];

const LOCAL_RECOMMENDATION_FEED_SOURCE_PAIRS = [
  [LocalRecommendationFeedSource.MODEL_INDEX, 'model-index'],
] as const satisfies readonly (readonly [
  LocalRecommendationFeedSource,
  LocalRecommendationFeedSourceId,
])[];

function enumNameForId(prefix: string, id: string): string {
  return `${prefix}${id.replace(/-/g, '_')}`;
}

function parseRuntimeEnumId<const T extends string>(
  value: unknown,
  pairs: readonly (readonly [number, T])[],
  prefix: string,
): T | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of pairs) {
    if (
      value === protoValue ||
      raw === String(protoValue) ||
      lower === id ||
      lower === enumNameForId(prefix, id)
    ) {
      return id;
    }
  }
  return undefined;
}

function idsFromPairs<const T extends string>(pairs: readonly (readonly [number, T])[]): readonly T[] {
  return Object.freeze(pairs.map(([, id]) => id)) as readonly T[];
}

export const LOCAL_RECOMMENDATION_SOURCE_IDS = idsFromPairs(LOCAL_RECOMMENDATION_SOURCE_PAIRS);
export const LOCAL_RECOMMENDATION_FORMAT_IDS = idsFromPairs(LOCAL_RECOMMENDATION_FORMAT_PAIRS);
export const LOCAL_RECOMMENDATION_TIER_IDS = idsFromPairs(LOCAL_RECOMMENDATION_TIER_PAIRS);
export const LOCAL_RECOMMENDATION_HOST_SUPPORT_CLASS_IDS = idsFromPairs(LOCAL_RECOMMENDATION_HOST_SUPPORT_CLASS_PAIRS);
export const LOCAL_RECOMMENDATION_CONFIDENCE_IDS = idsFromPairs(LOCAL_RECOMMENDATION_CONFIDENCE_PAIRS);
export const LOCAL_RECOMMENDATION_BASELINE_IDS = idsFromPairs(LOCAL_RECOMMENDATION_BASELINE_PAIRS);
export const LOCAL_RECOMMENDATION_FEED_CACHE_STATE_IDS = idsFromPairs(LOCAL_RECOMMENDATION_FEED_CACHE_STATE_PAIRS);

export const LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS = Object.freeze(
  LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS.map(([, id]) => id),
) as readonly LocalRecommendationFeedCapabilityId[];

export const LOCAL_RECOMMENDATION_FEED_SOURCE_IDS = idsFromPairs(LOCAL_RECOMMENDATION_FEED_SOURCE_PAIRS);

export const LOCAL_RECOMMENDATION_RUN_GRADE_IDS = Object.freeze([
  'runs_great',
  'runs_well',
  'tight_fit',
  'not_recommended',
] as const) as readonly LocalRecommendationRunGradeId[];

const LOCAL_RECOMMENDATION_TIER_TO_RUN_GRADE: Record<LocalRecommendationTierId, LocalRecommendationRunGradeId> = {
  recommended: 'runs_great',
  runnable: 'runs_well',
  tight: 'tight_fit',
  not_recommended: 'not_recommended',
};

export function parseLocalRecommendationSourceId(value: unknown): LocalRecommendationSourceId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_SOURCE_PAIRS, 'local_recommendation_source_');
}

export function parseLocalRecommendationFormatId(value: unknown): LocalRecommendationFormatId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_FORMAT_PAIRS, 'local_recommendation_format_');
}

export function parseLocalRecommendationTierId(value: unknown): LocalRecommendationTierId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_TIER_PAIRS, 'local_recommendation_tier_');
}

export function parseLocalRecommendationHostSupportClassId(
  value: unknown,
): LocalRecommendationHostSupportClassId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_HOST_SUPPORT_CLASS_PAIRS, 'local_host_support_class_');
}

export function parseLocalRecommendationConfidenceId(value: unknown): LocalRecommendationConfidenceId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_CONFIDENCE_PAIRS, 'local_recommendation_confidence_');
}

export function parseLocalRecommendationBaselineId(value: unknown): LocalRecommendationBaselineId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_BASELINE_PAIRS, 'local_recommendation_baseline_');
}

export function parseLocalRecommendationFeedCacheStateId(
  value: unknown,
): LocalRecommendationFeedCacheStateId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_FEED_CACHE_STATE_PAIRS, 'local_recommendation_feed_cache_state_');
}

export function parseLocalRecommendationFeedCapabilityId(
  value: unknown,
): LocalRecommendationFeedCapabilityId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS, 'local_recommendation_feed_capability_');
}

export function parseLocalRecommendationFeedSourceId(value: unknown): LocalRecommendationFeedSourceId | undefined {
  return parseRuntimeEnumId(value, LOCAL_RECOMMENDATION_FEED_SOURCE_PAIRS, 'local_recommendation_feed_source_');
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function requiredText(field: string, value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`Invalid local recommendation field: ${field}`);
  }
  return normalized;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function hashesFromRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, item]) => [key, normalizeText(item)]),
  );
}

export function parseRuntimeLocalCatalogRecommendation(
  value: unknown,
): LocalRecommendationCatalogProjection | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const source = parseLocalRecommendationSourceId(record.source);
  if (!source) {
    return undefined;
  }
  const suggestedAssets = Array.isArray(record.suggestedAssets)
    ? record.suggestedAssets.map((item) => {
      const row = asRecord(item);
      return {
        templateId: normalizeText(row.templateId) || undefined,
        assetId: normalizeText(row.assetId) || undefined,
        kind: normalizeText(row.kind),
        family: normalizeText(row.family) || undefined,
      };
    }).filter((item) => item.kind)
    : [];
  return {
    source,
    format: parseLocalRecommendationFormatId(record.format),
    tier: parseLocalRecommendationTierId(record.tier),
    hostSupportClass: parseLocalRecommendationHostSupportClassId(record.hostSupportClass),
    confidence: parseLocalRecommendationConfidenceId(record.confidence),
    reasonCodes: textList(record.reasonCodes),
    recommendedEntry: normalizeText(record.recommendedEntry) || undefined,
    fallbackEntries: textList(record.fallbackEntries),
    suggestedAssets,
    suggestedNotes: textList(record.suggestedNotes),
    baseline: parseLocalRecommendationBaselineId(record.baseline),
  };
}

function parseRuntimeLocalRecommendationFeedEntry(
  value: unknown,
): LocalRecommendationFeedEntryProjection {
  const record = asRecord(value);
  const format = parseLocalRecommendationFormatId(record.format);
  if (!format) {
    throw new Error('Invalid local recommendation field: recommendationFeed.entries[].format');
  }
  return {
    entryId: requiredText('recommendationFeed.entries[].entryId', record.entryId),
    format,
    entry: requiredText('recommendationFeed.entries[].entry', record.entry),
    files: textList(record.files),
    totalSizeBytes: positiveNumber(record.totalSizeBytes) ?? 0,
    sha256: normalizeText(record.sha256) || undefined,
  };
}

function parseRuntimeLocalRecommendationInstalledState(
  value: unknown,
): LocalRecommendationInstalledStateProjection {
  const record = asRecord(value);
  return {
    installed: Boolean(record.installed),
    localAssetId: normalizeText(record.localAssetId || record.localModelId) || undefined,
    status: record.status ? normalizeLocalRuntimeAssetStatusId(record.status) : undefined,
  };
}

function parseRuntimeLocalRecommendationActionState(value: unknown): LocalRecommendationActionStateProjection {
  const record = asRecord(value);
  return {
    canReviewInstallPlan: Boolean(record.canReviewInstallPlan),
    canOpenVariants: Boolean(record.canOpenVariants),
    canOpenLocalAsset: Boolean(record.canOpenLocalAsset || record.canOpenLocalModel),
  };
}

export function parseRuntimeLocalRecommendationFeedItem(
  value: unknown,
): LocalRecommendationFeedItemProjection | undefined {
  const record = asRecord(value);
  const installPayload = asRecord(record.installPayload);
  const source = parseLocalRecommendationFeedSourceId(record.source);
  const itemId = normalizeText(record.itemId);
  const repo = normalizeText(record.repo);
  const title = normalizeText(record.title);
  const preferredEngine = normalizeText(record.preferredEngine);
  const installModelId = normalizeText(installPayload.modelId || installPayload.assetId);
  const installRepo = normalizeText(installPayload.repo);
  if (!source || !itemId || !repo || !title || !preferredEngine || !installModelId || !installRepo) {
    return undefined;
  }
  const entries = Array.isArray(record.entries)
    ? record.entries.map((item) => {
      try {
        return parseRuntimeLocalRecommendationFeedEntry(item);
      } catch {
        return undefined;
      }
    }).filter((item): item is LocalRecommendationFeedEntryProjection => Boolean(item))
    : [];
  const formats = Array.isArray(record.formats)
    ? record.formats
      .map((item) => parseLocalRecommendationFormatId(item))
      .filter((item): item is LocalRecommendationFormatId => Boolean(item))
    : [];
  return {
    itemId,
    source,
    repo,
    revision: normalizeText(record.revision),
    title,
    description: normalizeText(record.description) || undefined,
    capabilities: textList(record.capabilities),
    tags: textList(record.tags),
    formats,
    downloads: positiveNumber(record.downloads),
    likes: positiveNumber(record.likes),
    lastModified: normalizeText(record.lastModified) || undefined,
    preferredEngine,
    verified: Boolean(record.verified),
    entries,
    recommendation: parseRuntimeLocalCatalogRecommendation(record.recommendation),
    installedState: parseRuntimeLocalRecommendationInstalledState(record.installedState),
    actionState: parseRuntimeLocalRecommendationActionState(record.actionState),
    installPayload: {
      modelId: installModelId,
      kind: normalizeLocalRuntimeAssetKindId(installPayload.kind),
      repo: installRepo,
      revision: normalizeText(installPayload.revision) || undefined,
      capabilities: Array.isArray(installPayload.capabilities) ? textList(installPayload.capabilities) : undefined,
      engine: normalizeText(installPayload.engine) || undefined,
      entry: normalizeText(installPayload.entry) || undefined,
      files: Array.isArray(installPayload.files) ? textList(installPayload.files) : undefined,
      license: normalizeText(installPayload.license) || undefined,
      hashes: hashesFromRecord(installPayload.hashes),
      endpoint: normalizeText(installPayload.endpoint) || undefined,
      engineConfig: undefined,
    },
  };
}

export function parseRuntimeLocalRecommendationFeedDescriptor<TDeviceProfile>(
  value: unknown,
  parseDeviceProfile: (value: unknown) => TDeviceProfile,
): LocalRecommendationFeedProjection<TDeviceProfile> {
  const record = asRecord(value);
  const activeCapability = parseLocalRecommendationFeedCapabilityId(record.activeCapability);
  if (!activeCapability) {
    throw new Error('Invalid local recommendation field: recommendationFeed.activeCapability');
  }
  const cacheState = parseLocalRecommendationFeedCacheStateId(record.cacheState);
  if (!cacheState) {
    throw new Error('Invalid local recommendation field: recommendationFeed.cacheState');
  }
  return {
    deviceProfile: parseDeviceProfile(record.deviceProfile),
    activeCapability,
    generatedAt: normalizeText(record.generatedAt) || undefined,
    cacheState,
    items: Array.isArray(record.items)
      ? record.items
        .map((item) => parseRuntimeLocalRecommendationFeedItem(item))
        .filter((item): item is LocalRecommendationFeedItemProjection => Boolean(item))
      : [],
  };
}

export function normalizeLocalRecommendationSourceId(
  value: unknown,
  fallback: LocalRecommendationSourceId = 'llmfit',
): LocalRecommendationSourceId {
  return parseLocalRecommendationSourceId(value) ?? fallback;
}

export function normalizeLocalRecommendationFormatId(
  value: unknown,
  fallback: LocalRecommendationFormatId = 'gguf',
): LocalRecommendationFormatId {
  return parseLocalRecommendationFormatId(value) ?? fallback;
}

export function normalizeLocalRecommendationTierId(
  value: unknown,
  fallback: LocalRecommendationTierId = 'recommended',
): LocalRecommendationTierId {
  return parseLocalRecommendationTierId(value) ?? fallback;
}

export function normalizeLocalRecommendationHostSupportClassId(
  value: unknown,
  fallback: LocalRecommendationHostSupportClassId = 'unsupported',
): LocalRecommendationHostSupportClassId {
  return parseLocalRecommendationHostSupportClassId(value) ?? fallback;
}

export function normalizeLocalRecommendationConfidenceId(
  value: unknown,
  fallback: LocalRecommendationConfidenceId = 'low',
): LocalRecommendationConfidenceId {
  return parseLocalRecommendationConfidenceId(value) ?? fallback;
}

export function normalizeLocalRecommendationBaselineId(
  value: unknown,
  fallback: LocalRecommendationBaselineId = 'image-default-v1',
): LocalRecommendationBaselineId {
  return parseLocalRecommendationBaselineId(value) ?? fallback;
}

export function normalizeLocalRecommendationFeedCacheStateId(
  value: unknown,
  fallback: LocalRecommendationFeedCacheStateId = 'empty',
): LocalRecommendationFeedCacheStateId {
  return parseLocalRecommendationFeedCacheStateId(value) ?? fallback;
}

export function normalizeLocalRecommendationFeedCapabilityId(
  value: unknown,
  fallback: LocalRecommendationFeedCapabilityId = 'chat',
): LocalRecommendationFeedCapabilityId {
  return parseLocalRecommendationFeedCapabilityId(value) ?? fallback;
}

export function toLocalRecommendationFeedCapabilityRequestValue(value: unknown): string {
  return normalizeLocalRecommendationFeedCapabilityId(value);
}

export function normalizeLocalRecommendationFeedSourceId(
  value: unknown,
  fallback: LocalRecommendationFeedSourceId = 'model-index',
): LocalRecommendationFeedSourceId {
  return parseLocalRecommendationFeedSourceId(value) ?? fallback;
}

export function localRecommendationTierToRunGrade(value: unknown): LocalRecommendationRunGradeId {
  const tier = parseLocalRecommendationTierId(value);
  return tier ? LOCAL_RECOMMENDATION_TIER_TO_RUN_GRADE[tier] : 'not_recommended';
}

export function summarizeLocalRecommendationFeedCacheState(
  feed: LocalRecommendationFeedLike,
): LocalRecommendationFeedCacheStateId {
  return normalizeLocalRecommendationFeedCacheStateId(feed?.cacheState);
}

export function formatLocalRecommendationRepoOwner(repo: unknown): string {
  const org = String(repo ?? '').split('/')[0]?.trim() || '';
  if (!org) {
    return 'Unknown';
  }
  return org
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

export function selectLocalRecommendationPrimaryEntrySize(
  item: LocalRecommendationFeedItemLike,
): number {
  const entries = item.entries;
  if (!entries || entries.length === 0) return 0;
  const recommended = String(item.recommendation?.recommendedEntry || '').trim();
  if (recommended) {
    const match = entries.find((entry) => entry.entry === recommended);
    if (match) return Number(match.totalSizeBytes || 0);
  }
  return Number(entries[0]?.totalSizeBytes || 0);
}

export function localRecommendationFeedMatchesQuery(
  item: LocalRecommendationFeedItemLike,
  query: unknown,
): boolean {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const fields = [
    item.title,
    item.repo,
    item.description,
    item.installPayload?.modelId,
    item.recommendation?.recommendedEntry,
    ...(item.tags || []),
    ...(item.capabilities || []),
    ...(item.formats || []),
  ];
  return fields.some((value) => String(value || '').toLowerCase().includes(normalized));
}
