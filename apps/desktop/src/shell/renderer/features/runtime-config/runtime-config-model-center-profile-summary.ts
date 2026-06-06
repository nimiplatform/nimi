import type { NimiRuntimeLocalProfileResolutionPlan } from '@nimiplatform/sdk/runtime';

export function summaryLine(plan: NimiRuntimeLocalProfileResolutionPlan): string {
  const selectedDependencies = plan.executionPlan.entries.filter((entry) => entry.selected).length;
  const auxiliaryEntries = plan.executionPlan.entries.filter((entry) => entry.kind !== 'model').length;
  return `${selectedDependencies} runtime entries · ${auxiliaryEntries} auxiliary entries`;
}
