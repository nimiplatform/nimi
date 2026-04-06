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
  userConfirmed: boolean;
  isFavorite: boolean;
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
  status: 'queued' | 'resolving' | 'geocoding' | 'succeeded' | 'failed' | 'running';
  transcript: string;
  extractionRaw: string;
  videoSummary: string;
  uncertainPoints: string[];
  audioSourceUrl: string;
  selectedSttModel: string;
  selectedTextModel: string;
  extractionCoverage: ExtractionCoverage | null;
  outputDir: string;
  publicCommentCount: number;
  commentClues: CommentClue[];
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  venues: VenueRecord[];
};

export type CommentClue = {
  commentId: string;
  authorName: string;
  message: string;
  likeCount: number;
  publishedAt: string;
  matchedVenueNames: string[];
  addressHint: string;
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
  isFavorite: boolean;
  userConfirmed: boolean;
};

export type SnapshotStats = {
  importCount: number;
  succeededCount: number;
  failedCount: number;
  venueCount: number;
  mappedVenueCount: number;
  reviewVenueCount: number;
  confirmedVenueCount: number;
  favoriteVenueCount: number;
};

export type VideoFoodMapSnapshot = {
  imports: ImportRecord[];
  mapPoints: MapPoint[];
  creatorSyncs: CreatorSyncRecord[];
  stats: SnapshotStats;
};

export type CreatorSyncRecord = {
  creatorMid: string;
  creatorName: string;
  sourceUrl: string;
  lastSyncedAt: string;
  lastScannedCount: number;
  lastQueuedCount: number;
  lastSkippedExistingCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreatorSyncItem = {
  bvid: string;
  title: string;
  canonicalUrl: string;
  publishedAt: string;
  status: 'queued' | 'skipped_existing';
  importId?: string;
  message: string;
};

export type CreatorSyncResult = {
  creatorMid: string;
  creatorName: string;
  sourceUrl: string;
  scannedCount: number;
  queuedCount: number;
  skippedExistingCount: number;
  savedSync?: CreatorSyncRecord;
  items: CreatorSyncItem[];
};

export type VideoFoodMapRouteSource = 'local' | 'cloud';

export type VideoFoodMapRouteSetting = {
  routeSource: VideoFoodMapRouteSource;
  connectorId: string;
  model: string;
};

export type VideoFoodMapDiningProfile = {
  dietaryRestrictions: string[];
  tabooIngredients: string[];
  flavorPreferences: string[];
  cuisinePreferences: string[];
};

export type VideoFoodMapSettings = {
  stt: VideoFoodMapRouteSetting;
  text: VideoFoodMapRouteSetting;
  diningProfile: VideoFoodMapDiningProfile;
};

export type VideoFoodMapRuntimeOption = {
  key: string;
  capability: 'audio.transcribe' | 'text.generate';
  source: VideoFoodMapRouteSource;
  connectorId: string;
  connectorLabel: string;
  provider: string;
  modelId: string;
  modelLabel: string;
  localModelId?: string;
};

export type VideoFoodMapRuntimeOptionsIssue = {
  scope: 'local-models' | 'connectors' | 'connector-models';
  kind: 'timeout' | 'runtime-error';
  message: string;
  connectorId?: string;
  capability?: 'audio.transcribe' | 'text.generate';
};

export type VideoFoodMapRuntimeOptionsCatalog = {
  options: VideoFoodMapRuntimeOption[];
  loadStatus: 'ready' | 'degraded' | 'failed';
  issues: VideoFoodMapRuntimeOptionsIssue[];
};

export type VideoFoodMapRuntimeOptions = {
  stt: VideoFoodMapRuntimeOptionsCatalog;
  text: VideoFoodMapRuntimeOptionsCatalog;
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

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
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
    userConfirmed: Boolean(record.userConfirmed),
    isFavorite: Boolean(record.isFavorite),
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
    status: (
      status === 'queued'
      || status === 'resolving'
      || status === 'geocoding'
      || status === 'failed'
      || status === 'running'
    ) ? status : 'succeeded',
    transcript: String(record.transcript || ''),
    extractionRaw: String(record.extractionRaw || ''),
    videoSummary: asString(record.videoSummary),
    uncertainPoints: asStringArray(record.uncertainPoints),
    audioSourceUrl: asString(record.audioSourceUrl),
    selectedSttModel: asString(record.selectedSttModel),
    selectedTextModel: asString(record.selectedTextModel),
    extractionCoverage: asCoverage(record.extractionCoverage),
    outputDir: asString(record.outputDir),
    publicCommentCount: asNumber(record.publicCommentCount),
    commentClues: Array.isArray(record.commentClues) ? record.commentClues.map(parseCommentClue) : [],
    errorMessage: asString(record.errorMessage),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    venues: Array.isArray(record.venues) ? record.venues.map(parseVenueRecord) : [],
  };
}

