export type NimiPlatformAIProfileFactoryRow = {
  readonly alias: string;
  readonly privacyPosture: string;
  readonly computePosture: string;
  readonly capabilitySet: readonly string[];
  readonly routingPolicy: string;
  readonly hostCapabilityProfileRefs: readonly string[];
  readonly localComputePackRefs: readonly string[];
  readonly dependencyFamilyRefs: readonly string[];
  readonly materializationConfirmationRequired: boolean;
  readonly applicableScopes: readonly string[];
  readonly firstRunInstallLevels: readonly string[];
  readonly sourceRule: string;
};

export const NIMI_PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID = 'platform_ai_profile_factory_catalog';
export const NIMI_PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION = 1;
export const NIMI_PLATFORM_AI_PROFILE_SELECTION_POLICY_REF = 'P-AIPS-004';

export const NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS = [
  {
    alias: 'cloud-first',
    privacyPosture: 'cloud-ok',
    computePosture: 'cloud-only',
    capabilitySet: [
      'text.generate',
      'text.embed',
      'audio.synthesize',
      'audio.transcribe',
      'image.generate',
    ],
    routingPolicy: 'cloud-first',
    hostCapabilityProfileRefs: [
      'windows-amd64-cpu',
      'windows-amd64-nvidia-cuda',
      'darwin-arm64-metal',
    ],
    localComputePackRefs: [],
    dependencyFamilyRefs: [],
    materializationConfirmationRequired: false,
    applicableScopes: ['first-party-app', 'scope-bound-apply'],
    firstRunInstallLevels: [],
    sourceRule: 'P-AIPS-002',
  },
  {
    alias: 'local-standard',
    privacyPosture: 'local-preferred',
    computePosture: 'cpu-only',
    capabilitySet: ['text.generate', 'text.embed'],
    routingPolicy: 'local-first',
    hostCapabilityProfileRefs: [
      'windows-amd64-cpu',
      'darwin-arm64-metal',
      'windows-amd64-nvidia-cuda',
    ],
    localComputePackRefs: ['local-text'],
    dependencyFamilyRefs: ['native-engine-package.llama', 'model.asset'],
    materializationConfirmationRequired: true,
    applicableScopes: ['first-party-app', 'scope-bound-apply'],
    firstRunInstallLevels: [],
    sourceRule: 'P-AIPS-002',
  },
  {
    alias: 'local-speech-ready',
    privacyPosture: 'local-preferred',
    computePosture: 'cpu-only',
    capabilitySet: ['text.generate', 'audio.transcribe', 'audio.synthesize'],
    routingPolicy: 'local-first',
    hostCapabilityProfileRefs: [
      'windows-amd64-cpu',
      'darwin-arm64-metal',
      'windows-amd64-nvidia-cuda',
    ],
    localComputePackRefs: ['local-text', 'local-speech'],
    dependencyFamilyRefs: [
      'native-engine-package.llama',
      'python.tool.uv',
      'python.runtime',
      'python.venv',
      'python.package-set',
      'model.asset',
    ],
    materializationConfirmationRequired: true,
    applicableScopes: ['first-run', 'first-party-app', 'scope-bound-apply'],
    firstRunInstallLevels: ['minimal', 'recommended'],
    sourceRule: 'P-AIPS-002',
  },
  {
    alias: 'local-gpu',
    privacyPosture: 'local-preferred',
    computePosture: 'cuda-capable',
    capabilitySet: [
      'text.generate',
      'audio.transcribe',
      'audio.synthesize',
      'image.generate',
    ],
    routingPolicy: 'local-first',
    hostCapabilityProfileRefs: ['windows-amd64-nvidia-cuda', 'darwin-arm64-metal'],
    localComputePackRefs: [
      'local-text',
      'local-speech',
      'local-image-native',
      'local-gpu-support',
    ],
    dependencyFamilyRefs: [
      'accelerator.cuda.runtime',
      'native-engine-package.llama',
      'native-engine-package.stablediffusion-ggml',
      'python.tool.uv',
      'python.runtime',
      'python.venv',
      'python.package-set',
      'python.torch-wheel',
      'model.asset',
      'model.companion-asset',
    ],
    materializationConfirmationRequired: true,
    applicableScopes: ['first-run', 'first-party-app', 'scope-bound-apply'],
    firstRunInstallLevels: ['recommended'],
    sourceRule: 'P-AIPS-002',
  },
  {
    alias: 'hybrid-recommended',
    privacyPosture: 'cloud-ok',
    computePosture: 'cuda-capable',
    capabilitySet: [
      'text.generate',
      'text.embed',
      'audio.transcribe',
      'audio.synthesize',
      'image.generate',
      'video.generate',
    ],
    routingPolicy: 'hybrid-explicit',
    hostCapabilityProfileRefs: [
      'windows-amd64-nvidia-cuda',
      'darwin-arm64-metal',
      'windows-amd64-cpu',
    ],
    localComputePackRefs: ['local-text', 'local-speech', 'local-image-native'],
    dependencyFamilyRefs: [
      'native-engine-package.llama',
      'native-engine-package.stablediffusion-ggml',
      'python.tool.uv',
      'python.runtime',
      'python.venv',
      'python.package-set',
      'model.asset',
      'model.companion-asset',
    ],
    materializationConfirmationRequired: true,
    applicableScopes: ['first-party-app', 'scope-bound-apply'],
    firstRunInstallLevels: [],
    sourceRule: 'P-AIPS-002',
  },
] as const satisfies readonly NimiPlatformAIProfileFactoryRow[];

