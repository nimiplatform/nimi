import {
  buildLocalRecommendationDetailItems,
  formatLocalRecommendationReasonLabel,
  parseRuntimeLocalCatalogRecommendation,
  summarizeLocalCatalogRecommendation,
} from '@nimiplatform/sdk/runtime';

export type TesterLocalRecommendationCopyProjection = {
  summary: string;
  reason: string;
  detailCount: number;
};

export function createTesterLocalRecommendationCopyProjection(): TesterLocalRecommendationCopyProjection {
  const recommendation = parseRuntimeLocalCatalogRecommendation({
    source: 'LOCAL_RECOMMENDATION_SOURCE_MEDIA_FIT',
    tier: 'LOCAL_RECOMMENDATION_TIER_RUNNABLE',
    reasonCodes: ['memory_headroom_runnable'],
    recommendedEntry: 'tester-q4.gguf',
    fallbackEntries: ['tester-q5.gguf'],
    baseline: 'LOCAL_RECOMMENDATION_BASELINE_IMAGE_DEFAULT_V1',
  });
  return {
    summary: summarizeLocalCatalogRecommendation(recommendation),
    reason: formatLocalRecommendationReasonLabel('memory_headroom_runnable'),
    detailCount: buildLocalRecommendationDetailItems(recommendation).length,
  };
}
