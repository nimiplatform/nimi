import type {
  GgufVariantDescriptor,
  LocalRuntimeAuditEvent,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeDownloadState,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeScaffoldArtifactResult,
  LocalRuntimeInstallAcceptedResponse,
  LocalRuntimeModelHealth,
  OrphanArtifactFile,
  OrphanModelFile,
} from './types';
import { asRecord, asString } from './parser-primitives';
import { toCanonicalLocalId } from './local-id';
import { normalizeArtifactKind, normalizeStatus } from './parsers';

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

function parseEnumValue<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  const normalized = asString(value) as T;
  return allowed.has(normalized) ? normalized : undefined;
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
  const suggestedArtifacts = Array.isArray(record.suggestedArtifacts)
    ? record.suggestedArtifacts.map((item) => {
      const row = asRecord(item);
      return {
        templateId: asString(row.templateId) || undefined,
        artifactId: asString(row.artifactId) || undefined,
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
    suggestedArtifacts,
    suggestedNotes,
    baseline: parseEnumValue(record.baseline, RECOMMENDATION_BASELINES),
  };
}

export function parseModelHealth(value: unknown): LocalRuntimeModelHealth {
  const record = asRecord(value);
  return {
    localModelId: asString(record.localModelId),
    status: normalizeStatus(record.status),
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

export function parseOrphanModelFile(value: unknown): OrphanModelFile {
  const record = asRecord(value);
  return {
    filename: asString(record.filename),
    path: asString(record.path),
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
    recommendation: parseCatalogRecommendation(record.recommendation),
  };
}

export function parseOrphanArtifactFile(value: unknown): OrphanArtifactFile {
  const record = asRecord(value);
  return {
    filename: asString(record.filename),
    path: asString(record.path),
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
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
    modelId: toCanonicalLocalId(record.modelId) || undefined,
    localModelId: asString(record.localModelId) || undefined,
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
    modelId: toCanonicalLocalId(record.modelId),
    localModelId: asString(record.localModelId) || undefined,
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
    modelId: toCanonicalLocalId(record.modelId),
    localModelId: asString(record.localModelId),
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

export function parseInstallAcceptedResponse(value: unknown): LocalRuntimeInstallAcceptedResponse {
  const record = asRecord(value);
  return {
    installSessionId: asString(record.installSessionId),
    modelId: toCanonicalLocalId(record.modelId),
    localModelId: asString(record.localModelId),
  };
}

export function parseScaffoldArtifactResult(value: unknown): LocalRuntimeScaffoldArtifactResult {
  const record = asRecord(value);
  return {
    manifestPath: asString(record.manifestPath),
    artifactId: toCanonicalLocalId(record.artifactId),
    kind: normalizeArtifactKind(record.kind),
  };
}
