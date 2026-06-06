import {
  formatLocalRecommendationRepoOwner,
  localRecommendationFeedMatchesQuery,
  localRecommendationTierToRunGrade,
  parseLocalRecommendationTierId,
  selectLocalRecommendationPrimaryEntrySize,
  type LocalRecommendationFeedItemLike,
  type LocalRecommendationFeedItemProjection,
  type LocalRecommendationRunGradeId,
  type LocalRecommendationTierId,
} from './local-recommendation-feed.js';

export type LocalRecommendationFeedSections<T extends LocalRecommendationFeedItemLike = LocalRecommendationFeedItemProjection> = {
  topMatches: T[];
  worthTrying: T[];
  alreadyInstalled: T[];
  searchMore: T[];
};

export type LocalRecommendationFeedSortKey = 'score' | 'size' | 'downloads' | 'likes' | 'updated' | 'name';

export type LocalRecommendationFeedFilters = {
  query?: unknown;
  grades?: ReadonlySet<LocalRecommendationRunGradeId>;
  providers?: ReadonlySet<string>;
  licenses?: ReadonlySet<string>;
};

export const LOCAL_RECOMMENDATION_FEED_SORT_KEYS = Object.freeze([
  'score',
  'size',
  'downloads',
  'likes',
  'updated',
  'name',
] as const) as readonly LocalRecommendationFeedSortKey[];

const LOCAL_RECOMMENDATION_FEED_TIER_RANK: Record<LocalRecommendationTierId, number> = {
  recommended: 0,
  runnable: 1,
  tight: 2,
  not_recommended: 3,
};

const LOCAL_RECOMMENDATION_PARAMS_RE = /\b(\d+(?:\.\d+)?)\s*[Bb]\b/;
const LOCAL_RECOMMENDATION_QUANT_LEVEL_RE = /\b(F32|F16|BF16|Q[2-8]_[A-Z0-9_]+|Q[2-8]_[0-9]+|IQ[1-4]_[A-Z0-9_]+)\b/i;
const LOCAL_RECOMMENDATION_QUANT_BITS: readonly (readonly [RegExp, number])[] = [
  [/\bF32\b/i, 32],
  [/\bF16\b/i, 16],
  [/\bBF16\b/i, 16],
  [/\bQ8/i, 8],
  [/\bQ6/i, 6],
  [/\bQ5/i, 5],
  [/\bQ4/i, 4],
  [/\bQ3/i, 3],
  [/\bQ2/i, 2],
  [/\bIQ4/i, 4],
  [/\bIQ3/i, 3],
  [/\bIQ2/i, 2],
  [/\bIQ1/i, 1],
];

export function formatLocalRecommendationRunGradeLabel(grade: LocalRecommendationRunGradeId): string {
  if (grade === 'runs_great') return 'Runs Great';
  if (grade === 'runs_well') return 'Runs Well';
  if (grade === 'tight_fit') return 'Tight Fit';
  return 'Not Recommended';
}

export function countLocalRecommendationRunGrades(
  items: readonly LocalRecommendationFeedItemLike[],
): Record<LocalRecommendationRunGradeId, number> {
  const counts: Record<LocalRecommendationRunGradeId, number> = {
    runs_great: 0,
    runs_well: 0,
    tight_fit: 0,
    not_recommended: 0,
  };
  for (const item of items) {
    counts[localRecommendationTierToRunGrade(item.recommendation?.tier)] += 1;
  }
  return counts;
}

export function parseLocalRecommendationParamsFromTitle(title: unknown): string {
  const match = LOCAL_RECOMMENDATION_PARAMS_RE.exec(String(title ?? ''));
  return match ? `${match[1]}B` : '';
}

export function parseLocalRecommendationLicenseShort(license: unknown): string {
  const raw = String(license || '').trim();
  if (!raw || raw === 'unknown') return '';
  const lower = raw.toLowerCase();
  if (lower.includes('apache')) return 'Apache 2.0';
  if (lower.includes('mit')) return 'MIT';
  if (lower.includes('llama 3.1') || lower.includes('llama3.1')) return 'Llama 3.1';
  if (lower.includes('llama 3.3') || lower.includes('llama3.3')) return 'Llama 3.3';
  if (lower.includes('llama 4') || lower.includes('llama4')) return 'Llama 4';
  if (lower.includes('llama')) return 'Llama Community';
  if (lower.includes('gemma')) return 'Gemma';
  if (lower.includes('qwen')) return 'Qwen';
  if (lower.includes('gpl')) return 'GPL';
  if (lower.includes('cc-by')) return 'CC-BY';
  if (lower.includes('creativeml')) return 'CreativeML';
  if (raw.length > 20) return `${raw.slice(0, 18)}\u2026`;
  return raw;
}

export function computeLocalRecommendationVramPercentage(
  modelSizeBytes: number,
  totalVramBytes?: number,
): number | null {
  if (!totalVramBytes || totalVramBytes <= 0 || modelSizeBytes <= 0) return null;
  return Math.round((modelSizeBytes / totalVramBytes) * 100);
}

