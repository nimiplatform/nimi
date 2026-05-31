import type {
  LocalRuntimeAssetKind,
  LocalRuntimeAssetStatus,
  LocalRuntimeAssetRecord,
  LocalRuntimeVerifiedAssetDescriptor,
  LocalRuntimeEngineRuntimeMode,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeExecutionApplyResult,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileRequirementDescriptor,
  LocalRuntimeProfileResolutionPlan,
} from './types.js';
import {
  normalizeLocalRuntimeAssetKindId,
  normalizeLocalRuntimeAssetStatusId,
} from '../local-asset-kind.js';
import {
  normalizeLocalRuntimeEngineRuntimeModeId,
} from '../local-engine.js';
import {
  parseLocalRuntimeProviderHints as parseSdkProviderHints,
  parseServiceDescriptor as parseSdkServiceDescriptor,
} from '../local-node-service.js';
import {
  parseExecutionEntryDescriptor as parseSdkExecutionEntryDescriptor,
  parseExecutionPlan as parseSdkExecutionPlan,
  parseExecutionStageResult as parseSdkExecutionStageResult,
  parsePreflightDecision as parseSdkPreflightDecision,
  normalizeExecutionEntryKind,
  parseExecutionStageResult,
  parseExecutionEntryDescriptor,
  parseExecutionPlan,
  parseDeviceProfile,
  parsePreflightDecision,
  parseExecutionSelectionRationale,
} from '../local-execution-plan.js';
import {
  toCanonicalLocalRuntimeAssetId,
} from '../local-asset-id.js';
import { asRecord, asString } from './parser-primitives.js';
import { asPlainObject } from './parser-helpers.js';
import { parseCatalogRecommendation } from './parsers-runtime-events.js';
export { asRecord, asString } from './parser-primitives.js';
export {
  assertLifecycleWriteAllowed,
  normalizeCaller,
} from './parser-helpers.js';
export {
  normalizeExecutionEntryKind,
  parseExecutionStageResult,
  parseExecutionEntryDescriptor,
  parseExecutionPlan,
  parseDeviceProfile,
  parsePreflightDecision,
  parseExecutionSelectionRationale,
};
export {
  normalizeDownloadState,
  parseAuditEvent,
  parseCatalogRecommendation,
  parseDownloadProgressEvent,
  parseDownloadSessionSummary,
  parseTransferAccepted,
  parseLocalRuntimeEnvironmentDependencyJob,
  parseLocalRuntimeEnvironmentPlan,
  parseLocalRuntimeEnvironmentPlanDependency,
  parseGgufVariantDescriptor,
  parseAssetHealth,
  parseUnregisteredAssetDescriptor,
  parseRecommendationFeedDescriptor,
  parseRecommendationFeedItemDescriptor,
  parseScaffoldAssetResult,
} from './parsers-runtime-events.js';
export function normalizeAssetStatus(value: unknown): LocalRuntimeAssetStatus {
  return normalizeLocalRuntimeAssetStatusId(value);
}

function inferIntegrityModeFromRepo(repo: string): 'verified' | 'local_unverified' {
  return repo.trim().toLowerCase().startsWith('local-import/')
    ? 'local_unverified'
    : 'verified';
}

function normalizeCapabilityToken(value: unknown): string {
  const normalized = asString(value).trim().toLowerCase();
  if (normalized === 'text.embed' || normalized === 'embed') {
    return 'embedding';
  }
  return normalized;
}

function normalizeCapabilities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.map((item) => normalizeCapabilityToken(item)).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function effectiveAssetKind(
  kind: LocalRuntimeAssetKind,
  capabilities: string[] | undefined,
): LocalRuntimeAssetKind {
  const capabilitySet = new Set((capabilities || []).map((item) => normalizeCapabilityToken(item)));
  const hasChat = capabilitySet.has('chat') || capabilitySet.has('text.generate');
  const hasEmbedding = capabilitySet.has('embedding');
  if (kind === 'chat' && hasEmbedding && !hasChat) {
    return 'embedding';
  }
  if (kind === 'embedding' && hasChat) {
    return 'chat';
  }
  return kind;
}

