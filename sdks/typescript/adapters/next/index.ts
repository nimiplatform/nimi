import type { NimiCapabilityManifest } from '../../core/contracts';
export const NIMI_NEXT_ADAPTER_ID = 'next' as const;
export const NIMI_NEXT_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;

export const NIMI_NEXT_ADAPTER_MANIFEST = {
  adapterId: NIMI_NEXT_ADAPTER_ID,
  targetLibrary: 'Next',
  targetVersionRange: 'structural-route-v1',
  capabilityLevel: 'L1',
  capabilities: {
    'route.chatCompletions.json': { support: 'unsupported', mode: 'adapter-mapped' },
    'route.chatCompletions.stream': { support: 'unsupported', mode: 'adapter-mapped' },
    middleware: { support: 'unsupported', mode: 'adapter-mapped' },
    serverActions: { support: 'unsupported', mode: 'adapter-mapped' },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export class NimiNextUnsupportedFeatureError extends Error {
  readonly code = NIMI_NEXT_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string) {
    super(feature);
    this.name = 'NimiNextUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedNextFeature(feature: string): never {
  throw new NimiNextUnsupportedFeatureError(feature);
}
