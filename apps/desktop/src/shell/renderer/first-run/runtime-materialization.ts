import { localRuntime, type LocalRuntimeEnvironmentDependencyJob, type LocalRuntimeEnvironmentPlanDependency, type LocalRuntimeFacade } from '../../../runtime/local-runtime/index.js';
import type { PlatformAIProfileFactoryRow } from '../../../runtime/platform-catalog/index.js';
import type { ProductControlState } from '../bridge/runtime-bridge.js';

export const FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE = 'desktop.first-run';

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

export type FirstRunMaterializationProductState = Extract<
  ProductControlState,
  | 'local_ai_profile_selected_assets_missing'
  | 'local_ai_profile_selected_environment_not_ready'
  | 'local_ai_assets_downloaded_environment_not_ready'
  | 'local_ai_ready'
  | 'repair_required'
  | 'blocked'
>;

export type FirstRunMaterializationDependencyProjection = {
  readonly packId: string;
  readonly dependency: LocalRuntimeEnvironmentPlanDependency;
  readonly job: LocalRuntimeEnvironmentDependencyJob | null;
};

export type FirstRunMaterializationProjection = {
  readonly status: FirstRunMaterializationStatus;
  readonly productState: FirstRunMaterializationProductState;
  readonly reason: string;
  readonly missingDependencyFamilies: readonly string[];
  readonly dependencies: readonly FirstRunMaterializationDependencyProjection[];
};

export type FirstRunMaterializationInput = {
  readonly profile: PlatformAIProfileFactoryRow;
  readonly runtimeDataRoot?: string | null;
  readonly runtime?: Pick<
    LocalRuntimeFacade,
    | 'resolveEnvironmentPlan'
    | 'listEnvironmentDependencyJobs'
    | 'resolveEnvironmentActivationGate'
    | 'startEnvironmentDependencyJob'
    | 'cancelEnvironmentDependencyJob'
    | 'retryEnvironmentDependencyJob'
    | 'repairEnvironmentDependency'
  >;
};

function normalizeState(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function latestJob(
  jobs: readonly LocalRuntimeEnvironmentDependencyJob[],
  dependency: LocalRuntimeEnvironmentPlanDependency,
): LocalRuntimeEnvironmentDependencyJob | null {
  return jobs
    .filter((job) =>
      job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId,
    )
    .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))[0] ?? null;
}

function dependencyReady(dependency: LocalRuntimeEnvironmentPlanDependency): boolean {
  const state = normalizeState(dependency.state);
  // Runtime materializer authority defines dependency readiness as verified
  // ready_system or ready_managed. A selected source record id or candidate
  // state is not readiness; the activation gate below remains final product
  // local_ai_ready evidence.
  return state === 'ready_system' || state === 'ready_managed';
}

function jobActive(job: LocalRuntimeEnvironmentDependencyJob | null): boolean {
  const state = normalizeState(job?.state);
  return state === 'needs_confirmation'
    || state === 'queued'
    || state === 'starting'
    || state === 'running'
    || state === 'in_progress'
    || state === 'downloading'
    || state === 'verifying'
    || state === 'installing';
}

function statusFor(
  missingDependencyFamilies: readonly string[],
  dependencies: readonly FirstRunMaterializationDependencyProjection[],
  activationReady: boolean,
): FirstRunMaterializationStatus {
  if (missingDependencyFamilies.length > 0 || dependencies.length === 0) return 'blocked';
  if (dependencies.some(({ dependency, job }) =>
    normalizeState(dependency.state) === 'unsupported' || normalizeState(job?.state) === 'unsupported',
  )) return 'unsupported';
  if (dependencies.some(({ dependency, job }) =>
    normalizeState(dependency.state) === 'repair_required' || normalizeState(job?.state) === 'repair_required',
  )) return 'repair_required';
  if (dependencies.some(({ job }) => normalizeState(job?.state) === 'failed')) return 'failed';
  if (dependencies.some(({ job }) => normalizeState(job?.state) === 'cancelled')) return 'cancelled';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency) && dependency.confirmationRequired && !job,
  )) return 'needs_confirmation';
  if (dependencies.some(({ job }) => jobActive(job))) return 'in_progress';
  if (dependencies.every(({ dependency }) => dependencyReady(dependency)) && activationReady) return 'local_ai_ready';
  return 'activation_pending';
}