export function parseAssetRecord(value: unknown): LocalRuntimeAssetRecord {
  const record = asRecord(value);
  const source = asRecord(record.source);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
    : [];
  const capabilities = normalizeCapabilities(record.capabilities);
  return {
    localAssetId: asString(record.localAssetId),
    assetId: toCanonicalLocalRuntimeAssetId(record.assetId),
    kind: effectiveAssetKind(normalizeAssetKind(record.kind), capabilities),
    engine: asString(record.engine),
    engineRuntimeMode: record.engineRuntimeMode == null
      ? undefined
      : normalizeEngineRuntimeMode(record.engineRuntimeMode),
    endpoint: asString(record.endpoint) || undefined,
    entry: asString(record.entry),
    files,
    license: asString(record.license),
    source: {
      repo: asString(source.repo),
      revision: asString(source.revision),
    },
    integrityMode: (
      asString(record.integrityMode) === 'local_unverified'
      || asString(record.integrityMode) === 'verified'
    )
      ? (asString(record.integrityMode) as 'verified' | 'local_unverified')
      : inferIntegrityModeFromRepo(asString(source.repo)),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    status: normalizeAssetStatus(record.status),
    installedAt: asString(record.installedAt),
    updatedAt: asString(record.updatedAt),
    healthDetail: asString(record.healthDetail) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    // Runnable-only
    capabilities,
    logicalModelId: asString(record.logicalModelId) || undefined,
    family: asString(record.family) || undefined,
    artifactRoles: Array.isArray(record.artifactRoles)
      ? record.artifactRoles.map((item) => asString(item)).filter(Boolean)
      : undefined,
    preferredEngine: asString(record.preferredEngine) || undefined,
    fallbackEngines: Array.isArray(record.fallbackEngines)
      ? record.fallbackEngines.map((item) => asString(item)).filter(Boolean)
      : undefined,
    engineConfig: asPlainObject(record.engineConfig),
    recommendation: parseCatalogRecommendation(record.recommendation),
    // Passive-only
    metadata: asPlainObject(record.metadata),
  };
}

export function parseVerifiedAssetDescriptor(value: unknown): LocalRuntimeVerifiedAssetDescriptor {
  const record = asRecord(value);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
    : [];
  const capabilities = normalizeCapabilities(record.capabilities) || [];
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => asString(item)).filter(Boolean)
    : [];
  const fileCountRaw = Number(record.fileCount);
  const totalSizeBytesRaw = Number(record.totalSizeBytes);
  return {
    templateId: asString(record.templateId),
    title: asString(record.title),
    description: asString(record.description),
    installKind: asString(record.installKind) || undefined,
    assetId: asString(record.assetId),
    kind: effectiveAssetKind(normalizeAssetKind(record.kind), capabilities),
    logicalModelId: asString(record.logicalModelId) || undefined,
    repo: asString(record.repo),
    revision: asString(record.revision) || 'main',
    capabilities: capabilities.length > 0 ? capabilities : undefined,
    engine: asString(record.engine),
    entry: asString(record.entry),
    files,
    license: asString(record.license),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    endpoint: asString(record.endpoint) || undefined,
    fileCount: Number.isFinite(fileCountRaw) && fileCountRaw > 0 ? fileCountRaw : files.length,
    totalSizeBytes: Number.isFinite(totalSizeBytesRaw) && totalSizeBytesRaw > 0
      ? totalSizeBytesRaw
      : undefined,
    tags,
    artifactRoles: Array.isArray(record.artifactRoles)
      ? record.artifactRoles.map((item) => asString(item)).filter(Boolean)
      : undefined,
    preferredEngine: asString(record.preferredEngine) || undefined,
    fallbackEngines: Array.isArray(record.fallbackEngines)
      ? record.fallbackEngines.map((item) => asString(item)).filter(Boolean)
      : undefined,
    engineConfig: asPlainObject(record.engineConfig),
    metadata: asPlainObject(record.metadata),
  };
}

export function normalizeAssetKind(value: unknown): LocalRuntimeAssetKind {
  return normalizeLocalRuntimeAssetKindId(value);
}


function parseProfileRequirementDescriptor(value: unknown): LocalRuntimeProfileRequirementDescriptor | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const minGpuMemoryGb = Number(record.minGpuMemoryGb);
  const minDiskBytes = Number(record.minDiskBytes);
  const platforms = Array.isArray(record.platforms)
    ? record.platforms.map((item) => asString(item)).filter(Boolean)
    : [];
  const notes = Array.isArray(record.notes)
    ? record.notes.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    minGpuMemoryGb: Number.isFinite(minGpuMemoryGb) ? minGpuMemoryGb : undefined,
    minDiskBytes: Number.isFinite(minDiskBytes) && minDiskBytes >= 0 ? minDiskBytes : undefined,
    platforms,
    notes,
  };
}

function parseProfileEntryDescriptor(value: unknown): LocalRuntimeProfileEntryDescriptor {
  const record = asRecord(value);
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    entryId: asString(record.entryId || record.id),
    kind: asString(record.kind) as LocalRuntimeProfileEntryDescriptor['kind'],
    title: asString(record.title) || undefined,
    description: asString(record.description) || undefined,
    capability: asString(record.capability) || undefined,
    required: typeof record.required === 'boolean' ? Boolean(record.required) : undefined,
    preferred: typeof record.preferred === 'boolean' ? Boolean(record.preferred) : undefined,
    assetId: toCanonicalLocalRuntimeAssetId(record.assetId) || undefined,
    assetKind: asString(record.assetKind) as LocalRuntimeProfileEntryDescriptor['assetKind'] || undefined,
    engineSlot: asString(record.engineSlot) || undefined,
    repo: asString(record.repo) || undefined,
    serviceId: asString(record.serviceId) || undefined,
    nodeId: asString(record.nodeId) || undefined,
    engine: asString(record.engine) || undefined,
    templateId: asString(record.templateId) || undefined,
    revision: asString(record.revision) || undefined,
    tags,
  };
}