export function filterLocalRecommendationFeedItems<T extends LocalRecommendationFeedItemLike>(
  items: readonly T[],
  query: unknown,
): T[] {
  return items.filter((item) => localRecommendationFeedMatchesQuery(item, query));
}

export function sortLocalRecommendationFeedItems<T extends LocalRecommendationFeedItemLike>(
  items: readonly T[],
  sortKey: LocalRecommendationFeedSortKey,
): T[] {
  return [...items].sort((a, b) => {
    if (sortKey === 'score') {
      const aTier = parseLocalRecommendationTierId(a.recommendation?.tier);
      const bTier = parseLocalRecommendationTierId(b.recommendation?.tier);
      const at = aTier ? LOCAL_RECOMMENDATION_FEED_TIER_RANK[aTier] : 4;
      const bt = bTier ? LOCAL_RECOMMENDATION_FEED_TIER_RANK[bTier] : 4;
      if (at !== bt) return at - bt;
      return (b.downloads || 0) - (a.downloads || 0);
    }
    if (sortKey === 'size') {
      return selectLocalRecommendationPrimaryEntrySize(a) - selectLocalRecommendationPrimaryEntrySize(b);
    }
    if (sortKey === 'downloads') {
      return (b.downloads || 0) - (a.downloads || 0);
    }
    if (sortKey === 'likes') {
      return (b.likes || 0) - (a.likes || 0);
    }
    if (sortKey === 'updated') {
      return String(b.lastModified || '').localeCompare(String(a.lastModified || ''));
    }
    return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
  });
}

export function applyLocalRecommendationFeedFilters<T extends LocalRecommendationFeedItemLike>(
  items: readonly T[],
  filters: LocalRecommendationFeedFilters,
): T[] {
  return items.filter((item) => {
    if (!localRecommendationFeedMatchesQuery(item, filters.query)) return false;
    if (filters.grades?.size) {
      const grade = localRecommendationTierToRunGrade(item.recommendation?.tier);
      if (!filters.grades.has(grade)) return false;
    }
    if (filters.providers?.size) {
      const provider = formatLocalRecommendationRepoOwner(item.repo);
      if (!filters.providers.has(provider)) return false;
    }
    if (filters.licenses?.size) {
      const license = parseLocalRecommendationLicenseShort(item.installPayload?.license);
      if (!license || !filters.licenses.has(license)) return false;
    }
    return true;
  });
}

export function collectLocalRecommendationFeedProviders(
  items: readonly LocalRecommendationFeedItemLike[],
): string[] {
  const set = new Set<string>();
  for (const item of items) {
    set.add(formatLocalRecommendationRepoOwner(item.repo));
  }
  return [...set].sort();
}

export function collectLocalRecommendationFeedLicenses(
  items: readonly LocalRecommendationFeedItemLike[],
): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const label = parseLocalRecommendationLicenseShort(item.installPayload?.license);
    if (label) set.add(label);
  }
  return [...set].sort();
}

export function parseLocalRecommendationQuantBitsFromEntry(entry: unknown): number | null {
  const text = String(entry || '');
  for (const [re, bits] of LOCAL_RECOMMENDATION_QUANT_BITS) {
    if (re.test(text)) return bits;
  }
  return null;
}

export function parseLocalRecommendationQuantLevelFromEntry(entry: unknown): string {
  const match = LOCAL_RECOMMENDATION_QUANT_LEVEL_RE.exec(String(entry || ''));
  return match ? match[1]!.toUpperCase() : '';
}

export function formatLocalRecommendationQuantQualityLabel(bits: number | null): string {
  if (bits === null) return '';
  if (bits >= 16) return 'Lossless';
  if (bits >= 8) return 'High';
  if (bits >= 5) return 'Medium-High';
  if (bits >= 4) return 'Medium';
  if (bits >= 3) return 'Low-Medium';
  return 'Low';
}

export function buildLocalRecommendationHuggingFaceUrl(repo: unknown): string {
  return `https://huggingface.co/${String(repo || '').trim()}`;
}

export function splitLocalRecommendationFeedItems<T extends LocalRecommendationFeedItemLike>(
  items: readonly T[],
): LocalRecommendationFeedSections<T> {
  const topMatches: T[] = [];
  const worthTrying: T[] = [];
  const alreadyInstalled: T[] = [];
  const searchMore: T[] = [];

  for (const item of items) {
    if (item.installedState?.installed) {
      alreadyInstalled.push(item);
      continue;
    }
    const tier = parseLocalRecommendationTierId(item.recommendation?.tier);
    if (tier === 'recommended' || tier === 'runnable') {
      topMatches.push(item);
      continue;
    }
    if (tier === 'tight') {
      worthTrying.push(item);
      continue;
    }
    searchMore.push(item);
  }

  return {
    topMatches,
    worthTrying,
    alreadyInstalled,
    searchMore,
  };
}
