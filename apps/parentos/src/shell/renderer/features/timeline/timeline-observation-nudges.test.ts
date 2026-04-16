import { describe, it, expect } from 'vitest';
import { computeObservationNudges } from './timeline-observation-nudges.js';
import type { ObservationDimension } from '../../knowledge-base/gen/observation-framework.gen.js';

function makeDim(id: string, displayName: string, parentQuestion: string): ObservationDimension {
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

const dims = [
  makeDim('DIM-A', '专注力', '孩子能不能沉浸在一件事情里？'),
  makeDim('DIM-B', '情绪', '孩子情绪稳定吗？'),
  makeDim('DIM-C', '社交', '孩子和同龄人怎么互动？'),
  makeDim('DIM-D', '独立性', '孩子能自己完成事情吗？'),
];

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

describe('computeObservationNudges', () => {
  it('returns up to 2 nudges when no entries exist', () => {
    const result = computeObservationNudges(dims, []);
    expect(result).toHaveLength(2);
    expect(result[0]!.dimensionId).toBe('DIM-A');
    expect(result[0]!.nudgeText).toBeTruthy();
    expect(result[0]!.parentQuestion).toBe('孩子能不能沉浸在一件事情里？');
  });

  it('only nudges dimensions with zero entries', () => {
    const entries = [
      { dimensionId: 'DIM-A', recordedAt: daysAgo(1) },
      { dimensionId: 'DIM-B', recordedAt: daysAgo(2) },
    ];
    const result = computeObservationNudges(dims, entries);
    // DIM-C and DIM-D have 0 entries
    expect(result).toHaveLength(2);
    expect(result[0]!.dimensionId).toBe('DIM-C');
    expect(result[1]!.dimensionId).toBe('DIM-D');
  });

  it('returns empty when all dimensions have entries', () => {
    const entries = [
      { dimensionId: 'DIM-A', recordedAt: daysAgo(1) },
      { dimensionId: 'DIM-B', recordedAt: daysAgo(2) },
      { dimensionId: 'DIM-C', recordedAt: daysAgo(3) },
      { dimensionId: 'DIM-D', recordedAt: daysAgo(4) },
    ];
    const result = computeObservationNudges(dims, entries);
    expect(result).toHaveLength(0);
  });

  it('ignores entries older than 14 days', () => {
    const entries = [
      { dimensionId: 'DIM-A', recordedAt: daysAgo(20) },
      { dimensionId: 'DIM-B', recordedAt: daysAgo(15) },
    ];
    const result = computeObservationNudges(dims, entries);
    // All entries are outside the window, so all 4 dims have 0 — returns 2 (default max)
    expect(result).toHaveLength(2);
    expect(result[0]!.dimensionId).toBe('DIM-A');
  });

  it('respects maxNudges option', () => {
    const result = computeObservationNudges(dims, [], { maxNudges: 1 });
    expect(result).toHaveLength(1);
  });

  it('returns empty when activeDimensions is empty', () => {
    const result = computeObservationNudges([], []);
    expect(result).toHaveLength(0);
  });

  it('ignores entries with null dimensionId', () => {
    const entries = [
      { dimensionId: null, recordedAt: daysAgo(1) },
      { dimensionId: null, recordedAt: daysAgo(2) },
    ];
    const result = computeObservationNudges(dims, entries);
    expect(result).toHaveLength(2);
  });
});
