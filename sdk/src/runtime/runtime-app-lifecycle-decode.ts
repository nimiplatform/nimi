import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import { toIsoFromTimestamp } from './helpers.js';
import {
  AppInstallJobPhase as ProtoAppInstallJobPhase,
  AppInstallJobState as ProtoAppInstallJobState,
  AppInstallSourceKind as ProtoAppInstallSourceKind,
  AppLifecycleJobKind as ProtoAppLifecycleJobKind,
  AppOpenFlowStep as ProtoAppOpenFlowStep,
  AppOpenState as ProtoAppOpenState,
  AppPackageReadinessState as ProtoAppPackageReadinessState,
  AppStorageState as ProtoAppStorageState,
} from './generated/runtime/v1/app.js';
import type {
  AppInstallJob as ProtoAppInstallJob,
  AppInstallJobEvent as ProtoAppInstallJobEvent,
  AppInstallStorageProjection as ProtoAppInstallStorageProjection,
  AppOpenProjection as ProtoAppOpenProjection,
  AppOpenScopeRef as ProtoAppOpenScopeRef,
  AppPackageReadinessProjection as ProtoAppPackageReadinessProjection,
  AppStorageProjection as ProtoAppStorageProjection,
  AppUninstallResult as ProtoAppUninstallResult,
} from './generated/runtime/v1/app.js';
import { ReasonCode as RuntimeReasonCode } from './generated/runtime/v1/common.js';
import type {
  RuntimeAppInstallJob,
  RuntimeAppInstallJobEvent,
  RuntimeAppInstallJobPhase,
  RuntimeAppInstallJobState,
  RuntimeAppInstallSourceKind,
  RuntimeAppInstallStorage,
  RuntimeAppLifecycleJobKind,
  RuntimeAppOpenFlowStep,
  RuntimeAppOpenProjection,
  RuntimeAppOpenScopeRef,
  RuntimeAppOpenState,
  RuntimeAppPackageReadinessProjection,
  RuntimeAppPackageReadinessState,
  RuntimeAppStorageProjection,
  RuntimeAppStorageState,
  RuntimeAppUninstallResult,
} from './runtime-app-lifecycle-types.js';

// ── Proto → typed decode (fail-closed) ─────────────────────────────────

