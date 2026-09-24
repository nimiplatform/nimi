import { describe, expect, it } from 'vitest';
import { alignToRepeat, matchesRepeat, nextOccurrence, normalizeRepeat, occurrencesBetween } from '../src/nimiday/domain/recurrence.js';

describe('recurrence', () => {
  it('steps daily repeats by their interval', () => {
    const repeat = normalizeRepeat({ freq: 'daily', interval: 2, anchor: '2026-09-24' });
    expect(nextOccurrence(repeat, '2026-09-24')).toBe('2026-09-26');
    expect(nextOccurrence(repeat, '2026-09-25')).toBe('2026-09-26');
    expect(alignToRepeat(repeat, '2026-09-25')).toBe('2026-09-26');
  });

  it('handles weekly repeats on several weekdays', () => {
    // 2026-09-24 is a Thursday. Trash goes out on Tuesdays and Fridays.
    const repeat = normalizeRepeat({ freq: 'weekly', weekdays: [5, 2], anchor: '2026-09-24' });
    expect(repeat.weekdays).toEqual([2, 5]);
    expect(alignToRepeat(repeat, '2026-09-24')).toBe('2026-09-25');
    expect(nextOccurrence(repeat, '2026-09-25')).toBe('2026-09-29');
    expect(nextOccurrence(repeat, '2026-09-29')).toBe('2026-10-02');
  });

  it('skips weeks for fortnightly repeats', () => {
    const repeat = normalizeRepeat({ freq: 'weekly', interval: 2, weekdays: [1], anchor: '2026-09-21' });
    expect(nextOccurrence(repeat, '2026-09-21')).toBe('2026-10-05');
    expect(matchesRepeat(repeat, '2026-09-28')).toBe(false);
  });

  it('keeps the 31st stable and clamps short months', () => {
    const repeat = normalizeRepeat({ freq: 'monthly', anchor: '2026-01-31' });
    expect(nextOccurrence(repeat, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(repeat, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(repeat, '2026-03-05')).toBe('2026-03-31');
    expect(alignToRepeat(repeat, '2026-04-02')).toBe('2026-04-30');
  });

  it('handles yearly repeats on Feb 29', () => {
    const repeat = normalizeRepeat({ freq: 'yearly', anchor: '2028-02-29' });
    expect(nextOccurrence(repeat, '2028-02-29')).toBe('2029-02-28');
    expect(nextOccurrence(repeat, '2031-03-01')).toBe('2032-02-29');
  });

  it('lists occurrences in a range', () => {
    const repeat = normalizeRepeat({ freq: 'weekly', weekdays: [2, 5], anchor: '2026-09-24' });
    expect(occurrencesBetween(repeat, '2026-09-25', '2026-09-24', '2026-10-06')).toEqual([
      '2026-09-25',
      '2026-09-29',
      '2026-10-02',
      '2026-10-06',
    ]);
  });
});
