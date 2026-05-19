import { describe, expect, it } from 'vitest';
import {
  GROWTH_MILESTONE_RULES,
  type GrowthMilestoneRule,
  type GrowthMilestoneMeasurementDensityTrigger,
  type GrowthMilestonePercentileShiftTrigger,
  type GrowthMilestoneThresholdCrossedTrigger,
} from '../../knowledge-base/index.js';
import type { WHOLMSDataset } from './who-lms-loader.js';
import {
  evaluateAllMilestones,
  evaluateMeasurementDensity,
  evaluatePercentileShift,
  evaluateThresholdCrossed,
  type HistoryPoint,
} from './growth-milestone-rules.js';

const NOW = '2026-05-18T12:00:00.000Z';

function findRule(ruleId: string): GrowthMilestoneRule {
  const rule = GROWTH_MILESTONE_RULES.find((r) => r.ruleId === ruleId);
  if (!rule) throw new Error(`Test fixture missing rule ${ruleId}`);
  return rule;
}

function isoDaysBefore(nowIso: string, days: number): string {
  const nowMs = Date.parse(nowIso);
  return new Date(nowMs - days * 86400000).toISOString();
}

function makePoint(overrides: Partial<HistoryPoint> & { eventId: string }): HistoryPoint {
  return {
    measuredAt: NOW,
    ageMonths: 100,
    value: 0,
    metricId: 'growth.height',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Threshold-crossed boundary tests (rule: growth-milestone-height-threshold-140cm)
// ---------------------------------------------------------------------------

describe('evaluateThresholdCrossed', () => {
  const rule140 = findRule('growth-milestone-height-threshold-140cm') as GrowthMilestoneRule & {
    triggerCondition: GrowthMilestoneThresholdCrossedTrigger;
  };

  it('returns null when the most recent point sits just under threshold (139 cm)', () => {
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'e1', measuredAt: isoDaysBefore(NOW, 90), value: 138 }),
      makePoint({ eventId: 'e2', measuredAt: isoDaysBefore(NOW, 30), value: 139 }),
    ];
    expect(evaluateThresholdCrossed(rule140, history, NOW)).toBeNull();
  });

  it('fires milestone when crossing exactly at the threshold value (140 cm)', () => {
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'e1', measuredAt: isoDaysBefore(NOW, 90), value: 139 }),
      makePoint({ eventId: 'e2', measuredAt: isoDaysBefore(NOW, 30), value: 140 }),
    ];
    const milestone = evaluateThresholdCrossed(rule140, history, NOW);
    expect(milestone).not.toBeNull();
    expect(milestone!.title).toBe('突破 140 cm');
    expect(milestone!.evidenceEventIds).toEqual(['e1', 'e2']);
  });

  it('fires milestone for a crossing point just over threshold (141 cm)', () => {
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'e1', measuredAt: isoDaysBefore(NOW, 90), value: 139 }),
      makePoint({ eventId: 'e2', measuredAt: isoDaysBefore(NOW, 30), value: 141 }),
    ];
    const milestone = evaluateThresholdCrossed(rule140, history, NOW);
    expect(milestone).not.toBeNull();
    expect(milestone!.title).toBe('突破 140 cm');
  });

  it('returns the first crossing only when multiple post-threshold points exist (no duplicates within window)', () => {
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'e1', measuredAt: isoDaysBefore(NOW, 120), value: 139 }),
      makePoint({ eventId: 'e2', measuredAt: isoDaysBefore(NOW, 90), value: 141 }),
      makePoint({ eventId: 'e3', measuredAt: isoDaysBefore(NOW, 30), value: 143 }),
    ];
    const milestone = evaluateThresholdCrossed(rule140, history, NOW);
    expect(milestone).not.toBeNull();
    // Earliest crossing pair (e1 → e2) is the evidence; e3 should NOT replace
    // it and there must be no second milestone for the same threshold.
    expect(milestone!.evidenceEventIds).toEqual(['e1', 'e2']);
  });

  it('honors all admitted threshold values 100/110/120/130/140/150/160/170 cm', () => {
    for (const value of [100, 110, 120, 130, 140, 150, 160, 170]) {
      const ruleId = `growth-milestone-height-threshold-${value}cm`;
      const rule = findRule(ruleId) as GrowthMilestoneRule & {
        triggerCondition: GrowthMilestoneThresholdCrossedTrigger;
      };
      const history: HistoryPoint[] = [
        makePoint({ eventId: 'a', measuredAt: isoDaysBefore(NOW, 60), value: value - 1 }),
        makePoint({ eventId: 'b', measuredAt: isoDaysBefore(NOW, 10), value }),
      ];
      const milestone = evaluateThresholdCrossed(rule, history, NOW);
      expect(milestone, `threshold ${value} cm should fire when crossing exactly`).not.toBeNull();
      expect(milestone!.title).toBe(`突破 ${value} cm`);
    }
  });
});

