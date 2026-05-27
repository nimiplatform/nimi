import type { ImportRecord, MapPoint } from './types.js';

export type ReviewFilter = 'all' | 'map_ready' | 'review' | 'search_only' | 'failed_import';

function matchesSearch(record: ImportRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    record.title,
    record.creatorName,
    record.creatorMid,
    record.description,
    record.videoSummary,
    ...record.tags,
    ...record.uncertainPoints,
    ...record.venues.flatMap((venue) => [
      venue.venueName,
      venue.addressText,
      ...venue.recommendedDishes,
      ...venue.cuisineTags,
      ...venue.flavorTags,
      ...venue.evidence,
    ]),
  ].join('\n').toLowerCase();
  return haystack.includes(normalized);
}

function matchesReviewState(record: ImportRecord, reviewFilter: ReviewFilter): boolean {
  if (reviewFilter === 'all') {
    return true;
  }
  if (reviewFilter === 'failed_import') {
    return record.status === 'failed';
  }
  return record.venues.some((venue) => venue.reviewState === reviewFilter);
}

export function filterImports(records: ImportRecord[], query: string, reviewFilter: ReviewFilter): ImportRecord[] {
  return records.filter((record) => matchesSearch(record, query) && matchesReviewState(record, reviewFilter));
}

export function filterMapPoints(points: MapPoint[], allowedImportIds: Set<string>): MapPoint[] {
  return points.filter((point) => allowedImportIds.has(point.importId));
}
