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
import { tierPillClass } from './runtime-config-runtime-page-ui';

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
  // Delegates to the shared tier→tone mapping so the model market and the
  // local model center render identical tier colors (runnable → info).
  return tierPillClass(tier);
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
  if (label.startsWith('Apache')) return 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)] border-[var(--nimi-status-success-soft-border)]';
  if (label === 'MIT') return 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)] border-[var(--nimi-status-info-soft-border)]';
  if (label.startsWith('Llama')) return 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)] border-[var(--nimi-status-warning-soft-border)]';
  if (label.startsWith('Gemma')) return 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)] border-[var(--nimi-status-info-soft-border)]';
  return 'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)] border-[var(--nimi-status-neutral-soft-border)]';
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
  if (pct === null) return 'text-[var(--nimi-text-muted)]';
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
  if (label === 'Lossless') return 'text-[var(--nimi-status-success-soft-text)] bg-[var(--nimi-status-success-soft-bg)]';
  if (label === 'High') return 'text-[var(--nimi-status-success-soft-text)] bg-[var(--nimi-status-success-soft-bg)]';
  if (label === 'Medium-High') return 'text-[var(--nimi-status-info-soft-text)] bg-[var(--nimi-status-info-soft-bg)]';
  if (label === 'Medium') return 'text-[var(--nimi-status-warning-soft-text)] bg-[var(--nimi-status-warning-soft-bg)]';
  if (label === 'Low-Medium') return 'text-[var(--nimi-status-warning-soft-text)] bg-[var(--nimi-status-warning-soft-bg)]';
  if (label === 'Low') return 'text-[var(--nimi-status-danger-soft-text)] bg-[var(--nimi-status-danger-soft-bg)]';
  return 'text-[var(--nimi-status-neutral-soft-text)] bg-[var(--nimi-status-neutral-soft-bg)]';
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
