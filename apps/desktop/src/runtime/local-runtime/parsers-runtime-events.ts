import type {
  GgufVariantDescriptor,
  LocalRuntimeAssetDeclaration,
  LocalRuntimeAuditEvent,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeRecommendationActionState,
  LocalRuntimeRecommendationFeedCapability,
  LocalRuntimeRecommendationFeedCacheState,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedEntryDescriptor,
  LocalRuntimeRecommendationFeedItemDescriptor,
  LocalRuntimeRecommendationFeedSource,
  LocalRuntimeRecommendationInstalledState,
  LocalRuntimeDownloadState,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeTransferSessionKind,
  LocalRuntimeScaffoldAssetResult,
  LocalRuntimeAssetHealth,
  LocalRuntimeUnregisteredAssetDescriptor,
} from './types';
import { asRecord, asString } from './parser-primitives';
import { toCanonicalLocalId } from './local-id';
import { normalizeAssetKind, normalizeAssetStatus } from './parsers';

const RECOMMENDATION_SOURCES = new Set<LocalRuntimeCatalogRecommendation['source']>(['llmfit', 'media-fit']);
const RECOMMENDATION_FORMATS = new Set<NonNullable<LocalRuntimeCatalogRecommendation['format']>>(['gguf', 'safetensors']);
const RECOMMENDATION_TIERS = new Set<NonNullable<LocalRuntimeCatalogRecommendation['tier']>>([
  'recommended',
  'runnable',
  'tight',
  'not_recommended',
]);
const RECOMMENDATION_HOST_SUPPORT = new Set<NonNullable<LocalRuntimeCatalogRecommendation['hostSupportClass']>>([
  'supported_supervised',
  'attached_only',
  'unsupported',
]);
const RECOMMENDATION_CONFIDENCE = new Set<NonNullable<LocalRuntimeCatalogRecommendation['confidence']>>([
  'high',
  'medium',
  'low',
]);
const RECOMMENDATION_BASELINES = new Set<NonNullable<LocalRuntimeCatalogRecommendation['baseline']>>([
  'image-default-v1',
  'video-default-v1',
]);
const RECOMMENDATION_FEED_CAPABILITIES = new Set<LocalRuntimeRecommendationFeedCapability>(['chat', 'image', 'video']);
const RECOMMENDATION_FEED_CACHE_STATES = new Set<LocalRuntimeRecommendationFeedCacheState>(['fresh', 'stale', 'empty']);
const RECOMMENDATION_FEED_SOURCES = new Set<LocalRuntimeRecommendationFeedSource>(['model-index']);

function parseEnumValue<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  const normalized = asString(value) as T;
  return allowed.has(normalized) ? normalized : undefined;
}

function requiredEnumValue<T extends string>(
  field: string,
  value: unknown,
  allowed: Set<T>,
): T {
  const normalized = parseEnumValue(value, allowed);
  if (!normalized) {
    throw new Error(`Invalid local runtime field: ${field}`);
  }
  return normalized;
}

function requiredString(field: string, value: unknown): string {
  const normalized = asString(value);
  if (!normalized) {
    throw new Error(`Missing local runtime field: ${field}`);
  }
  return normalized;
}

export function parseCatalogRecommendation(value: unknown): LocalRuntimeCatalogRecommendation | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const source = parseEnumValue(record.source, RECOMMENDATION_SOURCES);
  if (!source) {
    return undefined;
  }
  const reasonCodes = Array.isArray(record.reasonCodes)
    ? record.reasonCodes.map((item) => asString(item)).filter(Boolean)
    : [];
  const fallbackEntries = Array.isArray(record.fallbackEntries)
    ? record.fallbackEntries.map((item) => asString(item)).filter(Boolean)
    : [];
  const rawSuggestedAssets = record.suggestedAssets;
  const suggestedAssets = Array.isArray(rawSuggestedAssets)
    ? rawSuggestedAssets.map((item: unknown) => {
      const row = asRecord(item);
      return {
        templateId: asString(row.templateId) || undefined,
        assetId: asString(row.assetId || row.assetId) || undefined,
        kind: asString(row.kind),
        family: asString(row.family) || undefined,
      };
    }).filter((item) => item.kind)
    : [];
  const suggestedNotes = Array.isArray(record.suggestedNotes)
    ? record.suggestedNotes.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    source,
    format: parseEnumValue(record.format, RECOMMENDATION_FORMATS),
    tier: parseEnumValue(record.tier, RECOMMENDATION_TIERS),
    hostSupportClass: parseEnumValue(record.hostSupportClass, RECOMMENDATION_HOST_SUPPORT),
    confidence: parseEnumValue(record.confidence, RECOMMENDATION_CONFIDENCE),
    reasonCodes,
    recommendedEntry: asString(record.recommendedEntry) || undefined,
    fallbackEntries,
    suggestedAssets,
    suggestedNotes,
    baseline: parseEnumValue(record.baseline, RECOMMENDATION_BASELINES),
  };
}

