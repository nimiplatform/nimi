import { describe, expect, it } from 'vitest';
import { buildMapPointFromVenue } from './app-helpers.js';
import type { ImportRecord, VenueRecord } from './data/types.js';

function buildVenue(overrides: Partial<VenueRecord> = {}): VenueRecord {
  return {
    id: 'venue-1',
    importId: 'import-1',
    venueName: '天巢法国餐厅',
    addressText: '澳门葡京路新葡京酒店43楼',
    recommendedDishes: [],
    cuisineTags: [],
    flavorTags: [],
    evidence: [],
    confidence: 'high',
    recommendationPolarity: 'positive',
    needsReview: false,
    reviewState: 'map_ready',
    geocodeStatus: 'resolved',
    geocodeQuery: '天巢法国餐厅 澳门新葡京',
    latitude: 22.18758,
    longitude: 113.54878,
    userConfirmed: false,
    isFavorite: false,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    ...overrides,
  };
}

function buildImport(): ImportRecord {
  return {
    id: 'import-1',
    sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    canonicalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    bvid: 'BV1xx411c7mD',
    title: '澳门法餐探店',
    creatorName: '米雪食记',
    creatorMid: '123',
    description: '',
    tags: [],
    durationSec: 500,
    status: 'succeeded',
    transcript: '',
    extractionRaw: '',
    videoSummary: '',
    uncertainPoints: [],
    audioSourceUrl: '',
    selectedSttModel: '',
    selectedTextModel: '',
    extractionCoverage: null,
    outputDir: '',
    publicCommentCount: 0,
    commentClues: [],
    errorMessage: '',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    venues: [],
  };
}

describe('buildMapPointFromVenue', () => {
  it('does not build selected-map points for review-only coordinates', () => {
    const point = buildMapPointFromVenue(buildImport(), buildVenue({
      reviewState: 'review',
      needsReview: true,
    }));

    expect(point).toBeNull();
  });

  it('builds selected-map points for map-ready or user-confirmed venues', () => {
    expect(buildMapPointFromVenue(buildImport(), buildVenue({ reviewState: 'map_ready' }))).toMatchObject({
      venueId: 'venue-1',
    });
    expect(buildMapPointFromVenue(buildImport(), buildVenue({
      reviewState: 'review',
      userConfirmed: true,
    }))).toMatchObject({
      venueId: 'venue-1',
      userConfirmed: true,
    });
  });
});
