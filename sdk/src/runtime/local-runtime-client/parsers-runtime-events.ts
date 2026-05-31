import type {
  GgufVariantDescriptor,
  LocalRuntimeAssetDeclaration,
  LocalRuntimeAuditEvent,
  LocalRuntimeDownloadState,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeTransferAccepted,
  LocalRuntimeTransferSessionKind,
  LocalRuntimeScaffoldAssetResult,
  LocalRuntimeAssetHealth,
  LocalRuntimeUnregisteredAssetDescriptor,
} from './types.js';
import {
  parseLocalRuntimeEnvironmentDependencyJobProjection,
  parseLocalRuntimeEnvironmentPlanDependencyProjection,
  parseLocalRuntimeEnvironmentPlanProjection,
} from '../local-environment-dependency-states.js';
import {
  parseRuntimeLocalCatalogRecommendation,
  parseRuntimeLocalRecommendationFeedDescriptor,
  parseRuntimeLocalRecommendationFeedItem,
} from '../local-recommendation-feed.js';
import {
  toCanonicalLocalRuntimeAssetId,
} from '../local-asset-id.js';
import { asRecord, asString } from './parser-primitives.js';
import { normalizeAssetKind, normalizeAssetStatus } from './parsers.js';

export {
  parseLocalRuntimeEnvironmentDependencyJobProjection as parseLocalRuntimeEnvironmentDependencyJob,
  parseLocalRuntimeEnvironmentPlanDependencyProjection as parseLocalRuntimeEnvironmentPlanDependency,
  parseLocalRuntimeEnvironmentPlanProjection as parseLocalRuntimeEnvironmentPlan,
};

export const parseCatalogRecommendation = parseRuntimeLocalCatalogRecommendation;
export const parseRecommendationFeedItemDescriptor = parseRuntimeLocalRecommendationFeedItem;
export const parseRecommendationFeedDescriptor = parseRuntimeLocalRecommendationFeedDescriptor;

function requiredString(field: string, value: unknown): string {
  const normalized = asString(value);
  if (!normalized) {
    throw new Error(`Missing local runtime field: ${field}`);
  }
  return normalized;
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
    modelId: toCanonicalLocalRuntimeAssetId(record.modelId || record.assetId) || undefined,
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
    modelId: toCanonicalLocalRuntimeAssetId(record.modelId || record.assetId),
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
    modelId: toCanonicalLocalRuntimeAssetId(record.modelId || record.assetId),
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
    modelId: toCanonicalLocalRuntimeAssetId(requiredString('modelId', record.modelId || record.assetId)),
    localModelId: requiredString('localModelId', record.localModelId || record.localAssetId),
  };
}

export function parseScaffoldAssetResult(value: unknown): LocalRuntimeScaffoldAssetResult {
  const record = asRecord(value);
  return {
    manifestPath: asString(record.manifestPath),
    assetId: toCanonicalLocalRuntimeAssetId(record.assetId),
    kind: normalizeAssetKind(record.kind),
  };
}
