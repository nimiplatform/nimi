export type NimiRuntimeRecommendationApplicability = 'supported' | 'unknown' | 'unsupported';
export type NimiRuntimeModelAssetSourceAvailability = 'available' | 'unavailable';
export type NimiRuntimeModelAssetSourceFreshness = 'fresh' | 'stale';

export interface NimiRuntimeModelAssetSourceObservation {
  readonly availability: NimiRuntimeModelAssetSourceAvailability;
  readonly freshness?: NimiRuntimeModelAssetSourceFreshness;
  readonly generation?: string;
  readonly reasonCode?: string;
}

export interface NimiRuntimeModelAssetCatalogSearchResult {
  readonly modelLocator: string;
  readonly sourceLabel: string;
  readonly title: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly modelType?: string;
  readonly author?: string;
  readonly license?: string;
  readonly tags: readonly string[];
  readonly downloads?: number;
  readonly likes?: number;
  readonly lastModified?: string;
  readonly verified: boolean;
}

export interface NimiRuntimeModelAssetMarketCandidate {
  readonly offerRef: string;
  readonly sourceLabel: string;
  readonly title: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly modelType?: string;
  readonly variantLabel: string;
  readonly author?: string;
  readonly format?: string;
  readonly totalSizeBytes?: number;
  readonly license?: string;
  readonly tags: readonly string[];
  readonly downloads?: number;
  readonly likes?: number;
  readonly lastModified?: string;
  readonly verified: boolean;
  readonly installed: boolean;
  readonly installable: boolean;
  readonly featuredOrdinal?: number;
  readonly editorialReason?: string;
}

export interface NimiRuntimeFeaturedModelAssets {
  readonly source: NimiRuntimeModelAssetSourceObservation;
  readonly items: readonly NimiRuntimeModelAssetMarketCandidate[];
}

export interface NimiRuntimeFactoryProfileCapabilityApplicability {
  readonly capabilityContract: string;
  readonly applicability: NimiRuntimeRecommendationApplicability;
  readonly reasons: readonly string[];
}

export interface NimiRuntimeFactoryProfileRecommendation {
  readonly profileAlias: string;
  readonly capabilities: readonly NimiRuntimeFactoryProfileCapabilityApplicability[];
}
