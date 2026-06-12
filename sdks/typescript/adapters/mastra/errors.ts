export const NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;

export class NimiMastraUnsupportedFeatureError extends Error {
  readonly code = NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string, detail?: string) {
    super(detail ? `${feature}: ${detail}` : feature);
    this.name = 'NimiMastraUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedMastraFeature(feature: string, detail?: string): never {
  throw new NimiMastraUnsupportedFeatureError(feature, detail);
}
