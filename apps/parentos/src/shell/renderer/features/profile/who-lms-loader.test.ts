import { describe, expect, it } from 'vitest';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { canRenderWHOLMS, loadWHOLMS } from './who-lms-loader.js';

describe('who lms loader', () => {
  it('loads the official height dataset with the standard percentile lines', async () => {
    const dataset = await loadWHOLMS('height', 'female', 'who');
    expect(dataset.coverage.startAgeMonths).toBe(0);
    expect(dataset.coverage.endAgeMonths).toBe(228);
    expect(dataset.lines).toHaveLength(7);
    expect(dataset.lines.find((line) => line.percentile === 50)?.points.length ?? 0).toBeGreaterThan(100);
    expect(canRenderWHOLMS(dataset, 72)).toBe(true);
  });

  it('trims head circumference data to the Phase 1 coverage window', async () => {
    const dataset = await loadWHOLMS('head-circumference', 'male', 'who');
    expect(dataset.coverage.endAgeMonths).toBeLessThanOrEqual(36);
    expect(canRenderWHOLMS(dataset, 24)).toBe(true);
    expect(canRenderWHOLMS(dataset, 48)).toBe(false);
  });

  it('keeps weight percentile rendering fail-closed after the official 5-10 year coverage', async () => {
    const dataset = await loadWHOLMS('weight', 'male', 'who');
    expect(dataset.coverage.endAgeMonths).toBe(120);
    expect(canRenderWHOLMS(dataset, 96)).toBe(true);
    expect(canRenderWHOLMS(dataset, 144)).toBe(false);
  });

  it('rejects unsupported non-LMS growth types', async () => {
    await expect(loadWHOLMS('vision-left' as GrowthTypeId, 'female')).rejects.toThrow(
      /LMS dataset is not defined for growth type/,
    );
  });
});
