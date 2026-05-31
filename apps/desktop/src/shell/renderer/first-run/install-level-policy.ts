import type { PlatformAIProfileFactoryRow } from '@nimiplatform/sdk/platform-catalog';

export type FirstRunInstallLevel = 'minimal' | 'recommended';

export function isAdmittedFirstRunLocalBaseline(row: PlatformAIProfileFactoryRow): boolean {
  const levels = new Set(row.firstRunInstallLevels.map((level) => level.trim().toLowerCase()));
  if (!levels.has('minimal') && !levels.has('recommended')) {
    return false;
  }
  if (!row.applicableScopes.includes('first-run')) {
    return false;
  }
  if (row.computePosture === 'cloud-only') {
    return false;
  }
  if (row.routingPolicy === 'cloud-first' || row.routingPolicy === 'hybrid-explicit') {
    return false;
  }
  if (row.capabilitySet.includes('video.generate')) {
    return false;
  }
  return row.localComputePackRefs.length > 0 && row.dependencyFamilyRefs.length > 0;
}

export function selectFactoryAIProfileForFirstRun(
  rows: readonly PlatformAIProfileFactoryRow[],
  installLevel: FirstRunInstallLevel = 'minimal',
): PlatformAIProfileFactoryRow | null {
  const candidates = rows.filter((row) =>
    isAdmittedFirstRunLocalBaseline(row) && row.firstRunInstallLevels.includes(installLevel),
  );
  if (installLevel === 'recommended') {
    return candidates.find((row) => !row.firstRunInstallLevels.includes('minimal')) ?? candidates[0] ?? null;
  }
  return candidates[0] ?? null;
}
