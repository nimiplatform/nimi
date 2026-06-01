import { localRuntime } from '@nimiplatform/sdk/runtime';
import type { ProductControlState } from '@renderer/bridge';
import {
  cancelFirstRunMaterializationJob as cancelSdkFirstRunMaterializationJob,
  repairableFirstRunMaterializationDependencies as sdkRepairableFirstRunMaterializationDependencies,
  repairFirstRunMaterializationDependency as repairSdkFirstRunMaterializationDependency,
  resolveFirstRunMaterializationProjection as resolveSdkFirstRunMaterializationProjection,
  retryableInterruptedFirstRunMaterializationJobs as sdkRetryableInterruptedFirstRunMaterializationJobs,
  retryFirstRunMaterializationJob as retrySdkFirstRunMaterializationJob,
  startFirstRunMaterialization as startSdkFirstRunMaterialization,
  type FirstRunMaterializationDependencyProjection,
  type FirstRunMaterializationInput as SdkFirstRunMaterializationInput,
  type FirstRunMaterializationProjection as SdkFirstRunMaterializationProjection,
  type FirstRunMaterializationRuntime,
} from '@nimiplatform/sdk/runtime';
import type { LocalRuntimeEnvironmentPlanDependency } from '@nimiplatform/sdk/runtime';

export type {
  FirstRunMaterializationDependencyProjection,
  FirstRunMaterializationDownloadProgress,
  FirstRunMaterializationProductState,
  FirstRunMaterializationStatus,
} from '@nimiplatform/sdk/runtime';
export { productStateForMaterializationStatus } from '@nimiplatform/sdk/runtime';

export type FirstRunMaterializationProjection = SdkFirstRunMaterializationProjection;

export type FirstRunMaterializationInput = Omit<SdkFirstRunMaterializationInput, 'runtime'> & {
  readonly runtime?: FirstRunMaterializationRuntime;
};

function materializationRuntime(
  input: FirstRunMaterializationInput,
): FirstRunMaterializationRuntime {
  return input.runtime ?? localRuntime;
}

export function shouldResumeConfirmedFirstRunMaterialization(
  productState: ProductControlState,
  projection: FirstRunMaterializationProjection,
): boolean {
  if (projection.status !== 'needs_confirmation') return false;
  return productState === 'local_ai_profile_selected_assets_missing'
    || productState === 'local_ai_profile_selected_environment_not_ready'
    || productState === 'local_ai_assets_downloaded_environment_not_ready'
    || productState === 'local_ai_ready';
}

function isConfirmedFirstRunSetupState(productState: ProductControlState): boolean {
  return productState === 'local_ai_profile_selected_assets_missing'
    || productState === 'local_ai_profile_selected_environment_not_ready'
    || productState === 'local_ai_assets_downloaded_environment_not_ready'
    || productState === 'local_ai_ready';
}

export function retryableInterruptedFirstRunMaterializationJobs(
  productState: ProductControlState,
  projection: FirstRunMaterializationProjection,
) {
  if (!isConfirmedFirstRunSetupState(productState)) return [];
  return sdkRetryableInterruptedFirstRunMaterializationJobs(projection);
}

export function repairableConfirmedFirstRunMaterializationDependencies(
  productState: ProductControlState,
  projection: FirstRunMaterializationProjection,
): readonly FirstRunMaterializationDependencyProjection[] {
  if (!isConfirmedFirstRunSetupState(productState)) return [];
  return sdkRepairableFirstRunMaterializationDependencies(projection);
}

export async function resolveFirstRunMaterializationProjection(
  input: FirstRunMaterializationInput,
): Promise<FirstRunMaterializationProjection> {
  return resolveSdkFirstRunMaterializationProjection({
    ...input,
    runtime: materializationRuntime(input),
  });
}

export async function startFirstRunMaterialization(
  input: FirstRunMaterializationInput & { readonly confirmed: boolean },
): Promise<FirstRunMaterializationProjection> {
  return startSdkFirstRunMaterialization({
    ...input,
    runtime: materializationRuntime(input),
  });
}

export async function cancelFirstRunMaterializationJob(
  input: FirstRunMaterializationInput & { readonly jobId: string },
): Promise<FirstRunMaterializationProjection> {
  return cancelSdkFirstRunMaterializationJob({
    ...input,
    runtime: materializationRuntime(input),
  });
}

export async function retryFirstRunMaterializationJob(
  input: FirstRunMaterializationInput & { readonly jobId: string; readonly confirmed: boolean },
): Promise<FirstRunMaterializationProjection> {
  return retrySdkFirstRunMaterializationJob({
    ...input,
    runtime: materializationRuntime(input),
  });
}

export async function repairFirstRunMaterializationDependency(
  input: FirstRunMaterializationInput & {
    readonly dependency: LocalRuntimeEnvironmentPlanDependency;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
  },
): Promise<FirstRunMaterializationProjection> {
  return repairSdkFirstRunMaterializationDependency({
    ...input,
    runtime: materializationRuntime(input),
  });
}
