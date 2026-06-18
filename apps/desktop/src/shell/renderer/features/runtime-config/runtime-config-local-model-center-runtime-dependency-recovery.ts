import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobRetryableState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
} from '@nimiplatform/sdk/runtime';

function runtimeDependencyJobUpdatedAtMs(job: NimiRuntimeLocalEnvironmentDependencyJob): number {
  const updatedAtMs = Date.parse(String(job.updatedAt || job.createdAt || ''));
  return Number.isFinite(updatedAtMs) ? updatedAtMs : 0;
}

function runtimeDependencyJobMatchesDependency(
  job: NimiRuntimeLocalEnvironmentDependencyJob,
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): boolean {
  return (
    job.environmentKey === dependency.environmentKey
    && job.dependencyFamily === dependency.dependencyFamily
    && job.dependencyId === dependency.dependencyId
    && job.consumerScope === dependency.consumerScope
  );
}

function latestRuntimeDependencyJob(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
): NimiRuntimeLocalEnvironmentDependencyJob | undefined {
  return jobs.slice().sort((left, right) => runtimeDependencyJobUpdatedAtMs(right) - runtimeDependencyJobUpdatedAtMs(left))[0];
}

function runtimeDependencyJobIsInterrupted(job: NimiRuntimeLocalEnvironmentDependencyJob): boolean {
  return (
    String(job.recoveryDisposition || '').trim() === 'auto_retry_transient'
    || String(job.reasonCode || '').trim() === 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED'
  );
}

export function runtimeDependencyAutoRetryKey(job: NimiRuntimeLocalEnvironmentDependencyJob): string {
  return [
    job.dependencyFamily,
    job.dependencyId,
    job.consumerScope,
    String(job.reasonCode || job.failureDetail || job.state || '').trim(),
  ].join('|');
}

export function retryableInterruptedRuntimeDependencyJobs(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
): NimiRuntimeLocalEnvironmentDependencyJob[] {
  const next: NimiRuntimeLocalEnvironmentDependencyJob[] = [];
  const seen = new Set<string>();
  for (const dependency of dependencies) {
    if (isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state)) {
      continue;
    }
    const matchingJobs = jobs.filter((job) => runtimeDependencyJobMatchesDependency(job, dependency));
    if (matchingJobs.some((job) => isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state))) {
      continue;
    }
    const latestJob = latestRuntimeDependencyJob(matchingJobs);
    if (
      !latestJob?.jobId
      || !latestJob.retryable
      || !isNimiRuntimeLocalEnvironmentDependencyJobRetryableState(latestJob.state)
      || !runtimeDependencyJobIsInterrupted(latestJob)
    ) {
      continue;
    }
    if (seen.has(latestJob.jobId)) {
      continue;
    }
    seen.add(latestJob.jobId);
    next.push(latestJob);
  }
  return next;
}