function decodeError(message: string, reasonCode: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint: 'check_runtime_app_lifecycle_projection',
    source: 'runtime',
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function decodePhase(value: ProtoAppInstallJobPhase): RuntimeAppInstallJobPhase {
  switch (value) {
    case ProtoAppInstallJobPhase.QUEUED:
      return 'queued';
    case ProtoAppInstallJobPhase.RESOLVE_DESCRIPTOR:
      return 'resolve_descriptor';
    case ProtoAppInstallJobPhase.DOWNLOAD:
      return 'download';
    case ProtoAppInstallJobPhase.VERIFY:
      return 'verify';
    case ProtoAppInstallJobPhase.MATERIALIZE:
      return 'materialize';
    case ProtoAppInstallJobPhase.UNPACK:
      return 'unpack';
    case ProtoAppInstallJobPhase.EVIDENCE:
      return 'evidence';
    case ProtoAppInstallJobPhase.INSTALLED:
      return 'installed';
    case ProtoAppInstallJobPhase.SWAP:
      return 'swap';
    case ProtoAppInstallJobPhase.FAILED:
      return 'failed';
    case ProtoAppInstallJobPhase.CANCELLED:
      return 'cancelled';
    case ProtoAppInstallJobPhase.UNINSTALLED:
      return 'uninstalled';
    default:
      return decodeError(
        `runtime app install job has unspecified phase: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

function decodeState(value: ProtoAppInstallJobState): RuntimeAppInstallJobState {
  switch (value) {
    case ProtoAppInstallJobState.QUEUED:
      return 'queued';
    case ProtoAppInstallJobState.IN_PROGRESS:
      return 'in_progress';
    case ProtoAppInstallJobState.INSTALLED:
      return 'installed';
    case ProtoAppInstallJobState.FAILED:
      return 'failed';
    case ProtoAppInstallJobState.CANCELLED:
      return 'cancelled';
    case ProtoAppInstallJobState.UNINSTALLED:
      return 'uninstalled';
    default:
      return decodeError(
        `runtime app install job has unspecified state: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

function decodeKind(value: ProtoAppLifecycleJobKind): RuntimeAppLifecycleJobKind {
  switch (value) {
    case ProtoAppLifecycleJobKind.INSTALL:
      return 'install';
    case ProtoAppLifecycleJobKind.UPDATE:
      return 'update';
    case ProtoAppLifecycleJobKind.REPAIR:
      return 'repair';
    case ProtoAppLifecycleJobKind.UNINSTALL:
      return 'uninstall';
    default:
      return decodeError(
        `runtime app install job has unspecified kind: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

function decodeSourceKind(
  value: ProtoAppInstallSourceKind,
): RuntimeAppInstallSourceKind {
  switch (value) {
    case ProtoAppInstallSourceKind.BUNDLED:
      return 'bundled';
    case ProtoAppInstallSourceKind.EXTERNAL_ARTIFACT:
      return 'external_artifact';
    default:
      return decodeError(
        `runtime app install job has unspecified source kind: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

/**
 * Map a runtime-owned numeric `ReasonCode` to its stable string name. An
 * unknown / unspecified code fail-closes — it is never collapsed silently.
 */
function decodeReasonCode(value: number): string | undefined {
  if (!Number.isFinite(value) || value === RuntimeReasonCode.REASON_CODE_UNSPECIFIED) {
    return undefined;
  }
  const name = RuntimeReasonCode[value as RuntimeReasonCode];
  if (!name) {
    return decodeError(
      `runtime app lifecycle job carries an unknown reason code: ${String(value)}`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return String(name).trim();
}

function decodeStorage(
  storage: ProtoAppInstallStorageProjection | undefined,
): RuntimeAppInstallStorage {
  if (!storage) {
    return decodeError(
      'runtime app lifecycle projection is missing the storage roots',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return {
    appRoot: storage.appRoot,
    releaseRoot: storage.releaseRoot,
    durableDataRoot: storage.durableDataRoot,
    cacheRoot: storage.cacheRoot,
    tempRoot: storage.tempRoot,
  };
}

function decodeStorageState(value: ProtoAppStorageState): RuntimeAppStorageState {
  switch (value) {
    case ProtoAppStorageState.READY:
      return 'ready';
    case ProtoAppStorageState.INSTALL_REQUIRED:
      return 'install_required';
    case ProtoAppStorageState.REPAIR_REQUIRED:
      return 'repair_required';
    case ProtoAppStorageState.STORAGE_UNAVAILABLE:
      return 'storage_unavailable';
    default:
      return decodeError(
        `runtime app storage projection has an unspecified state: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

export function decodeStorageProjection(
  projection: ProtoAppStorageProjection | undefined,
): RuntimeAppStorageProjection {
  if (!projection) {
    return decodeError(
      'runtime app storage response is missing the storage projection',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const appId = optionalString(projection.appId);
  if (!appId) {
    return decodeError(
      'runtime app storage projection is missing an app id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const state = decodeStorageState(projection.state);
  const reasonCode = decodeReasonCode(projection.reasonCode as unknown as number);
  if ((state === 'repair_required' || state === 'storage_unavailable') && !reasonCode) {
    return decodeError(
      `runtime app storage projection ${appId} is ${state} without a typed reason code`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return {
    appId,
    state,
    appRoot: projection.appRoot,
    ...(optionalString(projection.activeReleaseRoot)
      ? { activeReleaseRoot: optionalString(projection.activeReleaseRoot) }
      : {}),
    durableDataRoot: projection.durableDataRoot,
    cacheRoot: projection.cacheRoot,
    tempRoot: projection.tempRoot,
    ...(optionalString(projection.activeVersion)
      ? { activeVersion: optionalString(projection.activeVersion) }
      : {}),
    storagePolicyRef: projection.storagePolicyRef,
    ...(reasonCode ? { reasonCode } : {}),
    ...(optionalString(projection.detail) ? { detail: optionalString(projection.detail) } : {}),
  };
}

function decodePackageReadinessState(value: ProtoAppPackageReadinessState): RuntimeAppPackageReadinessState {
  switch (value) {
    case ProtoAppPackageReadinessState.READY:
      return 'ready';
    case ProtoAppPackageReadinessState.INSTALL_REQUIRED:
      return 'install_required';
    case ProtoAppPackageReadinessState.UPDATE_REQUIRED:
      return 'update_required';
    case ProtoAppPackageReadinessState.REPAIR_REQUIRED:
      return 'repair_required';
    case ProtoAppPackageReadinessState.BLOCKED:
      return 'blocked';
    default:
      return decodeError(
        `runtime app package readiness projection has an unspecified state: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

export function decodePackageReadinessProjection(
  projection: ProtoAppPackageReadinessProjection | undefined,
): RuntimeAppPackageReadinessProjection {
  if (!projection) {
    return decodeError(
      'runtime app package readiness response is missing the projection',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const appId = optionalString(projection.appId);
  if (!appId) {
    return decodeError(
      'runtime app package readiness projection is missing an app id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const state = decodePackageReadinessState(projection.state);
  const reasonCode = decodeReasonCode(projection.reasonCode as unknown as number);
  if ((state === 'repair_required' || state === 'blocked') && !reasonCode) {
    return decodeError(
      `runtime app package readiness projection ${appId} is ${state} without a typed reason code`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return {
    appId,
    releaseDescriptorRef: projection.releaseDescriptorRef,
    storagePolicyRef: projection.storagePolicyRef,
    expectedVersion: projection.expectedVersion,
    ...(optionalString(projection.activeVersion)
      ? { activeVersion: optionalString(projection.activeVersion) }
      : {}),
    ...(optionalString(projection.installedVersion)
      ? { installedVersion: optionalString(projection.installedVersion) }
      : {}),
    ...(optionalString(projection.sha256) ? { sha256: optionalString(projection.sha256) } : {}),
    ...(optionalString(projection.verificationState)
      ? { verificationState: optionalString(projection.verificationState) }
      : {}),
    state,
    ...(reasonCode ? { reasonCode } : {}),
    ...(optionalString(projection.detail) ? { detail: optionalString(projection.detail) } : {}),
  };
}

function toBytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSequence(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return decodeError(
      `runtime app install job event has an invalid sequence: ${String(value)}`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return parsed;
}

/**
 * Decode a proto `AppInstallJob` into the typed projection. A missing job
 * fail-closes — the consumer never receives a synthesized placeholder.
 */
export function decodeAppInstallJob(
  job: ProtoAppInstallJob | undefined,
): RuntimeAppInstallJob {
  if (!job) {
    return decodeError(
      'runtime app lifecycle response is missing the job projection',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const jobId = optionalString(job.jobId);
  if (!jobId) {
    return decodeError(
      'runtime app install job is missing a job id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const appId = optionalString(job.appId);
  if (!appId) {
    return decodeError(
      'runtime app install job is missing an app id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const state = decodeState(job.state);
  const reasonCode = decodeReasonCode(job.reasonCode as unknown as number);
  // A failed / cancelled job must always carry a typed reason code so the
  // consumer never has to invent one — fail-close if the runtime omits it.
  if ((state === 'failed' || state === 'cancelled') && !reasonCode) {
    return decodeError(
      `runtime app install job ${jobId} is ${state} without a typed reason code`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return {
    jobId,
    appId,
    kind: decodeKind(job.kind),
    releaseDescriptorRef: job.releaseDescriptorRef,
    installedVersion: job.installedVersion,
    ...(optionalString(job.previousVersion)
      ? { previousVersion: optionalString(job.previousVersion) }
      : {}),
    state,
    phase: decodePhase(job.phase),
    sourceKind: decodeSourceKind(job.sourceKind),
    ...(optionalString(job.sha256) ? { sha256: optionalString(job.sha256) } : {}),
    artifactBytes: toBytes(job.artifactBytes),
    storage: decodeStorage(job.storage),
    ...(reasonCode ? { reasonCode } : {}),
    ...(optionalString(job.failureDetail)
      ? { failureDetail: optionalString(job.failureDetail) }
      : {}),
    retryable: job.retryable,
    ...(optionalString(job.createdAt) ? { createdAt: optionalString(job.createdAt) } : {}),
    ...(optionalString(job.updatedAt) ? { updatedAt: optionalString(job.updatedAt) } : {}),
  };
}

export function decodeUninstallResult(
  result: ProtoAppUninstallResult | undefined,
  jobProjection: ProtoAppInstallJob | undefined,
): RuntimeAppUninstallResult {
  if (!result) {
    return decodeError(
      'runtime uninstall response is missing the result projection',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const appId = optionalString(result.appId);
  if (!appId) {
    return decodeError(
      'runtime uninstall result is missing an app id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const reasonCode = decodeReasonCode(result.reasonCode as unknown as number);
  // The uninstall response carries the watchable uninstall lifecycle job
  // (K-APP-017) — the single live-job truth source for the `uninstalling`
  // card state. A missing job fail-closes; it is never synthesized.
  const job = decodeAppInstallJob(jobProjection);
  return {
    appId,
    releaseRemoved: result.releaseRemoved,
    durableDataRemoved: result.durableDataRemoved,
    storage: decodeStorage(result.storage),
    ...(reasonCode ? { reasonCode } : {}),
    job,
  };
}

function decodeOpenFlowStep(
  value: ProtoAppOpenFlowStep,
): RuntimeAppOpenFlowStep {
  switch (value) {
    case ProtoAppOpenFlowStep.RESOLVE_REGISTRY:
      return 'resolve_registry';
    case ProtoAppOpenFlowStep.VERIFY_PACKAGE:
      return 'verify_package';
    case ProtoAppOpenFlowStep.VERIFY_LIBRARY:
      return 'verify_library';
    case ProtoAppOpenFlowStep.VERIFY_APP_DATA:
      return 'verify_app_data';
    case ProtoAppOpenFlowStep.VERIFY_PERMISSIONS:
      return 'verify_permissions';
    case ProtoAppOpenFlowStep.ENSURE_AICONFIG:
      return 'ensure_aiconfig';
    case ProtoAppOpenFlowStep.VALIDATE_MANIFEST:
      return 'validate_manifest';
    case ProtoAppOpenFlowStep.LAUNCH:
      return 'launch';
    default:
      return decodeError(
        `runtime app open projection has an unspecified flow step: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

function decodeOpenState(value: ProtoAppOpenState): RuntimeAppOpenState {
  switch (value) {
    case ProtoAppOpenState.LAUNCHED:
      return 'launched';
    case ProtoAppOpenState.BLOCKED:
      return 'blocked';
    default:
      return decodeError(
        `runtime app open projection has an unspecified state: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

function decodeOpenScope(
  scope: ProtoAppOpenScopeRef | undefined,
): RuntimeAppOpenScopeRef | undefined {
  if (!scope) return undefined;
  const ownerId = optionalString(scope.ownerId);
  if (scope.kind !== 'app' || !ownerId) {
    return decodeError(
      'runtime app open projection carries a non-canonical app-launch scope',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const surfaceId = optionalString(scope.surfaceId);
  return {
    kind: 'app',
    ownerId,
    ...(surfaceId ? { surfaceId } : {}),
  };
}

/**
 * Decode a proto `AppOpenProjection` into the typed projection. A `blocked`
 * open must always carry a typed reason code so the consumer never has to
 * invent one — fail-close if the runtime omits it.
 */
export function decodeOpenProjection(
  projection: ProtoAppOpenProjection | undefined,
): RuntimeAppOpenProjection {
  if (!projection) {
    return decodeError(
      'runtime open response is missing the open projection',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const appId = optionalString(projection.appId);
  if (!appId) {
    return decodeError(
      'runtime app open projection is missing an app id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const state = decodeOpenState(projection.state);
  const reasonCode = decodeReasonCode(projection.reasonCode as unknown as number);
  if (state === 'blocked' && !reasonCode) {
    return decodeError(
      `runtime app open projection for ${appId} is blocked without a typed reason code`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const activeVersion = optionalString(projection.activeVersion);
  const detail = optionalString(projection.detail);
  const scope = decodeOpenScope(projection.scope);
  return {
    appId,
    state,
    reachedStep: decodeOpenFlowStep(projection.reachedStep),
    launched: projection.launched,
    ...(activeVersion ? { activeVersion } : {}),
    ...(scope ? { scope } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function decodeJobEvent(
  event: ProtoAppInstallJobEvent,
): RuntimeAppInstallJobEvent {
  const timestamp = toIsoFromTimestamp(event.timestamp);
  return {
    sequence: toSequence(event.sequence),
    job: decodeAppInstallJob(event.job),
    ...(timestamp ? { timestamp } : {}),
  };
}
