import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanInput,
  type NimiRuntimeLocalEnvironmentPlanDependency,
  type NimiRuntimeLocalEnvironmentClient,
} from '@nimiplatform/sdk/runtime';

export function latestEnvironmentDependencyJob(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): NimiRuntimeLocalEnvironmentDependencyJob | undefined {
  return jobs
    .filter((job) => job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId
      && (job.consumerScope === dependency.consumerScope
        || dependency.dependencyFamily === 'accelerator.cuda.runtime'
          && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(dependency.state)
          && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function hasRuntimeOwnedCapabilityConfirmation(plan: NimiRuntimeLocalEnvironmentPlan): boolean {
  const confirmedFamilies = new Set(plan.requiredDependencyFamilies);
  return plan.noSystemMutation
    && plan.requiredDependencyFamilies.length > 0
    && plan.dependencies.every((dependency) => !dependency.required || confirmedFamilies.has(dependency.dependencyFamily))
    && plan.storageCategories.length > 0
    && plan.sourceOwners.length > 0;
}

export function canApplyRuntimeEnvironmentPlan(
  plan: NimiRuntimeLocalEnvironmentPlan,
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
): boolean {
  if (!hasRuntimeOwnedCapabilityConfirmation(plan) || plan.state === 'unsupported') return false;
  return plan.dependencies.some((dependency) => {
    if (!dependency.required || isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state)) return false;
    if (dependency.dependencyFamily === 'accelerator.cuda.runtime' && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(dependency.state)) return false;
    const job = latestEnvironmentDependencyJob(jobs, dependency);
    return !job || !isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state);
  });
}

export function projectRuntimeEnvironmentState(
  plan: NimiRuntimeLocalEnvironmentPlan,
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
): {
  readonly state: 'ready' | 'active' | 'attention' | 'unsupported';
  readonly requiredCount: number;
  readonly attentionCount: number;
  readonly activeJobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
} {
  const required = plan.dependencies.filter((dependency) => dependency.required);
  const activeJobs = required.flatMap((dependency) => {
    const job = latestEnvironmentDependencyJob(jobs, dependency);
    return job && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state) ? [job] : [];
  });
  const attentionCount = required.filter(
    (dependency) => !isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state),
  ).length;
  const state = plan.state === 'unsupported'
    ? 'unsupported'
    : activeJobs.length > 0 || required.some(dependency => isNimiRuntimeLocalEnvironmentDependencyJobActiveState(dependency.state))
      ? 'active'
      : attentionCount > 0
        ? 'attention'
        : 'ready';
  return Object.freeze({ state, requiredCount: required.length, attentionCount, activeJobs: Object.freeze(activeJobs) });
}

export function runtimeEnvironmentConfirmation(
  plan: NimiRuntimeLocalEnvironmentPlan,
): {
  readonly families: string;
  readonly aggregateSizeKnown: boolean;
  readonly aggregateSizeBytes: number;
  readonly storageCategories: string;
  readonly sourceOwners: string;
  readonly noSystemMutation: boolean;
} {
  return {
    families: plan.requiredDependencyFamilies.join(', '),
    aggregateSizeKnown: plan.aggregateSizeKnown,
    aggregateSizeBytes: plan.aggregateSizeBytes,
    storageCategories: plan.storageCategories.join(', '),
    sourceOwners: plan.sourceOwners.join(', '),
    noSystemMutation: plan.noSystemMutation,
  };
}

export async function applyRuntimeEnvironmentPlan(
  localEnvironment: Pick<NimiRuntimeLocalEnvironmentClient, 'applyEnvironmentPlan'>,
  resolution: NimiRuntimeLocalEnvironmentPlanInput,
  plan: NimiRuntimeLocalEnvironmentPlan,
) {
  return localEnvironment.applyEnvironmentPlan({
    resolution,
    expectedPlanId: plan.planId,
    confirmed: true,
  }, { caller: 'core' });
}


/** Only an active job bound by the current plan may be cancelled here. */
export async function cancelRuntimeEnvironmentDependencyJob(
  client: Pick<NimiRuntimeLocalEnvironmentClient, 'cancelEnvironmentDependencyJob'>,
  plan: NimiRuntimeLocalEnvironmentPlan,
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  jobId: string,
) {
  const admitted = plan.dependencies.some((dependency) => {
    const job = latestEnvironmentDependencyJob(jobs, dependency);
    return job?.jobId === jobId && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state);
  });
  if (!admitted) throw new Error('LOCAL_ENVIRONMENT_JOB_OUTSIDE_CONFIGURATION');
  return client.cancelEnvironmentDependencyJob({ jobId }, { caller: 'core' });
}