export function parseAssetHealth(value: unknown): LocalRuntimeAssetHealth {
  const record = asRecord(value);
  return {
    localAssetId: asString(record.localAssetId),
    status: normalizeAssetStatus(record.status),
    detail: asString(record.detail),
    endpoint: asString(record.endpoint),
  };
}

export function parseGgufVariantDescriptor(value: unknown): GgufVariantDescriptor {
  const record = asRecord(value);
  return {
    filename: asString(record.filename),
    entry: asString(record.entry) || asString(record.filename),
    files: Array.isArray(record.files) ? record.files.map((item) => asString(item)).filter(Boolean) : [],
    format: asString(record.format) || undefined,
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : undefined,
    sha256: asString(record.sha256) || undefined,
    recommendation: parseCatalogRecommendation(record.recommendation),
  };
}

export function parseRecommendationFeedEntryDescriptor(value: unknown): LocalRuntimeRecommendationFeedEntryDescriptor {
  const record = asRecord(value);
  const totalSizeBytes = Number(record.totalSizeBytes);
  return {
    entryId: requiredString('recommendationFeed.entries[].entryId', record.entryId),
    format: requiredEnumValue(
      'recommendationFeed.entries[].format',
      record.format,
      RECOMMENDATION_FORMATS,
    ),
    entry: requiredString('recommendationFeed.entries[].entry', record.entry),
    files: Array.isArray(record.files) ? record.files.map((item) => asString(item)).filter(Boolean) : [],
    totalSizeBytes: Number.isFinite(totalSizeBytes) && totalSizeBytes > 0 ? totalSizeBytes : 0,
    sha256: asString(record.sha256) || undefined,
  };
}

export function parseRecommendationInstalledState(value: unknown): LocalRuntimeRecommendationInstalledState {
  const record = asRecord(value);
  return {
    installed: Boolean(record.installed),
    localAssetId: asString(record.localAssetId) || undefined,
    status: record.status ? normalizeAssetStatus(record.status) : undefined,
  };
}

export function parseRecommendationActionState(value: unknown): LocalRuntimeRecommendationActionState {
  const record = asRecord(value);
  return {
    canReviewInstallPlan: Boolean(record.canReviewInstallPlan),
    canOpenVariants: Boolean(record.canOpenVariants),
    canOpenLocalAsset: Boolean(record.canOpenLocalAsset || record.canOpenLocalModel),
  };
}

