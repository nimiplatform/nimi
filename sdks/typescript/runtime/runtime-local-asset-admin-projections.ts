import type {
  LocalAssetRecord as GeneratedLocalAssetRecord,
  LocalCatalogModelDescriptor as GeneratedLocalCatalogModelDescriptor,
  LocalCatalogVariantDescriptor as GeneratedLocalCatalogVariantDescriptor,
  LocalDeviceProfile as GeneratedLocalDeviceProfile,
  LocalEnvironmentDependencyJob as GeneratedLocalEnvironmentDependencyJob,
  LocalEnvironmentPlan as GeneratedLocalEnvironmentPlan,
  LocalEnvironmentPlanDependency as GeneratedLocalEnvironmentPlanDependency,
  LocalExecutionApplyResult as GeneratedLocalExecutionApplyResult,
  LocalExecutionEntryDescriptor as GeneratedLocalExecutionEntryDescriptor,
  LocalExecutionPlan as GeneratedLocalExecutionPlan,
  LocalExecutionStageResult as GeneratedLocalExecutionStageResult,
  LocalInstallPlanDescriptor as GeneratedLocalInstallPlanDescriptor,
  LocalPreflightDecision as GeneratedLocalPreflightDecision,
  LocalProfileApplyResult as GeneratedLocalProfileApplyResult,
  LocalProfileRequirementDescriptor as GeneratedLocalProfileRequirementDescriptor,
  LocalProfileResolutionPlan as GeneratedLocalProfileResolutionPlan,
  LocalProviderHints as GeneratedLocalProviderHints,
  LocalTransferProgressEvent as GeneratedLocalTransferProgressEvent,
  LocalTransferSessionSummary as GeneratedLocalTransferSessionSummary,
  LocalUnregisteredAssetDeclaration as GeneratedLocalUnregisteredAssetDeclaration,
  LocalUnregisteredAssetDescriptor as GeneratedLocalUnregisteredAssetDescriptor,
  LocalVerifiedAssetDescriptor as GeneratedLocalVerifiedAssetDescriptor,
} from '../core-generated/runtime-typed-client';
import { normalizeNimiRuntimeReasonCode } from './reason-messages';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';
import {
  normalizeNimiRuntimeLocalEngineRuntimeModeId,
  nimiRuntimeLocalRunnableAssetKindForCapabilities,
  parseNimiRuntimeLocalAssetKindId,
  parseNimiRuntimeLocalAssetStatusId,
  type NimiRuntimeLocalAssetDeclaration,
} from './local-asset-vocabulary';
import { projectNimiRuntimeLocalCatalogRecommendation } from './runtime-local-recommendation';
import type {
  NimiRuntimeLocalAssetRecord,
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalCatalogVariantDescriptor,
  NimiRuntimeLocalDeviceProfile,
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeLocalEnvironmentPlanDependency,
  NimiRuntimeLocalExecutionApplyResult,
  NimiRuntimeLocalExecutionEntryDescriptor,
  NimiRuntimeLocalExecutionPlan,
  NimiRuntimeLocalExecutionStageResult,
  NimiRuntimeLocalImageNativeAssetInput,
  NimiRuntimeLocalImageNativeEnvironmentPlanInput,
  NimiRuntimeLocalImageNativeEnvironmentPlanRuntime,
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeLocalPreflightDecision,
  NimiRuntimeLocalProfileApplyResult,
  NimiRuntimeLocalProfileResolutionPlan,
  NimiRuntimeLocalProviderHints,
  NimiRuntimeLocalTransferAccepted,
  NimiRuntimeLocalTransferProgressEvent,
  NimiRuntimeLocalTransferSessionSummary,
  NimiRuntimeLocalUnregisteredAssetDescriptor,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from './runtime-local-asset-admin-types';
import type { NimiRuntimeLocalProfileRequirementDescriptor } from './runtime-local-profile-manifest';
import {
  clampNimiRuntimeLocalPercent,
  finiteNumber,
  inferNimiRuntimeLocalIntegrityMode,
  invalidLocalProjection,
  nonEmptyRecord,
  nonNegativeNumber,
  normalizeNimiRuntimeLocalDownloadState,
  normalizeNimiRuntimeLocalState,
  normalizeText,
  numberFromInt64,
  parseNimiRuntimeLocalExecutionEntryKind,
  positiveNumber,
  requireProjectedText,
  stringRecord,
  textList,
  textListOrUndefined,
  toCanonicalNimiRuntimeLocalAssetId,
} from './runtime-local-asset-admin-values';

const NIMI_RUNTIME_LOCAL_IMAGE_NATIVE_PACK_ID = 'local-image-native';
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

export function projectNimiRuntimeLocalAssetRecord(
  value: GeneratedLocalAssetRecord,
): NimiRuntimeLocalAssetRecord {
  const localAssetId = requireProjectedText(value.localAssetId, 'Runtime local asset record is missing localAssetId');
  const capabilities = textList(value.capabilities);
  const parsedKind = parseNimiRuntimeLocalAssetKindId(value.kind);
  if (!parsedKind) {
    throw invalidLocalProjection(`Runtime local asset ${localAssetId} has unsupported kind ${String(value.kind)}`);
  }
  const kind = (parsedKind === 'chat' || parsedKind === 'embedding')
    ? nimiRuntimeLocalRunnableAssetKindForCapabilities(capabilities, parsedKind)
    : parsedKind;
  const status = parseNimiRuntimeLocalAssetStatusId(value.status);
  if (!status) {
    throw invalidLocalProjection(`Runtime local asset ${localAssetId} has unsupported status ${String(value.status)}`);
  }
  const source = value.source ?? { repo: '', revision: '' };
  const reasonCode = normalizeNimiRuntimeReasonCode(value.reasonCode);
  return {
    localAssetId,
    assetId: toCanonicalNimiRuntimeLocalAssetId(value.assetId),
    kind,
    engine: normalizeText(value.engine),
    engineRuntimeMode: undefined,
    endpoint: normalizeText(value.endpoint) || undefined,
    entry: normalizeText(value.entry),
    files: textList(value.files),
    license: normalizeText(value.license),
    source: {
      repo: normalizeText(source.repo),
      revision: normalizeText(source.revision),
    },
    integrityMode: inferNimiRuntimeLocalIntegrityMode(source.repo),
    hashes: stringRecord(value.hashes),
    status,
    installedAt: normalizeText(value.installedAt),
    updatedAt: normalizeText(value.updatedAt),
    reasonCode: reasonCode || undefined,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
    logicalModelId: normalizeText(value.logicalModelId) || undefined,
    family: normalizeText(value.family) || undefined,
    artifactRoles: textListOrUndefined(value.artifactRoles),
    preferredEngine: normalizeText(value.preferredEngine) || undefined,
    fallbackEngines: textListOrUndefined(value.fallbackEngines),
    engineConfig: nonEmptyRecord(fromNimiRuntimeProtoStruct(value.engineConfig)),
    recommendation: projectNimiRuntimeLocalCatalogRecommendation((value as { recommendation?: unknown }).recommendation),
    metadata: nonEmptyRecord(fromNimiRuntimeProtoStruct(value.metadata)),
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
    assetId: toCanonicalNimiRuntimeLocalAssetId(value.assetId),
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
    engineRuntimeMode: normalizeNimiRuntimeLocalEngineRuntimeModeId(value.engineRuntimeMode),
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
    engineRuntimeMode: normalizeNimiRuntimeLocalEngineRuntimeModeId(value.engineRuntimeMode),
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
    localModelId: normalizeText(value.localAssetId),
    localAssetId: normalizeText(value.localAssetId),
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
    localModelId: normalizeText(value.localAssetId) || undefined,
    localAssetId: normalizeText(value.localAssetId) || undefined,
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

export function buildNimiRuntimeLocalImageNativeEnvironmentPlanInput(
  asset: NimiRuntimeLocalImageNativeAssetInput,
): NimiRuntimeLocalImageNativeEnvironmentPlanInput {
  return {
    packId: NIMI_RUNTIME_LOCAL_IMAGE_NATIVE_PACK_ID,
    assetId: normalizeText(asset.assetId) || undefined,
    localAssetId: normalizeText(asset.localAssetId) || undefined,
  };
}

export async function resolveNimiRuntimeLocalImageNativeEnvironmentPlan(input: {
  readonly runtime: NimiRuntimeLocalImageNativeEnvironmentPlanRuntime;
  readonly asset: NimiRuntimeLocalImageNativeAssetInput;
}): Promise<NimiRuntimeLocalEnvironmentPlan> {
  return input.runtime.resolveEnvironmentPlan(
    buildNimiRuntimeLocalImageNativeEnvironmentPlanInput(input.asset),
  );
}

export function projectNimiRuntimeLocalUnregisteredAssetDescriptor(
  value: GeneratedLocalUnregisteredAssetDescriptor,
): NimiRuntimeLocalUnregisteredAssetDescriptor {
  return {
    filename: normalizeText(value.filename),
    path: normalizeText(value.path),
    sizeBytes: numberFromInt64(value.sizeBytes),
    declaration: projectNimiRuntimeLocalUnregisteredAssetDeclaration(value.declaration),
    suggestionSource: normalizeText(value.suggestionSource) || 'unknown',
    confidence: normalizeText(value.confidence) || 'low',
    autoImportable: Boolean(value.autoImportable),
    requiresManualReview: Boolean(value.requiresManualReview),
    folderName: normalizeText(value.folderName) || undefined,
  };
}

export function projectNimiRuntimeLocalProfileResolutionPlan(
  value: GeneratedLocalProfileResolutionPlan,
): NimiRuntimeLocalProfileResolutionPlan {
  return {
    planId: normalizeText(value.planId),
    targetId: normalizeText(value.targetId),
    profileId: normalizeText(value.profileId),
    title: normalizeText(value.title),
    description: normalizeText(value.description) || undefined,
    recommended: Boolean(value.recommended),
    consumeCapabilities: textList(value.consumeCapabilities),
    requirements: projectNimiRuntimeLocalProfileRequirement(value.requirements),
    executionPlan: value.executionPlan
      ? projectNimiRuntimeLocalExecutionPlan(value.executionPlan)
      : emptyNimiRuntimeLocalExecutionPlan(value.planId, value.targetId),
    warnings: textList(value.warnings),
    reasonCode: normalizeText(value.reasonCode) || undefined,
  };
}

export function projectNimiRuntimeLocalProfileApplyResult(
  value: GeneratedLocalProfileApplyResult,
): NimiRuntimeLocalProfileApplyResult {
  return {
    planId: normalizeText(value.planId),
    targetId: normalizeText(value.targetId),
    profileId: normalizeText(value.profileId),
    executionResult: value.executionResult
      ? projectNimiRuntimeLocalExecutionApplyResult(value.executionResult)
      : emptyNimiRuntimeLocalExecutionApplyResult(value.planId, value.targetId),
    installedAssets: value.installedAssets.map(projectNimiRuntimeLocalAssetRecord),
    warnings: textList(value.warnings),
    reasonCode: normalizeText(value.reasonCode) || undefined,
  };
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

function projectNimiRuntimeLocalExecutionPlan(
  value: GeneratedLocalExecutionPlan,
): NimiRuntimeLocalExecutionPlan {
  return {
    planId: normalizeText(value.planId),
    targetId: normalizeText(value.targetId),
    capability: normalizeText(value.capability) || undefined,
    deviceProfile: value.deviceProfile
      ? projectNimiRuntimeLocalDeviceProfile(value.deviceProfile)
      : projectNimiRuntimeLocalDeviceProfile({} as GeneratedLocalDeviceProfile),
    entries: value.entries.map(projectNimiRuntimeLocalExecutionEntry),
    preflightDecisions: value.preflightDecisions.map(projectNimiRuntimeLocalPreflightDecision),
    warnings: textList(value.warnings),
    reasonCode: normalizeText(value.reasonCode) || undefined,
  };
}

function projectNimiRuntimeLocalExecutionApplyResult(
  value: GeneratedLocalExecutionApplyResult,
): NimiRuntimeLocalExecutionApplyResult {
  return {
    planId: normalizeText(value.planId),
    targetId: normalizeText(value.targetId),
    entries: value.entries.map(projectNimiRuntimeLocalExecutionEntry),
    installedAssets: value.installedAssets.map(projectNimiRuntimeLocalAssetRecord),
    capabilities: textList(value.capabilities),
    stageResults: value.stageResults.map(projectNimiRuntimeLocalExecutionStageResult),
    preflightDecisions: value.preflightDecisions.map(projectNimiRuntimeLocalPreflightDecision),
    rollbackApplied: Boolean(value.rollbackApplied),
    warnings: textList(value.warnings),
    reasonCode: normalizeText(value.reasonCode) || undefined,
  };
}

function projectNimiRuntimeLocalExecutionEntry(
  value: GeneratedLocalExecutionEntryDescriptor,
): NimiRuntimeLocalExecutionEntryDescriptor {
  return {
    entryId: normalizeText(value.entryId),
    kind: parseNimiRuntimeLocalExecutionEntryKind(value.kind) ?? 'model',
    capability: normalizeText(value.capability),
    required: Boolean(value.required),
    selected: Boolean(value.selected),
    preferred: Boolean(value.preferred),
    modelId: normalizeText(value.modelId) || undefined,
    repo: normalizeText(value.repo) || undefined,
    engine: normalizeText(value.engine) || undefined,
    serviceId: normalizeText(value.serviceId) || undefined,
    nodeId: normalizeText(value.nodeId) || undefined,
    reasonCode: normalizeText(value.reasonCode) || undefined,
    warnings: textList(value.warnings),
  };
}

function projectNimiRuntimeLocalPreflightDecision(
  value: GeneratedLocalPreflightDecision,
): NimiRuntimeLocalPreflightDecision {
  return {
    entryId: normalizeText(value.entryId),
    target: normalizeText(value.target),
    check: normalizeText(value.check),
    ok: Boolean(value.ok),
    reasonCode: normalizeText(value.reasonCode) || undefined,
    detail: normalizeText(value.detail) || undefined,
  };
}

function projectNimiRuntimeLocalExecutionStageResult(
  value: GeneratedLocalExecutionStageResult,
): NimiRuntimeLocalExecutionStageResult {
  return {
    stage: normalizeText(value.stage),
    ok: Boolean(value.ok),
    reasonCode: normalizeText(value.reasonCode) || undefined,
    detail: normalizeText(value.detail) || undefined,
  };
}

function projectNimiRuntimeLocalProfileRequirement(
  value: GeneratedLocalProfileRequirementDescriptor | undefined,
): NimiRuntimeLocalProfileRequirementDescriptor | undefined {
  if (!value) {
    return undefined;
  }
  return {
    minGpuMemoryGb: finiteNumber(value.minGpuMemoryGb),
    minDiskBytes: finiteNumber(value.minDiskBytes),
    platforms: textList(value.platforms),
    notes: textList(value.notes),
  };
}

function projectNimiRuntimeLocalUnregisteredAssetDeclaration(
  value: GeneratedLocalUnregisteredAssetDeclaration | undefined,
): NimiRuntimeLocalAssetDeclaration | undefined {
  if (!value) {
    return undefined;
  }
  const assetKind = parseNimiRuntimeLocalAssetKindId(value.assetKind);
  if (!assetKind) {
    return undefined;
  }
  return {
    assetKind,
    engine: normalizeText(value.engine) || undefined,
  };
}

export function projectNimiRuntimeLocalTransferAccepted(
  value: GeneratedLocalTransferSessionSummary,
): NimiRuntimeLocalTransferAccepted {
  return {
    installSessionId: normalizeText(value.installSessionId),
    modelId: normalizeText(value.assetId),
    localModelId: normalizeText(value.localAssetId),
    localAssetId: normalizeText(value.localAssetId),
  };
}

function emptyNimiRuntimeLocalExecutionPlan(
  planId: unknown,
  targetId: unknown,
): NimiRuntimeLocalExecutionPlan {
  return {
    planId: normalizeText(planId),
    targetId: normalizeText(targetId),
    deviceProfile: projectNimiRuntimeLocalDeviceProfile({} as GeneratedLocalDeviceProfile),
    entries: [],
    preflightDecisions: [],
    warnings: [],
  };
}

function emptyNimiRuntimeLocalExecutionApplyResult(
  planId: unknown,
  targetId: unknown,
): NimiRuntimeLocalExecutionApplyResult {
  return {
    planId: normalizeText(planId),
    targetId: normalizeText(targetId),
    entries: [],
    installedAssets: [],
    capabilities: [],
    stageResults: [],
    preflightDecisions: [],
    rollbackApplied: false,
    warnings: [],
  };
}