// ---------------------------------------------------------------------------
// Percentile-shift boundary tests
// ---------------------------------------------------------------------------

function makeFlatWhoDataset(): WHOLMSDataset {
  // Construct a synthetic WHO dataset where the 7 standard percentile lines
  // are flat across the age range we use. computeApproxPercentile interpolates
  // between lines by value, so this gives us a deterministic mapping:
  // value 100 → P3, 105 → P10, 110 → P25, 115 → P50, 120 → P75, 125 → P90,
  // 130 → P97 (with linear interpolation between).
  const percentiles = [3, 10, 25, 50, 75, 90, 97];
  const valueByPercentile: Record<number, number> = {
    3: 100,
    10: 105,
    25: 110,
    50: 115,
    75: 120,
    90: 125,
    97: 130,
  };
  return {
    typeId: 'height',
    gender: 'male',
    coverage: { startAgeMonths: 0, endAgeMonths: 240 },
    points: [],
    lines: percentiles.map((p) => ({
      percentile: p,
      points: Array.from({ length: 25 }, (_, i) => ({
        ageMonths: i * 12,
        value: valueByPercentile[p]!,
      })),
    })),
    standard: 'who',
  } as unknown as WHOLMSDataset;
}

describe('evaluatePercentileShift', () => {
  const ruleUp = findRule('growth-milestone-percentile-shift-up') as GrowthMilestoneRule & {
    triggerCondition: GrowthMilestonePercentileShiftTrigger;
  };
  const ruleDown = findRule('growth-milestone-percentile-shift-down') as GrowthMilestoneRule & {
    triggerCondition: GrowthMilestonePercentileShiftTrigger;
  };
  const dataset = makeFlatWhoDataset();

  it('returns null without a WHO dataset', () => {
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'a', measuredAt: isoDaysBefore(NOW, 200), value: 110 }),
      makePoint({ eventId: 'b', measuredAt: isoDaysBefore(NOW, 10), value: 130 }),
    ];
    expect(evaluatePercentileShift(ruleUp, history, null, NOW)).toBeNull();
  });

  it('returns null when magnitude is exactly minMagnitudePoints − 1 (4)', () => {
    // Value 111 ≈ P28, value 115 = P50 → shift +22. We need shift exactly 4.
    // Use P50=115 → P54-ish requires careful values. Easier: just craft +4
    // delta directly. P50 = 115, P54 ≈ 115.4. Use 115 → 115.8 = shift +4
    // via interpolation (115 + (120-115)*0.16 = 115.8 → P50+(75-50)*0.16=54).
    // Easier path: dataset already encodes the lines flat per percentile.
    // Use 115 (P50) and 116 (between P50 and P75 → 50 + 25*(1/5)=55, shift 5).
    // So 115 and 115.8 → 50 and 54 = +4.
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'a', measuredAt: isoDaysBefore(NOW, 200), value: 115 }),
      makePoint({ eventId: 'b', measuredAt: isoDaysBefore(NOW, 10), value: 115.8 }),
    ];
    expect(evaluatePercentileShift(ruleUp, history, dataset, NOW)).toBeNull();
  });

  it('fires when upward magnitude is exactly minMagnitudePoints (5)', () => {
    // 115 → P50; 116 → 50 + 25*(1/5) = 55. Shift = +5.
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'a', measuredAt: isoDaysBefore(NOW, 200), value: 115 }),
      makePoint({ eventId: 'b', measuredAt: isoDaysBefore(NOW, 10), value: 116 }),
    ];
    const milestone = evaluatePercentileShift(ruleUp, history, dataset, NOW);
    expect(milestone).not.toBeNull();
    expect(milestone!.ruleId).toBe('growth-milestone-percentile-shift-up');
    expect(milestone!.evidenceEventIds).toEqual(['a', 'b']);
  });

  it('fires when upward magnitude is +1 above threshold (6)', () => {
    // 115 → P50; 116.2 → 50 + 25*(1.2/5) = 56. Shift = +6.
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'a', measuredAt: isoDaysBefore(NOW, 200), value: 115 }),
      makePoint({ eventId: 'b', measuredAt: isoDaysBefore(NOW, 10), value: 116.2 }),
    ];
    const milestone = evaluatePercentileShift(ruleUp, history, dataset, NOW);
    expect(milestone).not.toBeNull();
  });

  it('fires the downward rule on a -5 shift', () => {
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'a', measuredAt: isoDaysBefore(NOW, 200), value: 116 }),
      makePoint({ eventId: 'b', measuredAt: isoDaysBefore(NOW, 10), value: 115 }),
    ];
    const milestone = evaluatePercentileShift(ruleDown, history, dataset, NOW);
    expect(milestone).not.toBeNull();
    expect(milestone!.ruleId).toBe('growth-milestone-percentile-shift-down');
  });
});

