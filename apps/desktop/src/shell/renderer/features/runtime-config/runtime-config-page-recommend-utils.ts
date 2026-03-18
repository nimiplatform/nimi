import type {
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedItemDescriptor,
} from '@runtime/local-runtime';
import type { CapabilityV11 } from './runtime-config-state-types';

export const RECOMMEND_PAGE_CAPABILITIES = ['chat', 'image', 'video'] as const;

export type RecommendPageCapability = (typeof RECOMMEND_PAGE_CAPABILITIES)[number];

export type RecommendationFeedSections = {
  topMatches: LocalRuntimeRecommendationFeedItemDescriptor[];
  worthTrying: LocalRuntimeRecommendationFeedItemDescriptor[];
  alreadyInstalled: LocalRuntimeRecommendationFeedItemDescriptor[];
  searchMore: LocalRuntimeRecommendationFeedItemDescriptor[];
};

// ---------------------------------------------------------------------------
// Grade (display tier) — maps internal tiers to CanIRun-style labels
// ---------------------------------------------------------------------------

export type RecommendGrade = 'runs_great' | 'runs_well' | 'tight_fit' | 'not_recommended';

export const RECOMMEND_GRADES: RecommendGrade[] = [
  'runs_great',
  'runs_well',
  'tight_fit',
  'not_recommended',
];

const TIER_TO_GRADE: Record<string, RecommendGrade> = {
  recommended: 'runs_great',
  runnable: 'runs_well',
  tight: 'tight_fit',
  not_recommended: 'not_recommended',
};

export function tierToGrade(tier?: LocalRuntimeCatalogRecommendation['tier']): RecommendGrade {
  return TIER_TO_GRADE[tier || ''] || 'not_recommended';
}

export function gradeLabel(grade: RecommendGrade): string {
  if (grade === 'runs_great') return 'Runs Great';
  if (grade === 'runs_well') return 'Runs Well';
  if (grade === 'tight_fit') return 'Tight Fit';
  return 'Not Recommended';
}

export function gradeColorClass(grade: RecommendGrade): string {
  if (grade === 'runs_great') return 'bg-emerald-100 text-emerald-700';
  if (grade === 'runs_well') return 'bg-green-100 text-green-700';
  if (grade === 'tight_fit') return 'bg-amber-100 text-amber-700';
  return 'bg-rose-100 text-rose-700';
}

export function gradeDotClass(grade: RecommendGrade): string {
  if (grade === 'runs_great') return 'bg-emerald-500';
  if (grade === 'runs_well') return 'bg-green-500';
  if (grade === 'tight_fit') return 'bg-amber-500';
  return 'bg-rose-500';
}

// ---------------------------------------------------------------------------
// Tier counts (summary bar)
// ---------------------------------------------------------------------------

export type TierCounts = Record<RecommendGrade, number>;

