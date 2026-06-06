export type NimiCapabilityLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type NimiCapabilityStatus = 'supported' | 'partial' | 'unsupported';

export interface NimiCapabilityManifest {
  readonly adapterId: string;
  readonly targetLibrary: string;
  readonly targetVersionRange?: string;
  readonly capabilityLevel: NimiCapabilityLevel;
  readonly capabilities: Readonly<Record<string, NimiCapabilityStatus>>;
  readonly unsupportedBehavior: 'throw' | 'explicit-event';
}

export function assertNimiCapability(
  manifest: NimiCapabilityManifest,
  capability: string,
  expected: NimiCapabilityStatus = 'supported',
): void {
  const actual = manifest.capabilities[capability] ?? 'unsupported';
  if (actual !== expected) {
    throw new Error(
      `adapter ${manifest.adapterId} capability ${capability} expected ${expected} but found ${actual}`,
    );
  }
}
