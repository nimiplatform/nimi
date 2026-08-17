import type { JsonObject } from '../types';
import type { NimiRuntimeLocalAssetKindId } from './local-asset-vocabulary';

export type NimiRuntimeLocalRecommendationSourceId = 'llmfit' | 'media-fit';
export type NimiRuntimeLocalRecommendationFormatId = 'gguf' | 'safetensors';
export type NimiRuntimeLocalRecommendationTierId = 'recommended' | 'runnable' | 'tight' | 'not_recommended';
export type NimiRuntimeLocalRecommendationHostSupportClassId = 'supported_supervised' | 'attached_only' | 'unsupported';
export type NimiRuntimeLocalRecommendationConfidenceId = 'high' | 'medium' | 'low';
export type NimiRuntimeLocalRecommendationBaselineId = 'image-default-v1' | 'video-default-v1';
export type NimiRuntimeLocalRecommendationFeedCacheStateId = 'fresh' | 'stale' | 'empty';
export type NimiRuntimeLocalRecommendationFeedCapabilityId = 'chat' | 'image' | 'video';
export type NimiRuntimeLocalRecommendationFeedSourceId = 'model-index';
export interface NimiRuntimeLocalCatalogRecommendation {
  readonly source: NimiRuntimeLocalRecommendationSourceId;
  readonly format?: NimiRuntimeLocalRecommendationFormatId;
  readonly tier?: NimiRuntimeLocalRecommendationTierId;
  readonly hostSupportClass?: NimiRuntimeLocalRecommendationHostSupportClassId;
  readonly confidence?: NimiRuntimeLocalRecommendationConfidenceId;
  readonly reasonCodes: readonly string[];
  readonly recommendedEntry?: string;
  readonly fallbackEntries: readonly string[];
  readonly suggestedNotes: readonly string[];
  readonly baseline?: NimiRuntimeLocalRecommendationBaselineId;
}

export interface NimiRuntimeLocalRecommendationFeedEntry {
  readonly entryId: string;
  readonly format: NimiRuntimeLocalRecommendationFormatId;
  readonly entry: string;
  readonly files: readonly string[];
  readonly totalSizeBytes: number;
  readonly sha256?: string;
}

export interface NimiRuntimeLocalRecommendationInstalledState {
  readonly installed: boolean;
}

export interface NimiRuntimeLocalRecommendationActionState {
  readonly canReviewInstallPlan: boolean;
  readonly canOpenVariants: boolean;
  readonly canOpenModelAsset: boolean;
}

export interface NimiRuntimeLocalRecommendationInstallPayload {
  readonly modelId: string;
  readonly kind: NimiRuntimeLocalAssetKindId;
  readonly repo: string;
  readonly revision?: string;
  readonly capabilities?: readonly string[];
  readonly engine?: string;
  readonly entry?: string;
  readonly files?: readonly string[];
  readonly license?: string;
  readonly hashes?: Record<string, string>;
  readonly endpoint?: string;
  readonly engineConfig?: JsonObject;
}

export interface NimiRuntimeLocalRecommendationFeedItem {
  readonly itemId: string;
  readonly source: NimiRuntimeLocalRecommendationFeedSourceId;
  readonly repo: string;
  readonly revision: string;
  readonly title: string;
  readonly description?: string;
  readonly capabilities: readonly string[];
  readonly tags: readonly string[];
  readonly formats: readonly NimiRuntimeLocalRecommendationFormatId[];
  readonly downloads?: number;
  readonly likes?: number;
  readonly lastModified?: string;
  readonly preferredEngine: string;
  readonly verified: boolean;
  readonly entries: readonly NimiRuntimeLocalRecommendationFeedEntry[];
  readonly recommendation?: NimiRuntimeLocalCatalogRecommendation;
  readonly installedState: NimiRuntimeLocalRecommendationInstalledState;
  readonly actionState: NimiRuntimeLocalRecommendationActionState;
  readonly installPayload: NimiRuntimeLocalRecommendationInstallPayload;
}

export interface NimiRuntimeLocalRecommendationFeed<TDeviceProfile = unknown> {
  readonly deviceProfile: TDeviceProfile;
  readonly activeCapability: NimiRuntimeLocalRecommendationFeedCapabilityId;
  readonly generatedAt?: string;
  readonly cacheState: NimiRuntimeLocalRecommendationFeedCacheStateId;
  readonly items: readonly NimiRuntimeLocalRecommendationFeedItem[];
}

export interface NimiRuntimeLocalRecommendationFeedEntryLike {
  readonly entry?: string;
  readonly totalSizeBytes?: number;
}

export interface NimiRuntimeLocalRecommendationFeedItemLike {
  readonly repo?: string;
  readonly title?: string;
  readonly description?: string;
  readonly tags?: readonly unknown[];
  readonly capabilities?: readonly unknown[];
  readonly formats?: readonly unknown[];
  readonly downloads?: number;
  readonly likes?: number;
  readonly lastModified?: string;
  readonly recommendation?: {
    readonly tier?: unknown;
    readonly recommendedEntry?: string;
  } | null;
  readonly installPayload?: {
    readonly modelId?: string;
    readonly license?: string;
  } | null;
  readonly installedState?: {
    readonly installed?: boolean;
  } | null;
  readonly entries?: readonly NimiRuntimeLocalRecommendationFeedEntryLike[];
}

export type NimiRuntimeLocalRecommendationCopyTranslator = (
  key: string,
  options: { defaultValue: string } & Record<string, string | number>,
) => string;

export interface NimiRuntimeLocalRecommendationCopyOptions {
  readonly translate?: NimiRuntimeLocalRecommendationCopyTranslator;
}

export interface NimiRuntimeLocalRecommendationDetailItem {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface NimiRuntimeLocalRecommendationDetailOptions
  extends NimiRuntimeLocalRecommendationCopyOptions {
  readonly maxFallbackEntries?: number;
  readonly includeNote?: boolean;
}

export interface NimiRuntimeLocalRecommendationFeedFilters {
  readonly query?: unknown;
  readonly providers?: ReadonlySet<string>;
  readonly licenses?: ReadonlySet<string>;
}
