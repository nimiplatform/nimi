import type { NimiProductControlState } from '../bridge';
import {
  cancelNimiFirstRunMaterializationJob,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  repairNimiFirstRunMaterializationDependency,
  repairableNimiFirstRunMaterializationDependencies,
  resolveNimiFirstRunMaterializationProjection,
  retryableInterruptedNimiFirstRunMaterializationJobs,
  retryNimiFirstRunMaterializationJob,
  startNimiFirstRunMaterialization,
  type NimiFirstRunMaterializationInput,
  type NimiFirstRunMaterializationProjection,
  type NimiFirstRunMaterializationRuntime,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';

export type {
  NimiFirstRunMaterializationDependencyProjection,
  NimiFirstRunMaterializationDownloadProgress,
  NimiFirstRunMaterializationProductState,
  NimiFirstRunMaterializationProjection,
  NimiFirstRunMaterializationStatus,
} from '@nimiplatform/sdk/runtime';
export { productStateForNimiFirstRunMaterializationStatus } from '@nimiplatform/sdk/runtime';

export type DesktopNimiFirstRunMaterializationInput = NimiFirstRunMaterializationInput & {
  readonly runtime: NimiFirstRunMaterializationRuntime;
};

export function shouldResumeConfirmedNimiFirstRunMaterialization(
  productState: NimiProductControlState,
  projection: NimiFirstRunMaterializationProjection,
): boolean {
  if (projection.status !== 'needs_confirmation') return false;
  return productState === 'local_ai_profile_selected_assets_missing'
    || productState === 'local_ai_profile_selected_environment_not_ready'
    || productState === 'local_ai_assets_downloaded_environment_not_ready'
    || productState === 'local_ai_ready';
}

function isConfirmedNimiFirstRunSetupState(productState: NimiProductControlState): boolean {
  return productState === 'local_ai_profile_selected_assets_missing'
    || productState === 'local_ai_profile_selected_environment_not_ready'
    || productState === 'local_ai_assets_downloaded_environment_not_ready'
    || productState === 'local_ai_ready';
}

export function retryableInterruptedNimiFirstRunMaterializationJobsForProductState(
  productState: NimiProductControlState,
  projection: NimiFirstRunMaterializationProjection,
) {
  if (!isConfirmedNimiFirstRunSetupState(productState)) return [];
  if (projection.status !== 'failed' && projection.status !== 'cancelled') return [];
  return projection.dependencies
    .map(({ job }) => job)
    .filter((job): job is NimiRuntimeLocalEnvironmentDependencyJob =>
      job !== null
      && job.retryable
      && job.recoveryDisposition === 'auto_retry_transient'
      && (
        isNimiRuntimeLocalEnvironmentDependencyJobFailedState(job.state)
        || isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(job.state)
      ));
}

export function repairableConfirmedNimiFirstRunMaterializationDependencies(
  productState: NimiProductControlState,
  projection: NimiFirstRunMaterializationProjection,
) {
  if (!isConfirmedNimiFirstRunSetupState(productState)) return [];
  return repairableNimiFirstRunMaterializationDependencies(projection);
}

function materializationDependencyIdentity(
  job: NimiRuntimeLocalEnvironmentDependencyJob,
): string {
  return [
    job.environmentKey,
    job.dependencyFamily,
    job.dependencyId,
    job.consumerScope,
  ].join('|');
}

export async function retryAllInterruptedNimiFirstRunMaterializationJobs(
  projection: NimiFirstRunMaterializationProjection,
  retryJob: (
    jobId: string,
  ) => Promise<NimiFirstRunMaterializationProjection>,
): Promise<NimiFirstRunMaterializationProjection> {
  let current = projection;
  const attemptedDependencies = new Set<string>();

  while (true) {
    const job = retryableInterruptedNimiFirstRunMaterializationJobs(current)
      .find((candidate) =>
        !attemptedDependencies.has(materializationDependencyIdentity(candidate)));
    if (!job) return current;

    attemptedDependencies.add(materializationDependencyIdentity(job));
    current = await retryJob(job.jobId);
  }
}

export async function resolveDesktopNimiFirstRunMaterializationProjection(
  input: DesktopNimiFirstRunMaterializationInput,
): Promise<NimiFirstRunMaterializationProjection> {
  return resolveNimiFirstRunMaterializationProjection({
    ...input,
  });
}

export async function startDesktopNimiFirstRunMaterialization(
  input: DesktopNimiFirstRunMaterializationInput & { readonly confirmed: boolean },
): Promise<NimiFirstRunMaterializationProjection> {
  return startNimiFirstRunMaterialization({
    ...input,
  });
}

export async function cancelDesktopNimiFirstRunMaterializationJob(
  input: DesktopNimiFirstRunMaterializationInput & { readonly jobId: string },
): Promise<NimiFirstRunMaterializationProjection> {
  return cancelNimiFirstRunMaterializationJob({
    ...input,
  });
}

export async function retryDesktopNimiFirstRunMaterializationJob(
  input: DesktopNimiFirstRunMaterializationInput & { readonly jobId: string; readonly confirmed: boolean },
): Promise<NimiFirstRunMaterializationProjection> {
  return retryNimiFirstRunMaterializationJob({
    ...input,
  });
}

export async function repairDesktopNimiFirstRunMaterializationDependency(
  input: DesktopNimiFirstRunMaterializationInput & {
    readonly dependency: NimiRuntimeLocalEnvironmentPlanDependency;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
  },
): Promise<NimiFirstRunMaterializationProjection> {
  return repairNimiFirstRunMaterializationDependency({
    ...input,
  });
}
