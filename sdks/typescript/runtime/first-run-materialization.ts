import type { NimiProductControlState } from './product-control-types';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeLocalEnvironmentPlanDependency,
  NimiRuntimeLocalWriteOptions,
} from './runtime-local-model-center';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  isNimiRuntimeLocalEnvironmentDependencyJobTransferringState,
  isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState,
  isNimiRuntimeLocalEnvironmentDependencyUnsupportedState,
} from './runtime-local-model-center';

export const NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE = 'first-run';

export type NimiFirstRunMaterializationStatus =
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

export type NimiFirstRunMaterializationProfile = {
  readonly localComputePackRefs: readonly string[];
  readonly dependencyFamilyRefs: readonly string[];
  readonly materializationConfirmationRequired: boolean;
};

export type NimiFirstRunMaterializationProductState = Extract<
  NimiProductControlState,
  | 'local_ai_profile_selected_assets_missing'
  | 'local_ai_profile_selected_environment_not_ready'
  | 'local_ai_assets_downloaded_environment_not_ready'
  | 'local_ai_ready'
  | 'repair_required'
  | 'blocked'
>;

export type NimiFirstRunMaterializationRuntime = {
  readonly resolveEnvironmentPlan: (input: {
    readonly packId: string;
    readonly consumerScope: string;
    readonly runtimeDataRoot?: string;
    readonly installLevel?: string;
  }) => Promise<NimiRuntimeLocalEnvironmentPlan>;
  readonly listEnvironmentDependencyJobs: (input: {
    readonly environmentKey: string;
  }) => Promise<readonly NimiRuntimeLocalEnvironmentDependencyJob[]>;
  readonly startEnvironmentDependencyJob: (input: {
    readonly environmentKey: string;
    readonly dependencyFamily: string;
    readonly dependencyId: string;
    readonly sourceKind: string;
    readonly confirmed: boolean;
    readonly consumerScope: string;
  }, options?: NimiRuntimeLocalWriteOptions) => Promise<unknown>;
  readonly cancelEnvironmentDependencyJob: (input: {
    readonly jobId: string;
  }, options?: NimiRuntimeLocalWriteOptions) => Promise<unknown>;
  readonly retryEnvironmentDependencyJob: (input: {
    readonly jobId: string;
    readonly confirmed: boolean;
  }, options?: NimiRuntimeLocalWriteOptions) => Promise<unknown>;
  readonly repairEnvironmentDependency: (input: {
    readonly environmentKey: string;
    readonly dependencyFamily: string;
    readonly dependencyId: string;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
    readonly consumerScope: string;
  }, options?: NimiRuntimeLocalWriteOptions) => Promise<unknown>;
};

export type NimiFirstRunMaterializationDependencyProjection = {
  readonly packId: string;
  readonly dependency: NimiRuntimeLocalEnvironmentPlanDependency;
  readonly job: NimiRuntimeLocalEnvironmentDependencyJob | null;
};

export type NimiFirstRunMaterializationBaseProjection = {
  readonly status: NimiFirstRunMaterializationStatus;
  readonly reason: string;
  readonly missingDependencyFamilies: readonly string[];
  readonly dependencies: readonly NimiFirstRunMaterializationDependencyProjection[];
};

export type NimiFirstRunMaterializationProjection = NimiFirstRunMaterializationBaseProjection & {
  readonly productState: NimiFirstRunMaterializationProductState;
};

export type NimiFirstRunMaterializationInput = {
  readonly profile: NimiFirstRunMaterializationProfile;
  readonly runtime: NimiFirstRunMaterializationRuntime;
  readonly runtimeDataRoot?: string | null;
  readonly installLevel?: string | null;
};

export type NimiFirstRunMaterializationDownloadProgress = {
  readonly bytesReceived: number;
  readonly bytesTotal: number;
  readonly percent: number | null;
  readonly speedBytesPerSec: number | null;
  readonly etaSeconds: number | null;
};

export function productStateForNimiFirstRunMaterializationStatus(
  status: NimiFirstRunMaterializationStatus,
): NimiFirstRunMaterializationProductState {
  if (status === 'blocked' || status === 'unsupported') return 'blocked';
  if (status === 'failed' || status === 'repair_required' || status === 'cancelled') {
    return 'local_ai_profile_selected_environment_not_ready';
  }
  if (status === 'activation_pending') return 'local_ai_profile_selected_environment_not_ready';
  if (status === 'local_ai_ready') return 'local_ai_ready';
  return 'local_ai_profile_selected_assets_missing';
}

