import {
  LocalAssetKind,
  LocalAssetStatus,
  LocalHostSupportClass,
  LocalRecommendationBaseline,
  LocalRecommendationConfidence,
  LocalRecommendationFeedCacheState,
  LocalRecommendationFeedCapability,
  LocalRecommendationFeedSource,
  LocalRecommendationFormat,
  LocalRecommendationSource,
  LocalRecommendationTier,
} from '../core-generated/runtime-typed-client';
import type { JsonObject } from '../types';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';
import {
  normalizeNimiRuntimeLocalAssetKindId,
  parseNimiRuntimeLocalAssetKindId,
  parseNimiRuntimeLocalAssetStatusId,
  toNimiRuntimeLocalAssetKindRequestValue,
  type NimiRuntimeLocalAssetKindId,
  type NimiRuntimeLocalAssetStatusId,
} from './local-asset-vocabulary';

import type {
  NimiRuntimeLocalCatalogRecommendation,
  NimiRuntimeLocalRecommendationActionState,
  NimiRuntimeLocalRecommendationBaselineId,
  NimiRuntimeLocalRecommendationConfidenceId,
  NimiRuntimeLocalRecommendationFeed,
  NimiRuntimeLocalRecommendationFeedCacheStateId,
  NimiRuntimeLocalRecommendationFeedCapabilityId,
  NimiRuntimeLocalRecommendationFeedEntry,
  NimiRuntimeLocalRecommendationFeedItem,
  NimiRuntimeLocalRecommendationFeedSourceId,
  NimiRuntimeLocalRecommendationFormatId,
  NimiRuntimeLocalRecommendationHostSupportClassId,
  NimiRuntimeLocalRecommendationInstallPayload,
  NimiRuntimeLocalRecommendationInstalledState,
  NimiRuntimeLocalRecommendationSourceId,
  NimiRuntimeLocalRecommendationSuggestedAsset,
  NimiRuntimeLocalRecommendationTierId,
} from './runtime-local-recommendation-types';
export * from './runtime-local-recommendation-feed-ui';
export * from './runtime-local-recommendation-types';

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_SOURCE_PAIRS = [
  [LocalRecommendationSource.LLMFIT, 'llmfit'],
  [LocalRecommendationSource.MEDIA_FIT, 'media-fit'],
] as const satisfies readonly (readonly [
  LocalRecommendationSource,
  NimiRuntimeLocalRecommendationSourceId,
])[];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_FORMAT_PAIRS = [
  [LocalRecommendationFormat.GGUF, 'gguf'],
  [LocalRecommendationFormat.SAFETENSORS, 'safetensors'],
] as const satisfies readonly (readonly [
  LocalRecommendationFormat,
  NimiRuntimeLocalRecommendationFormatId,
])[];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_TIER_PAIRS = [
  [LocalRecommendationTier.RECOMMENDED, 'recommended'],
  [LocalRecommendationTier.RUNNABLE, 'runnable'],
  [LocalRecommendationTier.TIGHT, 'tight'],
  [LocalRecommendationTier.NOT_RECOMMENDED, 'not_recommended'],
] as const satisfies readonly (readonly [
  LocalRecommendationTier,
  NimiRuntimeLocalRecommendationTierId,
])[];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_HOST_SUPPORT_CLASS_PAIRS = [
  [LocalHostSupportClass.SUPPORTED_SUPERVISED, 'supported_supervised'],
  [LocalHostSupportClass.ATTACHED_ONLY, 'attached_only'],
  [LocalHostSupportClass.UNSUPPORTED, 'unsupported'],
] as const satisfies readonly (readonly [
  LocalHostSupportClass,
  NimiRuntimeLocalRecommendationHostSupportClassId,
])[];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_CONFIDENCE_PAIRS = [
  [LocalRecommendationConfidence.HIGH, 'high'],
  [LocalRecommendationConfidence.MEDIUM, 'medium'],
  [LocalRecommendationConfidence.LOW, 'low'],
] as const satisfies readonly (readonly [
  LocalRecommendationConfidence,
  NimiRuntimeLocalRecommendationConfidenceId,
])[];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_BASELINE_PAIRS = [
  [LocalRecommendationBaseline.IMAGE_DEFAULT_V1, 'image-default-v1'],
  [LocalRecommendationBaseline.VIDEO_DEFAULT_V1, 'video-default-v1'],
] as const satisfies readonly (readonly [
  LocalRecommendationBaseline,
  NimiRuntimeLocalRecommendationBaselineId,
])[];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_PAIRS = [
  [LocalRecommendationFeedCacheState.FRESH, 'fresh'],
  [LocalRecommendationFeedCacheState.STALE, 'stale'],
  [LocalRecommendationFeedCacheState.EMPTY, 'empty'],
] as const satisfies readonly (readonly [
  LocalRecommendationFeedCacheState,
  NimiRuntimeLocalRecommendationFeedCacheStateId,
])[];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS = [
  [LocalRecommendationFeedCapability.CHAT, 'chat'],
  [LocalRecommendationFeedCapability.IMAGE, 'image'],
  [LocalRecommendationFeedCapability.VIDEO, 'video'],
] as const satisfies readonly (readonly [
  LocalRecommendationFeedCapability,
  NimiRuntimeLocalRecommendationFeedCapabilityId,
])[];

const NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_SOURCE_PAIRS = [
  [LocalRecommendationFeedSource.MODEL_INDEX, 'model-index'],
] as const satisfies readonly (readonly [
  LocalRecommendationFeedSource,
  NimiRuntimeLocalRecommendationFeedSourceId,
])[];

export const NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS = Object.freeze(
  NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS.map(([, id]) => id),
) as readonly NimiRuntimeLocalRecommendationFeedCapabilityId[];

export function parseNimiRuntimeLocalRecommendationSourceId(
  value: unknown,
): NimiRuntimeLocalRecommendationSourceId | undefined {
  return parseRuntimeEnumId(value, NIMI_RUNTIME_LOCAL_RECOMMENDATION_SOURCE_PAIRS, 'local_recommendation_source_');
}

export function parseNimiRuntimeLocalRecommendationFormatId(
  value: unknown,
): NimiRuntimeLocalRecommendationFormatId | undefined {
  return parseRuntimeEnumId(value, NIMI_RUNTIME_LOCAL_RECOMMENDATION_FORMAT_PAIRS, 'local_recommendation_format_');
}

export function parseNimiRuntimeLocalRecommendationTierId(
  value: unknown,
): NimiRuntimeLocalRecommendationTierId | undefined {
  return parseRuntimeEnumId(value, NIMI_RUNTIME_LOCAL_RECOMMENDATION_TIER_PAIRS, 'local_recommendation_tier_');
}

export function parseNimiRuntimeLocalRecommendationHostSupportClassId(
  value: unknown,
): NimiRuntimeLocalRecommendationHostSupportClassId | undefined {
  return parseRuntimeEnumId(
    value,
    NIMI_RUNTIME_LOCAL_RECOMMENDATION_HOST_SUPPORT_CLASS_PAIRS,
    'local_host_support_class_',
  );
}

export function parseNimiRuntimeLocalRecommendationConfidenceId(
  value: unknown,
): NimiRuntimeLocalRecommendationConfidenceId | undefined {
  return parseRuntimeEnumId(
    value,
    NIMI_RUNTIME_LOCAL_RECOMMENDATION_CONFIDENCE_PAIRS,
    'local_recommendation_confidence_',
  );
}

export function parseNimiRuntimeLocalRecommendationBaselineId(
  value: unknown,
): NimiRuntimeLocalRecommendationBaselineId | undefined {
  return parseRuntimeEnumId(
    value,
    NIMI_RUNTIME_LOCAL_RECOMMENDATION_BASELINE_PAIRS,
    'local_recommendation_baseline_',
  );
}

export function parseNimiRuntimeLocalRecommendationFeedCacheStateId(
  value: unknown,
): NimiRuntimeLocalRecommendationFeedCacheStateId | undefined {
  return parseRuntimeEnumId(
    value,
    NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_PAIRS,
    'local_recommendation_feed_cache_state_',
  );
}

export function parseNimiRuntimeLocalRecommendationFeedCapabilityId(
  value: unknown,
): NimiRuntimeLocalRecommendationFeedCapabilityId | undefined {
  return parseRuntimeEnumId(
    value,
    NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS,
    'local_recommendation_feed_capability_',
  );
}

export function parseNimiRuntimeLocalRecommendationFeedSourceId(
  value: unknown,
): NimiRuntimeLocalRecommendationFeedSourceId | undefined {
  return parseRuntimeEnumId(
    value,
    NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_SOURCE_PAIRS,
    'local_recommendation_feed_source_',
  );
}

