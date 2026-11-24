// @nimi-authority: rule.nimi.desktop.ai-consumption.r026

import type { QueryClient } from '@tanstack/react-query';
import {
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiMachineLoadout,
  type NimiMachineLoadouts,
  type NimiRuntimeLocalEnvironmentPlan,
} from '@nimiplatform/sdk/runtime';
import { CAPABILITY_INVENTORY_KEY } from './runtime-capability-inventory.js';
import { LOADOUT_ENVIRONMENT_KEY } from './runtime-local-model-status.js';
import type { RuntimeSetupRunnerPorts } from './runtime-setup-task-runner.js';

export function invalidateDesktopLoadoutQueries(queryClient: QueryClient): Promise<void[]> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['app-ai-config'] }),
    queryClient.invalidateQueries({ queryKey: CAPABILITY_INVENTORY_KEY }),
    queryClient.invalidateQueries({ queryKey: LOADOUT_ENVIRONMENT_KEY }),
    queryClient.invalidateQueries({ queryKey: ['desktop', 'machine-local-ai-config-selections'] }),
  ]);
}

export function environmentPlanHasReadyRequiredDependencies(
  plan: NimiRuntimeLocalEnvironmentPlan | undefined,
): boolean {
  if (!plan || plan.state === 'unsupported') return false;
  return plan.dependencies.every(
    (dep) => !dep.required || isNimiRuntimeLocalEnvironmentDependencyReadyState(dep.state),
  );
}

export type SelectExistingLoadoutResult =
  | { readonly status: 'selected'; readonly selectionRevision: string }
  | { readonly status: 'conflict'; readonly reasonCode: string; readonly selectionRevision: string }
  | { readonly status: 'needs-environment'; readonly plan: NimiRuntimeLocalEnvironmentPlan };

/**
 * Checks environment readiness for an existing configured Loadout and selects
 * that exact loadoutId under both expectedCandidateRevision and selection
 * revision conditions, explicitly inspecting the non-throwing applied flag.
 */
export async function checkExistingLoadoutEnvironment(input: {
  readonly loadout: NimiMachineLoadout;
  readonly resolveEnvironmentPlan: RuntimeSetupRunnerPorts['environment']['resolveEnvironmentPlan'];
}): Promise<{ readonly ready: boolean; readonly plan: NimiRuntimeLocalEnvironmentPlan }> {
  const plan = await input.resolveEnvironmentPlan({
    capabilityContract: input.loadout.capabilityContract,
    candidateLoadoutId: input.loadout.loadoutId,
  });
  return {
    ready: environmentPlanHasReadyRequiredDependencies(plan),
    plan,
  };
}

export async function commitExistingLoadoutSelection(input: {
  readonly loadout: NimiMachineLoadout;
  readonly aggregate: Pick<NimiMachineLoadouts, 'selectionRevisions'> | null | undefined;
  readonly selectLoadout: RuntimeSetupRunnerPorts['loadouts']['select'];
  readonly queryClient: QueryClient;
}): Promise<Exclude<SelectExistingLoadoutResult, { readonly status: 'needs-environment' }>> {
  const selectionRevision = input.aggregate?.selectionRevisions?.[input.loadout.capabilityContract] ?? '';
  const result = await input.selectLoadout(
    input.loadout.capabilityContract,
    input.loadout.loadoutId,
    true,
    {
      ...(selectionRevision
        ? { expectedSelectionRevision: selectionRevision }
        : { expectNoPriorSelection: true }),
      expectedCandidateRevision: input.loadout.revision,
    },
  );
  await invalidateDesktopLoadoutQueries(input.queryClient);
  if (!result.applied) {
    return {
      status: 'conflict',
      reasonCode: result.reasonCode || 'AI_LOADOUT_CONDITION_CONFLICT',
      selectionRevision: result.selectionRevision,
    };
  }
  return {
    status: 'selected',
    selectionRevision: result.selectionRevision,
  };
}
