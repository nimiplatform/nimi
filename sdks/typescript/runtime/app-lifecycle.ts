import {
  AppHealthRepairAction,
  AppInstallJobPhase,
  AppInstallJobState,
  AppInstallSourceKind,
  AppLifecycleJobKind,
  AppOpenFlowStep,
  AppOpenState,
  AppPackageReadinessState,
  AppStorageState,
  ReasonCode as RuntimeGeneratedReasonCode,
  type AppInstallJob,
  type AppInstallJobEvent,
  type AppInstallStorageProjection,
  type AppOpenProjection,
  type AppOpenScopeRef,
  type AppPackageReadinessProjection,
  type AppStorageProjection,
  type AppUninstallResult,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import type {
  NimiRuntimeAppHealthRepairAction,
  NimiRuntimeAppInstallJob,
  NimiRuntimeAppInstallJobEvent,
  NimiRuntimeAppInstallJobPhase,
  NimiRuntimeAppInstallJobState,
  NimiRuntimeAppInstallSourceKind,
  NimiRuntimeAppInstallStorage,
  NimiRuntimeAppInstallInput,
  NimiRuntimeAppLifecycleClient,
  NimiRuntimeAppLifecycleGeneratedClient,
  NimiRuntimeAppLifecycleJobKind,
  NimiRuntimeAppOpenFlowStep,
  NimiRuntimeAppOpenInput,
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
import { toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

export * from './app-lifecycle-types';

export function createNimiRuntimeAppLifecycleClient(input: {
  readonly client: NimiRuntimeAppLifecycleGeneratedClient;
}): NimiRuntimeAppLifecycleClient {
  const { client } = input;
  return {
    async install(installInput, options) {
      const appId = requireNimiRuntimeAppId(installInput?.appId);
      const response = await client.installApp({
        appId,
        confirmed: Boolean(installInput?.confirmed),
      }, options);
      return decodeNimiRuntimeAppInstallJob(response.job);
    },
    async uninstall(uninstallInput, options) {
      const appId = requireNimiRuntimeAppId(uninstallInput?.appId);
      const response = await client.uninstallApp({
        appId,
        deleteDurableData: Boolean(uninstallInput?.deleteDurableData),
        destructiveDataDeleteConfirmed: Boolean(uninstallInput?.destructiveDataDeleteConfirmed),
      }, options);
      return decodeNimiRuntimeAppUninstallResult(response.result, response.job);
    },
    async storage(storageInput, options) {
      const appId = requireNimiRuntimeAppId(storageInput?.appId);
      const response = await client.getAppStorage({ appId }, options);
      return decodeNimiRuntimeAppStorageProjection(response.projection);
    },
    async packageReadiness(readinessInput, options) {
      const appId = requireNimiRuntimeAppId(readinessInput?.appId);
      const response = await client.getAppPackageReadiness({ appId }, options);
      return decodeNimiRuntimeAppPackageReadinessProjection(response.projection);
    },
    async getJob(getInput, options) {
      const jobId = requireNimiRuntimeAppLifecycleJobId(getInput?.jobId);
      const response = await client.getAppInstallJob({ jobId }, options);
      return decodeNimiRuntimeAppInstallJob(response.job);
    },
    async listJobs(listInput, options) {
      const appId = normalizeNimiRuntimeAppLifecycleText(listInput?.appId);
      const response = await client.listAppInstallJobs({ appId }, options);
      return (response.jobs || []).map((job) => decodeNimiRuntimeAppInstallJob(job));
    },
    watchJobEvents(watchInput, options) {
      const jobId = normalizeNimiRuntimeAppLifecycleText(watchInput?.jobId);
      const raw = client.watchAppInstallJobEvents({ jobId }, options);
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAppInstallJobEvent> {
          for await (const event of raw) {
            yield decodeNimiRuntimeAppJobEvent(event);
          }
        },
      };
    },
    async update(updateInput, options) {
      const appId = requireNimiRuntimeAppId(updateInput?.appId);
      const response = await client.updateApp({
        appId,
        confirmed: Boolean(updateInput?.confirmed),
      }, options);
      return decodeNimiRuntimeAppInstallJob(response.job);
    },
    async healthRepair(repairInput, options) {
      const appId = requireNimiRuntimeAppId(repairInput?.appId);
      const response = await client.healthRepairApp({
        appId,
        action: toRuntimeGeneratedAppHealthRepairAction(repairInput?.action),
        jobId: normalizeNimiRuntimeAppLifecycleText(repairInput?.jobId),
      }, options);
      return decodeNimiRuntimeAppInstallJob(response.job);
    },
    async open(openInput, options) {
      const appId = requireNimiRuntimeAppId(openInput?.appId);
      const response = await client.openApp({
        appId,
        scope: toRuntimeGeneratedAppOpenScope(appId, openInput?.scope),
      }, options);
      return decodeNimiRuntimeAppOpenProjection(response.projection);
    },
  };
}

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
  const scope = decodeNimiRuntimeAppOpenScope(projection.scope);
  if (state === 'launched' && !scope) {
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
  return {
    appId,
    state,
    reachedStep: decodeNimiRuntimeAppOpenFlowStep(projection.reachedStep),
    launched: projection.launched,
    ...(activeVersion ? { activeVersion } : {}),
    ...(scope ? { scope } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
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

function toRuntimeGeneratedAppHealthRepairAction(value: unknown): AppHealthRepairAction {
  switch (value) {
    case 'cancel':
      return AppHealthRepairAction.CANCEL;
    case 'retry':
      return AppHealthRepairAction.RETRY;
    case 'repair':
      return AppHealthRepairAction.REPAIR;
    case 'reinstall':
      return AppHealthRepairAction.REINSTALL;
    default:
      throw createNimiError({
        message: `runtime.appLifecycle.healthRepair rejects action: ${String(value)}`,
        reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_REPAIR_ACTION_INVALID,
        actionHint: 'use_cancel_retry_repair_or_reinstall',
        source: 'sdk',
      });
  }
}

function toRuntimeGeneratedAppOpenScope(appId: string, scope: NimiRuntimeAppOpenScopeRef | undefined): AppOpenScopeRef {
  if (!scope || typeof scope !== 'object') {
    throw createNimiError({
      message: 'runtime.appLifecycle.open requires an explicit app-launch scope',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
      actionHint: 'pass_explicit_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  const ownerId = normalizeNimiRuntimeAppLifecycleText(scope.ownerId);
  const surfaceId = normalizeNimiRuntimeAppLifecycleText(scope.surfaceId);
  if (scope.kind !== 'app' || !ownerId || ownerId !== appId) {
    throw createNimiError({
      message: 'runtime.appLifecycle.open scope must be app-shaped with ownerId equal to appId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
      actionHint: 'use_canonical_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  return {
    kind: 'app',
    ownerId,
    surfaceId,
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

function decodeNimiRuntimeReasonCode(value: RuntimeGeneratedReasonCode): string | undefined {
  if (!Number.isInteger(value) || value === RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED) {
    return undefined;
  }
  const name = RuntimeGeneratedReasonCode[value];
  if (!name) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app lifecycle projection carries an unknown reason code: ${String(value)}`,
    );
  }
  return name;
}

function decodeNimiRuntimeAppInstallStorage(
  storage: AppInstallStorageProjection | undefined,
): NimiRuntimeAppInstallStorage {
  if (!storage) {
    return decodeNimiRuntimeAppLifecycleError('runtime app lifecycle projection is missing storage roots');
  }
  return {
    appRoot: requireNimiRuntimeAppLifecycleProjectionText(storage.appRoot, 'runtime app install storage appRoot'),
    releaseRoot: requireNimiRuntimeAppLifecycleProjectionText(
      storage.releaseRoot,
      'runtime app install storage releaseRoot',
    ),
    durableDataRoot: requireNimiRuntimeAppLifecycleProjectionText(
      storage.durableDataRoot,
      'runtime app install storage durableDataRoot',
    ),
    cacheRoot: requireNimiRuntimeAppLifecycleProjectionText(storage.cacheRoot, 'runtime app install storage cacheRoot'),
    tempRoot: requireNimiRuntimeAppLifecycleProjectionText(storage.tempRoot, 'runtime app install storage tempRoot'),
  };
}

function decodeNimiRuntimeAppArtifactBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app install job has invalid artifact bytes: ${String(value)}`,
    );
  }
  return parsed;
}

function decodeNimiRuntimeAppJobEventSequence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app install job event has an invalid sequence: ${String(value)}`,
    );
  }
  return parsed;
}

function requireNimiRuntimeAppId(value: unknown): string {
  const appId = normalizeNimiRuntimeAppLifecycleText(value);
  if (!appId) {
    throw createNimiError({
      message: 'runtime.appLifecycle requires a non-empty appId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_APP_ID_REQUIRED,
      actionHint: 'pass_admitted_nimi_app_id',
      source: 'sdk',
    });
  }
  return appId;
}

function requireNimiRuntimeAppLifecycleJobId(value: unknown): string {
  const jobId = normalizeNimiRuntimeAppLifecycleText(value);
  if (!jobId) {
    throw createNimiError({
      message: 'runtime.appLifecycle requires a non-empty jobId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_JOB_ID_REQUIRED,
      actionHint: 'pass_runtime_emitted_job_id',
      source: 'sdk',
    });
  }
  return jobId;
}

function requireNimiRuntimeAppLifecycleProjectionText(value: unknown, field: string): string {
  const normalized = normalizeNimiRuntimeAppLifecycleText(value);
  if (!normalized) {
    return decodeNimiRuntimeAppLifecycleError(`${field} is missing`);
  }
  return normalized;
}

function normalizeNimiRuntimeAppLifecycleText(value: unknown): string {
  return String(value || '').trim();
}

function decodeNimiRuntimeAppLifecycleError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_app_lifecycle_projection',
    source: 'runtime',
  });
}
