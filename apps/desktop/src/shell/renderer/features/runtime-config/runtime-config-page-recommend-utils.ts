import type {
  NimiRuntimeLocalRecommendationFeed,
  NimiRuntimeLocalRecommendationFeedItem,
} from '@nimiplatform/sdk/runtime';
import {
  NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS,
  applyNimiRuntimeLocalRecommendationFeedFilters,
  buildNimiRuntimeLocalRecommendationHuggingFaceUrl,
  collectNimiRuntimeLocalRecommendationFeedLicenses,
  collectNimiRuntimeLocalRecommendationFeedProviders,
  computeNimiRuntimeLocalRecommendationVramPercentage,
  filterNimiRuntimeLocalRecommendationFeedItems as filterSdkRecommendationFeedItems,
  formatNimiRuntimeLocalRecommendationQuantQualityLabel,
  formatNimiRuntimeLocalRecommendationRepoOwner,
  nimiRuntimeLocalRecommendationFeedMatchesQuery,
  parseNimiRuntimeLocalRecommendationFeedCapabilityId,
  parseNimiRuntimeLocalRecommendationLicenseShort,
  parseNimiRuntimeLocalRecommendationParamsFromTitle,
  parseNimiRuntimeLocalRecommendationQuantBitsFromEntry,
  parseNimiRuntimeLocalRecommendationQuantLevelFromEntry,
  parseNimiRuntimeLocalRecommendationTierId,
  selectNimiRuntimeLocalRecommendationPrimaryEntrySize,
  summarizeNimiRuntimeLocalRecommendationFeedCacheState,
  type NimiRuntimeLocalRecommendationFeedCapabilityId,
  type NimiRuntimeLocalRecommendationTierId,
} from '@nimiplatform/sdk/runtime';
import type { CapabilityV11 } from './runtime-config-state-types';

export const RECOMMEND_PAGE_CAPABILITIES = NIMI_RUNTIME_LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS;

export type RecommendPageCapability = NimiRuntimeLocalRecommendationFeedCapabilityId;

export type RecommendTier = NimiRuntimeLocalRecommendationTierId | null;

export function recommendationTier(value?: unknown): RecommendTier {
  return parseNimiRuntimeLocalRecommendationTierId(value) ?? null;
}

export function recommendationTierLabel(tier: RecommendTier): string {
  if (tier === 'recommended') return 'Recommended';
  if (tier === 'runnable') return 'Runnable';
  if (tier === 'tight') return 'Tight';
  if (tier === 'not_recommended') return 'Not Recommended';
  return 'Unscored';
}

export function recommendationTierColorClass(tier: RecommendTier): string {
  if (tier === 'recommended' || tier === 'runnable') {
    return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]';
  }
  if (tier === 'tight') {
    return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]';
  }
  if (tier === 'not_recommended') {
    return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]';
  }
  return 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]';
}

// ---------------------------------------------------------------------------
// Parse helpers — extract structured data from existing fields
// ---------------------------------------------------------------------------

export function parseParamsFromTitle(title: string): string {
  return parseNimiRuntimeLocalRecommendationParamsFromTitle(title);
}

export function parseLicenseShort(license?: string): string {
  return parseNimiRuntimeLocalRecommendationLicenseShort(license);
}

export function licenseColorClass(label: string): string {
  if (label.startsWith('Apache')) return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)] border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)]';
  if (label === 'MIT') return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_18%,transparent)] text-[var(--nimi-status-info)] border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)]';
  if (label.startsWith('Llama')) return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)] border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)]';
  if (label.startsWith('Gemma')) return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_18%,transparent)] text-[var(--nimi-status-info)] border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)] border-[var(--nimi-border-subtle)]';
}

export function formatRepoOwnerFromRepo(repo: string): string {
  return formatNimiRuntimeLocalRecommendationRepoOwner(repo);
}

// ---------------------------------------------------------------------------
// Model size helpers
// ---------------------------------------------------------------------------

export function primaryEntrySize(item: NimiRuntimeLocalRecommendationFeedItem): number {
  return selectNimiRuntimeLocalRecommendationPrimaryEntrySize(item);
}

export function computeVramPercentage(
  modelSizeBytes: number,
  totalVramBytes?: number,
): number | null {
  return computeNimiRuntimeLocalRecommendationVramPercentage(modelSizeBytes, totalVramBytes);
}

