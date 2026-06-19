import {
  buildNimiRuntimeLocalImageNativeEnvironmentPlanInput,
  createNimiRuntimeLocalModelCenterClient,
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyStartableState,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import { getTesterCapability } from './tester-capabilities.js';
import type { ResolvedLLMBinding, TesterRuntimeInvocationClient } from './tester-runtime-invokers-core.js';
import { capabilityUnavailable, type TesterUnavailable } from './tester-unavailable.js';

function latestJobForDependency(
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

function nonReadyRequiredDependencies(plan: NimiRuntimeLocalEnvironmentPlan): readonly NimiRuntimeLocalEnvironmentPlanDependency[] {
  return plan.dependencies.filter((dependency) =>
    dependency.required && !isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state));
}

function summarizeLocalImageDependencies(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): string {
  return dependencies
    .slice(0, 6)
    .map((dependency) => `${dependency.dependencyFamily}:${dependency.dependencyId} state=${dependency.state}`)
    .join('; ');
}

export async function ensureLocalImageEnvironmentReady(
  client: TesterRuntimeInvocationClient,
  resolved: ResolvedLLMBinding,
): Promise<TesterUnavailable | null> {
  if (resolved.routePolicy !== 'local') return null;
  if (!client.runtime.local) {
    return capabilityUnavailable(
      getTesterCapability('image.generate'),
      'runtime-call-failed',
      'image.generate local model setup requires Runtime local environment APIs; reload Runtime projection and retry.',
    );
  }

  const local = createNimiRuntimeLocalModelCenterClient({ local: client.runtime.local });
  const plan = await local.resolveEnvironmentPlan(buildNimiRuntimeLocalImageNativeEnvironmentPlanInput({
    assetId: resolved.model,
    localAssetId: resolved.metadata.aiConfigRuntimeModelLocalAssetId,
  }));
  const blocked = nonReadyRequiredDependencies(plan);
  if (blocked.length === 0) return null;

  const jobsByDependency = await Promise.all(blocked.map(async (dependency) => ({
    dependency,
    job: latestJobForDependency(
      await local.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey }),
      dependency,
    ),
  })));
  const startable = jobsByDependency
    .filter(({ dependency, job }) =>
      dependency.confirmationRequired &&
      isNimiRuntimeLocalEnvironmentDependencyStartableState(dependency.state)
      && !job)
    .map(({ dependency }) => dependency);

  if (startable.length > 0) {
    await Promise.all(startable.map((dependency) =>
      local.startEnvironmentDependencyJob({
        environmentKey: dependency.environmentKey,
        dependencyFamily: dependency.dependencyFamily,
        dependencyId: dependency.dependencyId,
        sourceKind: dependency.sourceKind,
        confirmed: true,
        consumerScope: dependency.consumerScope,
      }, { caller: 'core' }),
    ));
  }

  const activeCount = jobsByDependency.filter(({ job }) =>
    isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job?.state)).length;
  const summary = summarizeLocalImageDependencies(blocked);
  return capabilityUnavailable(
    getTesterCapability('image.generate'),
    'local-environment-preparing',
    startable.length > 0
      ? `Runtime local image setup started ${startable.length} dependency job(s). Pending dependencies: ${summary}`
      : `Runtime local image setup is still preparing (${activeCount} active job(s), plan=${plan.state}). Pending dependencies: ${summary}`,
  );
}
