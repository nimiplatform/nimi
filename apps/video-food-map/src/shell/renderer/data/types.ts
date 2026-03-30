export type ExtractionCoverage = {
  state: 'full' | 'leading_segments_only';
  processedSegmentCount: number;
  processedDurationSec: number;
  totalDurationSec: number;
};

export type VenueRecord = {
  id: string;
  importId: string;
  venueName: string;
  addressText: string;
  recommendedDishes: string[];
  cuisineTags: string[];
  flavorTags: string[];
  evidence: string[];
  confidence: string;
  recommendationPolarity: string;
  needsReview: boolean;
  reviewState: 'map_ready' | 'review' | 'search_only';
  geocodeStatus: 'resolved' | 'failed' | 'skipped';
  geocodeQuery: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ImportRecord = {
  id: string;
  sourceUrl: string;
  canonicalUrl: string;
  bvid: string;
  title: string;
  creatorName: string;
  creatorMid: string;
  description: string;
  tags: string[];
  durationSec: number;
  status: 'succeeded' | 'failed' | 'running';
  transcript: string;
  extractionRaw: string;
  videoSummary: string;
  uncertainPoints: string[];
  audioSourceUrl: string;
  selectedSttModel: string;
  extractionCoverage: ExtractionCoverage | null;
  outputDir: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  venues: VenueRecord[];
};

export type MapPoint = {
  venueId: string;
  importId: string;
  venueName: string;
  creatorName: string;
  title: string;
  addressText: string;
  latitude: number;
  longitude: number;
};

export type SnapshotStats = {
  importCount: number;
  succeededCount: number;
  failedCount: number;
  venueCount: number;
  mappedVenueCount: number;
  reviewVenueCount: number;
};

export type VideoFoodMapSnapshot = {
  imports: ImportRecord[];
  mapPoints: MapPoint[];
  stats: SnapshotStats;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asNumber(value: unknown): number {
  return Number(value || 0);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function asCoverage(value: unknown): ExtractionCoverage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const state = asString(record.state);
  if (state !== 'full' && state !== 'leading_segments_only') {
    return null;
  }
  return {
    state,
    processedSegmentCount: asNumber(record.processedSegmentCount),
    processedDurationSec: asNumber(record.processedDurationSec),
    totalDurationSec: asNumber(record.totalDurationSec),
  };
}

function parseVenueRecord(value: unknown): VenueRecord {
  const record = asRecord(value, 'venue');
  const reviewState = asString(record.reviewState);
  const geocodeStatus = asString(record.geocodeStatus);
  return {
    id: asString(record.id),
    importId: asString(record.importId),
    venueName: asString(record.venueName),
    addressText: asString(record.addressText),
    recommendedDishes: asStringArray(record.recommendedDishes),
    cuisineTags: asStringArray(record.cuisineTags),
    flavorTags: asStringArray(record.flavorTags),
    evidence: asStringArray(record.evidence),
    confidence: asString(record.confidence),
    recommendationPolarity: asString(record.recommendationPolarity),
    needsReview: Boolean(record.needsReview),
    reviewState: reviewState === 'map_ready' || reviewState === 'review' ? reviewState : 'search_only',
    geocodeStatus: geocodeStatus === 'resolved' || geocodeStatus === 'failed' ? geocodeStatus : 'skipped',
    geocodeQuery: asString(record.geocodeQuery),
    latitude: record.latitude == null ? null : Number(record.latitude),
    longitude: record.longitude == null ? null : Number(record.longitude),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
}

function parseImportRecord(value: unknown): ImportRecord {
  const record = asRecord(value, 'import');
  const status = asString(record.status);
  return {
    id: asString(record.id),
    sourceUrl: asString(record.sourceUrl),
    canonicalUrl: asString(record.canonicalUrl),
    bvid: asString(record.bvid),
    title: asString(record.title),
    creatorName: asString(record.creatorName),
    creatorMid: asString(record.creatorMid),
    description: asString(record.description),
    tags: asStringArray(record.tags),
    durationSec: asNumber(record.durationSec),
    status: status === 'failed' || status === 'running' ? status : 'succeeded',
    transcript: String(record.transcript || ''),
    extractionRaw: String(record.extractionRaw || ''),
    videoSummary: asString(record.videoSummary),
    uncertainPoints: asStringArray(record.uncertainPoints),
    audioSourceUrl: asString(record.audioSourceUrl),
    selectedSttModel: asString(record.selectedSttModel),
    extractionCoverage: asCoverage(record.extractionCoverage),
    outputDir: asString(record.outputDir),
    errorMessage: asString(record.errorMessage),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    venues: Array.isArray(record.venues) ? record.venues.map(parseVenueRecord) : [],
  };
}

function parseMapPoint(value: unknown): MapPoint {
  const record = asRecord(value, 'mapPoint');
  return {
    venueId: asString(record.venueId),
    importId: asString(record.importId),
    venueName: asString(record.venueName),
    creatorName: asString(record.creatorName),
    title: asString(record.title),
    addressText: asString(record.addressText),
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
  };
}

export function parseSnapshot(value: unknown): VideoFoodMapSnapshot {
  const record = asRecord(value, 'snapshot');
  const stats = asRecord(record.stats, 'stats');
  return {
    imports: Array.isArray(record.imports) ? record.imports.map(parseImportRecord) : [],
    mapPoints: Array.isArray(record.mapPoints) ? record.mapPoints.map(parseMapPoint) : [],
    stats: {
      importCount: asNumber(stats.importCount),
      succeededCount: asNumber(stats.succeededCount),
      failedCount: asNumber(stats.failedCount),
      venueCount: asNumber(stats.venueCount),
      mappedVenueCount: asNumber(stats.mappedVenueCount),
      reviewVenueCount: asNumber(stats.reviewVenueCount),
    },
  };
}

export function parseImportRecordResult(value: unknown): ImportRecord {
  return parseImportRecord(value);
}