export function vramPercentageColorClass(pct: number | null): string {
  if (pct === null) return 'text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]';
  if (pct <= 50) return 'text-[var(--nimi-status-success)]';
  if (pct <= 80) return 'text-[var(--nimi-status-warning)]';
  if (pct <= 100) return 'text-[var(--nimi-status-warning)]';
  return 'text-[var(--nimi-status-danger)]';
}

export function vramBarColorClass(pct: number | null): string {
  if (pct === null) return 'bg-[var(--nimi-border-subtle)]';
  if (pct <= 50) return 'bg-[var(--nimi-status-success)]';
  if (pct <= 80) return 'bg-[var(--nimi-status-warning)]';
  if (pct <= 100) return 'bg-[var(--nimi-status-warning)]';
  return 'bg-[var(--nimi-status-danger)]';
}

// ---------------------------------------------------------------------------
// Multi-filter
// ---------------------------------------------------------------------------

export type RecommendFilters = {
  query: string;
  providers: Set<string>;
  licenses: Set<string>;
};

export function emptyFilters(): RecommendFilters {
  return { query: '', providers: new Set(), licenses: new Set() };
}

export function applyFilters(
  items: readonly NimiRuntimeLocalRecommendationFeedItem[],
  filters: RecommendFilters,
): NimiRuntimeLocalRecommendationFeedItem[] {
  return applyNimiRuntimeLocalRecommendationFeedFilters(items, filters);
}

export function collectUniqueProviders(items: readonly NimiRuntimeLocalRecommendationFeedItem[]): string[] {
  return collectNimiRuntimeLocalRecommendationFeedProviders(items);
}

export function collectUniqueLicenses(items: readonly NimiRuntimeLocalRecommendationFeedItem[]): string[] {
  return collectNimiRuntimeLocalRecommendationFeedLicenses(items);
}

// ---------------------------------------------------------------------------
// Quantization parse helpers — extract structured quant data from entry names
// ---------------------------------------------------------------------------

export function parseQuantBitsFromEntry(entry: string): number | null {
  return parseNimiRuntimeLocalRecommendationQuantBitsFromEntry(entry);
}

export function parseQuantLevelFromEntry(entry: string): string {
  return parseNimiRuntimeLocalRecommendationQuantLevelFromEntry(entry);
}

export function quantQualityLabel(bits: number | null): string {
  return formatNimiRuntimeLocalRecommendationQuantQualityLabel(bits);
}

export function quantQualityColorClass(label: string): string {
  if (label === 'Lossless') return 'text-[var(--nimi-status-success)] bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)]';
  if (label === 'High') return 'text-[var(--nimi-status-success)] bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)]';
  if (label === 'Medium-High') return 'text-[var(--nimi-status-info)] bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)]';
  if (label === 'Medium') return 'text-[var(--nimi-status-warning)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)]';
  if (label === 'Low-Medium') return 'text-[var(--nimi-status-warning)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)]';
  if (label === 'Low') return 'text-[var(--nimi-status-danger)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]';
  return 'text-[var(--nimi-text-muted)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]';
}

export function buildHuggingFaceUrl(repo: string): string {
  return buildNimiRuntimeLocalRecommendationHuggingFaceUrl(repo);
}

export function normalizeRecommendPageCapability(
  value: CapabilityV11 | string | undefined,
): RecommendPageCapability | null {
  return parseNimiRuntimeLocalRecommendationFeedCapabilityId(value) ?? null;
}

export function recommendationFeedMatchesQuery(
  item: NimiRuntimeLocalRecommendationFeedItem,
  query: string,
): boolean {
  return nimiRuntimeLocalRecommendationFeedMatchesQuery(item, query);
}

export function filterRecommendationFeedItems(
  items: readonly NimiRuntimeLocalRecommendationFeedItem[],
  query: string,
): NimiRuntimeLocalRecommendationFeedItem[] {
  return filterSdkRecommendationFeedItems(items, query);
}

export function recommendationFeedCacheSummary(
  feed: NimiRuntimeLocalRecommendationFeed | null,
): 'fresh' | 'stale' | 'empty' {
  return summarizeNimiRuntimeLocalRecommendationFeedCacheState(feed);
}
