import {
  buildNimiRuntimeLocalImageNativeEnvironmentPlanInput,
  createNimiRuntimeLocalModelCenterClient,
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyStartableState,
  withNimiRuntimeIdempotencyMetadata,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlanInput,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import { getTesterCapability } from './tester-capabilities.js';
import type { TesterRuntimeInvocationClient } from './tester-runtime-invokers-core.js';
import type { ImageRuntimeBinding } from './tester-runtime-media-bindings.js';
import { capabilityUnavailable, type TesterUnavailable } from './tester-unavailable.js';

type ImageEnvironmentPlanInput = NimiRuntimeLocalEnvironmentPlanInput & {
  readonly packId: 'local-image-native';
};

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

function dedupeDependencies(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): readonly NimiRuntimeLocalEnvironmentPlanDependency[] {
  const seen = new Set<string>();
  const out: NimiRuntimeLocalEnvironmentPlanDependency[] = [];
  for (const dependency of dependencies) {
    const key = [
      dependency.environmentKey,
      dependency.dependencyFamily,
      dependency.dependencyId,
      dependency.consumerScope,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dependency);
  }
  return out;
}

function summarizeLocalImageDependencies(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): string {
  return dependencies
    .slice(0, 6)
    .map((dependency) => `${dependency.dependencyFamily}:${dependency.dependencyId} state=${dependency.state}`)
    .join('; ');
}

function dependencyJobIdempotencyKey(baseIdempotencyKey: string, index: number): string {
  return `${baseIdempotencyKey}:local-image-env:${index + 1}`;
}

function profileEntryText(entry: unknown, snakeKey: string, camelKey: string): string {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const record = entry as Record<string, unknown>;
  return String(record[snakeKey] ?? record[camelKey] ?? '').trim();
}

function localImageProfileEntryAssetID(entry: unknown): string {
  return profileEntryText(entry, 'asset_id', 'assetId');
}

function localImageProfileEntryEngineSlot(entry: unknown): string {
  return profileEntryText(entry, 'engine_slot', 'engineSlot');
}

function isImageProfileBindingsDependency(dependency: NimiRuntimeLocalEnvironmentPlanDependency): boolean {
  return dependency.dependencyFamily === 'model.companion-asset'
    && dependency.dependencyId.startsWith('image-profile-bindings:');
}

function localImageEnvironmentPlanInputs(binding: ImageRuntimeBinding): readonly ImageEnvironmentPlanInput[] {
  const assetId = String(binding.resolved.metadata.aiConfigRuntimeModelAssetId || binding.resolved.model || '').trim();
  const localAssetId = String(binding.resolved.metadata.aiConfigRuntimeModelLocalAssetId || '').trim();
  const base = buildNimiRuntimeLocalImageNativeEnvironmentPlanInput({
    assetId,
    localAssetId,
  });
  const inputs: ImageEnvironmentPlanInput[] = [base];
  const mainEntryAssetId = binding.profileEntries
    .map((entry) => localImageProfileEntryEngineSlot(entry) ? '' : localImageProfileEntryAssetID(entry))
    .find(Boolean) || assetId;
  for (const entry of binding.profileEntries) {
    if (!localImageProfileEntryEngineSlot(entry)) continue;
    const companionAssetId = localImageProfileEntryAssetID(entry);
    if (!companionAssetId || !mainEntryAssetId) continue;
    inputs.push({
      ...base,
      companionAssetId,
      parentAssetId: mainEntryAssetId,
    });
  }
  return inputs;
}

export async function ensureLocalImageEnvironmentReady(
  client: TesterRuntimeInvocationClient,
  binding: ImageRuntimeBinding,
  runIdempotencyKey: string,
): Promise<TesterUnavailable | null> {
  const resolved = binding.resolved;
  if (resolved.routePolicy !== 'local') return null;
  if (!client.runtime.local) {
    return capabilityUnavailable(
      getTesterCapability('image.generate'),
      'runtime-call-failed',
      'image.generate local model setup requires Runtime local environment APIs; reload Runtime projection and retry.',
    );
  }

  const local = createNimiRuntimeLocalModelCenterClient({ local: client.runtime.local });
  const planInputs = localImageEnvironmentPlanInputs(binding);
  const plans = await Promise.all(planInputs.map((input) => local.resolveEnvironmentPlan(input)));
  const hasConcreteCompanionInputs = planInputs.some((input) => Boolean(input.companionAssetId && input.parentAssetId));
  const blocked = dedupeDependencies(plans.flatMap(nonReadyRequiredDependencies))
    .filter((dependency) => !(hasConcreteCompanionInputs && isImageProfileBindingsDependency(dependency)));
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
    await Promise.all(startable.map((dependency, index) =>
      local.startEnvironmentDependencyJob({
        environmentKey: dependency.environmentKey,
        dependencyFamily: dependency.dependencyFamily,
        dependencyId: dependency.dependencyId,
        sourceKind: dependency.sourceKind,
        confirmed: true,
        consumerScope: dependency.consumerScope,
      }, {
        caller: 'core',
        callOptions: withNimiRuntimeIdempotencyMetadata(
          undefined,
          dependencyJobIdempotencyKey(runIdempotencyKey, index),
        ),
      }),
    ));
  }

  const activeCount = jobsByDependency.filter(({ job }) =>
    isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job?.state)).length;
  const summary = summarizeLocalImageDependencies(blocked);
  const profileBindingBlockers = blocked.filter(isImageProfileBindingsDependency);
  if (!hasConcreteCompanionInputs && profileBindingBlockers.length > 0) {
    const startedNote = startable.length > 0
      ? ` Runtime local image setup started ${startable.length} dependency job(s).`
      : '';
    return capabilityUnavailable(
      getTesterCapability('image.generate'),
      'local-environment-blocked',
      `Local image generation requires concrete companion model bindings before Runtime can resolve profile setup.${startedNote} Pending dependencies: ${summary}`,
    );
  }
  const planState = [...new Set(plans.map((plan) => plan.state).filter(Boolean))].join(',') || 'unknown';
  return capabilityUnavailable(
    getTesterCapability('image.generate'),
    'local-environment-preparing',
    startable.length > 0
      ? `Runtime local image setup started ${startable.length} dependency job(s). Pending dependencies: ${summary}`
      : `Runtime local image setup is still preparing (${activeCount} active job(s), plan=${planState}). Pending dependencies: ${summary}`,
  );
}
