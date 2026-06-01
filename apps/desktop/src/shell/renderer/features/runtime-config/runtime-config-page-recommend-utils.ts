import type {
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedItemDescriptor,
} from '@nimiplatform/sdk/runtime';
import {
  LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS,
  LOCAL_RECOMMENDATION_RUN_GRADE_IDS,
  applyLocalRecommendationFeedFilters,
  buildLocalRecommendationHuggingFaceUrl,
  collectLocalRecommendationFeedLicenses,
  collectLocalRecommendationFeedProviders,
  computeLocalRecommendationVramPercentage,
  countLocalRecommendationRunGrades,
  filterLocalRecommendationFeedItems as filterSdkRecommendationFeedItems,
  formatLocalRecommendationQuantQualityLabel,
  formatLocalRecommendationRepoOwner,
  formatLocalRecommendationRunGradeLabel,
  localRecommendationFeedMatchesQuery,
  localRecommendationTierToRunGrade,
  normalizeLocalRecommendationFeedCapabilityId,
  parseLocalRecommendationLicenseShort,
  parseLocalRecommendationParamsFromTitle,
  parseLocalRecommendationQuantBitsFromEntry,
  parseLocalRecommendationQuantLevelFromEntry,
  selectLocalRecommendationPrimaryEntrySize,
  sortLocalRecommendationFeedItems,
  splitLocalRecommendationFeedItems as splitSdkRecommendationFeedItems,
  summarizeLocalRecommendationFeedCacheState,
  type LocalRecommendationFeedCapabilityId,
  type LocalRecommendationFeedSections as SdkRecommendationFeedSections,
  type LocalRecommendationFeedSortKey,
  type LocalRecommendationRunGradeId,
} from '@nimiplatform/sdk/runtime';
import type { CapabilityV11 } from './runtime-config-state-types';

export const RECOMMEND_PAGE_CAPABILITIES = LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS;

export type RecommendPageCapability = LocalRecommendationFeedCapabilityId;

export type RecommendationFeedSections = SdkRecommendationFeedSections<LocalRuntimeRecommendationFeedItemDescriptor>;

// ---------------------------------------------------------------------------
// Grade (display tier) — maps internal tiers to CanIRun-style labels
// ---------------------------------------------------------------------------

export type RecommendGrade = LocalRecommendationRunGradeId;

export const RECOMMEND_GRADES: readonly RecommendGrade[] = LOCAL_RECOMMENDATION_RUN_GRADE_IDS;

export function tierToGrade(tier?: unknown): RecommendGrade {
  return localRecommendationTierToRunGrade(tier);
}

export function gradeLabel(grade: RecommendGrade): string {
  return formatLocalRecommendationRunGradeLabel(grade);
}

export function gradeColorClass(grade: RecommendGrade): string {
  if (grade === 'runs_great') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]';
  if (grade === 'runs_well') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]';
  if (grade === 'tight_fit') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]';
}

export function gradeDotClass(grade: RecommendGrade): string {
  if (grade === 'runs_great') return 'bg-[var(--nimi-status-success)]';
  if (grade === 'runs_well') return 'bg-[var(--nimi-status-success)]';
  if (grade === 'tight_fit') return 'bg-[var(--nimi-status-warning)]';
  return 'bg-[var(--nimi-status-danger)]';
}

// ---------------------------------------------------------------------------
// Tier counts (summary bar)
// ---------------------------------------------------------------------------

export type TierCounts = Record<RecommendGrade, number>;

export function computeTierCounts(items: LocalRuntimeRecommendationFeedItemDescriptor[]): TierCounts {
  return countLocalRecommendationRunGrades(items);
}

// ---------------------------------------------------------------------------
// Parse helpers — extract structured data from existing fields
// ---------------------------------------------------------------------------

export function parseParamsFromTitle(title: string): string {
  return parseLocalRecommendationParamsFromTitle(title);
}

export function parseLicenseShort(license?: string): string {
  return parseLocalRecommendationLicenseShort(license);
}

export function licenseColorClass(label: string): string {
  if (label.startsWith('Apache')) return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)] border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)]';
  if (label === 'MIT') return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_18%,transparent)] text-[var(--nimi-status-info)] border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)]';
  if (label.startsWith('Llama')) return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)] border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)]';
  if (label.startsWith('Gemma')) return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_18%,transparent)] text-[var(--nimi-status-info)] border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)] border-[var(--nimi-border-subtle)]';
}

