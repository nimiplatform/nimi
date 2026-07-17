export type NimiElectronLocalDevelopmentSummaryAvailability = 'available' | 'unavailable';
export type NimiElectronLocalDevelopmentSummaryUnavailableReason =
  | 'principal-unauthorized'
  | 'local-app-operation-unavailable';

export type NimiElectronLocalDevelopmentDeveloperModeSummary = {
  readonly availability: NimiElectronLocalDevelopmentSummaryAvailability;
  readonly state: 'disabled' | 'enabled' | 'unavailable';
  readonly unavailableReason: NimiElectronLocalDevelopmentSummaryUnavailableReason | null;
};

export type NimiElectronLocalDevelopmentProjectAuthorizationSummary = {
  readonly availability: NimiElectronLocalDevelopmentSummaryAvailability;
  readonly activeCount: number;
  readonly dormantCount: number;
  readonly deniedCount: number;
  readonly revokedCount: number;
  readonly unavailableReason: NimiElectronLocalDevelopmentSummaryUnavailableReason | null;
};

export type NimiElectronLocalDevelopmentGrantSummary = {
  readonly availability: NimiElectronLocalDevelopmentSummaryAvailability;
  readonly pendingCount: number;
  readonly grantedCount: number;
  readonly deniedCount: number;
  readonly expiredCount: number;
  readonly revokedCount: number;
  readonly supersededCount: number;
  readonly unavailableReason: NimiElectronLocalDevelopmentSummaryUnavailableReason | null;
};

export type NimiElectronLocalDevelopmentAuthoritySummary = {
  readonly developerMode: NimiElectronLocalDevelopmentDeveloperModeSummary;
  readonly projectAuthorization: NimiElectronLocalDevelopmentProjectAuthorizationSummary;
  readonly grantSummary: NimiElectronLocalDevelopmentGrantSummary;
};

export function parseNimiElectronLocalDevelopmentAuthoritySummary(
  value: unknown,
): NimiElectronLocalDevelopmentAuthoritySummary {
  const row = exact(value, ['developerMode', 'grantSummary', 'projectAuthorization']);
  return {
    developerMode: parseDeveloperModeSummary(row.developerMode),
    projectAuthorization: parseProjectAuthorizationSummary(row.projectAuthorization),
    grantSummary: parseGrantSummary(row.grantSummary),
  };
}

function parseDeveloperModeSummary(value: unknown): NimiElectronLocalDevelopmentDeveloperModeSummary {
  const row = exact(value, ['availability', 'state', 'unavailableReason']);
  const availability = summaryAvailability(row.availability);
  const unavailableReason = summaryUnavailableReason(row.unavailableReason);
  const state = row.state;
  if (availability === 'available') {
    if ((state !== 'disabled' && state !== 'enabled') || unavailableReason !== null) invalid();
  } else if (state !== 'unavailable' || unavailableReason === null) {
    invalid();
  }
  return {
    availability,
    state: state as NimiElectronLocalDevelopmentDeveloperModeSummary['state'],
    unavailableReason,
  };
}

function parseProjectAuthorizationSummary(
  value: unknown,
): NimiElectronLocalDevelopmentProjectAuthorizationSummary {
  const row = exact(value, [
    'activeCount', 'availability', 'deniedCount', 'dormantCount', 'revokedCount', 'unavailableReason',
  ]);
  const availability = summaryAvailability(row.availability);
  const unavailableReason = summaryUnavailableReason(row.unavailableReason);
  const counts = {
    activeCount: summaryCount(row.activeCount),
    dormantCount: summaryCount(row.dormantCount),
    deniedCount: summaryCount(row.deniedCount),
    revokedCount: summaryCount(row.revokedCount),
  };
  requireAvailabilityConsistency(availability, unavailableReason, Object.values(counts));
  return { availability, ...counts, unavailableReason };
}

function parseGrantSummary(value: unknown): NimiElectronLocalDevelopmentGrantSummary {
  const row = exact(value, [
    'availability', 'deniedCount', 'expiredCount', 'grantedCount', 'pendingCount', 'revokedCount',
    'supersededCount', 'unavailableReason',
  ]);
  const availability = summaryAvailability(row.availability);
  const unavailableReason = summaryUnavailableReason(row.unavailableReason);
  const counts = {
    pendingCount: summaryCount(row.pendingCount),
    grantedCount: summaryCount(row.grantedCount),
    deniedCount: summaryCount(row.deniedCount),
    expiredCount: summaryCount(row.expiredCount),
    revokedCount: summaryCount(row.revokedCount),
    supersededCount: summaryCount(row.supersededCount),
  };
  requireAvailabilityConsistency(availability, unavailableReason, Object.values(counts));
  return { availability, ...counts, unavailableReason };
}

function requireAvailabilityConsistency(
  availability: NimiElectronLocalDevelopmentSummaryAvailability,
  unavailableReason: NimiElectronLocalDevelopmentSummaryUnavailableReason | null,
  counts: readonly number[],
): void {
  if (availability === 'available') {
    if (unavailableReason !== null) invalid();
    return;
  }
  if (unavailableReason === null || counts.some((count) => count !== 0)) invalid();
}

function summaryAvailability(value: unknown): NimiElectronLocalDevelopmentSummaryAvailability {
  if (value !== 'available' && value !== 'unavailable') invalid();
  return value;
}

function summaryUnavailableReason(
  value: unknown,
): NimiElectronLocalDevelopmentSummaryUnavailableReason | null {
  if (value === null) return null;
  if (value !== 'principal-unauthorized' && value !== 'local-app-operation-unavailable') invalid();
  return value;
}

function summaryCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw new TypeError('runtime-service-untrusted');
}