export function parseRecommendationFeedItemDescriptor(value: unknown): LocalRuntimeRecommendationFeedItemDescriptor | undefined {
  const record = asRecord(value);
  const installPayload = asRecord(record.installPayload);
  const source = parseEnumValue(record.source, RECOMMENDATION_FEED_SOURCES);
  const itemId = asString(record.itemId);
  const repo = asString(record.repo);
  const title = asString(record.title);
  const preferredEngine = asString(record.preferredEngine);
  const installAssetId = asString(installPayload.assetId || installPayload.assetId);
  const installRepo = asString(installPayload.repo);
  if (!source || !itemId || !repo || !title || !preferredEngine || !installAssetId || !installRepo) {
    return undefined;
  }
  const downloads = Number(record.downloads);
  const likes = Number(record.likes);
  const entries = Array.isArray(record.entries)
    ? record.entries.map((item) => {
      try {
        return parseRecommendationFeedEntryDescriptor(item);
      } catch {
        return undefined;
      }
    }).filter((item): item is LocalRuntimeRecommendationFeedEntryDescriptor => Boolean(item))
    : [];
  const formats = Array.isArray(record.formats)
    ? record.formats
      .map((item) => parseEnumValue(item, RECOMMENDATION_FORMATS))
      .filter((item): item is NonNullable<LocalRuntimeRecommendationFeedItemDescriptor['formats'][number]> => Boolean(item))
    : [];
  return {
    itemId,
    source,
    repo,
    revision: asString(record.revision),
    title,
    description: asString(record.description) || undefined,
    capabilities: Array.isArray(record.capabilities) ? record.capabilities.map((item) => asString(item)).filter(Boolean) : [],
    tags: Array.isArray(record.tags) ? record.tags.map((item) => asString(item)).filter(Boolean) : [],
    formats,
    downloads: Number.isFinite(downloads) && downloads >= 0 ? downloads : undefined,
    likes: Number.isFinite(likes) && likes >= 0 ? likes : undefined,
    lastModified: asString(record.lastModified) || undefined,
    preferredEngine,
    verified: Boolean(record.verified),
    entries,
    recommendation: parseCatalogRecommendation(record.recommendation),
    installedState: parseRecommendationInstalledState(record.installedState),
    actionState: parseRecommendationActionState(record.actionState),
    installPayload: {
      modelId: installAssetId,
      kind: normalizeAssetKind(installPayload.kind),
      repo: installRepo,
      revision: asString(installPayload.revision) || undefined,
      capabilities: Array.isArray(installPayload.capabilities)
        ? (installPayload.capabilities as unknown[]).map((item) => asString(item)).filter(Boolean)
        : undefined,
      engine: asString(installPayload.engine) || undefined,
      entry: asString(installPayload.entry) || undefined,
      files: Array.isArray(installPayload.files)
        ? (installPayload.files as unknown[]).map((item) => asString(item)).filter(Boolean)
        : undefined,
      license: asString(installPayload.license) || undefined,
      hashes: Object.fromEntries(
        Object.entries(asRecord(installPayload.hashes)).map(([key, item]) => [key, asString(item)]),
      ),
      endpoint: asString(installPayload.endpoint) || undefined,
      engineConfig: undefined,
    },
  };
}

export function parseRecommendationFeedDescriptor(
  value: unknown,
  parseDeviceProfile: (value: unknown) => LocalRuntimeRecommendationFeedDescriptor['deviceProfile'],
): LocalRuntimeRecommendationFeedDescriptor {
  const record = asRecord(value);
  const activeCapability = requiredEnumValue(
    'recommendationFeed.activeCapability',
    record.activeCapability,
    RECOMMENDATION_FEED_CAPABILITIES,
  );
  const cacheState = requiredEnumValue(
    'recommendationFeed.cacheState',
    record.cacheState,
    RECOMMENDATION_FEED_CACHE_STATES,
  );
  return {
    deviceProfile: parseDeviceProfile(record.deviceProfile),
    activeCapability,
    generatedAt: asString(record.generatedAt) || undefined,
    cacheState,
    items: Array.isArray(record.items)
      ? record.items
        .map((item) => parseRecommendationFeedItemDescriptor(item))
        .filter((item): item is LocalRuntimeRecommendationFeedItemDescriptor => Boolean(item))
      : [],
  };
}

export function parseUnregisteredAssetDescriptor(value: unknown): LocalRuntimeUnregisteredAssetDescriptor {
  const record = asRecord(value);
  const declaration = asRecord(record.declaration);
  const assetKindRaw = asString(declaration.assetKind);
  let parsedDeclaration: LocalRuntimeAssetDeclaration | undefined;
  if (assetKindRaw) {
    parsedDeclaration = {
      assetKind: normalizeAssetKind(assetKindRaw),
      engine: asString(declaration.engine) || undefined,
    };
  }
  return {
    filename: asString(record.filename),
    path: asString(record.path),
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
    declaration: parsedDeclaration,
    suggestionSource: (asString(record.suggestionSource) || 'unknown') as LocalRuntimeUnregisteredAssetDescriptor['suggestionSource'],
    confidence: (asString(record.confidence) || 'low') as LocalRuntimeUnregisteredAssetDescriptor['confidence'],
    autoImportable: Boolean(record.autoImportable),
    requiresManualReview: Boolean(record.requiresManualReview),
    folderName: asString(record.folderName) || undefined,
  };
}