// ---------------------------------------------------------------------------
// Measurement-density boundary tests
// ---------------------------------------------------------------------------

describe('evaluateMeasurementDensity', () => {
  const rule = findRule('growth-milestone-measurement-density-spike') as GrowthMilestoneRule & {
    triggerCondition: GrowthMilestoneMeasurementDensityTrigger;
  };

  it('returns null when count is minCount − 1 (4 records)', () => {
    const history: HistoryPoint[] = Array.from({ length: 4 }, (_, i) =>
      makePoint({
        eventId: `e${i}`,
        measuredAt: isoDaysBefore(NOW, 10),
        value: 100,
        metricId: 'growth.height',
      }),
    );
    expect(evaluateMeasurementDensity(rule, history, NOW)).toBeNull();
  });

  it('fires when count is exactly minCount (5 records inside windowDays)', () => {
    const history: HistoryPoint[] = Array.from({ length: 5 }, (_, i) =>
      makePoint({
        eventId: `e${i}`,
        // All within a single day window (windowDays = 1).
        measuredAt: isoDaysBefore(NOW, 10) + (i === 0 ? '' : ''),
        value: 100 + i,
        metricId: 'growth.height',
      }),
    );
    const milestone = evaluateMeasurementDensity(rule, history, NOW);
    expect(milestone).not.toBeNull();
    expect(milestone!.evidenceEventIds).toHaveLength(5);
  });

  it('fires when count is minCount + 1 (6 records inside windowDays)', () => {
    const history: HistoryPoint[] = Array.from({ length: 6 }, (_, i) =>
      makePoint({
        eventId: `e${i}`,
        measuredAt: isoDaysBefore(NOW, 10),
        value: 100 + i,
        metricId: 'growth.height',
      }),
    );
    const milestone = evaluateMeasurementDensity(rule, history, NOW);
    expect(milestone).not.toBeNull();
    expect(milestone!.evidenceEventIds.length).toBeGreaterThanOrEqual(5);
  });

  it('returns null when 5 records span more than windowDays apart', () => {
    // Spread points across 10 days (> 1-day window).
    const history: HistoryPoint[] = Array.from({ length: 5 }, (_, i) =>
      makePoint({
        eventId: `e${i}`,
        measuredAt: isoDaysBefore(NOW, 10 + i * 3),
        value: 100,
        metricId: 'growth.height',
      }),
    );
    expect(evaluateMeasurementDensity(rule, history, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Evidence-window boundary tests
// ---------------------------------------------------------------------------

describe('evidence window enforcement', () => {
  const ruleHeight140 = findRule('growth-milestone-height-threshold-140cm') as GrowthMilestoneRule & {
    triggerCondition: GrowthMilestoneThresholdCrossedTrigger;
  };

  it('includes an oldest point that sits just inside the 12-month window', () => {
    // ~360 days ago — well inside a 12-month window (≈ 365.24 days).
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'old', measuredAt: isoDaysBefore(NOW, 360), value: 139 }),
      makePoint({ eventId: 'recent', measuredAt: isoDaysBefore(NOW, 10), value: 141 }),
    ];
    const milestone = evaluateThresholdCrossed(ruleHeight140, history, NOW);
    expect(milestone).not.toBeNull();
  });

  it('excludes an oldest point that sits just outside the 12-month window', () => {
    // ~400 days ago — outside the 12-month window. The recent point alone
    // cannot demonstrate a crossing → null.
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'old', measuredAt: isoDaysBefore(NOW, 400), value: 139 }),
      makePoint({ eventId: 'recent', measuredAt: isoDaysBefore(NOW, 10), value: 141 }),
    ];
    expect(evaluateThresholdCrossed(ruleHeight140, history, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism — same input twice yields structurally equal output incl. ids
// ---------------------------------------------------------------------------

describe('evaluateAllMilestones determinism', () => {
  it('produces identical milestone arrays (including milestoneId) when called twice with the same input', () => {
    const dataset = makeFlatWhoDataset();
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'h1', measuredAt: isoDaysBefore(NOW, 200), value: 139 }),
      makePoint({ eventId: 'h2', measuredAt: isoDaysBefore(NOW, 30), value: 141 }),
      makePoint({ eventId: 'h3', measuredAt: isoDaysBefore(NOW, 5), value: 142 }),
      makePoint({
        eventId: 'p1',
        measuredAt: isoDaysBefore(NOW, 200),
        value: 115,
        ageMonths: 96,
      }),
      makePoint({
        eventId: 'p2',
        measuredAt: isoDaysBefore(NOW, 10),
        value: 116.5,
        ageMonths: 108,
      }),
    ];
    const first = evaluateAllMilestones(history, dataset, NOW);
    const second = evaluateAllMilestones(history, dataset, NOW);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    // milestoneId must be present and non-empty for every entry.
    for (const m of first) {
      expect(m.milestoneId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('produces a different milestoneId when evidenceEventIds differ but ruleId is the same', () => {
    const history1: HistoryPoint[] = [
      makePoint({ eventId: 'x1', measuredAt: isoDaysBefore(NOW, 200), value: 139 }),
      makePoint({ eventId: 'x2', measuredAt: isoDaysBefore(NOW, 30), value: 141 }),
    ];
    const history2: HistoryPoint[] = [
      makePoint({ eventId: 'y1', measuredAt: isoDaysBefore(NOW, 200), value: 139 }),
      makePoint({ eventId: 'y2', measuredAt: isoDaysBefore(NOW, 30), value: 141 }),
    ];
    const a = evaluateAllMilestones(history1, null, NOW);
    const b = evaluateAllMilestones(history2, null, NOW);
    expect(a[0]!.ruleId).toBe(b[0]!.ruleId);
    expect(a[0]!.milestoneId).not.toBe(b[0]!.milestoneId);
  });
});
