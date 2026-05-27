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
  LocalRuntimeTransferAccepted,
  LocalRuntimeEnvironmentActivationGate,
  LocalRuntimeEnvironmentDependencyJob,
  LocalRuntimeEnvironmentPlan,
  LocalRuntimeEnvironmentPlanDependency,
  LocalRuntimeEnvironmentSelectedSourceRecord,
  LocalRuntimeTransferSessionKind,
  LocalRuntimeScaffoldAssetResult,
  LocalRuntimeAssetHealth,
  LocalRuntimeUnregisteredAssetDescriptor,
} from './types';
import {
  LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS,
  parseLocalRecommendationFeedCapabilityId,
} from '@nimiplatform/sdk/runtime';
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
const RECOMMENDATION_FEED_CAPABILITIES = new Set<LocalRuntimeRecommendationFeedCapability>(
  LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS,
);
const RECOMMENDATION_FEED_CACHE_STATES = new Set<LocalRuntimeRecommendationFeedCacheState>(['fresh', 'stale', 'empty']);
const RECOMMENDATION_FEED_SOURCES = new Set<LocalRuntimeRecommendationFeedSource>(['model-index']);

function parseEnumValue<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  const normalized = normalizeRecommendationEnumValue(value, allowed) as T;
  return allowed.has(normalized) ? normalized : undefined;
}

function normalizeRecommendationEnumValue<T extends string>(value: unknown, allowed: Set<T>): string {
  const raw = asString(value);
  const lower = raw.toLowerCase();
  if (allowed === RECOMMENDATION_SOURCES) {
    if (raw === '1' || lower === 'local_recommendation_source_llmfit') return 'llmfit';
    if (raw === '2' || lower === 'local_recommendation_source_media_fit') return 'media-fit';
  }
  if (allowed === RECOMMENDATION_FORMATS) {
    if (raw === '1' || lower === 'local_recommendation_format_gguf') return 'gguf';
    if (raw === '2' || lower === 'local_recommendation_format_safetensors') return 'safetensors';
  }
  if (allowed === RECOMMENDATION_TIERS) {
    if (raw === '1' || lower === 'local_recommendation_tier_recommended') return 'recommended';
    if (raw === '2' || lower === 'local_recommendation_tier_runnable') return 'runnable';
    if (raw === '3' || lower === 'local_recommendation_tier_tight') return 'tight';
    if (raw === '4' || lower === 'local_recommendation_tier_not_recommended') return 'not_recommended';
  }
  if (allowed === RECOMMENDATION_HOST_SUPPORT) {
    if (raw === '1' || lower === 'local_host_support_class_supported_supervised') return 'supported_supervised';
    if (raw === '2' || lower === 'local_host_support_class_attached_only') return 'attached_only';
    if (raw === '3' || lower === 'local_host_support_class_unsupported') return 'unsupported';
  }
  if (allowed === RECOMMENDATION_CONFIDENCE) {
    if (raw === '1' || lower === 'local_recommendation_confidence_high') return 'high';
    if (raw === '2' || lower === 'local_recommendation_confidence_medium') return 'medium';
    if (raw === '3' || lower === 'local_recommendation_confidence_low') return 'low';
  }
  if (allowed === RECOMMENDATION_BASELINES) {
    if (raw === '1' || lower === 'local_recommendation_baseline_image_default_v1') return 'image-default-v1';
    if (raw === '2' || lower === 'local_recommendation_baseline_video_default_v1') return 'video-default-v1';
  }
  if (allowed === RECOMMENDATION_FEED_CAPABILITIES) {
    return parseLocalRecommendationFeedCapabilityId(value) || raw;
  }
  if (allowed === RECOMMENDATION_FEED_CACHE_STATES) {
    if (raw === '1' || lower === 'local_recommendation_feed_cache_state_fresh') return 'fresh';
    if (raw === '2' || lower === 'local_recommendation_feed_cache_state_stale') return 'stale';
    if (raw === '3' || lower === 'local_recommendation_feed_cache_state_empty') return 'empty';
  }
  if (allowed === RECOMMENDATION_FEED_SOURCES) {
    if (raw === '1' || lower === 'local_recommendation_feed_source_model_index') return 'model-index';
  }
  return raw;
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
    reasonCode: asString(record.reasonCode) || undefined,
  };
}

export function parseLocalRuntimeEnvironmentPlanDependency(value: unknown): LocalRuntimeEnvironmentPlanDependency {
  const record = asRecord(value);
  return {
    dependencyFamily: asString(record.dependencyFamily),
    dependencyId: asString(record.dependencyId),
    required: Boolean(record.required),
    state: asString(record.state),
    sourceKind: asString(record.sourceKind),
    confirmationRequired: Boolean(record.confirmationRequired),
    selectedSourceRecordId: asString(record.selectedSourceRecordId) || undefined,
    environmentKey: asString(record.environmentKey),
    canonicalRoot: asString(record.canonicalRoot) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    detail: asString(record.detail) || undefined,
  };
}