export function parseAuditEvent(value: unknown): LocalRuntimeAuditEvent {
  const record = asRecord(value);
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : undefined;
  const source = asString(record.source || payload?.source) || undefined;
  const modality = asString(record.modality || payload?.modality) || undefined;
  const reasonCode = asString(record.reasonCode || payload?.reasonCode) || undefined;
  const detail = asString(record.detail || payload?.detail || payload?.error) || undefined;
  return {
    id: asString(record.id),
    eventType: asString(record.eventType),
    occurredAt: asString(record.occurredAt),
    source,
    modality,
    reasonCode,
    detail,
    modelId: toCanonicalLocalId(record.modelId || record.assetId) || undefined,
    localModelId: asString(record.localModelId || record.localAssetId) || undefined,
    payload,
  };
}

export function normalizeDownloadState(
  value: unknown,
  fallbackDone?: boolean,
  fallbackSuccess?: boolean,
): LocalRuntimeDownloadState {
  const raw = asString(value).toLowerCase();
  if (
    raw === 'queued'
    || raw === 'running'
    || raw === 'paused'
    || raw === 'failed'
    || raw === 'completed'
    || raw === 'cancelled'
  ) {
    return raw;
  }
  if (fallbackDone) {
    return fallbackSuccess ? 'completed' : 'failed';
  }
  return 'running';
}

function normalizeTransferSessionKind(value: unknown): LocalRuntimeTransferSessionKind {
  return asString(value).toLowerCase() === 'import' ? 'import' : 'download';
}

export function parseDownloadProgressEvent(value: unknown): LocalRuntimeDownloadProgressEvent {
  const record = asRecord(value);
  const bytesReceived = Number(record.bytesReceived);
  const bytesTotalRaw = Number(record.bytesTotal);
  const speedRaw = Number(record.speedBytesPerSec);
  const etaRaw = Number(record.etaSeconds);
  const done = Boolean(record.done);
  const success = Boolean(record.success);
  const retryable = typeof record.retryable === 'boolean' ? Boolean(record.retryable) : undefined;
  return {
    installSessionId: asString(record.installSessionId),
    modelId: toCanonicalLocalId(record.modelId || record.assetId),
    localModelId: asString(record.localModelId || record.localAssetId) || undefined,
    sessionKind: normalizeTransferSessionKind(record.sessionKind),
    phase: asString(record.phase) || 'download',
    bytesReceived: Number.isFinite(bytesReceived) && bytesReceived >= 0 ? bytesReceived : 0,
    bytesTotal: Number.isFinite(bytesTotalRaw) && bytesTotalRaw >= 0 ? bytesTotalRaw : undefined,
    speedBytesPerSec: Number.isFinite(speedRaw) && speedRaw >= 0 ? speedRaw : undefined,
    etaSeconds: Number.isFinite(etaRaw) && etaRaw >= 0 ? etaRaw : undefined,
    message: asString(record.message) || undefined,
    state: normalizeDownloadState(record.state, done, success),
    reasonCode: asString(record.reasonCode) || undefined,
    retryable,
    done,
    success,
  };
}

export function parseDownloadSessionSummary(value: unknown): LocalRuntimeDownloadSessionSummary {
  const record = asRecord(value);
  const bytesReceived = Number(record.bytesReceived);
  const bytesTotalRaw = Number(record.bytesTotal);
  const speedRaw = Number(record.speedBytesPerSec);
  const etaRaw = Number(record.etaSeconds);
  return {
    installSessionId: asString(record.installSessionId),
    modelId: toCanonicalLocalId(record.modelId || record.assetId),
    localModelId: asString(record.localModelId || record.localAssetId),
    sessionKind: normalizeTransferSessionKind(record.sessionKind),
    phase: asString(record.phase) || 'download',
    state: normalizeDownloadState(record.state),
    bytesReceived: Number.isFinite(bytesReceived) && bytesReceived >= 0 ? bytesReceived : 0,
    bytesTotal: Number.isFinite(bytesTotalRaw) && bytesTotalRaw >= 0 ? bytesTotalRaw : undefined,
    speedBytesPerSec: Number.isFinite(speedRaw) && speedRaw >= 0 ? speedRaw : undefined,
    etaSeconds: Number.isFinite(etaRaw) && etaRaw >= 0 ? etaRaw : undefined,
    message: asString(record.message) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    retryable: Boolean(record.retryable),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
}

export function parseScaffoldAssetResult(value: unknown): LocalRuntimeScaffoldAssetResult {
  const record = asRecord(value);
  return {
    manifestPath: asString(record.manifestPath),
    assetId: toCanonicalLocalId(record.assetId),
    kind: normalizeAssetKind(record.kind),
  };
}
