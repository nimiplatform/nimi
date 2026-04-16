import { describe, it, expect } from 'vitest';
import { computeRecommendedPrompts, type RecommendedPrompt } from './journal-recommended-prompts.js';
import type { ObservationDimension } from '../../knowledge-base/gen/observation-framework.gen.js';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';

function makeDimension(id: string, displayName: string, parentQuestion: string): ObservationDimension {
  return {
    dimensionId: id,
    displayName,
    description: '',
    ageRange: { startMonths: 0, endMonths: -1 },
    parentQuestion,
    observableSignals: [],
    guidedQuestions: [],
    quickTags: [],
    source: 'test',
  };
}

function makeEntry(dimensionId: string | null, recordedAt: string): JournalEntryRow {
  return {
    entryId: `e-${Math.random().toString(36).slice(2, 8)}`,
    childId: 'child-1',
    contentType: 'text',
    textContent: 'test',
    voicePath: null,
    photoPaths: null,
    recordedAt,
    ageMonths: 24,
    observationMode: 'quick-capture',
    dimensionId,
    selectedTags: null,
    guidedAnswers: null,
    observationDuration: null,
    keepsake: 0,
    moodTag: null,
    recorderId: null,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  };
}

const dims = [
  makeDimension('DIM-A', '专注力', '孩子能不能沉浸在一件事情里？'),
  makeDimension('DIM-B', '情绪', '孩子情绪稳定吗？'),
  makeDimension('DIM-C', '社交', '孩子和同龄人怎么互动？'),
  makeDimension('DIM-D', '独立性', '孩子能自己完成事情吗？'),
];

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

describe('computeRecommendedPrompts', () => {
  it('returns up to 3 prompts from activeDimensions when there are no entries', () => {
    const result = computeRecommendedPrompts(dims, []);
    expect(result).toHaveLength(3);
    expect(result[0]!.entryCountLast14d).toBe(0);
    expect(result[0]!.dimensionId).toBe('DIM-A');
    expect(result[0]!.parentQuestion).toBe('孩子能不能沉浸在一件事情里？');
  });

  it('identifies least-recorded dimensions', () => {
    const entries = [
      makeEntry('DIM-A', daysAgo(1)),
      makeEntry('DIM-A', daysAgo(2)),
      makeEntry('DIM-A', daysAgo(3)),
      makeEntry('DIM-B', daysAgo(1)),
      makeEntry('DIM-B', daysAgo(2)),
      // DIM-C: 0 entries
      makeEntry('DIM-D', daysAgo(1)),
    ];
    const result = computeRecommendedPrompts(dims, entries, { maxPrompts: 2 });
    expect(result).toHaveLength(2);
    expect(result[0]!.dimensionId).toBe('DIM-C');
    expect(result[0]!.entryCountLast14d).toBe(0);
    expect(result[1]!.dimensionId).toBe('DIM-D');
    expect(result[1]!.entryCountLast14d).toBe(1);
  });

  it('excludes entries older than 14 days', () => {
    const entries = [
      makeEntry('DIM-A', daysAgo(20)), // outside window
      makeEntry('DIM-B', daysAgo(5)),  // inside window
    ];
    const result = computeRecommendedPrompts(dims, entries, { maxPrompts: 4 });
    // DIM-A's old entry should not count
    const dimA = result.find((r) => r.dimensionId === 'DIM-A');
    expect(dimA!.entryCountLast14d).toBe(0);
    const dimB = result.find((r) => r.dimensionId === 'DIM-B');
    expect(dimB!.entryCountLast14d).toBe(1);
  });

  it('ignores entries with null dimensionId', () => {
    const entries = [
      makeEntry(null, daysAgo(1)),
      makeEntry(null, daysAgo(2)),
    ];
    const result = computeRecommendedPrompts(dims, entries);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.entryCountLast14d === 0)).toBe(true);
  });

  it('returns empty array when activeDimensions is empty', () => {
    const result = computeRecommendedPrompts([], [makeEntry('DIM-A', daysAgo(1))]);
    expect(result).toHaveLength(0);
  });

  it('respects custom windowDays', () => {
    const entries = [
      makeEntry('DIM-A', daysAgo(5)), // inside 7-day window
      makeEntry('DIM-B', daysAgo(8)), // outside 7-day window
    ];
    const result = computeRecommendedPrompts(dims, entries, { windowDays: 7, maxPrompts: 4 });
    const dimA = result.find((r) => r.dimensionId === 'DIM-A');
    expect(dimA!.entryCountLast14d).toBe(1);
    const dimB = result.find((r) => r.dimensionId === 'DIM-B');
    expect(dimB!.entryCountLast14d).toBe(0);
  });

  it('respects maxPrompts option', () => {
    const result = computeRecommendedPrompts(dims, [], { maxPrompts: 1 });
    expect(result).toHaveLength(1);
  });
});
