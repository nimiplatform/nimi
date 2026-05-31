import {
  collectLocalRecommendationFeedProviders,
  countLocalRecommendationRunGrades,
  filterLocalRecommendationFeedItems,
  buildLocalRecommendationDetailItems,
  formatLocalRecommendationReasonLabel,
  parseLocalRecommendationLicenseShort,
  parseRuntimeLocalCatalogRecommendation,
  splitLocalRecommendationFeedItems,
  summarizeLocalCatalogRecommendation,
} from '@nimiplatform/sdk/runtime';

export type TesterLocalRecommendationCopyProjection = {
  summary: string;
  reason: string;
  detailCount: number;
  feedSummary: string;
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
  const feedRows = [{
    itemId: 'tester-feed-row',
    repo: 'tester/feed-model',
    title: 'Tester Feed Model 8B',
    recommendation: { tier: 'LOCAL_RECOMMENDATION_TIER_RUNNABLE', recommendedEntry: 'tester-q4.gguf' },
    installPayload: { modelId: 'tester/feed-model', license: 'apache-2.0' },
    installedState: { installed: false },
    entries: [{ entry: 'tester-q4.gguf', totalSizeBytes: 4 }],
  }];
  const feedSections = splitLocalRecommendationFeedItems(feedRows);
  const feedCounts = countLocalRecommendationRunGrades(feedRows);
  const feedProviders = collectLocalRecommendationFeedProviders(feedRows);
  return {
    summary: summarizeLocalCatalogRecommendation(recommendation),
    reason: formatLocalRecommendationReasonLabel('memory_headroom_runnable'),
    detailCount: buildLocalRecommendationDetailItems(recommendation).length,
    feedSummary: [
      filterLocalRecommendationFeedItems(feedRows, 'tester-q4').length,
      feedSections.topMatches.length,
      feedCounts.runs_well,
      feedProviders[0],
      parseLocalRecommendationLicenseShort(feedRows[0]?.installPayload.license),
    ].join('/'),
  };
}