export function toNimiRuntimeLocalRecommendationFeedCapabilityRequestValue(value: unknown): string {
  return parseNimiRuntimeLocalRecommendationFeedCapabilityId(value) ?? normalizeText(value);
}

export function projectNimiRuntimeLocalCatalogRecommendation(
  value: unknown,
): NimiRuntimeLocalCatalogRecommendation | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const source = parseNimiRuntimeLocalRecommendationSourceId(record.source);
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
    format: parseNimiRuntimeLocalRecommendationFormatId(record.format),
    tier: parseNimiRuntimeLocalRecommendationTierId(record.tier),
    hostSupportClass: parseNimiRuntimeLocalRecommendationHostSupportClassId(record.hostSupportClass),
    confidence: parseNimiRuntimeLocalRecommendationConfidenceId(record.confidence),
    reasonCodes: textList(record.reasonCodes),
    recommendedEntry: normalizeText(record.recommendedEntry) || undefined,
    fallbackEntries: textList(record.fallbackEntries),
    suggestedAssets,
    suggestedNotes: textList(record.suggestedNotes),
    baseline: parseNimiRuntimeLocalRecommendationBaselineId(record.baseline),
  };
}

export function projectNimiRuntimeLocalRecommendationFeedItem(
  value: unknown,
): NimiRuntimeLocalRecommendationFeedItem | undefined {
  const record = asRecord(value);
  const installPayload = asRecord(record.installPayload);
  const source = parseNimiRuntimeLocalRecommendationFeedSourceId(record.source);
  const itemId = normalizeText(record.itemId);
  const repo = normalizeText(record.repo);
  const title = normalizeText(record.title);
  const preferredEngine = normalizeText(record.preferredEngine);
  const installModelId = normalizeText(installPayload.modelId || installPayload.assetId);
  const installRepo = normalizeText(installPayload.repo);
  if (!source || !itemId || !repo || !title || !preferredEngine || !installModelId || !installRepo) {
    return undefined;
  }
  return {
    itemId,
    source,
    repo,
    revision: normalizeText(record.revision),
    title,
    description: normalizeText(record.description) || undefined,
    capabilities: textList(record.capabilities),
    tags: textList(record.tags),
    formats: Array.isArray(record.formats)
      ? record.formats
        .map((item) => parseNimiRuntimeLocalRecommendationFormatId(item))
        .filter((item): item is NimiRuntimeLocalRecommendationFormatId => Boolean(item))
      : [],
    downloads: positiveNumber(record.downloads),
    likes: positiveNumber(record.likes),
    lastModified: normalizeText(record.lastModified) || undefined,
    preferredEngine,
    verified: Boolean(record.verified),
    entries: Array.isArray(record.entries)
      ? record.entries
        .map((item) => projectNimiRuntimeLocalRecommendationFeedEntry(item))
        .filter((item): item is NimiRuntimeLocalRecommendationFeedEntry => Boolean(item))
      : [],
    recommendation: projectNimiRuntimeLocalCatalogRecommendation(record.recommendation),
    installedState: projectNimiRuntimeLocalRecommendationInstalledState(record.installedState),
    actionState: projectNimiRuntimeLocalRecommendationActionState(record.actionState),
    installPayload: {
      modelId: installModelId,
      kind: normalizeNimiRuntimeLocalAssetKindId(installPayload.kind),
      repo: installRepo,
      revision: normalizeText(installPayload.revision) || undefined,
      capabilities: Array.isArray(installPayload.capabilities) ? textList(installPayload.capabilities) : undefined,
      engine: normalizeText(installPayload.engine) || undefined,
      entry: normalizeText(installPayload.entry) || undefined,
      files: Array.isArray(installPayload.files) ? textList(installPayload.files) : undefined,
      license: normalizeText(installPayload.license) || undefined,
      hashes: stringRecord(installPayload.hashes),
      endpoint: normalizeText(installPayload.endpoint) || undefined,
      engineConfig: nonEmptyRecord(recordToJsonObject(installPayload.engineConfig)),
    },
  };
}

