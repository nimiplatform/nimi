import { describe, expect, it, vi } from 'vitest';
import { computeAgeMonths, computeAgeMonthsAt } from './app-store.js';

describe('app-store age helpers', () => {
  it('computes age in months using the provided record date', () => {
    expect(computeAgeMonthsAt('2024-01-15', '2024-02-14')).toBe(0);
    expect(computeAgeMonthsAt('2024-01-15', '2024-02-15')).toBe(1);
    expect(computeAgeMonthsAt('2024-01-15', '2025-04-16')).toBe(15);
  });

  it('never returns a negative age for backfilled dates before birth', () => {
    expect(computeAgeMonthsAt('2024-05-20', '2024-05-01')).toBe(0);
  });

  it('computeAgeMonths delegates to the current date helper', () => {
    const fakeNow = new Date('2025-03-20T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    expect(computeAgeMonths('2024-01-15')).toBe(computeAgeMonthsAt('2024-01-15', fakeNow.toISOString()));

    vi.useRealTimers();
  });
});