export function aggregateNimiFirstRunMaterializationDownloadProgress(
  dependencies: readonly NimiFirstRunMaterializationDependencyProjection[],
): NimiFirstRunMaterializationDownloadProgress | null {
  const transferring = dependencies
    .map(({ job }) => job)
    .filter((job): job is NimiRuntimeLocalEnvironmentDependencyJob =>
      job !== null && isNimiRuntimeLocalEnvironmentDependencyJobTransferringState(job.state));
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

export function retryableInterruptedNimiFirstRunMaterializationJobs(
  projection: NimiFirstRunMaterializationProjection,
): readonly NimiRuntimeLocalEnvironmentDependencyJob[] {
  if (projection.status !== 'failed' && projection.status !== 'cancelled') return [];
  return projection.dependencies
    .filter(({ dependency }) => !dependencyReady(dependency))
    .map(({ job }) => job)
    .filter((job): job is NimiRuntimeLocalEnvironmentDependencyJob =>
      job !== null && isRetryableNimiFirstRunMaterializationFailure(job));
}

export function repairableNimiFirstRunMaterializationDependencies(
  projection: NimiFirstRunMaterializationProjection,
): readonly NimiFirstRunMaterializationDependencyProjection[] {
  if (projection.status !== 'repair_required') return [];
  return projection.dependencies.filter((item) => !dependencyReady(item.dependency) && dependencyRepairable(item));
}

export async function resolveNimiFirstRunMaterializationProjection(
  input: NimiFirstRunMaterializationInput,
): Promise<NimiFirstRunMaterializationProjection> {
  const packIds = unique(input.profile.localComputePackRefs);
  const requiredFamilies = unique(input.profile.dependencyFamilyRefs);
  const plans = await Promise.all(packIds.map((packId) =>
    input.runtime.resolveEnvironmentPlan({
      packId,
      consumerScope: NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
      runtimeDataRoot: input.runtimeDataRoot || undefined,
      installLevel: input.installLevel || undefined,
    }),
  ));
  const dependencyByKey = new Map<string, NimiFirstRunMaterializationDependencyProjection>();
  for (const plan of plans) {
    for (const dependency of plan.dependencies) {
      if (!dependencyInNimiFirstRunMaterializationScope(dependency, requiredFamilies)) continue;
      dependencyByKey.set(`${dependency.environmentKey}:${dependency.dependencyFamily}:${dependency.dependencyId}:${dependency.consumerScope}`, {
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
  const status = statusForNimiFirstRunMaterialization(missingDependencyFamilies, dependencies);
  return withProductState({
    status,
    reason: reasonForNimiFirstRunMaterializationStatus(status, missingDependencyFamilies),
    missingDependencyFamilies,
    dependencies,
  });
}

export async function startNimiFirstRunMaterialization(
  input: NimiFirstRunMaterializationInput & { readonly confirmed: boolean },
): Promise<NimiFirstRunMaterializationProjection> {
  const before = await resolveNimiFirstRunMaterializationProjection(input);
  if (input.profile.materializationConfirmationRequired && !input.confirmed) {
    return {
      ...before,
      status: 'needs_confirmation',
      reason: 'materialization_requires_confirmation',
    };
  }
  const startable = before.dependencies.filter(({ dependency, job }) => dependencyStartable(dependency, job));
  await startNimiFirstRunMaterializationDependencies(input, startable, input.confirmed);
  const after = await resolveNimiFirstRunMaterializationProjection(input);
  return startable.length > 0
    ? withProductState({
        ...after,
        status: after.status === 'needs_confirmation' ? 'starting' : after.status,
        reason: 'runtime_materialization_jobs_started',
      })
    : after;
}

export async function cancelNimiFirstRunMaterializationJob(
  input: NimiFirstRunMaterializationInput & { readonly jobId: string },
): Promise<NimiFirstRunMaterializationProjection> {
  await input.runtime.cancelEnvironmentDependencyJob({ jobId: input.jobId }, { caller: 'core' });
  return resolveNimiFirstRunMaterializationProjection(input);
}

export async function retryNimiFirstRunMaterializationJob(
  input: NimiFirstRunMaterializationInput & { readonly jobId: string; readonly confirmed: boolean },
): Promise<NimiFirstRunMaterializationProjection> {
  const before = await resolveNimiFirstRunMaterializationProjection(input);
  await startNimiFirstRunMaterializationDependencies(
    input,
    before.dependencies.filter(({ dependency, job }) => dependencyStartable(dependency, job)),
    input.confirmed,
  );
  await input.runtime.retryEnvironmentDependencyJob({ jobId: input.jobId, confirmed: input.confirmed }, { caller: 'core' });
  return resolveNimiFirstRunMaterializationProjection(input);
}

export async function repairNimiFirstRunMaterializationDependency(
  input: NimiFirstRunMaterializationInput & {
    readonly dependency: NimiRuntimeLocalEnvironmentPlanDependency;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
  },
): Promise<NimiFirstRunMaterializationProjection> {
  await input.runtime.repairEnvironmentDependency({
    environmentKey: input.dependency.environmentKey,
    dependencyFamily: input.dependency.dependencyFamily,
    dependencyId: input.dependency.dependencyId,
    confirmed: input.confirmed,
    reasonCode: input.reasonCode,
    consumerScope: input.dependency.consumerScope,
  }, { caller: 'core' });
  return resolveNimiFirstRunMaterializationProjection(input);
}

function withProductState(
  projection: NimiFirstRunMaterializationBaseProjection,
): NimiFirstRunMaterializationProjection {
  return {
    ...projection,
    productState: productStateForNimiFirstRunMaterializationStatus(projection.status),
  };
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function latestJob(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): NimiRuntimeLocalEnvironmentDependencyJob | null {
  return jobs
    .filter((job) =>
      job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId
      && job.consumerScope === dependency.consumerScope)
    .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))[0] ?? null;
}

function dependencyReady(dependency: NimiRuntimeLocalEnvironmentPlanDependency): boolean {
  return isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state);
}

function dependencyNeedsConfirmation(dependency: NimiRuntimeLocalEnvironmentPlanDependency): boolean {
  return isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState(dependency.state)
    && dependency.confirmationRequired === true;
}

function dependencyAwaitingStart(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
  job: NimiRuntimeLocalEnvironmentDependencyJob | null,
): boolean {
  if (dependencyReady(dependency) || !dependencyNeedsConfirmation(dependency)) return false;
  return job === null || isNimiRuntimeLocalEnvironmentDependencyReadyState(job.state);
}

function startNimiFirstRunMaterializationDependencies(
  input: NimiFirstRunMaterializationInput,
  dependencies: readonly NimiFirstRunMaterializationDependencyProjection[],
  confirmed: boolean,
): Promise<unknown[]> {
  return Promise.all(dependencies.map(({ dependency }) =>
    input.runtime.startEnvironmentDependencyJob({
      environmentKey: dependency.environmentKey,
      dependencyFamily: dependency.dependencyFamily,
      dependencyId: dependency.dependencyId,
      sourceKind: dependency.sourceKind,
      confirmed,
      consumerScope: dependency.consumerScope,
    }, { caller: 'core' }),
  ));
}

function jobActive(job: NimiRuntimeLocalEnvironmentDependencyJob | null): boolean {
  return Boolean(job)
    && (
      isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState(job?.state)
      || isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job?.state)
    );
}

function dependencyStartable(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
  job: NimiRuntimeLocalEnvironmentDependencyJob | null,
): boolean {
  if (jobActive(job)) return false;
  return dependencyAwaitingStart(dependency, job);
}

function dependencyInNimiFirstRunMaterializationScope(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
  profileDependencyFamilies: readonly string[],
): boolean {
  if (dependency.required) return true;
  return profileDependencyFamilies.includes(dependency.dependencyFamily);
}

function isRetryableNimiFirstRunMaterializationFailure(
  job: NimiRuntimeLocalEnvironmentDependencyJob,
): boolean {
  if (
    !isNimiRuntimeLocalEnvironmentDependencyJobFailedState(job.state)
    && !isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(job.state)
  ) return false;
  return job.retryable;
}

function statusForNimiFirstRunMaterialization(
  missingDependencyFamilies: readonly string[],
  dependencies: readonly NimiFirstRunMaterializationDependencyProjection[],
): NimiFirstRunMaterializationStatus {
  if (missingDependencyFamilies.length > 0 || dependencies.length === 0) return 'blocked';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency)
    && (
      isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(dependency.state)
      || isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(job?.state)
    ),
  )) return 'unsupported';
  if (dependencies.some((item) => !dependencyReady(item.dependency) && dependencyRepairable(item))) return 'repair_required';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency)
    && (
      isNimiRuntimeLocalEnvironmentDependencyJobFailedState(job?.state)
      || isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(job?.state)
      || isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(dependency.state)
    ),
  )) return 'failed';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency) && isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(job?.state),
  )) return 'cancelled';
  if (dependencies.some(({ dependency, job }) =>
    dependencyAwaitingStart(dependency, job),
  )) return 'needs_confirmation';
  if (dependencies.some(({ job }) => jobActive(job))) return 'in_progress';
  if (dependencies.every(({ dependency }) => dependencyReady(dependency))) return 'local_ai_ready';
  return 'activation_pending';
}

function dependencyRepairable(item: NimiFirstRunMaterializationDependencyProjection): boolean {
  const selectedSourceRecordId = item.dependency.selectedSourceRecordId || item.job?.selectedSourceRecordId || '';
  if (!selectedSourceRecordId.trim()) return false;
  return isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(item.dependency.state)
    || isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(item.job?.state);
}

function reasonForNimiFirstRunMaterializationStatus(
  status: NimiFirstRunMaterializationStatus,
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
