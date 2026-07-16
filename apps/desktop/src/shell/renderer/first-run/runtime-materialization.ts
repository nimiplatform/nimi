import type { NimiProductControlState } from '@renderer/bridge';
import {
  cancelNimiFirstRunMaterializationJob,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  repairNimiFirstRunMaterializationDependency,
  repairableNimiFirstRunMaterializationDependencies,
  resolveNimiFirstRunMaterializationProjection,
  retryNimiFirstRunMaterializationJob,
  startNimiFirstRunMaterialization,
  type NimiFirstRunMaterializationInput,
  type NimiFirstRunMaterializationProjection,
  type NimiFirstRunMaterializationRuntime,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import { firstRunRuntimeLocalClient } from './first-run-runtime-local-client.js';

export type {
  NimiFirstRunMaterializationDependencyProjection,
  NimiFirstRunMaterializationDownloadProgress,
  NimiFirstRunMaterializationProductState,
  NimiFirstRunMaterializationProjection,
  NimiFirstRunMaterializationStatus,
} from '@nimiplatform/sdk/runtime';
export { productStateForNimiFirstRunMaterializationStatus } from '@nimiplatform/sdk/runtime';

export type DesktopNimiFirstRunMaterializationInput = Omit<NimiFirstRunMaterializationInput, 'runtime'> & {
  readonly runtime?: NimiFirstRunMaterializationRuntime;
};

function nimiFirstRunMaterializationRuntime(
  input: DesktopNimiFirstRunMaterializationInput,
): NimiFirstRunMaterializationRuntime {
  return input.runtime ?? firstRunRuntimeLocalClient;
}

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

export async function resolveDesktopNimiFirstRunMaterializationProjection(
  input: DesktopNimiFirstRunMaterializationInput,
): Promise<NimiFirstRunMaterializationProjection> {
  return resolveNimiFirstRunMaterializationProjection({
    ...input,
    runtime: nimiFirstRunMaterializationRuntime(input),
  });
}

export async function startDesktopNimiFirstRunMaterialization(
  input: DesktopNimiFirstRunMaterializationInput & { readonly confirmed: boolean },
): Promise<NimiFirstRunMaterializationProjection> {
  return startNimiFirstRunMaterialization({
    ...input,
    runtime: nimiFirstRunMaterializationRuntime(input),
  });
}

export async function cancelDesktopNimiFirstRunMaterializationJob(
  input: DesktopNimiFirstRunMaterializationInput & { readonly jobId: string },
): Promise<NimiFirstRunMaterializationProjection> {
  return cancelNimiFirstRunMaterializationJob({
    ...input,
    runtime: nimiFirstRunMaterializationRuntime(input),
  });
}

export async function retryDesktopNimiFirstRunMaterializationJob(
  input: DesktopNimiFirstRunMaterializationInput & { readonly jobId: string; readonly confirmed: boolean },
): Promise<NimiFirstRunMaterializationProjection> {
  return retryNimiFirstRunMaterializationJob({
    ...input,
    runtime: nimiFirstRunMaterializationRuntime(input),
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
    runtime: nimiFirstRunMaterializationRuntime(input),
  });
}
