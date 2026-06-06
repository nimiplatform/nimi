import type {
  LocalRuntimeEnvironmentDependencyJobProjection,
  LocalRuntimeEnvironmentPlanDependencyProjection,
  LocalRuntimeEnvironmentPlanProjection,
} from './local-environment-dependency-states.js';
import type { LocalRuntimeWriteOptions } from './local-runtime-client/types.js';
import type { ProductControlState } from '../product-control.js';
import {
  isLocalRuntimeEnvironmentDependencyJobActiveState,
  isLocalRuntimeEnvironmentDependencyJobCancelledState,
  isLocalRuntimeEnvironmentDependencyJobFailedState,
  isLocalRuntimeEnvironmentDependencyJobTransferringState,
  isLocalRuntimeEnvironmentDependencyNeedsConfirmationState,
  isLocalRuntimeEnvironmentDependencyReadyState,
  isLocalRuntimeEnvironmentDependencyRepairRequiredState,
  isLocalRuntimeEnvironmentDependencyUnsupportedState,
} from './local-environment-dependency-states.js';

export const FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE = 'first-run';

export type FirstRunMaterializationStatus =
  | 'needs_confirmation'
  | 'starting'
  | 'in_progress'
  | 'activation_pending'
  | 'local_ai_ready'
  | 'repair_required'
  | 'failed'
  | 'cancelled'
  | 'unsupported'
  | 'blocked';

export type FirstRunMaterializationProfile = {
  readonly localComputePackRefs: readonly string[];
  readonly dependencyFamilyRefs: readonly string[];
  readonly materializationConfirmationRequired: boolean;
};

export type FirstRunMaterializationProductState = Extract<
  ProductControlState,
  | 'local_ai_profile_selected_assets_missing'
  | 'local_ai_profile_selected_environment_not_ready'
  | 'local_ai_assets_downloaded_environment_not_ready'
  | 'local_ai_ready'
  | 'repair_required'
  | 'blocked'
>;

export type FirstRunMaterializationRuntime = {
  readonly resolveEnvironmentPlan: (input: {
    readonly packId: string;
    readonly consumerScope: string;
    readonly runtimeDataRoot?: string;
    readonly installLevel?: string;
  }) => Promise<LocalRuntimeEnvironmentPlanProjection>;
  readonly listEnvironmentDependencyJobs: (input: {
    readonly environmentKey: string;
  }) => Promise<readonly LocalRuntimeEnvironmentDependencyJobProjection[]>;
  readonly startEnvironmentDependencyJob: (input: {
    readonly environmentKey: string;
    readonly dependencyFamily: string;
    readonly dependencyId: string;
    readonly sourceKind: string;
    readonly confirmed: boolean;
  }, options?: LocalRuntimeWriteOptions) => Promise<unknown>;
  readonly cancelEnvironmentDependencyJob: (input: {
    readonly jobId: string;
  }, options?: LocalRuntimeWriteOptions) => Promise<unknown>;
  readonly retryEnvironmentDependencyJob: (input: {
    readonly jobId: string;
    readonly confirmed: boolean;
  }, options?: LocalRuntimeWriteOptions) => Promise<unknown>;
  readonly repairEnvironmentDependency: (input: {
    readonly environmentKey: string;
    readonly dependencyFamily: string;
    readonly dependencyId: string;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
  }, options?: LocalRuntimeWriteOptions) => Promise<unknown>;
};

export type FirstRunMaterializationDependencyProjection = {
  readonly packId: string;
  readonly dependency: LocalRuntimeEnvironmentPlanDependencyProjection;
  readonly job: LocalRuntimeEnvironmentDependencyJobProjection | null;
};

export type FirstRunMaterializationBaseProjection = {
  readonly status: FirstRunMaterializationStatus;
  readonly reason: string;
  readonly missingDependencyFamilies: readonly string[];
  readonly dependencies: readonly FirstRunMaterializationDependencyProjection[];
};

export type FirstRunMaterializationProjection = FirstRunMaterializationBaseProjection & {
  readonly productState: FirstRunMaterializationProductState;
};

