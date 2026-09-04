import {
  LocalRecommendationApplicability,
  ModelAssetSourceAvailability,
  ModelAssetSourceFreshness,
  ReasonCode,
  type FactoryProfileRecommendation,
  type ModelAssetCatalogSearchResult,
  type ModelAssetFeaturedSourceObservation,
  type ModelAssetMarketCandidate,
} from '../core-generated/runtime-typed-client';
import type {
  NimiRuntimeFactoryProfileRecommendation,
  NimiRuntimeFeaturedModelAssets,
  NimiRuntimeModelAssetCatalogSearchResult,
  NimiRuntimeModelAssetMarketCandidate,
  NimiRuntimeModelAssetSourceObservation,
  NimiRuntimeRecommendationApplicability,
} from './runtime-local-recommendation-types';
import {
  invalidLocalProjection,
  nonNegativeNumber,
  normalizeText,
  positiveNumber,
  requireProjectedText,
  textList,
} from './runtime-local-environment-client-values';

export * from './runtime-local-recommendation-types';

export function projectNimiRuntimeRecommendationApplicability(
  value: LocalRecommendationApplicability,
): NimiRuntimeRecommendationApplicability {
  switch (value) {
    case LocalRecommendationApplicability.SUPPORTED:
      return 'supported';
    case LocalRecommendationApplicability.UNKNOWN:
      return 'unknown';
    case LocalRecommendationApplicability.UNSUPPORTED:
      return 'unsupported';
    default:
      throw invalidLocalProjection('Runtime recommendation applicability is unspecified');
  }
}

export function projectNimiRuntimeModelAssetSearchResult(
  value: ModelAssetCatalogSearchResult,
): NimiRuntimeModelAssetCatalogSearchResult {
  return Object.freeze({
    modelLocator: requireProjectedText(value.modelLocator, 'Runtime catalog search result is missing modelLocator'),
    sourceLabel: requireProjectedText(value.sourceLabel, 'Runtime catalog search result is missing sourceLabel'),
    title: requireProjectedText(value.title, 'Runtime catalog search result is missing title'),
    description: normalizeText(value.description),
    categories: Object.freeze(textList(value.categories)),
    ...(normalizeText(value.modelType) ? { modelType: normalizeText(value.modelType) } : {}),
    ...(normalizeText(value.author) ? { author: normalizeText(value.author) } : {}),
    ...(normalizeText(value.license) ? { license: normalizeText(value.license) } : {}),
    tags: Object.freeze(textList(value.tags)),
    ...(positiveNumber(value.downloads) !== undefined ? { downloads: positiveNumber(value.downloads) } : {}),
    ...(positiveNumber(value.likes) !== undefined ? { likes: positiveNumber(value.likes) } : {}),
    ...(normalizeText(value.lastModified) ? { lastModified: normalizeText(value.lastModified) } : {}),
    verified: Boolean(value.verified),
  });
}