function parseCommentClue(value: unknown): CommentClue {
  const record = asRecord(value, 'commentClue');
  return {
    commentId: asString(record.commentId),
    authorName: asString(record.authorName),
    message: asString(record.message),
    likeCount: asNumber(record.likeCount),
    publishedAt: asString(record.publishedAt),
    matchedVenueNames: asStringArray(record.matchedVenueNames),
    addressHint: asString(record.addressHint),
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
    isFavorite: Boolean(record.isFavorite),
    userConfirmed: Boolean(record.userConfirmed),
  };
}

export function parseSnapshot(value: unknown): VideoFoodMapSnapshot {
  const record = asRecord(value, 'snapshot');
  const stats = asRecord(record.stats, 'stats');
  return {
    imports: Array.isArray(record.imports) ? record.imports.map(parseImportRecord) : [],
    mapPoints: Array.isArray(record.mapPoints) ? record.mapPoints.map(parseMapPoint) : [],
    creatorSyncs: Array.isArray(record.creatorSyncs) ? record.creatorSyncs.map(parseCreatorSyncRecord) : [],
    stats: {
      importCount: asNumber(stats.importCount),
      succeededCount: asNumber(stats.succeededCount),
      failedCount: asNumber(stats.failedCount),
      venueCount: asNumber(stats.venueCount),
      mappedVenueCount: asNumber(stats.mappedVenueCount),
      reviewVenueCount: asNumber(stats.reviewVenueCount),
      confirmedVenueCount: asNumber(stats.confirmedVenueCount),
      favoriteVenueCount: asNumber(stats.favoriteVenueCount),
    },
  };
}

export function parseImportRecordResult(value: unknown): ImportRecord {
  return parseImportRecord(value);
}