export function formatRepoOwnerFromRepo(repo: string): string {
  return formatLocalRecommendationRepoOwner(repo);
}

// ---------------------------------------------------------------------------
// Model size helpers
// ---------------------------------------------------------------------------

export function primaryEntrySize(item: LocalRuntimeRecommendationFeedItemDescriptor): number {
  return selectLocalRecommendationPrimaryEntrySize(item);
}

export function computeVramPercentage(
  modelSizeBytes: number,
  totalVramBytes?: number,
): number | null {
  return computeLocalRecommendationVramPercentage(modelSizeBytes, totalVramBytes);
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
// Sort
// ---------------------------------------------------------------------------

export type RecommendSortKey = LocalRecommendationFeedSortKey;

export const RECOMMEND_SORT_OPTIONS: { value: RecommendSortKey; label: string }[] = [
  { value: 'score', label: 'Score' },
  { value: 'size', label: 'Size' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'likes', label: 'Likes' },
  { value: 'updated', label: 'Last Updated' },
  { value: 'name', label: 'Name' },
];

export function sortFeedItems(
  items: LocalRuntimeRecommendationFeedItemDescriptor[],
  sortKey: RecommendSortKey,
): LocalRuntimeRecommendationFeedItemDescriptor[] {
  return sortLocalRecommendationFeedItems(items, sortKey);
}

// ---------------------------------------------------------------------------
// Multi-filter
// ---------------------------------------------------------------------------

export type RecommendFilters = {
  query: string;
  grades: Set<RecommendGrade>;
  providers: Set<string>;
  licenses: Set<string>;
};

export function emptyFilters(): RecommendFilters {
  return { query: '', grades: new Set(), providers: new Set(), licenses: new Set() };
}

export function applyFilters(
  items: LocalRuntimeRecommendationFeedItemDescriptor[],
  filters: RecommendFilters,
): LocalRuntimeRecommendationFeedItemDescriptor[] {
  return applyLocalRecommendationFeedFilters(items, filters);
}

export function collectUniqueProviders(items: LocalRuntimeRecommendationFeedItemDescriptor[]): string[] {
  return collectLocalRecommendationFeedProviders(items);
}

export function collectUniqueLicenses(items: LocalRuntimeRecommendationFeedItemDescriptor[]): string[] {
  return collectLocalRecommendationFeedLicenses(items);
}

// ---------------------------------------------------------------------------
// Quantization parse helpers — extract structured quant data from entry names
// ---------------------------------------------------------------------------

export function parseQuantBitsFromEntry(entry: string): number | null {
  return parseLocalRecommendationQuantBitsFromEntry(entry);
}

export function parseQuantLevelFromEntry(entry: string): string {
  return parseLocalRecommendationQuantLevelFromEntry(entry);
}

export function quantQualityLabel(bits: number | null): string {
  return formatLocalRecommendationQuantQualityLabel(bits);
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
  return buildLocalRecommendationHuggingFaceUrl(repo);
}

export function normalizeRecommendPageCapability(value: CapabilityV11 | string | undefined): RecommendPageCapability {
  return normalizeLocalRecommendationFeedCapabilityId(value);
}

export function recommendationFeedMatchesQuery(
  item: LocalRuntimeRecommendationFeedItemDescriptor,
  query: string,
): boolean {
  return localRecommendationFeedMatchesQuery(item, query);
}

export function filterRecommendationFeedItems(
  items: LocalRuntimeRecommendationFeedItemDescriptor[],
  query: string,
): LocalRuntimeRecommendationFeedItemDescriptor[] {
  return filterSdkRecommendationFeedItems(items, query);
}

export function splitRecommendationFeedItems(
  items: LocalRuntimeRecommendationFeedItemDescriptor[],
): RecommendationFeedSections {
  return splitSdkRecommendationFeedItems(items);
}

export function recommendationFeedCacheSummary(
  feed: LocalRuntimeRecommendationFeedDescriptor | null,
): 'fresh' | 'stale' | 'empty' {
  return summarizeLocalRecommendationFeedCacheState(feed);
}
