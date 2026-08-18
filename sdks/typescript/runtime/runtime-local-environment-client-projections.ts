import type {
  LocalCatalogModelDescriptor as GeneratedLocalCatalogModelDescriptor,
  LocalCatalogVariantDescriptor as GeneratedLocalCatalogVariantDescriptor,
  LocalDeviceProfile as GeneratedLocalDeviceProfile,
  LocalEnvironmentDependencyJob as GeneratedLocalEnvironmentDependencyJob,
  LocalEnvironmentPlan as GeneratedLocalEnvironmentPlan,
  LocalEnvironmentPlanDependency as GeneratedLocalEnvironmentPlanDependency,
  LocalInstallPlanDescriptor as GeneratedLocalInstallPlanDescriptor,
  LocalProviderHints as GeneratedLocalProviderHints,
  LocalTransferProgressEvent as GeneratedLocalTransferProgressEvent,
  LocalTransferSessionSummary as GeneratedLocalTransferSessionSummary,
  LocalVerifiedAssetDescriptor as GeneratedLocalVerifiedAssetDescriptor,
  ModelAssetRecord as GeneratedModelAssetRecord,
} from '../core-generated/runtime-typed-client';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';
import {
  nimiRuntimeLocalRunnableAssetKindForCapabilities,
  parseNimiRuntimeLocalAssetKindId,
  parseNimiRuntimeLocalEngineRuntimeModeId,
} from './local-asset-vocabulary';
import { projectNimiRuntimeLocalCatalogRecommendation } from './runtime-local-recommendation';
import type {
  NimiRuntimeModelAssetRecord,
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalCatalogVariantDescriptor,
  NimiRuntimeLocalDeviceProfile,
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeLocalEnvironmentPlanDependency,
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeLocalProviderHints,
  NimiRuntimeLocalTransferAccepted,
  NimiRuntimeLocalTransferProgressEvent,
  NimiRuntimeLocalTransferSessionSummary,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from './runtime-local-environment-client-types';
import {
  clampNimiRuntimeLocalPercent,
  invalidLocalProjection,
  nonEmptyRecord,
  nonNegativeNumber,
  normalizeNimiRuntimeLocalDownloadState,
  normalizeNimiRuntimeLocalState,
  normalizeText,
  numberFromInt64,
  positiveNumber,
  requireProjectedText,
  stringRecord,
  textList,
  textListOrUndefined,
} from './runtime-local-environment-client-values';

const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_READY_STATES: ReadonlySet<string> = new Set([
  'ready_system',
  'ready_managed',
  'ready',
  'already_satisfied',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_STARTABLE_STATES: ReadonlySet<string> = new Set([
  'missing',
  'stale',
  'needs_confirmation',
  'repair_required',
  'failed',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_NEEDS_CONFIRMATION_STATES: ReadonlySet<string> = new Set([
  'needs_confirmation',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED_STATES: ReadonlySet<string> = new Set([
  'repair_required',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED_STATES: ReadonlySet<string> = new Set([
  'unsupported',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_ACTIVE_STATES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'downloading',
  'verifying',
  'installing',
  'applying',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_TRANSFERRING_STATES: ReadonlySet<string> = new Set([
  'downloading',
  'verifying',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_RETRYABLE_STATES: ReadonlySet<string> = new Set([
  'failed',
  'cancelled',
  'unsupported',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED_STATES: ReadonlySet<string> = new Set([
  'failed',
]);
const NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_CANCELLED_STATES: ReadonlySet<string> = new Set([
  'cancelled',
]);

export function projectNimiRuntimeModelAssetRecord(
  value: GeneratedModelAssetRecord,
): NimiRuntimeModelAssetRecord {
  const modelAssetId = requireProjectedText(value.modelAssetId, 'Runtime ModelAsset record is missing modelAssetId');
  const contentId = requireProjectedText(value.contentId, `Runtime ModelAsset ${modelAssetId} is missing contentId`);
  if (!value.contentVerified) {
    throw invalidLocalProjection(`Runtime ModelAsset ${modelAssetId} is not content verified`);
  }
  const catalogVerification = value.catalogVerification === 1
    ? 'matched'
    : value.catalogVerification === 2
      ? 'not_matched'
      : 'unknown';
  return {
    modelAssetId,
    contentId,
    displayName: normalizeText(value.displayName),
    entry: normalizeText(value.entry),
    files: value.files.map((file) => ({
      relativePath: requireProjectedText(file.relativePath, `Runtime ModelAsset ${modelAssetId} has a file without relativePath`),
      sha256: requireProjectedText(file.sha256, `Runtime ModelAsset ${modelAssetId} has a file without sha256`),
      sizeBytes: nonNegativeNumber(numberFromInt64(file.sizeBytes)),
      nonExecutableContent: Boolean(file.nonExecutableContent),
    })),
    totalSizeBytes: nonNegativeNumber(numberFromInt64(value.totalSizeBytes)),
    contentVerified: true,
    catalogVerification,
    catalogVerified: catalogVerification === 'matched',
    unclassified: Boolean(value.unclassified),
    boundedFingerprint: nonEmptyRecord(fromNimiRuntimeProtoStruct(value.boundedFingerprint)),
    provenance: nonEmptyRecord(fromNimiRuntimeProtoStruct(value.provenance)),
    createdAt: normalizeText(value.createdAt),
    updatedAt: normalizeText(value.updatedAt),
    latestIntegrityCheckedAt: normalizeText(value.latestIntegrityCheckedAt),
    duplicateContent: Boolean(value.duplicateContent),
    containsNonExecutableCode: Boolean(value.containsNonExecutableCode),
  };
}

export function projectNimiRuntimeLocalVerifiedAssetDescriptor(
  value: GeneratedLocalVerifiedAssetDescriptor,
): NimiRuntimeLocalVerifiedAssetDescriptor {
  const kind = parseNimiRuntimeLocalAssetKindId(value.kind);
  if (!kind) {
    throw invalidLocalProjection(`Runtime local verified asset ${value.templateId} has unsupported kind ${String(value.kind)}`);
  }
  const capabilities = textList(value.capabilities);
  const files = textList(value.files);
  return {
    templateId: normalizeText(value.templateId),
    title: normalizeText(value.title),
    description: normalizeText(value.description),
    installKind: normalizeText(value.installKind) || undefined,
    assetId: normalizeText(value.assetId),
    kind,
    logicalModelId: normalizeText(value.logicalModelId) || undefined,
    repo: normalizeText(value.repo),
    revision: normalizeText(value.revision) || 'main',
    capabilities: capabilities.length > 0 ? capabilities : undefined,
    engine: normalizeText(value.engine),
    entry: normalizeText(value.entry),
    files,
    license: normalizeText(value.license),
    hashes: stringRecord(value.hashes),
    endpoint: normalizeText(value.endpoint) || undefined,
    fileCount: positiveNumber(value.fileCount) ?? files.length,
    totalSizeBytes: positiveNumber(value.totalSizeBytes),
    contentId: normalizeText(value.contentId),
    tags: textList(value.tags),
    artifactRoles: textListOrUndefined(value.artifactRoles),
    preferredEngine: normalizeText(value.preferredEngine) || undefined,
    fallbackEngines: textListOrUndefined(value.fallbackEngines),
    engineConfig: nonEmptyRecord(fromNimiRuntimeProtoStruct(value.engineConfig)),
    metadata: nonEmptyRecord(fromNimiRuntimeProtoStruct(value.metadata)),
  };
}

export function projectNimiRuntimeLocalCatalogItemDescriptor(
  value: GeneratedLocalCatalogModelDescriptor,
): NimiRuntimeLocalCatalogItemDescriptor {
  const kind = nimiRuntimeLocalRunnableAssetKindForCapabilities(value.capabilities);
  if (!kind) {
    throw invalidLocalProjection(`Runtime local catalog item ${value.itemId} has unknown or ambiguous capabilities`);
  }
  const engineRuntimeMode = parseNimiRuntimeLocalEngineRuntimeModeId(value.engineRuntimeMode);
  if (!engineRuntimeMode) {
    throw invalidLocalProjection(`Runtime local catalog item ${value.itemId} has unknown engine runtime mode`);
  }
  return {
    itemId: normalizeText(value.itemId),
    source: normalizeText(value.source) || 'huggingface',
    title: normalizeText(value.title),
    description: normalizeText(value.description),
    modelId: normalizeText(value.modelId),
    repo: normalizeText(value.repo),
    revision: normalizeText(value.revision) || 'main',
    templateId: normalizeText(value.templateId) || undefined,
    capabilities: textList(value.capabilities),
    engine: normalizeText(value.engine),
    engineRuntimeMode,
    installKind: normalizeText(value.installKind),
    installAvailable: Boolean(value.installAvailable),
    endpoint: normalizeText(value.endpoint) || undefined,
    providerHints: projectNimiRuntimeLocalProviderHints(value.providerHints),
    entry: normalizeText(value.entry) || undefined,
    files: textList(value.files),
    license: normalizeText(value.license) || undefined,
    hashes: stringRecord(value.hashes),
    tags: [...new Set([...textList(value.tags), kind])],
    downloads: positiveNumber(value.downloads),
    likes: positiveNumber(value.likes),
    lastModified: normalizeText(value.lastModified) || undefined,
    verified: Boolean(value.verified),
    engineConfig: nonEmptyRecord(fromNimiRuntimeProtoStruct(value.engineConfig)),
    recommendation: projectNimiRuntimeLocalCatalogRecommendation((value as { recommendation?: unknown }).recommendation),
    totalSizeBytes: positiveNumber(value.totalSizeBytes),
  };
}

export function projectNimiRuntimeLocalCatalogVariantDescriptor(
  value: GeneratedLocalCatalogVariantDescriptor,
): NimiRuntimeLocalCatalogVariantDescriptor {
  return {
    filename: normalizeText(value.filename),
    entry: normalizeText(value.entry),
    files: textList(value.files),
    format: normalizeText(value.format) || undefined,
    sizeBytes: positiveNumber(value.sizeBytes),
    sha256: normalizeText(value.sha256) || undefined,
    recommendation: projectNimiRuntimeLocalCatalogRecommendation((value as { recommendation?: unknown }).recommendation),
  };
}

export function projectNimiRuntimeLocalInstallPlanDescriptor(
  value: GeneratedLocalInstallPlanDescriptor,
): NimiRuntimeLocalInstallPlanDescriptor {
  const engineRuntimeMode = parseNimiRuntimeLocalEngineRuntimeModeId(value.engineRuntimeMode);
  if (!engineRuntimeMode) {
    throw invalidLocalProjection(`Runtime local install plan ${value.planId} has unknown engine runtime mode`);
  }
  return {
    planId: normalizeText(value.planId),
    itemId: normalizeText(value.itemId),
    source: normalizeText(value.source) || 'huggingface',
    templateId: normalizeText(value.templateId) || undefined,
    modelId: normalizeText(value.modelId),
    repo: normalizeText(value.repo),
    revision: normalizeText(value.revision) || 'main',
    capabilities: textList(value.capabilities),
    engine: normalizeText(value.engine),
    engineRuntimeMode,
    installKind: normalizeText(value.installKind),
    installAvailable: Boolean(value.installAvailable),
    endpoint: normalizeText(value.endpoint),
    providerHints: projectNimiRuntimeLocalProviderHints(value.providerHints),
    entry: normalizeText(value.entry),
    files: textList(value.files),
    license: normalizeText(value.license),
    hashes: stringRecord(value.hashes),
    warnings: textList(value.warnings),
    reasonCode: normalizeText(value.reasonCode) || undefined,
    engineConfig: nonEmptyRecord(fromNimiRuntimeProtoStruct(value.engineConfig)),
    totalSizeBytes: positiveNumber(value.totalSizeBytes),
  };
}

export function projectNimiRuntimeLocalDeviceProfile(
  value: GeneratedLocalDeviceProfile,
): NimiRuntimeLocalDeviceProfile {
  return {
    os: normalizeText(value.os),
    arch: normalizeText(value.arch),
    totalRamBytes: numberFromInt64(value.totalRamBytes),
    availableRamBytes: numberFromInt64(value.availableRamBytes),
    diskFreeBytes: numberFromInt64(value.diskFreeBytes),
    ports: (value.ports ?? []).map((port) => ({
      port: Number(port.port || 0),
      available: Boolean(port.available),
    })),
    gpu: {
      available: Boolean(value.gpu?.available),
      vendor: normalizeText(value.gpu?.vendor),
      model: normalizeText(value.gpu?.model),
      totalVramBytes: numberFromInt64(value.gpu?.totalVramBytes),
      availableVramBytes: numberFromInt64(value.gpu?.availableVramBytes),
      memoryModel: value.gpu?.memoryModel
        ? (value.gpu.memoryModel === 1 ? 'discrete' : value.gpu.memoryModel === 2 ? 'unified' : undefined)
        : undefined,
    },
    python: {
      available: Boolean(value.python?.available),
      version: normalizeText(value.python?.version),
    },
    npu: {
      available: Boolean(value.npu?.available),
      ready: Boolean(value.npu?.ready),
      vendor: normalizeText(value.npu?.vendor),
      runtime: normalizeText(value.npu?.runtime),
      detail: normalizeText(value.npu?.detail),
    },
  };
}

export function projectNimiRuntimeLocalTransferSessionSummary(
  value: GeneratedLocalTransferSessionSummary,
): NimiRuntimeLocalTransferSessionSummary {
  const state = normalizeNimiRuntimeLocalDownloadState(value.state);
  return {
    installSessionId: normalizeText(value.installSessionId),
    modelId: normalizeText(value.assetId),
    sessionKind: normalizeText(value.sessionKind) || 'download',
    phase: normalizeText(value.phase),
    state,
    bytesReceived: numberFromInt64(value.bytesReceived),
    bytesTotal: positiveNumber(value.bytesTotal),
    speedBytesPerSec: positiveNumber(value.speedBytesPerSec),
    etaSeconds: positiveNumber(value.etaSeconds),
    message: normalizeText(value.message) || undefined,
    reasonCode: normalizeText(value.reasonCode) || undefined,
    retryable: Boolean(value.retryable),
    createdAt: normalizeText(value.createdAt),
    updatedAt: normalizeText(value.updatedAt),
  };
}

export function projectNimiRuntimeLocalTransferProgressEvent(
  value: GeneratedLocalTransferProgressEvent,
): NimiRuntimeLocalTransferProgressEvent {
  return {
    installSessionId: normalizeText(value.installSessionId),
    modelId: normalizeText(value.assetId),
    sessionKind: normalizeText(value.sessionKind) || 'download',
    phase: normalizeText(value.phase),
    bytesReceived: numberFromInt64(value.bytesReceived),
    bytesTotal: positiveNumber(value.bytesTotal),
    speedBytesPerSec: positiveNumber(value.speedBytesPerSec),
    etaSeconds: positiveNumber(value.etaSeconds),
    message: normalizeText(value.message) || undefined,
    state: normalizeNimiRuntimeLocalDownloadState(value.state),
    reasonCode: normalizeText(value.reasonCode) || undefined,
    retryable: Boolean(value.retryable),
    done: Boolean(value.done),
    success: Boolean(value.success),
    createdAt: normalizeText(value.createdAt) || undefined,
    updatedAt: normalizeText(value.updatedAt) || undefined,
  };
}

export function projectNimiRuntimeLocalEnvironmentPlan(
  value: GeneratedLocalEnvironmentPlan,
): NimiRuntimeLocalEnvironmentPlan {
  return {
    planId: normalizeText(value.planId),
    packId: normalizeText(value.packId),
    productLabel: normalizeText(value.productLabel),
    hostProfileId: normalizeText(value.hostProfileId),
    platformTuple: normalizeText(value.platformTuple),
    runtimeDataRoot: normalizeText(value.runtimeDataRoot),
    consumerScope: normalizeText(value.consumerScope),
    cloudOnlyImpact: normalizeText(value.cloudOnlyImpact),
    state: normalizeText(value.state),
    reasonCode: normalizeText(value.reasonCode) || undefined,
    dependencies: value.dependencies.map(projectNimiRuntimeLocalEnvironmentPlanDependency),
    requiredDependencyFamilies: value.requiredDependencyFamilies.map(normalizeText).filter(Boolean),
    aggregateSizeKnown: Boolean(value.aggregateSizeKnown),
    aggregateSizeBytes: numberFromInt64(value.aggregateSizeBytes),
    storageCategories: value.storageCategories.map(normalizeText).filter(Boolean),
    sourceOwners: value.sourceOwners.map(normalizeText).filter(Boolean),
    noSystemMutation: Boolean(value.noSystemMutation),
  };
}

export function projectNimiRuntimeLocalEnvironmentPlanDependency(
  value: GeneratedLocalEnvironmentPlanDependency,
): NimiRuntimeLocalEnvironmentPlanDependency {
  return {
    dependencyFamily: normalizeText(value.dependencyFamily),
    dependencyId: normalizeText(value.dependencyId),
    consumerScope: normalizeText(value.consumerScope),
    required: Boolean(value.required),
    state: normalizeText(value.state),
    sourceKind: normalizeText(value.sourceKind),
    confirmationRequired: Boolean(value.confirmationRequired),
    selectedSourceRecordId: normalizeText(value.selectedSourceRecordId) || undefined,
    environmentKey: normalizeText(value.environmentKey),
    canonicalRoot: normalizeText(value.canonicalRoot) || undefined,
    reasonCode: normalizeText(value.reasonCode) || undefined,
    detail: normalizeText(value.detail) || undefined,
  };
}

export function projectNimiRuntimeLocalEnvironmentDependencyJob(
  value: GeneratedLocalEnvironmentDependencyJob,
): NimiRuntimeLocalEnvironmentDependencyJob {
  return {
    jobId: normalizeText(value.jobId),
    environmentKey: normalizeText(value.environmentKey),
    dependencyFamily: normalizeText(value.dependencyFamily),
    dependencyId: normalizeText(value.dependencyId),
    consumerScope: normalizeText(value.consumerScope),
    state: normalizeText(value.state),
    sourceKind: normalizeText(value.sourceKind),
    canonicalRoot: normalizeText(value.canonicalRoot) || undefined,
    selectedSourceRecordId: normalizeText(value.selectedSourceRecordId) || undefined,
    failureDetail: normalizeText(value.failureDetail) || undefined,
    retryable: Boolean(value.retryable),
    createdAt: normalizeText(value.createdAt),
    updatedAt: normalizeText(value.updatedAt),
    reasonCode: normalizeText(value.reasonCode) || undefined,
    recoveryDisposition: normalizeText(value.recoveryDisposition) || undefined,
    bytesReceived: nonNegativeNumber(value.bytesReceived),
    bytesTotal: nonNegativeNumber(value.bytesTotal),
    percent: clampNimiRuntimeLocalPercent(value.percent),
    speedBytesPerSec: nonNegativeNumber(value.speedBytesPerSec),
    etaSeconds: nonNegativeNumber(value.etaSeconds),
  };
}

export function isNimiRuntimeLocalEnvironmentDependencyReadyState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_READY_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyStartableState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_STARTABLE_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_NEEDS_CONFIRMATION_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyJobActiveState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_ACTIVE_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyJobTransferringState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_TRANSFERRING_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyJobRetryableState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_RETRYABLE_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyJobFailedState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED_STATES.has(normalizeNimiRuntimeLocalState(state));
}

export function isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(state: unknown): boolean {
  return NIMI_RUNTIME_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_CANCELLED_STATES.has(normalizeNimiRuntimeLocalState(state));
}

function projectNimiRuntimeLocalProviderHints(
  value: GeneratedLocalProviderHints | undefined,
): NimiRuntimeLocalProviderHints | undefined {
  if (!value) {
    return undefined;
  }
  const hints: NimiRuntimeLocalProviderHints = {
    llama: value.llama
      ? {
        backend: normalizeText(value.llama.backend),
        preferredAdapter: normalizeText(value.llama.preferredAdapter),
        multimodalProjector: normalizeText(value.llama.multimodalProjector) || undefined,
      }
      : undefined,
    media: value.media
      ? {
        backend: normalizeText(value.media.backend),
        preferredAdapter: normalizeText(value.media.preferredAdapter),
        family: normalizeText(value.media.family) || undefined,
        imageDriver: normalizeText(value.media.imageDriver) || undefined,
        videoDriver: normalizeText(value.media.videoDriver) || undefined,
        device: normalizeText(value.media.device) || undefined,
        fallbackDriver: normalizeText(value.media.fallbackDriver) || undefined,
        fallbackReason: normalizeText(value.media.fallbackReason) || undefined,
        policyGate: normalizeText(value.media.policyGate) || undefined,
      }
      : undefined,
    speech: value.speech
      ? {
        backend: normalizeText(value.speech.backend),
        preferredAdapter: normalizeText(value.speech.preferredAdapter),
        family: normalizeText(value.speech.family) || undefined,
        driver: normalizeText(value.speech.driver) || undefined,
        device: normalizeText(value.speech.device) || undefined,
        voiceWorkflowDriver: normalizeText(value.speech.voiceWorkflowDriver) || undefined,
        policyGate: normalizeText(value.speech.policyGate) || undefined,
      }
      : undefined,
    sidecar: value.sidecar
      ? {
        preferredAdapter: normalizeText(value.sidecar.preferredAdapter),
        backend: normalizeText(value.sidecar.backend),
      }
      : undefined,
    extra: Object.keys(value.extra ?? {}).length > 0 ? stringRecord(value.extra) : undefined,
  };
  return Object.values(hints).some(Boolean) ? hints : undefined;
}

export function projectNimiRuntimeLocalTransferAccepted(
  value: GeneratedLocalTransferSessionSummary,
): NimiRuntimeLocalTransferAccepted {
  return {
    installSessionId: normalizeText(value.installSessionId),
    modelId: normalizeText(value.assetId),
  };
}