function parseCreatorSyncRecord(value: unknown): CreatorSyncRecord {
  const record = asRecord(value, 'creatorSyncRecord');
  return {
    creatorMid: asString(record.creatorMid),
    creatorName: asString(record.creatorName),
    sourceUrl: asString(record.sourceUrl),
    lastSyncedAt: asString(record.lastSyncedAt),
    lastScannedCount: asNumber(record.lastScannedCount),
    lastQueuedCount: asNumber(record.lastQueuedCount),
    lastSkippedExistingCount: asNumber(record.lastSkippedExistingCount),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
}

function parseCreatorSyncItem(value: unknown): CreatorSyncItem {
  const record = asRecord(value, 'creatorSyncItem');
  const status = asString(record.status);
  return {
    bvid: asString(record.bvid),
    title: asString(record.title),
    canonicalUrl: asString(record.canonicalUrl),
    publishedAt: asString(record.publishedAt),
    status: status === 'skipped_existing' ? 'skipped_existing' : 'queued',
    importId: asString(record.importId) || undefined,
    message: asString(record.message),
  };
}

export function parseCreatorSyncResult(value: unknown): CreatorSyncResult {
  const record = asRecord(value, 'creatorSyncResult');
  return {
    creatorMid: asString(record.creatorMid),
    creatorName: asString(record.creatorName),
    sourceUrl: asString(record.sourceUrl),
    scannedCount: asNumber(record.scannedCount),
    queuedCount: asNumber(record.queuedCount),
    skippedExistingCount: asNumber(record.skippedExistingCount),
    savedSync: record.savedSync ? parseCreatorSyncRecord(record.savedSync) : undefined,
    items: Array.isArray(record.items) ? record.items.map(parseCreatorSyncItem) : [],
  };
}

function parseRouteSource(value: unknown): VideoFoodMapRouteSource {
  return asString(value) === 'local' ? 'local' : 'cloud';
}

function parseRouteSetting(value: unknown): VideoFoodMapRouteSetting {
  const record = asRecord(value, 'routeSetting');
  return {
    routeSource: parseRouteSource(record.routeSource),
    connectorId: asString(record.connectorId),
    model: asString(record.model),
  };
}

function parseDiningProfile(value: unknown): VideoFoodMapDiningProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      dietaryRestrictions: [],
      tabooIngredients: [],
      flavorPreferences: [],
      cuisinePreferences: [],
    };
  }
  const record = value as Record<string, unknown>;
  return {
    dietaryRestrictions: asStringArray(record.dietaryRestrictions),
    tabooIngredients: asStringArray(record.tabooIngredients),
    flavorPreferences: asStringArray(record.flavorPreferences),
    cuisinePreferences: asStringArray(record.cuisinePreferences),
  };
}

export function parseVideoFoodMapSettings(value: unknown): VideoFoodMapSettings {
  const record = asRecord(value, 'videoFoodMapSettings');
  return {
    stt: parseRouteSetting(record.stt),
    text: parseRouteSetting(record.text),
    diningProfile: parseDiningProfile(record.diningProfile),
  };
}

function parseRuntimeOption(value: unknown): VideoFoodMapRuntimeOption {
  const record = asRecord(value, 'runtimeOption');
  const capability = asString(record.capability);
  return {
    key: asString(record.key),
    capability: capability === 'audio.transcribe' ? 'audio.transcribe' : 'text.generate',
    source: parseRouteSource(record.source),
    connectorId: asString(record.connectorId),
    connectorLabel: asString(record.connectorLabel),
    provider: asString(record.provider),
    modelId: asString(record.modelId),
    modelLabel: asString(record.modelLabel),
    localModelId: asString(record.localModelId) || undefined,
  };
}

function parseRuntimeIssue(value: unknown): VideoFoodMapRuntimeOptionsIssue {
  const record = asRecord(value, 'runtimeIssue');
  const scope = asString(record.scope);
  const kind = asString(record.kind);
  const capability = asString(record.capability);
  return {
    scope: scope === 'local-models' || scope === 'connectors' ? scope : 'connector-models',
    kind: kind === 'timeout' ? 'timeout' : 'runtime-error',
    message: asString(record.message),
    connectorId: asString(record.connectorId) || undefined,
    capability: capability === 'audio.transcribe' || capability === 'text.generate' ? capability : undefined,
  };
}

function parseRuntimeCatalog(value: unknown): VideoFoodMapRuntimeOptionsCatalog {
  const record = asRecord(value, 'runtimeCatalog');
  const loadStatus = asString(record.loadStatus);
  return {
    options: asObjectArray(record.options).map(parseRuntimeOption),
    loadStatus: loadStatus === 'ready' || loadStatus === 'degraded' ? loadStatus : 'failed',
    issues: asObjectArray(record.issues).map(parseRuntimeIssue),
  };
}

export function parseVideoFoodMapRuntimeOptions(value: unknown): VideoFoodMapRuntimeOptions {
  const record = asRecord(value, 'videoFoodMapRuntimeOptions');
  return {
    stt: parseRuntimeCatalog(record.stt),
    text: parseRuntimeCatalog(record.text),
  };
}