export type FirstRunMaterializationInput = {
  readonly profile: FirstRunMaterializationProfile;
  readonly runtime: FirstRunMaterializationRuntime;
  readonly runtimeDataRoot?: string | null;
  readonly installLevel?: string | null;
};

export function productStateForMaterializationStatus(
  status: FirstRunMaterializationStatus,
): FirstRunMaterializationProductState {
  if (status === 'blocked' || status === 'unsupported') return 'blocked';
  if (status === 'failed' || status === 'repair_required' || status === 'cancelled') {
    return 'local_ai_profile_selected_environment_not_ready';
  }
  if (status === 'activation_pending') return 'local_ai_profile_selected_environment_not_ready';
  if (status === 'local_ai_ready') return 'local_ai_ready';
  return 'local_ai_profile_selected_assets_missing';
}

function withProductState(
  projection: FirstRunMaterializationBaseProjection,
): FirstRunMaterializationProjection {
  return {
    ...projection,
    productState: productStateForMaterializationStatus(projection.status),
  };
}

function normalizeState(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function latestJob(
  jobs: readonly LocalRuntimeEnvironmentDependencyJobProjection[],
  dependency: LocalRuntimeEnvironmentPlanDependencyProjection,
): LocalRuntimeEnvironmentDependencyJobProjection | null {
  return jobs
    .filter((job) =>
      job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId)
    .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))[0] ?? null;
}

function dependencyReady(dependency: LocalRuntimeEnvironmentPlanDependencyProjection): boolean {
  return isLocalRuntimeEnvironmentDependencyReadyState(dependency.state);
}

function dependencyNeedsConfirmation(dependency: LocalRuntimeEnvironmentPlanDependencyProjection): boolean {
  return isLocalRuntimeEnvironmentDependencyNeedsConfirmationState(dependency.state)
    && dependency.confirmationRequired === true;
}

function jobActive(job: LocalRuntimeEnvironmentDependencyJobProjection | null): boolean {
  return Boolean(job)
    && (
      isLocalRuntimeEnvironmentDependencyNeedsConfirmationState(job?.state)
      || isLocalRuntimeEnvironmentDependencyJobActiveState(job?.state)
    );
}

function dependencyStartable(
  dependency: LocalRuntimeEnvironmentPlanDependencyProjection,
  job: LocalRuntimeEnvironmentDependencyJobProjection | null,
): boolean {
  if (dependencyReady(dependency) || !dependencyNeedsConfirmation(dependency) || jobActive(job)) return false;
  return !job;
}

export type FirstRunMaterializationDownloadProgress = {
  readonly bytesReceived: number;
  readonly bytesTotal: number;
  readonly percent: number | null;
  readonly speedBytesPerSec: number | null;
  readonly etaSeconds: number | null;
};

export function aggregateMaterializationDownloadProgress(
  dependencies: readonly FirstRunMaterializationDependencyProjection[],
): FirstRunMaterializationDownloadProgress | null {
  const transferring = dependencies
    .map(({ job }) => job)
    .filter((job): job is LocalRuntimeEnvironmentDependencyJobProjection =>
      job !== null && isLocalRuntimeEnvironmentDependencyJobTransferringState(job.state));
  if (transferring.length === 0) return null;

  let bytesReceived = 0;
  let bytesTotal = 0;
  let speed = 0;
  let speedKnown = false;
  let knownTotalCount = 0;
  for (const job of transferring) {
    const received = Math.max(0, Number(job.bytesReceived) || 0);
    const total = Math.max(0, Number(job.bytesTotal) || 0);
    bytesReceived += received;
    if (total > 0) {
      bytesTotal += total;
      knownTotalCount += 1;
    }
    const jobSpeed = Math.max(0, Number(job.speedBytesPerSec) || 0);
    if (jobSpeed > 0) {
      speed += jobSpeed;
      speedKnown = true;
    }
  }
  const percent = knownTotalCount === transferring.length && bytesTotal > 0
    ? Math.min(100, Math.round((bytesReceived / bytesTotal) * 100))
    : null;
  const speedBytesPerSec = speedKnown ? speed : null;
  const etaSeconds = percent !== null && speedBytesPerSec !== null && bytesReceived < bytesTotal
    ? Math.max(0, Math.round((bytesTotal - bytesReceived) / speedBytesPerSec))
    : null;
  return { bytesReceived, bytesTotal, percent, speedBytesPerSec, etaSeconds };
}

