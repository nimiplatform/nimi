export type NimiCapabilityLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type NimiCapabilitySupport = 'supported' | 'partial' | 'unsupported' | 'not-applicable';
export type NimiCapabilityMode =
  | 'adapter-mapped'
  | 'framework-owned'
  | 'runtime-owned'
  | 'sdk-feature-owned'
  | 'caller-owned'
  | 'owner-gated'
  | 'governance-only'
  | 'out-of-domain';

export interface NimiCapabilityClaim {
  readonly support: NimiCapabilitySupport;
  readonly mode: NimiCapabilityMode;
  readonly note?: string;
  readonly gaps?: readonly string[];
}

export interface NimiCapabilityManifest {
  readonly adapterId: string;
  readonly targetLibrary: string;
  readonly targetVersionRange?: string;
  readonly capabilityLevel: NimiCapabilityLevel;
  readonly capabilities: Readonly<Record<string, NimiCapabilityClaim>>;
  readonly unsupportedBehavior: 'throw' | 'explicit-event';
}

export function getNimiCapabilityClaim(manifest: NimiCapabilityManifest, capability: string): NimiCapabilityClaim {
  return (
    manifest.capabilities[capability] ?? {
      support: 'unsupported',
      mode: 'out-of-domain',
      note: 'capability is not declared by this adapter',
    }
  );
}

export function assertNimiCapability(
  manifest: NimiCapabilityManifest,
  capability: string,
  expected: NimiCapabilitySupport = 'supported',
): void {
  const actual = getNimiCapabilityClaim(manifest, capability).support;
  if (actual !== expected) {
    throw new Error(
      `adapter ${manifest.adapterId} capability ${capability} expected ${expected} but found ${actual}`,
    );
  }
}