export function projectNimiRuntimeLocalRecommendationFeed<TDeviceProfile>(
  value: unknown,
  parseDeviceProfile: (value: unknown) => TDeviceProfile,
): NimiRuntimeLocalRecommendationFeed<TDeviceProfile> {
  const record = asRecord(value);
  const activeCapability = parseNimiRuntimeLocalRecommendationFeedCapabilityId(record.activeCapability);
  if (!activeCapability) {
    throw new Error('Invalid local recommendation feed activeCapability');
  }
  const cacheState = parseNimiRuntimeLocalRecommendationFeedCacheStateId(record.cacheState);
  if (!cacheState) {
    throw new Error('Invalid local recommendation feed cacheState');
  }
  return {
    deviceProfile: parseDeviceProfile(record.deviceProfile),
    activeCapability,
    generatedAt: normalizeText(record.generatedAt) || undefined,
    cacheState,
    items: Array.isArray(record.items)
      ? record.items
        .map((item) => projectNimiRuntimeLocalRecommendationFeedItem(item))
        .filter((item): item is NimiRuntimeLocalRecommendationFeedItem => Boolean(item))
      : [],
  };
}

export function toNimiRuntimeLocalRecommendationInstallRequestValue(
  payload: NimiRuntimeLocalRecommendationInstallPayload,
) {
  return {
    modelId: normalizeText(payload.modelId),
    kind: toNimiRuntimeLocalAssetKindRequestValue(payload.kind),
    repo: normalizeText(payload.repo),
    revision: normalizeText(payload.revision),
    capabilities: [...(payload.capabilities ?? [])].map(normalizeText).filter(Boolean),
    engine: normalizeText(payload.engine),
    entry: normalizeText(payload.entry),
    files: [...(payload.files ?? [])].map(normalizeText).filter(Boolean),
    license: normalizeText(payload.license),
    hashes: stringRecord(payload.hashes),
    endpoint: normalizeText(payload.endpoint),
    engineConfig: payload.engineConfig,
  };
}

function projectNimiRuntimeLocalRecommendationFeedEntry(
  value: unknown,
): NimiRuntimeLocalRecommendationFeedEntry | undefined {
  const record = asRecord(value);
  const format = parseNimiRuntimeLocalRecommendationFormatId(record.format);
  const entryId = normalizeText(record.entryId);
  const entry = normalizeText(record.entry);
  if (!format || !entryId || !entry) {
    return undefined;
  }
  return {
    entryId,
    format,
    entry,
    files: textList(record.files),
    totalSizeBytes: positiveNumber(record.totalSizeBytes) ?? 0,
    sha256: normalizeText(record.sha256) || undefined,
  };
}

function projectNimiRuntimeLocalRecommendationInstalledState(
  value: unknown,
): NimiRuntimeLocalRecommendationInstalledState {
  const record = asRecord(value);
  return {
    installed: Boolean(record.installed),
    localAssetId: normalizeText(record.localAssetId || record.localModelId) || undefined,
    status: parseGeneratedOrStringStatus(record.status),
  };
}

function projectNimiRuntimeLocalRecommendationActionState(
  value: unknown,
): NimiRuntimeLocalRecommendationActionState {
  const record = asRecord(value);
  return {
    canReviewInstallPlan: Boolean(record.canReviewInstallPlan),
    canOpenVariants: Boolean(record.canOpenVariants),
    canOpenLocalAsset: Boolean(record.canOpenLocalAsset || record.canOpenLocalModel),
  };
}

function parseGeneratedOrStringStatus(value: unknown): NimiRuntimeLocalAssetStatusId | undefined {
  if (!value || value === LocalAssetStatus.UNSPECIFIED) {
    return undefined;
  }
  return parseNimiRuntimeLocalAssetStatusId(value);
}

function parseRuntimeEnumId<const T extends string>(
  value: unknown,
  pairs: readonly (readonly [number, T])[],
  prefix: string,
): T | undefined {
  const raw = normalizeText(value);
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of pairs) {
    if (
      value === protoValue
      || raw === String(protoValue)
      || lower === id
      || lower === id.replace(/-/g, '_')
      || lower === `${prefix}${id.replace(/-/g, '_')}`
    ) {
      return id;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, item]) => [key, normalizeText(item)]),
  );
}

function nonEmptyRecord(value: JsonObject): JsonObject | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

function recordToJsonObject(value: unknown): JsonObject {
  return fromNimiRuntimeProtoStruct(value as Parameters<typeof fromNimiRuntimeProtoStruct>[0]);
}

export function toNimiRuntimeLocalRecommendationAssetKindRequestValue(value: unknown): LocalAssetKind {
  return toNimiRuntimeLocalAssetKindRequestValue(parseNimiRuntimeLocalAssetKindId(value));
}
