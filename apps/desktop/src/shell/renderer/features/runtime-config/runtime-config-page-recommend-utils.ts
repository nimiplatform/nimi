import type { LocalRuntimeRecommendationFeedDescriptor, LocalRuntimeRecommendationFeedItemDescriptor } from '@runtime/local-runtime';
import type { CapabilityV11 } from './runtime-config-state-types';

export const RECOMMEND_PAGE_CAPABILITIES = ['chat', 'image', 'video'] as const;

export type RecommendPageCapability = (typeof RECOMMEND_PAGE_CAPABILITIES)[number];

export type RecommendationFeedSections = {
  topMatches: LocalRuntimeRecommendationFeedItemDescriptor[];
  worthTrying: LocalRuntimeRecommendationFeedItemDescriptor[];
  alreadyInstalled: LocalRuntimeRecommendationFeedItemDescriptor[];
  searchMore: LocalRuntimeRecommendationFeedItemDescriptor[];
};

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
