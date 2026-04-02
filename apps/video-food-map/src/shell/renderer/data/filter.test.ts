import { describe, expect, it } from 'vitest';
import { filterImports } from './filter.js';
import type { ImportRecord } from './types.js';

function buildImport(overrides: Partial<ImportRecord> = {}): ImportRecord {
  return {
    id: 'import-1',
    sourceUrl: 'https://www.bilibili.com/video/BV1test',
    canonicalUrl: 'https://www.bilibili.com/video/BV1test/',
    bvid: 'BV1test',
    title: '深夜烧烤地图',
    creatorName: '老王探店',
    creatorMid: '123',
    description: '广州烧烤合集',
    tags: ['烧烤', '广州'],
    durationSec: 300,
    status: 'succeeded',
    transcript: '',
    extractionRaw: '',
    videoSummary: '作者在广州找烧烤店',
    uncertainPoints: [],
    audioSourceUrl: '',
    selectedSttModel: '',
    extractionCoverage: null,
    outputDir: '',
    publicCommentCount: 0,
    commentClues: [],
    errorMessage: '',
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:00:00.000Z',
    venues: [{
      id: 'venue-1',
      importId: 'import-1',
      venueName: '炭火小馆',
      addressText: '广州天河',
      recommendedDishes: ['烤鸡翅'],
      cuisineTags: ['烧烤'],
      flavorTags: ['香辣'],
      evidence: ['这家鸡翅真的可以'],
      confidence: 'high',
      recommendationPolarity: 'positive',
      needsReview: false,
      reviewState: 'map_ready',
      geocodeStatus: 'resolved',
      geocodeQuery: '炭火小馆 广州天河',
      latitude: 23.1,
      longitude: 113.3,
      userConfirmed: false,
      isFavorite: false,
      createdAt: '2026-03-30T10:00:00.000Z',
      updatedAt: '2026-03-30T10:00:00.000Z',
    }],
    ...overrides,
  };
}

describe('filterImports', () => {
  it('matches creator, venue, dish, cuisine, flavor, and area text in one search box', () => {
    const records = [buildImport()];
    expect(filterImports(records, '老王', 'all')).toHaveLength(1);
    expect(filterImports(records, '炭火小馆', 'all')).toHaveLength(1);
    expect(filterImports(records, '烤鸡翅', 'all')).toHaveLength(1);
    expect(filterImports(records, '烧烤', 'all')).toHaveLength(1);
    expect(filterImports(records, '香辣', 'all')).toHaveLength(1);
    expect(filterImports(records, '天河', 'all')).toHaveLength(1);
  });

  it('filters by review state and failed imports', () => {
    const baseVenue = buildImport().venues[0]!;
    const reviewRecord = buildImport({
      id: 'review-import',
      venues: [{ ...baseVenue, id: 'venue-review', reviewState: 'review' }],
    });
    const failedImport = buildImport({
      id: 'failed-import',
      status: 'failed',
      venues: [],
    });
    const records = [reviewRecord, failedImport];

    expect(filterImports(records, '', 'review').map((record) => record.id)).toEqual(['review-import']);
    expect(filterImports(records, '', 'failed_import').map((record) => record.id)).toEqual(['failed-import']);
  });
});
