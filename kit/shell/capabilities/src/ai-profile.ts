import {
  NIMI_PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
  NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS,
  NIMI_PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
  type NimiPlatformAIProfileFactoryRow,
} from './ai-profile-factory.generated.js';

export {
  NIMI_PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID,
  NIMI_PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
  NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS,
  NIMI_PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
  type NimiPlatformAIProfileFactoryRow,
} from './ai-profile-factory.generated.js';

export function resolveNimiFactoryAiProfileAlias(alias: unknown): NimiPlatformAIProfileFactoryRow | undefined {
  const normalized = normalizeNimiCapabilityText(alias);
  if (!normalized) return undefined;
  return NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === normalized);
}

export type NimiFactoryProfileIndexRow = {
  readonly profileRef: string;
  readonly alias: string;
  readonly os: readonly string[];
  readonly deviceClass: string;
  readonly capabilities: readonly string[];
  readonly applicableScopes: readonly string[];
};

export type NimiFactoryProfileIndexRecord = {
  readonly schemaVersion: 1;
  readonly catalogVersion: string;
  readonly updatedAt: string;
  readonly policies: {
    readonly baseline: string;
    readonly recommended: string;
  };
  readonly profiles: readonly NimiFactoryProfileIndexRow[];
};

export function buildNimiFactoryProfileIndexRecord(updatedAt = new Date().toISOString()): NimiFactoryProfileIndexRecord {
  const profiles = NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS.map((row) => ({
    profileRef: `factory-ai-profile:v${NIMI_PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION}:${row.alias}`,
    alias: row.alias,
    os: osAxisFromNimiHostCapabilityRefs(row.hostCapabilityProfileRefs),
    deviceClass: deviceClassFromNimiComputePosture(row.computePosture),
    capabilities: [...row.capabilitySet],
    applicableScopes: [...row.applicableScopes],
  }));
  if (profiles.length === 0) {
    throw new Error('Platform factory catalog projected zero profile rows');
  }
  return {
    schemaVersion: 1,
    catalogVersion: `v${NIMI_PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION}`,
    updatedAt,
    policies: {
      baseline: NIMI_PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
      recommended: NIMI_PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
    },
    profiles,
  };
}

function normalizeNimiCapabilityText(value: unknown): string {
  return String(value ?? '').trim();
}

function osAxisFromNimiHostCapabilityRefs(hostRefs: readonly string[]): string[] {
  const out: string[] = [];
  for (const hostRef of hostRefs) {
    const family = hostRef.split('-')[0];
    const os = family === 'darwin' || family === 'macos'
      ? 'macos'
      : family === 'windows' || family === 'linux'
        ? family
        : '';
    if (os && !out.includes(os)) out.push(os);
  }
  return out;
}

function deviceClassFromNimiComputePosture(computePosture: string): string {
  if (computePosture === 'cpu-only') return 'cpu-standard';
  if (computePosture === 'metal-capable') return 'apple-silicon';
  if (computePosture === 'cuda-capable') return 'gpu-recommended';
  if (computePosture === 'cloud-only') return 'cloud-only';
  throw new Error(`factory catalog row has an unknown compute_posture: ${computePosture}`);
}