export function parseProfileResolutionPlan(value: unknown): LocalRuntimeProfileResolutionPlan {
  const record = asRecord(value);
  const assetEntries = Array.isArray(record.assetEntries)
    ? record.assetEntries.map((item) => parseProfileEntryDescriptor(item))
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    targetId: asString(record.targetId),
    profileId: asString(record.profileId),
    title: asString(record.title),
    description: asString(record.description) || undefined,
    recommended: Boolean(record.recommended),
    consumeCapabilities: Array.isArray(record.consumeCapabilities)
      ? record.consumeCapabilities.map((item) => asString(item)).filter(Boolean)
      : [],
    requirements: parseProfileRequirementDescriptor(record.requirements),
    executionPlan: parseSdkExecutionPlan(record.executionPlan),
    assetEntries,
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}

export function parseProfileApplyResult(value: unknown): LocalRuntimeProfileApplyResult {
  const record = asRecord(value);
  const installedAssets = Array.isArray(record.installedAssets)
    ? record.installedAssets.map((item: unknown) => parseAssetRecord(item))
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    targetId: asString(record.targetId),
    profileId: asString(record.profileId),
    executionResult: parseExecutionApplyResult(record.executionResult),
    installedAssets,
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}


export function normalizeEngineRuntimeMode(value: unknown): LocalRuntimeEngineRuntimeMode {
  return normalizeLocalRuntimeEngineRuntimeModeId(value);
}

export function parseCatalogItemDescriptor(value: unknown): LocalRuntimeCatalogItemDescriptor {
  const record = asRecord(value);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => asString(item)).filter(Boolean)
    : [];
  const downloads = Number(record.downloads);
  const likes = Number(record.likes);
  return {
    itemId: asString(record.itemId),
    source: asString(record.source) || 'huggingface',
    title: asString(record.title),
    description: asString(record.description),
    modelId: asString(record.modelId || record.assetId),
    repo: asString(record.repo),
    revision: asString(record.revision) || 'main',
    templateId: asString(record.templateId) || undefined,
    capabilities,
    engine: asString(record.engine),
    engineRuntimeMode: normalizeEngineRuntimeMode(record.engineRuntimeMode),
    installKind: asString(record.installKind),
    installAvailable: Boolean(record.installAvailable),
    endpoint: asString(record.endpoint) || undefined,
    providerHints: parseSdkProviderHints(record.providerHints),
    entry: asString(record.entry) || undefined,
    files,
    license: asString(record.license) || undefined,
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    tags,
    downloads: Number.isFinite(downloads) && downloads > 0 ? downloads : undefined,
    likes: Number.isFinite(likes) && likes >= 0 ? likes : undefined,
    lastModified: asString(record.lastModified) || undefined,
    verified: Boolean(record.verified),
    engineConfig: asPlainObject(record.engineConfig),
    recommendation: parseCatalogRecommendation(record.recommendation),
  };
}

export function parseInstallPlanDescriptor(value: unknown): LocalRuntimeInstallPlanDescriptor {
  const record = asRecord(value);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    itemId: asString(record.itemId),
    source: asString(record.source) || 'huggingface',
    templateId: asString(record.templateId) || undefined,
    modelId: asString(record.modelId || record.assetId),
    repo: asString(record.repo),
    revision: asString(record.revision) || 'main',
    capabilities,
    engine: asString(record.engine),
    engineRuntimeMode: normalizeEngineRuntimeMode(record.engineRuntimeMode),
    installKind: asString(record.installKind),
    installAvailable: Boolean(record.installAvailable),
    endpoint: asString(record.endpoint),
    providerHints: parseSdkProviderHints(record.providerHints),
    entry: asString(record.entry),
    files,
    license: asString(record.license),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
    engineConfig: asPlainObject(record.engineConfig),
    recommendation: parseCatalogRecommendation(record.recommendation),
  };
}

export function parseExecutionApplyResult(value: unknown): LocalRuntimeExecutionApplyResult {
  const record = asRecord(value);
  const entries = Array.isArray(record.entries)
    ? record.entries.map((item) => parseSdkExecutionEntryDescriptor(item))
    : [];
  const installedAssets = Array.isArray(record.installedAssets)
    ? record.installedAssets.map((item: unknown) => parseAssetRecord(item))
    : [];
  const services = Array.isArray(record.services)
    ? record.services.map((item) => parseSdkServiceDescriptor(item))
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  const stageResults = Array.isArray(record.stageResults)
    ? record.stageResults.map((item) => parseSdkExecutionStageResult(item))
    : [];
  const preflightDecisions = Array.isArray(record.preflightDecisions)
    ? record.preflightDecisions.map((item) => parseSdkPreflightDecision(item))
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    targetId: asString(record.targetId),
    entries,
    installedAssets,
    services,
    capabilities,
    stageResults,
    preflightDecisions,
    rollbackApplied: Boolean(record.rollbackApplied),
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}