export function projectNimiRuntimeModelAssetMarketCandidate(
  value: ModelAssetMarketCandidate,
): NimiRuntimeModelAssetMarketCandidate {
  const offerRef = requireProjectedText(value.offerRef, 'Runtime ModelAsset candidate is missing offerRef');
  if (value.installable && !offerRef) {
    throw invalidLocalProjection('Installable Runtime ModelAsset candidate is missing offerRef');
  }
  return Object.freeze({
    offerRef,
    sourceLabel: requireProjectedText(value.sourceLabel, 'Runtime ModelAsset candidate is missing sourceLabel'),
    title: requireProjectedText(value.title, 'Runtime ModelAsset candidate is missing title'),
    description: normalizeText(value.description),
    categories: Object.freeze(textList(value.categories)),
    ...(normalizeText(value.modelType) ? { modelType: normalizeText(value.modelType) } : {}),
    variantLabel: requireProjectedText(value.variantLabel, 'Runtime ModelAsset candidate is missing variantLabel'),
    ...(normalizeText(value.author) ? { author: normalizeText(value.author) } : {}),
    ...(normalizeText(value.format) ? { format: normalizeText(value.format) } : {}),
    ...(positiveNumber(value.totalSizeBytes) !== undefined ? { totalSizeBytes: positiveNumber(value.totalSizeBytes) } : {}),
    ...(normalizeText(value.license) ? { license: normalizeText(value.license) } : {}),
    tags: Object.freeze(textList(value.tags)),
    ...(positiveNumber(value.downloads) !== undefined ? { downloads: positiveNumber(value.downloads) } : {}),
    ...(positiveNumber(value.likes) !== undefined ? { likes: positiveNumber(value.likes) } : {}),
    ...(normalizeText(value.lastModified) ? { lastModified: normalizeText(value.lastModified) } : {}),
    verified: Boolean(value.verified),
    installed: Boolean(value.installed),
    installable: Boolean(value.installable),
    ...(value.featuredOrdinal !== undefined
      ? { featuredOrdinal: nonNegativeNumber(value.featuredOrdinal) }
      : {}),
    ...(normalizeText(value.editorialReason) ? { editorialReason: normalizeText(value.editorialReason) } : {}),
  });
}

export function projectNimiRuntimeModelAssetSourceObservation(
  value: ModelAssetFeaturedSourceObservation | undefined,
): NimiRuntimeModelAssetSourceObservation {
  if (!value) {
    throw invalidLocalProjection('Runtime featured ModelAsset response is missing source observation');
  }
  if (value.availability === ModelAssetSourceAvailability.AVAILABLE) {
    const freshness = value.freshness === ModelAssetSourceFreshness.FRESH
      ? 'fresh'
      : value.freshness === ModelAssetSourceFreshness.STALE
        ? 'stale'
        : undefined;
    if (!freshness) {
      throw invalidLocalProjection('Available Runtime featured source has unspecified freshness');
    }
    return Object.freeze({
      availability: 'available',
      freshness,
      generation: requireProjectedText(value.generation, 'Available Runtime featured source is missing generation'),
      ...(value.reasonCode !== ReasonCode.REASON_CODE_UNSPECIFIED
        ? { reasonCode: ReasonCode[value.reasonCode] || 'REASON_CODE_UNSPECIFIED' }
        : {}),
    });
  }
  if (value.availability === ModelAssetSourceAvailability.UNAVAILABLE) {
    return Object.freeze({
      availability: 'unavailable',
      ...(value.reasonCode !== ReasonCode.REASON_CODE_UNSPECIFIED
        ? { reasonCode: ReasonCode[value.reasonCode] || 'REASON_CODE_UNSPECIFIED' }
        : {}),
    });
  }
  throw invalidLocalProjection('Runtime featured source availability is unspecified');
}

export function projectNimiRuntimeFeaturedModelAssets(input: {
  readonly source?: ModelAssetFeaturedSourceObservation;
  readonly items: readonly ModelAssetMarketCandidate[];
}): NimiRuntimeFeaturedModelAssets {
  return Object.freeze({
    source: projectNimiRuntimeModelAssetSourceObservation(input.source),
    items: Object.freeze(input.items.map(projectNimiRuntimeModelAssetMarketCandidate)),
  });
}

export function projectNimiRuntimeFactoryProfileRecommendation(
  value: FactoryProfileRecommendation,
): NimiRuntimeFactoryProfileRecommendation {
  return Object.freeze({
    profileAlias: requireProjectedText(value.profileAlias, 'Runtime factory Profile recommendation is missing profileAlias'),
    capabilities: Object.freeze(value.capabilities.map((capability) => Object.freeze({
      capabilityContract: requireProjectedText(capability.capabilityContract, 'Runtime factory Profile capability is missing capabilityContract'),
      applicability: projectNimiRuntimeRecommendationApplicability(capability.applicability),
      reasons: Object.freeze(capability.reasons.map((reason) => ReasonCode[reason] || 'REASON_CODE_UNSPECIFIED')),
    }))),
  });
}