function statusFor(
  missingDependencyFamilies: readonly string[],
  dependencies: readonly FirstRunMaterializationDependencyProjection[],
): FirstRunMaterializationStatus {
  if (missingDependencyFamilies.length > 0 || dependencies.length === 0) return 'blocked';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency)
    && (
      isLocalRuntimeEnvironmentDependencyUnsupportedState(dependency.state)
      || isLocalRuntimeEnvironmentDependencyUnsupportedState(job?.state)
    ),
  )) return 'unsupported';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency)
    && (
      isLocalRuntimeEnvironmentDependencyRepairRequiredState(dependency.state)
      || isLocalRuntimeEnvironmentDependencyRepairRequiredState(job?.state)
    ),
  )) return 'repair_required';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency) && isLocalRuntimeEnvironmentDependencyJobFailedState(job?.state),
  )) return 'failed';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency) && isLocalRuntimeEnvironmentDependencyJobCancelledState(job?.state),
  )) return 'cancelled';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency) && dependencyNeedsConfirmation(dependency) && !job,
  )) return 'needs_confirmation';
  if (dependencies.some(({ job }) => jobActive(job))) return 'in_progress';
  if (dependencies.every(({ dependency }) => dependencyReady(dependency))) return 'local_ai_ready';
  return 'activation_pending';
}

function dependencyInMaterializationScope(
  dependency: LocalRuntimeEnvironmentPlanDependencyProjection,
  profileDependencyFamilies: readonly string[],
): boolean {
  if (dependency.required) return true;
  return profileDependencyFamilies.includes(dependency.dependencyFamily);
}

function isAutoRecoverableMaterializationFailure(job: LocalRuntimeEnvironmentDependencyJobProjection): boolean {
  if (
    !isLocalRuntimeEnvironmentDependencyJobFailedState(job.state)
    && !isLocalRuntimeEnvironmentDependencyJobCancelledState(job.state)
  ) return false;
  if (!job.retryable) return false;
  return normalizeState(job.recoveryDisposition) === 'auto_retry_transient';
}

export function retryableInterruptedFirstRunMaterializationJobs(
  projection: FirstRunMaterializationProjection,
): readonly LocalRuntimeEnvironmentDependencyJobProjection[] {
  if (projection.status !== 'failed' && projection.status !== 'cancelled') return [];
  return projection.dependencies
    .filter(({ dependency }) => !dependencyReady(dependency))
    .map(({ job }) => job)
    .filter((job): job is LocalRuntimeEnvironmentDependencyJobProjection =>
      job !== null && isAutoRecoverableMaterializationFailure(job));
}

export function repairableFirstRunMaterializationDependencies(
  projection: FirstRunMaterializationProjection,
): readonly FirstRunMaterializationDependencyProjection[] {
  if (projection.status !== 'repair_required') return [];
  return projection.dependencies.filter(({ dependency, job }) =>
    !dependencyReady(dependency)
    && (
      isLocalRuntimeEnvironmentDependencyRepairRequiredState(dependency.state)
      || isLocalRuntimeEnvironmentDependencyRepairRequiredState(job?.state)
    ));
}

function reasonForStatus(
  status: FirstRunMaterializationStatus,
  missingDependencyFamilies: readonly string[],
): string {
  if (missingDependencyFamilies.length > 0) {
    return `missing_dependency_families:${missingDependencyFamilies.join(',')}`;
  }
  switch (status) {
    case 'needs_confirmation': return 'materialization_requires_confirmation';
    case 'starting': return 'runtime_materialization_jobs_started';
    case 'in_progress': return 'runtime_materialization_jobs_in_progress';
    case 'activation_pending': return 'runtime_activation_gate_not_ready';
    case 'local_ai_ready': return 'runtime_local_ai_ready_evidence_projected';
    case 'repair_required': return 'runtime_materialization_repair_required';
    case 'failed': return 'runtime_materialization_job_failed';
    case 'cancelled': return 'runtime_materialization_job_cancelled';
    case 'unsupported': return 'runtime_materialization_unsupported';
    case 'blocked': return 'runtime_materialization_blocked';
  }
}

