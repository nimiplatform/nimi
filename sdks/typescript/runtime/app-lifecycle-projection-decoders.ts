import {
  AppInstallJobPhase,
  AppInstallJobState,
  AppInstallSourceKind,
  AppLifecycleJobKind,
  AppOpenFlowStep,
  AppOpenState,
  AppPackageReadinessState,
  AppStorageState,
  type AppInstallJob,
  type AppInstallJobEvent,
  type AppOpenProjection,
  type AppOpenScopeRef,
  type AppPackageReadinessProjection,
  type AppStorageProjection,
  type AppUninstallResult,
} from '../core-generated/runtime-typed-client';
import type {
  NimiRuntimeAppInstallJob,
  NimiRuntimeAppInstallJobEvent,
  NimiRuntimeAppInstallJobPhase,
  NimiRuntimeAppInstallJobState,
  NimiRuntimeAppInstallSourceKind,
  NimiRuntimeAppLifecycleJobKind,
  NimiRuntimeAppOpenFlowStep,
  NimiRuntimeAppOpenProjection,
  NimiRuntimeAppOpenScopeRef,
  NimiRuntimeAppOpenState,
  NimiRuntimeAppPackageReadinessProjection,
  NimiRuntimeAppPackageReadinessState,
  NimiRuntimeAppUninstallResult,
} from './app-lifecycle-types';
import type {
  NimiRuntimeAppStorageProjection,
  NimiRuntimeAppStorageState,
} from './app-storage';
import {
  decodeNimiRuntimeAppArtifactBytes,
  decodeNimiRuntimeAppInstallStorage,
  decodeNimiRuntimeAppJobEventSequence,
  decodeNimiRuntimeAppLifecycleError,
  decodeNimiRuntimeReasonCode,
  normalizeNimiRuntimeAppLifecycleText,
  requireNimiRuntimeAppLifecycleProjectionText,
} from './app-lifecycle-decoder-utils';
import { toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

export function decodeNimiRuntimeAppStorageProjection(
  projection: AppStorageProjection | undefined,
): NimiRuntimeAppStorageProjection {
  if (!projection) {
    return decodeNimiRuntimeAppLifecycleError('runtime app storage response is missing the storage projection');
  }
  const appId = requireNimiRuntimeAppLifecycleProjectionText(projection.appId, 'runtime app storage projection appId');
  const state = decodeNimiRuntimeAppStorageState(projection.state);
  const reasonCode = decodeNimiRuntimeReasonCode(projection.reasonCode);
  if ((state === 'repair_required' || state === 'storage_unavailable') && !reasonCode) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app storage projection ${appId} is ${state} without a typed reason code`,
    );
  }
  const activeReleaseRoot = normalizeNimiRuntimeAppLifecycleText(projection.activeReleaseRoot);
  const activeVersion = normalizeNimiRuntimeAppLifecycleText(projection.activeVersion);
  const detail = normalizeNimiRuntimeAppLifecycleText(projection.detail);
  return {
    appId,
    state,
    appRoot: requireNimiRuntimeAppLifecycleProjectionText(projection.appRoot, 'runtime app storage projection appRoot'),
    ...(activeReleaseRoot ? { activeReleaseRoot } : {}),
    durableDataRoot: requireNimiRuntimeAppLifecycleProjectionText(
      projection.durableDataRoot,
      'runtime app storage projection durableDataRoot',
    ),
    cacheRoot: requireNimiRuntimeAppLifecycleProjectionText(
      projection.cacheRoot,
      'runtime app storage projection cacheRoot',
    ),
    tempRoot: requireNimiRuntimeAppLifecycleProjectionText(
      projection.tempRoot,
      'runtime app storage projection tempRoot',
    ),
    ...(activeVersion ? { activeVersion } : {}),
    storagePolicyRef: requireNimiRuntimeAppLifecycleProjectionText(
      projection.storagePolicyRef,
      'runtime app storage projection storagePolicyRef',
    ),
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function decodeNimiRuntimeAppPackageReadinessProjection(
  projection: AppPackageReadinessProjection | undefined,
): NimiRuntimeAppPackageReadinessProjection {
  if (!projection) {
    return decodeNimiRuntimeAppLifecycleError('runtime app package readiness response is missing the projection');
  }
  const appId = requireNimiRuntimeAppLifecycleProjectionText(
    projection.appId,
    'runtime app package readiness projection appId',
  );
  const state = decodeNimiRuntimeAppPackageReadinessState(projection.state);
  const reasonCode = decodeNimiRuntimeReasonCode(projection.reasonCode);
  if ((state === 'repair_required' || state === 'blocked') && !reasonCode) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app package readiness projection ${appId} is ${state} without a typed reason code`,
    );
  }
  const activeVersion = normalizeNimiRuntimeAppLifecycleText(projection.activeVersion);
  const installedVersion = normalizeNimiRuntimeAppLifecycleText(projection.installedVersion);
  const sha256 = normalizeNimiRuntimeAppLifecycleText(projection.sha256);
  const verificationState = normalizeNimiRuntimeAppLifecycleText(projection.verificationState);
  const detail = normalizeNimiRuntimeAppLifecycleText(projection.detail);
  return {
    appId,
    releaseDescriptorRef: requireNimiRuntimeAppLifecycleProjectionText(
      projection.releaseDescriptorRef,
      'runtime app package readiness projection releaseDescriptorRef',
    ),
    storagePolicyRef: requireNimiRuntimeAppLifecycleProjectionText(
      projection.storagePolicyRef,
      'runtime app package readiness projection storagePolicyRef',
    ),
    expectedVersion: requireNimiRuntimeAppLifecycleProjectionText(
      projection.expectedVersion,
      'runtime app package readiness projection expectedVersion',
    ),
    ...(activeVersion ? { activeVersion } : {}),
    ...(installedVersion ? { installedVersion } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(verificationState ? { verificationState } : {}),
    state,
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function decodeNimiRuntimeAppInstallJob(job: AppInstallJob | undefined): NimiRuntimeAppInstallJob {
  if (!job) {
    return decodeNimiRuntimeAppLifecycleError('runtime app lifecycle response is missing the job projection');
  }
  const jobId = requireNimiRuntimeAppLifecycleProjectionText(job.jobId, 'runtime app install job jobId');
  const appId = requireNimiRuntimeAppLifecycleProjectionText(job.appId, 'runtime app install job appId');
  const state = decodeNimiRuntimeAppInstallJobState(job.state);
  const reasonCode = decodeNimiRuntimeReasonCode(job.reasonCode);
  if ((state === 'failed' || state === 'cancelled') && !reasonCode) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app install job ${jobId} is ${state} without a typed reason code`,
    );
  }
  const previousVersion = normalizeNimiRuntimeAppLifecycleText(job.previousVersion);
  const sha256 = normalizeNimiRuntimeAppLifecycleText(job.sha256);
  const failureDetail = normalizeNimiRuntimeAppLifecycleText(job.failureDetail);
  const createdAt = normalizeNimiRuntimeAppLifecycleText(job.createdAt);
  const updatedAt = normalizeNimiRuntimeAppLifecycleText(job.updatedAt);
  return {
    jobId,
    appId,
    kind: decodeNimiRuntimeAppLifecycleJobKind(job.kind),
    releaseDescriptorRef: requireNimiRuntimeAppLifecycleProjectionText(
      job.releaseDescriptorRef,
      'runtime app install job releaseDescriptorRef',
    ),
    installedVersion: requireNimiRuntimeAppLifecycleProjectionText(
      job.installedVersion,
      'runtime app install job installedVersion',
    ),
    ...(previousVersion ? { previousVersion } : {}),
    state,
    phase: decodeNimiRuntimeAppInstallJobPhase(job.phase),
    sourceKind: decodeNimiRuntimeAppInstallSourceKind(job.sourceKind),
    ...(sha256 ? { sha256 } : {}),
    artifactBytes: decodeNimiRuntimeAppArtifactBytes(job.artifactBytes),
    storage: decodeNimiRuntimeAppInstallStorage(job.storage),
    ...(reasonCode ? { reasonCode } : {}),
    ...(failureDetail ? { failureDetail } : {}),
    retryable: Boolean(job.retryable),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function decodeNimiRuntimeAppUninstallResult(
  result: AppUninstallResult | undefined,
  jobProjection: AppInstallJob | undefined,
): NimiRuntimeAppUninstallResult {
  if (!result) {
    return decodeNimiRuntimeAppLifecycleError('runtime uninstall response is missing the result projection');
  }
  const reasonCode = decodeNimiRuntimeReasonCode(result.reasonCode);
  return {
    appId: requireNimiRuntimeAppLifecycleProjectionText(result.appId, 'runtime app uninstall result appId'),
    releaseRemoved: Boolean(result.releaseRemoved),
    durableDataRemoved: Boolean(result.durableDataRemoved),
    storage: decodeNimiRuntimeAppInstallStorage(result.storage),
    ...(reasonCode ? { reasonCode } : {}),
    job: decodeNimiRuntimeAppInstallJob(jobProjection),
  };
}

export function decodeNimiRuntimeAppOpenProjection(
  projection: AppOpenProjection | undefined,
): NimiRuntimeAppOpenProjection {
  if (!projection) {
    return decodeNimiRuntimeAppLifecycleError('runtime open response is missing the open projection');
  }
  const appId = requireNimiRuntimeAppLifecycleProjectionText(projection.appId, 'runtime app open projection appId');
  const state = decodeNimiRuntimeAppOpenState(projection.state);
  const reasonCode = decodeNimiRuntimeReasonCode(projection.reasonCode);
  if (state === 'blocked' && !reasonCode) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection for ${appId} is blocked without a typed reason code`,
    );
  }
  if (state === 'launched' && projection.launched !== true) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection for ${appId} is launched but launched=false`,
    );
  }
  if (state === 'blocked' && projection.launched === true) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection for ${appId} is blocked but launched=true`,
    );
  }
  if (state === 'launch_prepared' && projection.launched === true) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection for ${appId} is launch-prepared but launched=true`,
    );
  }
  const scope = decodeNimiRuntimeAppOpenScope(projection.scope);
  if ((state === 'launched' || state === 'launch_prepared') && !scope) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection for ${appId} launched without an app-launch scope`,
    );
  }
  if (scope && scope.ownerId !== appId) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection scope owner ${scope.ownerId} does not match app ${appId}`,
    );
  }
  const activeVersion = normalizeNimiRuntimeAppLifecycleText(projection.activeVersion);
  const detail = normalizeNimiRuntimeAppLifecycleText(projection.detail);
  const releaseDescriptorRef = normalizeNimiRuntimeAppLifecycleText(projection.releaseDescriptorRef);
  const descriptorClass = normalizeNimiRuntimeAppLifecycleText(projection.descriptorClass);
  const admissionTrack = normalizeNimiRuntimeAppLifecycleText(projection.admissionTrack);
  const sourceKind = normalizeNimiRuntimeAppLifecycleText(projection.sourceKind);
  const ordinaryVisibility = normalizeNimiRuntimeAppLifecycleText(projection.ordinaryVisibility);
  const digestVerificationState = normalizeNimiRuntimeAppLifecycleText(projection.digestVerificationState);
  const runtimeEntryRef = normalizeNimiRuntimeAppLifecycleText(projection.runtimeEntryRef);
  const activeReleaseRoot = normalizeNimiRuntimeAppLifecycleText(projection.activeReleaseRoot);
  const shellCapabilitySetRef = normalizeNimiRuntimeAppLifecycleText(projection.shellCapabilitySetRef);
  const callerMode = normalizeNimiRuntimeAppLifecycleText(projection.callerMode);
  if (projection.launchId !== undefined && !(projection.launchId instanceof Uint8Array)) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection for ${appId} carries a malformed launch id`,
    );
  }
  const launchId = projection.launchId && projection.launchId.length > 0
    ? Uint8Array.from(projection.launchId)
    : undefined;
  if (launchId && launchId.length !== 32) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection for ${appId} launch id must contain exactly 32 bytes`,
    );
  }
  if (state === 'launch_prepared' && !launchId) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app open projection for ${appId} is launch-prepared without a launch id`,
    );
  }
  return {
    appId,
    state,
    reachedStep: decodeNimiRuntimeAppOpenFlowStep(projection.reachedStep),
    launched: projection.launched,
    ...(activeVersion ? { activeVersion } : {}),
    ...(scope ? { scope } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
    ...(releaseDescriptorRef ? { releaseDescriptorRef } : {}),
    ...(descriptorClass ? { descriptorClass } : {}),
    ...(admissionTrack ? { admissionTrack } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(ordinaryVisibility ? { ordinaryVisibility } : {}),
    ...(digestVerificationState ? { digestVerificationState } : {}),
    ...(runtimeEntryRef ? { runtimeEntryRef } : {}),
    ...(activeReleaseRoot ? { activeReleaseRoot } : {}),
    ...(projection.storage ? { storage: decodeNimiRuntimeAppInstallStorage(projection.storage) } : {}),
    ...(shellCapabilitySetRef ? { shellCapabilitySetRef } : {}),
    ...(callerMode ? { callerMode } : {}),
    ...(launchId ? { launchId } : {}),
    ...(releaseDescriptorRef ? { productReadinessClaimAllowed: Boolean(projection.productReadinessClaimAllowed) } : {}),
  };
}

export function decodeNimiRuntimeAppJobEvent(event: AppInstallJobEvent): NimiRuntimeAppInstallJobEvent {
  const timestamp = toNimiRuntimeIsoFromTimestamp(event.timestamp);
  return {
    sequence: decodeNimiRuntimeAppJobEventSequence(event.sequence),
    job: decodeNimiRuntimeAppInstallJob(event.job),
    ...(timestamp ? { timestamp } : {}),
  };
}

function decodeNimiRuntimeAppInstallJobPhase(value: AppInstallJobPhase): NimiRuntimeAppInstallJobPhase {
  switch (value) {
    case AppInstallJobPhase.QUEUED:
      return 'queued';
    case AppInstallJobPhase.RESOLVE_DESCRIPTOR:
      return 'resolve_descriptor';
    case AppInstallJobPhase.DOWNLOAD:
      return 'download';
    case AppInstallJobPhase.VERIFY:
      return 'verify';
    case AppInstallJobPhase.MATERIALIZE:
      return 'materialize';
    case AppInstallJobPhase.UNPACK:
      return 'unpack';
    case AppInstallJobPhase.EVIDENCE:
      return 'evidence';
    case AppInstallJobPhase.INSTALLED:
      return 'installed';
    case AppInstallJobPhase.SWAP:
      return 'swap';
    case AppInstallJobPhase.FAILED:
      return 'failed';
    case AppInstallJobPhase.CANCELLED:
      return 'cancelled';
    case AppInstallJobPhase.UNINSTALLED:
      return 'uninstalled';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app install job has unspecified phase: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAppInstallJobState(value: AppInstallJobState): NimiRuntimeAppInstallJobState {
  switch (value) {
    case AppInstallJobState.QUEUED:
      return 'queued';
    case AppInstallJobState.IN_PROGRESS:
      return 'in_progress';
    case AppInstallJobState.INSTALLED:
      return 'installed';
    case AppInstallJobState.FAILED:
      return 'failed';
    case AppInstallJobState.CANCELLED:
      return 'cancelled';
    case AppInstallJobState.UNINSTALLED:
      return 'uninstalled';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app install job has unspecified state: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAppLifecycleJobKind(value: AppLifecycleJobKind): NimiRuntimeAppLifecycleJobKind {
  switch (value) {
    case AppLifecycleJobKind.INSTALL:
      return 'install';
    case AppLifecycleJobKind.UPDATE:
      return 'update';
    case AppLifecycleJobKind.REPAIR:
      return 'repair';
    case AppLifecycleJobKind.UNINSTALL:
      return 'uninstall';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app install job has unspecified kind: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAppInstallSourceKind(value: AppInstallSourceKind): NimiRuntimeAppInstallSourceKind {
  switch (value) {
    case AppInstallSourceKind.BUNDLED:
      return 'bundled';
    case AppInstallSourceKind.EXTERNAL_ARTIFACT:
      return 'external_artifact';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app install job has unspecified source kind: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAppStorageState(value: AppStorageState): NimiRuntimeAppStorageState {
  switch (value) {
    case AppStorageState.READY:
      return 'ready';
    case AppStorageState.INSTALL_REQUIRED:
      return 'install_required';
    case AppStorageState.REPAIR_REQUIRED:
      return 'repair_required';
    case AppStorageState.STORAGE_UNAVAILABLE:
      return 'storage_unavailable';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app storage projection has an unspecified state: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAppPackageReadinessState(
  value: AppPackageReadinessState,
): NimiRuntimeAppPackageReadinessState {
  switch (value) {
    case AppPackageReadinessState.READY:
      return 'ready';
    case AppPackageReadinessState.INSTALL_REQUIRED:
      return 'install_required';
    case AppPackageReadinessState.UPDATE_REQUIRED:
      return 'update_required';
    case AppPackageReadinessState.REPAIR_REQUIRED:
      return 'repair_required';
    case AppPackageReadinessState.BLOCKED:
      return 'blocked';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app package readiness projection has an unspecified state: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAppOpenFlowStep(value: AppOpenFlowStep): NimiRuntimeAppOpenFlowStep {
  switch (value) {
    case AppOpenFlowStep.RESOLVE_REGISTRY:
      return 'resolve_registry';
    case AppOpenFlowStep.VERIFY_PACKAGE:
      return 'verify_package';
    case AppOpenFlowStep.VERIFY_LIBRARY:
      return 'verify_library';
    case AppOpenFlowStep.VERIFY_APP_DATA:
      return 'verify_app_data';
    case AppOpenFlowStep.VERIFY_PERMISSIONS:
      return 'verify_permissions';
    case AppOpenFlowStep.ENSURE_AICONFIG:
      return 'ensure_aiconfig';
    case AppOpenFlowStep.VALIDATE_MANIFEST:
      return 'validate_manifest';
    case AppOpenFlowStep.LAUNCH:
      return 'launch';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app open projection has an unspecified flow step: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAppOpenState(value: AppOpenState): NimiRuntimeAppOpenState {
  switch (value) {
    case AppOpenState.LAUNCHED:
      return 'launched';
    case AppOpenState.BLOCKED:
      return 'blocked';
    case AppOpenState.LAUNCH_PREPARED:
      return 'launch_prepared';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app open projection has an unspecified state: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAppOpenScope(scope: AppOpenScopeRef | undefined): NimiRuntimeAppOpenScopeRef | undefined {
  if (!scope) {
    return undefined;
  }
  const ownerId = normalizeNimiRuntimeAppLifecycleText(scope.ownerId);
  const surfaceId = normalizeNimiRuntimeAppLifecycleText(scope.surfaceId);
  if (scope.kind !== 'app' || !ownerId) {
    return decodeNimiRuntimeAppLifecycleError(
      'runtime app open projection carries a non-canonical app-launch scope',
    );
  }
  return {
    kind: 'app',
    ownerId,
    ...(surfaceId ? { surfaceId } : {}),
  };
}
