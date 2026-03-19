export type DeferredFeatureName = 'analytics' | 'template-marketplace' | 'copyright';

export class DeferredFeatureUnavailableError extends Error {
  readonly code = 'FORGE_FEATURE_DEFERRED';

  constructor(
    readonly feature: DeferredFeatureName,
    message: string,
  ) {
    super(message);
    this.name = 'DeferredFeatureUnavailableError';
  }
}

export function throwDeferredFeature(feature: DeferredFeatureName, message: string): never {
  throw new DeferredFeatureUnavailableError(feature, message);
}
