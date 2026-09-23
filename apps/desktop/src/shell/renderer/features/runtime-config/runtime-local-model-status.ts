import {
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiMachineLoadout,
  type NimiRuntimeLocalEnvironmentPlan,
} from '@nimiplatform/sdk/runtime';
import type { CapabilityPreparationState } from './runtime-capability-inventory.js';
import type { RuntimeSetupTask } from './runtime-setup-task-store.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.model-preparation-status-ownership
//
// Preparation status of one specific saved Loadout. The environment check is
// an explicit input: the caller says whether it was run, is running, failed
// or produced a plan. Nothing here fetches, creates, modifies or selects a
// Loadout, and an unchecked or failed check is never read as prepared.

export type LoadoutEnvironmentCheck =
  | { readonly kind: 'not-checked' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'failed'; readonly message?: string }
  | { readonly kind: 'checked'; readonly plan: NimiRuntimeLocalEnvironmentPlan };

export type LoadoutPreparationReason =
  | 'ready'
  | 'preparing'
  | 'task-failed'
  | 'configuration-incomplete'
  | 'environment-unsupported'
  | 'environment-missing'
  | 'not-checked'
  | 'checking'
  | 'check-failed';

export type LoadoutPreparationStatus = {
  readonly state: CapabilityPreparationState;
  readonly reason: LoadoutPreparationReason;
  /** Required dependencies not yet ready; only filled from a completed check. */
  readonly missingDependencyIds: readonly string[];
  readonly task?: RuntimeSetupTask;
};

export function loadoutPreparationStatus(input: {
  readonly loadout: Pick<NimiMachineLoadout, 'loadoutId' | 'capabilityContract' | 'validationState'>;
  readonly check: LoadoutEnvironmentCheck;
  readonly tasks?: readonly RuntimeSetupTask[];
}): LoadoutPreparationStatus {
  const latest = [...(input.tasks ?? [])]
    .reverse()
    .find(
      (item) =>
        item.capabilityContract === input.loadout.capabilityContract &&
        item.candidateLoadoutId === input.loadout.loadoutId,
    );
  const task =
    latest && !['done', 'stopped'].includes(latest.status) && !latest.supersededBy ? latest : undefined;
  if (task?.status === 'preparing' || task?.status === 'committing') {
    return { state: 'preparing', reason: 'preparing', missingDependencyIds: [], task };
  }
  if (task?.status === 'failed' || task?.status === 'needs-attention') {
    return { state: 'attention', reason: 'task-failed', missingDependencyIds: [], task };
  }
  if (input.loadout.validationState !== 'configured') {
    return { state: 'attention', reason: 'configuration-incomplete', missingDependencyIds: [], task };
  }
  switch (input.check.kind) {
    case 'not-checked':
      return { state: 'unknown', reason: 'not-checked', missingDependencyIds: [], task };
    case 'checking':
      return { state: 'unknown', reason: 'checking', missingDependencyIds: [], task };
    case 'failed':
      return { state: 'unknown', reason: 'check-failed', missingDependencyIds: [], task };
    case 'checked': {
      const plan = input.check.plan;
      if (plan.state === 'unsupported') {
        return { state: 'attention', reason: 'environment-unsupported', missingDependencyIds: [], task };
      }
      const missing = plan.dependencies
        .filter((item) => item.required && !isNimiRuntimeLocalEnvironmentDependencyReadyState(item.state))
        .map((item) => item.dependencyId);
      if (missing.length > 0) {
        return { state: 'attention', reason: 'environment-missing', missingDependencyIds: missing, task };
      }
      return { state: 'ready', reason: 'ready', missingDependencyIds: [], task };
    }
  }
}
