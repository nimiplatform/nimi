import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  isNimiRuntimeLocalEnvironmentDependencyJobRetryableState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState,
  isNimiRuntimeLocalEnvironmentDependencyUnsupportedState,
} from '@nimiplatform/sdk/runtime';

function normalizeRuntimeDependencyState(state: unknown): string {
  return String(state || '').trim();
}

function runtimeDependencyBlocksActivation(dependency?: NimiRuntimeLocalEnvironmentPlanDependency): boolean {
  if (!dependency) {
    return false;
  }
  const state = normalizeRuntimeDependencyState(dependency.state);
  return Boolean(state) && !isNimiRuntimeLocalEnvironmentDependencyReadyState(state);
}

export function runtimeDependencyJobShouldSurface(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): boolean {
  if (!job || !runtimeDependencyBlocksActivation(dependency)) {
    return false;
  }
  const state = normalizeRuntimeDependencyState(job.state);
  return (
    isNimiRuntimeLocalEnvironmentDependencyJobActiveState(state)
    || isNimiRuntimeLocalEnvironmentDependencyJobRetryableState(state)
    || isNimiRuntimeLocalEnvironmentDependencyJobFailedState(state)
    || isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(state)
    || isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(state)
    || isNimiRuntimeLocalEnvironmentDependencyUnsupportedState(state)
  );
}

export function runtimeDependencyJobForDisplay(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): NimiRuntimeLocalEnvironmentDependencyJob | undefined {
  return runtimeDependencyJobShouldSurface(dependency, job) ? job : undefined;
}

export function runtimeDependencyCurrentState(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): string {
  const displayJob = runtimeDependencyJobForDisplay(dependency, job);
  return normalizeRuntimeDependencyState(displayJob?.state || dependency?.state);
}

export function runtimeDependencyRequiresAttention(
  dependency?: NimiRuntimeLocalEnvironmentPlanDependency,
  job?: NimiRuntimeLocalEnvironmentDependencyJob,
): boolean {
  if (!dependency) {
    return false;
  }
  const state = runtimeDependencyCurrentState(dependency, job);
  return Boolean(state) && !isNimiRuntimeLocalEnvironmentDependencyReadyState(state);
}
