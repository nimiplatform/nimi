import { describe, expect, it } from 'vitest';
import { buildStructuredTrendSignals } from './trend-analysis.js';

describe('trend-analysis', () => {
  it('builds deterministic measurement and journal trend signals from local data', () => {
    const signals = buildStructuredTrendSignals({
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-03T00:00:00.000Z',
      measurements: [
        {
          measurementId: 'm-1',
          childId: 'child-1',
          typeId: 'height',
          value: 95.2,
          measuredAt: '2025-12-20T00:00:00.000Z',
          ageMonths: 23,
          percentile: null,
          source: 'manual',
          notes: null,
          createdAt: '2025-12-20T00:00:00.000Z',
        },
        {
          measurementId: 'm-2',
          childId: 'child-1',
          typeId: 'height',
          value: 98.4,
          measuredAt: '2026-04-01T00:00:00.000Z',
          ageMonths: 26,
          percentile: null,
          source: 'manual',
          notes: null,
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      journalEntries: [
        {
          entryId: 'j-1',
          childId: 'child-1',
          contentType: 'voice',
          textContent: null,
          voicePath: 'C:/voice/entry-1.webm',
          photoPaths: null,
          recordedAt: '2026-03-10T00:00:00.000Z',
          ageMonths: 25,
          observationMode: 'five-minute',
          dimensionId: 'PO-OBS-SOCL-001',
          selectedTags: null,
          guidedAnswers: null,
          observationDuration: 5,
          keepsake: 1,
          recorderId: 'mom',
          createdAt: '2026-03-10T00:00:00.000Z',
          updatedAt: '2026-03-10T00:00:00.000Z',
        },
        {
          entryId: 'j-2',
          childId: 'child-1',
          contentType: 'mixed',
          textContent: 'Shared toys.',
          voicePath: 'C:/voice/entry-2.webm',
          photoPaths: null,
          recordedAt: '2026-02-15T00:00:00.000Z',
          ageMonths: 25,
          observationMode: 'quick-capture',
          dimensionId: 'PO-OBS-SOCL-001',
          selectedTags: '["Shared toys"]',
          guidedAnswers: null,
          observationDuration: null,
          keepsake: 0,
          recorderId: 'mom',
          createdAt: '2026-02-15T00:00:00.000Z',
          updatedAt: '2026-02-15T00:00:00.000Z',
        },
      ],
    });

    expect(signals.some((signal) => signal.id === 'measurement-height')).toBe(true);
    expect(signals.some((signal) => signal.id === 'journal-volume')).toBe(true);
    expect(signals.some((signal) => signal.id === 'journal-dimension')).toBe(true);

    const growthSignal = signals.find((signal) => signal.id === 'measurement-height');
    expect(growthSignal?.summary).toMatch(/\+3\.2/);
  });
});