export function computeTierCounts(items: LocalRuntimeRecommendationFeedItemDescriptor[]): TierCounts {
  const counts: TierCounts = { runs_great: 0, runs_well: 0, tight_fit: 0, not_recommended: 0 };
  for (const item of items) {
    const grade = tierToGrade(item.recommendation?.tier);
    counts[grade] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Parse helpers — extract structured data from existing fields
// ---------------------------------------------------------------------------

const PARAM_RE = /\b(\d+(?:\.\d+)?)\s*[Bb]\b/;

export function parseParamsFromTitle(title: string): string {
  const match = PARAM_RE.exec(title);
  return match ? `${match[1]}B` : '';
}

export function parseLicenseShort(license?: string): string {
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
  if (raw.length > 20) return raw.slice(0, 18) + '…';
  return raw;
}

export function licenseColorClass(label: string): string {
  if (label.startsWith('Apache')) return 'bg-green-100 text-green-700 border-green-200';
  if (label === 'MIT') return 'bg-sky-100 text-sky-700 border-sky-200';
  if (label.startsWith('Llama')) return 'bg-orange-100 text-orange-700 border-orange-200';
  if (label.startsWith('Gemma')) return 'bg-purple-100 text-purple-700 border-purple-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

export function parseProviderFromRepo(repo: string): string {
  const org = repo.split('/')[0]?.toLowerCase() || '';
  if (org.includes('meta') || org.includes('llama')) return 'Meta';
  if (org.includes('qwen') || org.includes('alibaba') || org.includes('dashscope')) return 'Alibaba';
  if (org.includes('google') || org.includes('gemma')) return 'Google';
  if (org.includes('mistral')) return 'Mistral';
  if (org.includes('microsoft') || org.includes('phi')) return 'Microsoft';
  if (org.includes('deepseek')) return 'DeepSeek';
  if (org.includes('stabilityai') || org.includes('stability')) return 'Stability AI';
  if (org.includes('black-forest') || org.includes('flux')) return 'Black Forest Labs';
  if (org.includes('openai')) return 'OpenAI';
  if (org.includes('nvidia')) return 'NVIDIA';
  if (org.includes('tencent')) return 'Tencent';
  if (org.includes('01-ai') || org.includes('yi')) return '01.AI';
  if (org.includes('cohere')) return 'Cohere';
  if (org.includes('nous') || org.includes('nousresearch')) return 'NousResearch';
  if (org.includes('thebloke')) return 'TheBloke';
  if (org.includes('bartowski')) return 'bartowski';
  if (org.includes('unsloth')) return 'Unsloth';
  if (org.includes('lmstudio') || org.includes('lm-studio')) return 'LM Studio';
  return org || 'Unknown';
}

// ---------------------------------------------------------------------------
// Model size helpers
// ---------------------------------------------------------------------------

export function primaryEntrySize(item: LocalRuntimeRecommendationFeedItemDescriptor): number {
  const entries = item.entries;
  if (!entries || entries.length === 0) return 0;
  const recommended = item.recommendation?.recommendedEntry;
  if (recommended) {
    const match = entries.find((e) => e.entry === recommended);
    if (match) return match.totalSizeBytes;
  }
  const first = entries[0];
  return first ? first.totalSizeBytes : 0;
}

export function computeVramPercentage(
  modelSizeBytes: number,
  totalVramBytes?: number,
): number | null {
  if (!totalVramBytes || totalVramBytes <= 0 || modelSizeBytes <= 0) return null;
  return Math.round((modelSizeBytes / totalVramBytes) * 100);
}

export function vramPercentageColorClass(pct: number | null): string {
  if (pct === null) return 'text-slate-400';
  if (pct <= 50) return 'text-emerald-600';
  if (pct <= 80) return 'text-amber-600';
  if (pct <= 100) return 'text-orange-600';
  return 'text-rose-600';
}

export function vramBarColorClass(pct: number | null): string {
  if (pct === null) return 'bg-slate-200';
  if (pct <= 50) return 'bg-emerald-400';
  if (pct <= 80) return 'bg-amber-400';
  if (pct <= 100) return 'bg-orange-400';
  return 'bg-rose-400';
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export type RecommendSortKey = 'score' | 'size' | 'downloads' | 'likes' | 'updated' | 'name';

export const RECOMMEND_SORT_OPTIONS: { value: RecommendSortKey; label: string }[] = [
  { value: 'score', label: 'Score' },
  { value: 'size', label: 'Size' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'likes', label: 'Likes' },
  { value: 'updated', label: 'Last Updated' },
  { value: 'name', label: 'Name' },
];

const TIER_RANK: Record<string, number> = {
  recommended: 0,
  runnable: 1,
  tight: 2,
  not_recommended: 3,
};

export function sortFeedItems(
  items: LocalRuntimeRecommendationFeedItemDescriptor[],
  sortKey: RecommendSortKey,
): LocalRuntimeRecommendationFeedItemDescriptor[] {
  return [...items].sort((a, b) => {
    if (sortKey === 'score') {
      const at = TIER_RANK[a.recommendation?.tier || ''] ?? 4;
      const bt = TIER_RANK[b.recommendation?.tier || ''] ?? 4;
      if (at !== bt) return at - bt;
      return (b.downloads || 0) - (a.downloads || 0);
    }
    if (sortKey === 'size') {
      return primaryEntrySize(a) - primaryEntrySize(b);
    }
    if (sortKey === 'downloads') {
      return (b.downloads || 0) - (a.downloads || 0);
    }
    if (sortKey === 'likes') {
      return (b.likes || 0) - (a.likes || 0);
    }
    if (sortKey === 'updated') {
      return (b.lastModified || '').localeCompare(a.lastModified || '');
    }
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
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
  return items.filter((item) => {
    if (!recommendationFeedMatchesQuery(item, filters.query)) return false;
    if (filters.grades.size > 0) {
      const grade = tierToGrade(item.recommendation?.tier);
      if (!filters.grades.has(grade)) return false;
    }
    if (filters.providers.size > 0) {
      const provider = parseProviderFromRepo(item.repo);
      if (!filters.providers.has(provider)) return false;
    }
    if (filters.licenses.size > 0) {
      const license = parseLicenseShort(item.installPayload.license);
      if (!license || !filters.licenses.has(license)) return false;
    }
    return true;
  });
}

export function collectUniqueProviders(items: LocalRuntimeRecommendationFeedItemDescriptor[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    set.add(parseProviderFromRepo(item.repo));
  }
  return [...set].sort();
}

export function collectUniqueLicenses(items: LocalRuntimeRecommendationFeedItemDescriptor[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const label = parseLicenseShort(item.installPayload.license);
    if (label) set.add(label);
  }
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Quantization parse helpers — extract structured quant data from entry names
// ---------------------------------------------------------------------------

const QUANT_BITS_MAP: [RegExp, number][] = [
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

export function parseQuantBitsFromEntry(entry: string): number | null {
  for (const [re, bits] of QUANT_BITS_MAP) {
    if (re.test(entry)) return bits;
  }
  return null;
}

const QUANT_LEVEL_RE = /\b(F32|F16|BF16|Q[2-8]_[A-Z0-9_]+|Q[2-8]_[0-9]+|IQ[1-4]_[A-Z0-9_]+)\b/i;

export function parseQuantLevelFromEntry(entry: string): string {
  const match = QUANT_LEVEL_RE.exec(entry);
  return match ? match[1]!.toUpperCase() : '';
}

export function quantQualityLabel(bits: number | null): string {
  if (bits === null) return '';
  if (bits >= 16) return 'Lossless';
  if (bits >= 8) return 'High';
  if (bits >= 5) return 'Medium-High';
  if (bits >= 4) return 'Medium';
  if (bits >= 3) return 'Low-Medium';
  return 'Low';
}

export function quantQualityColorClass(label: string): string {
  if (label === 'Lossless') return 'text-emerald-600 bg-emerald-50';
  if (label === 'High') return 'text-green-600 bg-green-50';
  if (label === 'Medium-High') return 'text-sky-600 bg-sky-50';
  if (label === 'Medium') return 'text-amber-600 bg-amber-50';
  if (label === 'Low-Medium') return 'text-orange-600 bg-orange-50';
  if (label === 'Low') return 'text-rose-600 bg-rose-50';
  return 'text-slate-500 bg-slate-50';
}

export function buildHuggingFaceUrl(repo: string): string {
  return `https://huggingface.co/${repo}`;
}

// ---------------------------------------------------------------------------
// Original exports (preserved for backward compat)
// ---------------------------------------------------------------------------

export function normalizeRecommendPageCapability(value: CapabilityV11 | string | undefined): RecommendPageCapability {
  if (value === 'image' || value === 'video') {
    return value;
  }
  return 'chat';
}

export function recommendationFeedMatchesQuery(
  item: LocalRuntimeRecommendationFeedItemDescriptor,
  query: string,
): boolean {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const fields = [
    item.title,
    item.repo,
    item.description,
    item.installPayload.modelId,
    item.recommendation?.recommendedEntry,
    ...(item.tags || []),
    ...(item.capabilities || []),
    ...(item.formats || []),
  ];
  return fields.some((value) => String(value || '').toLowerCase().includes(normalized));
}

export function filterRecommendationFeedItems(
  items: LocalRuntimeRecommendationFeedItemDescriptor[],
  query: string,
): LocalRuntimeRecommendationFeedItemDescriptor[] {
  return items.filter((item) => recommendationFeedMatchesQuery(item, query));
}

export function splitRecommendationFeedItems(
  items: LocalRuntimeRecommendationFeedItemDescriptor[],
): RecommendationFeedSections {
  const topMatches: LocalRuntimeRecommendationFeedItemDescriptor[] = [];
  const worthTrying: LocalRuntimeRecommendationFeedItemDescriptor[] = [];
  const alreadyInstalled: LocalRuntimeRecommendationFeedItemDescriptor[] = [];
  const searchMore: LocalRuntimeRecommendationFeedItemDescriptor[] = [];

  for (const item of items) {
    if (item.installedState.installed) {
      alreadyInstalled.push(item);
      continue;
    }
    const tier = item.recommendation?.tier;
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

export function recommendationFeedCacheSummary(
  feed: LocalRuntimeRecommendationFeedDescriptor | null,
): 'fresh' | 'stale' | 'empty' {
  if (!feed) {
    return 'empty';
  }
  return feed.cacheState;
}