export function productStateForMaterializationStatus(
  status: FirstRunMaterializationStatus,
): FirstRunMaterializationProductState {
  if (status === 'blocked' || status === 'unsupported') return 'blocked';
  if (status === 'failed' || status === 'repair_required' || status === 'cancelled') return 'repair_required';
  if (status === 'activation_pending') return 'local_ai_profile_selected_environment_not_ready';
  if (status === 'local_ai_ready') return 'local_ai_ready';
  return 'local_ai_profile_selected_assets_missing';
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

async function activationReadyForAllPacks(
  input: Required<Pick<FirstRunMaterializationInput, 'runtime'>> & FirstRunMaterializationInput,
  packIds: readonly string[],
): Promise<boolean> {
  if (packIds.length === 0) return false;
  const gates = await Promise.all(packIds.map((packId) =>
    input.runtime.resolveEnvironmentActivationGate({
      consumerId: FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
      packId,
      runtimeDataRoot: input.runtimeDataRoot || undefined,
    }),
  ));
  return gates.every((gate) => {
    const state = normalizeState(gate.state);
    return gate.blockingDependencies.length === 0 && state === 'ready';
  });
}

export async function resolveFirstRunMaterializationProjection(
  input: FirstRunMaterializationInput,
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  const packIds = unique(input.profile.localComputePackRefs);
  const requiredFamilies = unique(input.profile.dependencyFamilyRefs);
  const plans = await Promise.all(packIds.map((packId) =>
    runtime.resolveEnvironmentPlan({
      packId,
      consumerScope: FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
      runtimeDataRoot: input.runtimeDataRoot || undefined,
    }),
  ));
  const dependencyByKey = new Map<string, FirstRunMaterializationDependencyProjection>();
  for (const plan of plans) {
    for (const dependency of plan.dependencies) {
      if (!dependency.required || !requiredFamilies.includes(dependency.dependencyFamily)) continue;
      dependencyByKey.set(`${dependency.environmentKey}:${dependency.dependencyFamily}:${dependency.dependencyId}`, {
        packId: plan.packId,
        dependency,
        job: null,
      });
    }
  }
  const dependencies = await Promise.all(Array.from(dependencyByKey.values()).map(async (item) => {
    const jobs = await runtime.listEnvironmentDependencyJobs({ environmentKey: item.dependency.environmentKey });
    return { ...item, job: latestJob(jobs, item.dependency) };
  }));
  const foundFamilies = new Set(dependencies.map(({ dependency }) => dependency.dependencyFamily));
  const missingDependencyFamilies = requiredFamilies.filter((family) => !foundFamilies.has(family));
  const allDependenciesReady = dependencies.length > 0 && dependencies.every(({ dependency }) => dependencyReady(dependency));
  const activationReady = allDependenciesReady
    ? await activationReadyForAllPacks({ ...input, runtime }, packIds)
    : false;
  const status = statusFor(missingDependencyFamilies, dependencies, activationReady);
  return {
    status,
    productState: productStateForMaterializationStatus(status),
    reason: reasonForStatus(status, missingDependencyFamilies),
    missingDependencyFamilies,
    dependencies,
  };
}

export async function startFirstRunMaterialization(
  input: FirstRunMaterializationInput & { readonly confirmed: boolean },
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  const before = await resolveFirstRunMaterializationProjection({ ...input, runtime });
  if (input.profile.materializationConfirmationRequired && !input.confirmed) {
    return {
      ...before,
      status: 'needs_confirmation',
      productState: productStateForMaterializationStatus('needs_confirmation'),
      reason: 'materialization_requires_confirmation',
    };
  }
  const startable = before.dependencies.filter(({ dependency, job }) =>
    !dependencyReady(dependency)
    && !jobActive(job)
    && normalizeState(job?.state) !== 'failed'
    && normalizeState(job?.state) !== 'cancelled'
  );
  await Promise.all(startable.map(({ dependency }) =>
    runtime.startEnvironmentDependencyJob({
      environmentKey: dependency.environmentKey,
      dependencyFamily: dependency.dependencyFamily,
      dependencyId: dependency.dependencyId,
      sourceKind: dependency.sourceKind,
      confirmed: input.confirmed,
    }, { caller: 'core' }),
  ));
  const after = await resolveFirstRunMaterializationProjection({ ...input, runtime });
  return startable.length > 0
    ? {
        ...after,
        status: after.status === 'needs_confirmation' ? 'starting' : after.status,
        productState: productStateForMaterializationStatus(after.status === 'needs_confirmation' ? 'starting' : after.status),
        reason: 'runtime_materialization_jobs_started',
      }
    : after;
}

export async function cancelFirstRunMaterializationJob(
  input: FirstRunMaterializationInput & { readonly jobId: string },
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  await runtime.cancelEnvironmentDependencyJob({ jobId: input.jobId }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection({ ...input, runtime });
}

export async function retryFirstRunMaterializationJob(
  input: FirstRunMaterializationInput & { readonly jobId: string; readonly confirmed: boolean },
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  await runtime.retryEnvironmentDependencyJob({ jobId: input.jobId, confirmed: input.confirmed }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection({ ...input, runtime });
}

export async function repairFirstRunMaterializationDependency(
  input: FirstRunMaterializationInput & {
    readonly dependency: LocalRuntimeEnvironmentPlanDependency;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
  },
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  await runtime.repairEnvironmentDependency({
    environmentKey: input.dependency.environmentKey,
    dependencyFamily: input.dependency.dependencyFamily,
    dependencyId: input.dependency.dependencyId,
    confirmed: input.confirmed,
    reasonCode: input.reasonCode,
  }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection({ ...input, runtime });
}