export function resolveNimiFactoryAiProfileAlias(alias: unknown): NimiPlatformAIProfileFactoryRow | undefined {
  const normalized = normalizeNimiCapabilityText(alias);
  if (!normalized) {
    return undefined;
  }
  return NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === normalized);
}

export function verifyNimiFirstRunFactoryAiProfile(alias: unknown, installLevel: unknown): NimiPlatformAIProfileFactoryRow {
  const normalizedAlias = normalizeNimiCapabilityText(alias);
  const normalizedLevel = normalizeNimiCapabilityText(installLevel);
  const row = resolveNimiFactoryAiProfileAlias(normalizedAlias);
  if (!row) {
    throw new Error(`selected aiProfileAlias is not admitted in Platform factory catalog: ${normalizedAlias}`);
  }
  if (!row.applicableScopes.includes('first-run')) {
    throw new Error(`aiProfileAlias is not admitted for first-run: ${row.alias}`);
  }
  if (!row.firstRunInstallLevels.includes(normalizedLevel)) {
    throw new Error(`aiProfileAlias ${row.alias} is not admitted for first-run install level ${normalizedLevel}`);
  }
  if (
    row.computePosture === 'cloud-only'
    || row.routingPolicy === 'cloud-first'
    || row.routingPolicy === 'hybrid-explicit'
    || row.capabilitySet.includes('video.generate')
  ) {
    throw new Error(`aiProfileAlias ${row.alias} is not an admitted local first-run baseline`);
  }
  return row;
}

export type NimiFactoryProfileIndexRow = {
  readonly profileRef: string;
  readonly alias: string;
  readonly mode: string;
  readonly os: readonly string[];
  readonly deviceClass: string;
  readonly capabilities: readonly string[];
  readonly applicableScopes: readonly string[];
  readonly firstRunInstallLevels: readonly string[];
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
    mode: modeFromNimiFactoryInstallLevels(row.firstRunInstallLevels),
    os: osAxisFromNimiHostCapabilityRefs(row.hostCapabilityProfileRefs),
    deviceClass: deviceClassFromNimiComputePosture(row.computePosture),
    capabilities: [...row.capabilitySet],
    applicableScopes: [...row.applicableScopes],
    firstRunInstallLevels: [...row.firstRunInstallLevels],
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
    if (os && !out.includes(os)) {
      out.push(os);
    }
  }
  return out;
}

function deviceClassFromNimiComputePosture(computePosture: string): string {
  if (computePosture === 'cpu-only') {
    return 'cpu-standard';
  }
  if (computePosture === 'metal-capable') {
    return 'apple-silicon';
  }
  if (computePosture === 'cuda-capable') {
    return 'gpu-recommended';
  }
  if (computePosture === 'cloud-only') {
    return 'cloud-only';
  }
  throw new Error(`factory catalog row has an unknown compute_posture: ${computePosture}`);
}

function modeFromNimiFactoryInstallLevels(firstRunInstallLevels: readonly string[]): string {
  if (firstRunInstallLevels.includes('recommended')) {
    return 'recommended';
  }
  if (firstRunInstallLevels.includes('minimal')) {
    return 'baseline';
  }
  return 'scope-bound';
}
