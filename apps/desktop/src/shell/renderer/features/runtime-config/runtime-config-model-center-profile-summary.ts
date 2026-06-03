import type { LocalRuntimeProfileResolutionPlan } from '@nimiplatform/sdk/runtime';

export function summaryLine(plan: LocalRuntimeProfileResolutionPlan): string {
  const selectedDependencies = plan.executionPlan.entries.filter((entry) => entry.selected).length;
  const passiveAssetCount = plan.assetEntries.length;
  return `${selectedDependencies} runtime entries · ${passiveAssetCount} passive assets`;
}
