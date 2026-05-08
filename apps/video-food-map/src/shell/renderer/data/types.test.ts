import { describe, expect, it } from 'vitest';
import { parseSnapshot } from './types.js';

function buildImport(overrides: Record<string, unknown> = {}) {
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
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:00:00.000Z',
    venues: [],
    ...overrides,
  };
}

describe('parseSnapshot', () => {
  it('surfaces unknown import status as failed instead of succeeded', () => {
    const snapshot = parseSnapshot({
      imports: [buildImport({ status: 'completed_elsewhere' })],
      mapPoints: [],
      creatorSyncs: [],
      stats: {},
    });

    expect(snapshot.imports[0]?.status).toBe('failed');
    expect(snapshot.imports[0]?.errorMessage).toBe('Unknown import status: completed_elsewhere');
  });

  it('preserves known succeeded status', () => {
    const snapshot = parseSnapshot({
      imports: [buildImport({ status: 'succeeded' })],
      mapPoints: [],
      creatorSyncs: [],
      stats: {},
    });

    expect(snapshot.imports[0]?.status).toBe('succeeded');
    expect(snapshot.imports[0]?.errorMessage).toBe('');
  });
});
