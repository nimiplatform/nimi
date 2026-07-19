// Read-only card fields derived from the unified SDK inventory projection.

import type { NimiAppInventoryEntry } from '@nimiplatform/sdk/app';

export interface AppCardRequirementSummary {
  readonly ai: boolean;
  readonly platformFeatures: boolean;
  readonly data: boolean;
  readonly runtime: boolean;
}

export function deriveRequirementSummary(entry: NimiAppInventoryEntry): AppCardRequirementSummary {
  return {
    ai: Boolean(entry.aiProfileSelectionRef?.trim()),
    platformFeatures: entry.capabilitySet.length > 0,
    data: Boolean(entry.installStoragePolicyRef?.trim()),
    runtime: Boolean(entry.releaseDescriptorRef?.trim()),
  };
}

/**
 * Stable identity fallback. Apps must not inspect app-local files for icons;
 * the catalog/local-record display name is already an owner projection.
 */
export function deriveIconGlyph(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  return (Array.from(trimmed)[0] ?? '?').toLocaleUpperCase();
}