export async function resolveFirstRunMaterializationProjection(
  input: FirstRunMaterializationInput,
): Promise<FirstRunMaterializationProjection> {
  const packIds = unique(input.profile.localComputePackRefs);
  const requiredFamilies = unique(input.profile.dependencyFamilyRefs);
  const plans = await Promise.all(packIds.map((packId) =>
    input.runtime.resolveEnvironmentPlan({
      packId,
      consumerScope: FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
      runtimeDataRoot: input.runtimeDataRoot || undefined,
      installLevel: input.installLevel || undefined,
    }),
  ));
  const dependencyByKey = new Map<string, FirstRunMaterializationDependencyProjection>();
  for (const plan of plans) {
    for (const dependency of plan.dependencies) {
      if (!dependencyInMaterializationScope(dependency, requiredFamilies)) continue;
      dependencyByKey.set(`${dependency.environmentKey}:${dependency.dependencyFamily}:${dependency.dependencyId}`, {
        packId: plan.packId,
        dependency,
        job: null,
      });
    }
  }
  const dependencies = await Promise.all(Array.from(dependencyByKey.values()).map(async (item) => {
    const jobs = await input.runtime.listEnvironmentDependencyJobs({ environmentKey: item.dependency.environmentKey });
    return { ...item, job: latestJob(jobs, item.dependency) };
  }));
  const foundFamilies = new Set(dependencies.map(({ dependency }) => dependency.dependencyFamily));
  const missingDependencyFamilies = requiredFamilies.filter((family) => !foundFamilies.has(family));
  const status = statusFor(missingDependencyFamilies, dependencies);
  return withProductState({
    status,
    reason: reasonForStatus(status, missingDependencyFamilies),
    missingDependencyFamilies,
    dependencies,
  });
}

export async function startFirstRunMaterialization(
  input: FirstRunMaterializationInput & { readonly confirmed: boolean },
): Promise<FirstRunMaterializationProjection> {
  const before = await resolveFirstRunMaterializationProjection(input);
  if (input.profile.materializationConfirmationRequired && !input.confirmed) {
    return {
      ...before,
      status: 'needs_confirmation',
      reason: 'materialization_requires_confirmation',
    };
  }
  const startable = before.dependencies.filter(({ dependency, job }) => dependencyStartable(dependency, job));
  await Promise.all(startable.map(({ dependency }) =>
    input.runtime.startEnvironmentDependencyJob({
      environmentKey: dependency.environmentKey,
      dependencyFamily: dependency.dependencyFamily,
      dependencyId: dependency.dependencyId,
      sourceKind: dependency.sourceKind,
      confirmed: input.confirmed,
    }, { caller: 'core' }),
  ));
  const after = await resolveFirstRunMaterializationProjection(input);
  return startable.length > 0
    ? withProductState({
        ...after,
        status: after.status === 'needs_confirmation' ? 'starting' : after.status,
        reason: 'runtime_materialization_jobs_started',
      })
    : after;
}

export async function cancelFirstRunMaterializationJob(
  input: FirstRunMaterializationInput & { readonly jobId: string },
): Promise<FirstRunMaterializationProjection> {
  await input.runtime.cancelEnvironmentDependencyJob({ jobId: input.jobId }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection(input);
}

export async function retryFirstRunMaterializationJob(
  input: FirstRunMaterializationInput & { readonly jobId: string; readonly confirmed: boolean },
): Promise<FirstRunMaterializationProjection> {
  await input.runtime.retryEnvironmentDependencyJob({ jobId: input.jobId, confirmed: input.confirmed }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection(input);
}

export async function repairFirstRunMaterializationDependency(
  input: FirstRunMaterializationInput & {
    readonly dependency: LocalRuntimeEnvironmentPlanDependencyProjection;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
  },
): Promise<FirstRunMaterializationProjection> {
  await input.runtime.repairEnvironmentDependency({
    environmentKey: input.dependency.environmentKey,
    dependencyFamily: input.dependency.dependencyFamily,
    dependencyId: input.dependency.dependencyId,
    confirmed: input.confirmed,
    reasonCode: input.reasonCode,
  }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection(input);
}