export function parseLocalRuntimeEnvironmentPlan(value: unknown): LocalRuntimeEnvironmentPlan {
  const record = asRecord(value);
  const dependencies = Array.isArray(record.dependencies)
    ? record.dependencies.map((item) => parseLocalRuntimeEnvironmentPlanDependency(item))
    : [];
  return {
    planId: asString(record.planId),
    packId: asString(record.packId),
    productLabel: asString(record.productLabel),
    hostProfileId: asString(record.hostProfileId),
    platformTuple: asString(record.platformTuple),
    runtimeDataRoot: asString(record.runtimeDataRoot) || undefined,
    consumerScope: asString(record.consumerScope) || undefined,
    cloudOnlyImpact: asString(record.cloudOnlyImpact) || undefined,
    state: asString(record.state),
    reasonCode: asString(record.reasonCode) || undefined,
    dependencies,
  };
}

export function parseLocalRuntimeEnvironmentSelectedSourceRecord(value: unknown): LocalRuntimeEnvironmentSelectedSourceRecord {
  const record = asRecord(value);
  const hashes = asRecord(record.hashes);
  return {
    recordId: asString(record.recordId),
    dependencyFamily: asString(record.dependencyFamily),
    dependencyId: asString(record.dependencyId),
    environmentKey: asString(record.environmentKey),
    sourceKind: asString(record.sourceKind),
    canonicalRoot: asString(record.canonicalRoot) || undefined,
    version: asString(record.version) || undefined,
    compatibilityEvidence: Array.isArray(record.compatibilityEvidence)
      ? record.compatibilityEvidence.map((item) => asString(item)).filter(Boolean)
      : [],
    verifiedArtifacts: Array.isArray(record.verifiedArtifacts)
      ? record.verifiedArtifacts.map((item) => asString(item)).filter(Boolean)
      : [],
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    selectedConsumers: Array.isArray(record.selectedConsumers)
      ? record.selectedConsumers.map((item) => asString(item)).filter(Boolean)
      : [],
    activationEnvDelta: Array.isArray(record.activationEnvDelta)
      ? record.activationEnvDelta.map((item) => asString(item)).filter(Boolean)
      : [],
    selectedAt: asString(record.selectedAt) || undefined,
    lastVerifiedAt: asString(record.lastVerifiedAt) || undefined,
    repairState: asString(record.repairState) || undefined,
    auditReasonCode: asString(record.auditReasonCode) || undefined,
  };
}

export function parseLocalRuntimeEnvironmentDependencyJob(value: unknown): LocalRuntimeEnvironmentDependencyJob {
  const record = asRecord(value);
  // K-RPC-025 progress fields. The proto int64s arrive as strings over the
  // bridge; clamp every field to a non-negative finite number and fall back to
  // 0 (absent) on any non-numeric value — never a fabricated estimate.
  return {
    jobId: asString(record.jobId),
    environmentKey: asString(record.environmentKey),
    dependencyFamily: asString(record.dependencyFamily),
    dependencyId: asString(record.dependencyId),
    state: asString(record.state),
    sourceKind: asString(record.sourceKind),
    canonicalRoot: asString(record.canonicalRoot) || undefined,
    selectedSourceRecordId: asString(record.selectedSourceRecordId) || undefined,
    failureDetail: asString(record.failureDetail) || undefined,
    retryable: Boolean(record.retryable),
    createdAt: asString(record.createdAt) || undefined,
    updatedAt: asString(record.updatedAt) || undefined,
    bytesReceived: nonNegativeNumber(record.bytesReceived),
    bytesTotal: nonNegativeNumber(record.bytesTotal),
    percent: clampPercent(record.percent),
    speedBytesPerSec: nonNegativeNumber(record.speedBytesPerSec),
    etaSeconds: nonNegativeNumber(record.etaSeconds),
  };
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function clampPercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed >= 100 ? 100 : Math.round(parsed);
}

export function parseLocalRuntimeEnvironmentActivationGate(value: unknown): LocalRuntimeEnvironmentActivationGate {
  const record = asRecord(value);
  return {
    consumerId: asString(record.consumerId),
    packId: asString(record.packId),
    state: asString(record.state),
    reasonCode: asString(record.reasonCode) || undefined,
    detail: asString(record.detail) || undefined,
    blockingDependencies: Array.isArray(record.blockingDependencies)
      ? record.blockingDependencies.map((item) => parseLocalRuntimeEnvironmentPlanDependency(item))
      : [],
    dependencies: Array.isArray(record.dependencies)
      ? record.dependencies.map((item) => parseLocalRuntimeEnvironmentPlanDependency(item))
      : [],
  };
}

export function parseGgufVariantDescriptor(value: unknown): GgufVariantDescriptor {
  const record = asRecord(value);
  const sizeBytes = Number(record.sizeBytes);
  return {
    filename: asString(record.filename),
    entry: asString(record.entry) || asString(record.filename),
    files: Array.isArray(record.files) ? record.files.map((item) => asString(item)).filter(Boolean) : [],
    format: asString(record.format) || undefined,
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : undefined,
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
    localAssetId: asString(record.localAssetId || record.localModelId) || undefined,
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
  const installModelId = asString(installPayload.modelId || installPayload.assetId);
  const installRepo = asString(installPayload.repo);
  if (!source || !itemId || !repo || !title || !preferredEngine || !installModelId || !installRepo) {
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
      modelId: installModelId,
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
    sizeBytes: Number(record.sizeBytes) || 0,
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

export function parseTransferAccepted(value: unknown): LocalRuntimeTransferAccepted {
  const record = asRecord(value);
  return {
    installSessionId: requiredString('installSessionId', record.installSessionId),
    modelId: toCanonicalLocalId(requiredString('modelId', record.modelId || record.assetId)),
    localModelId: requiredString('localModelId', record.localModelId || record.localAssetId),
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
