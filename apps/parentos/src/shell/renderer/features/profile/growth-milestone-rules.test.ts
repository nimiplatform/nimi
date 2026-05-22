import { describe, expect, it } from 'vitest';
import {
  GROWTH_MILESTONE_RULES,
  type GrowthMilestoneRule,
  type GrowthMilestoneThresholdCrossedTrigger,
  type GrowthMilestoneRelativeChangeTrigger,
} from '../../knowledge-base/index.js';
import {
  evaluateAllMilestones,
  evaluateRelativeChange,
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

  it('fires for a crossing far outside the 12-month window when fullHistory is set', () => {
    // Both points predate the 12-month window. The history table evaluates
    // with fullHistory=true so historical threshold crossings still surface.
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'old-prior', measuredAt: isoDaysBefore(NOW, 1100), value: 139 }),
      makePoint({ eventId: 'old-cross', measuredAt: isoDaysBefore(NOW, 900), value: 141 }),
    ];
    expect(evaluateThresholdCrossed(ruleHeight140, history, NOW)).toBeNull();
    const milestone = evaluateThresholdCrossed(ruleHeight140, history, NOW, true);
    expect(milestone).not.toBeNull();
    expect(milestone!.title).toBe('突破 140 cm');
    expect(milestone!.evidenceEventIds).toEqual(['old-prior', 'old-cross']);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same input twice yields structurally equal output incl. ids
// ---------------------------------------------------------------------------

describe('evaluateAllMilestones determinism', () => {
  it('produces identical milestone arrays (including milestoneId) when called twice with the same input', () => {
    const history: HistoryPoint[] = [
      makePoint({ eventId: 'h1', measuredAt: isoDaysBefore(NOW, 200), value: 139 }),
      makePoint({ eventId: 'h2', measuredAt: isoDaysBefore(NOW, 30), value: 141 }),
      makePoint({ eventId: 'h3', measuredAt: isoDaysBefore(NOW, 5), value: 142 }),
    ];
    const first = evaluateAllMilestones(history, NOW);
    const second = evaluateAllMilestones(history, NOW);
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
    const a = evaluateAllMilestones(history1, NOW);
    const b = evaluateAllMilestones(history2, NOW);
    expect(a[0]!.ruleId).toBe(b[0]!.ruleId);
    expect(a[0]!.milestoneId).not.toBe(b[0]!.milestoneId);
  });
});

// ---------------------------------------------------------------------------
// Relative-change weight nodes (rules: growth-milestone-weight-rise/drop-10pct)
// ---------------------------------------------------------------------------

describe('evaluateRelativeChange', () => {
  const dropRule = findRule('growth-milestone-weight-drop-10pct') as GrowthMilestoneRule & {
    triggerCondition: GrowthMilestoneRelativeChangeTrigger;
  };
  const riseRule = findRule('growth-milestone-weight-rise-10pct') as GrowthMilestoneRule & {
    triggerCondition: GrowthMilestoneRelativeChangeTrigger;
  };

  function weightPoint(eventId: string, daysBefore: number, value: number): HistoryPoint {
    return makePoint({
      eventId,
      measuredAt: isoDaysBefore(NOW, daysBefore),
      value,
      metricId: 'growth.weight',
    });
  }

  it('fires a negative node when weight drops >=10% versus the previous record', () => {
    const history = [weightPoint('w1', 90, 20), weightPoint('w2', 30, 17)];
    const nodes = evaluateRelativeChange(dropRule, history, NOW);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.polarity).toBe('negative');
    expect(nodes[0]!.title).toBe('体重下降 15%');
    expect(nodes[0]!.evidenceEventIds).toEqual(['w1', 'w2']);
  });

  it('does not fire when the drop is under the 10% threshold', () => {
    const history = [weightPoint('w1', 90, 20), weightPoint('w2', 30, 19)];
    expect(evaluateRelativeChange(dropRule, history, NOW)).toHaveLength(0);
  });

  it('fires a positive node when weight rises >=10% versus the previous record', () => {
    const history = [weightPoint('w1', 90, 15), weightPoint('w2', 30, 17)];
    const nodes = evaluateRelativeChange(riseRule, history, NOW);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.polarity).toBe('positive');
    expect(nodes[0]!.title).toBe('体重上升 13%');
  });

  it('emits one node per qualifying consecutive pair across a longer history', () => {
    const history = [
      weightPoint('w1', 200, 20),
      weightPoint('w2', 120, 17), // -15%
      weightPoint('w3', 40, 15), // -11.8%
    ];
    const nodes = evaluateRelativeChange(dropRule, history, NOW);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((node) => node.polarity === 'negative')).toBe(true);
  });

  it('surfaces weight nodes through evaluateAllMilestones with deterministic ids', () => {
    const history = [weightPoint('w1', 90, 20), weightPoint('w2', 30, 17)];
    const first = evaluateAllMilestones(history, NOW, true);
    const second = evaluateAllMilestones(history, NOW, true);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    const drop = first.find((m) => m.ruleId === 'growth-milestone-weight-drop-10pct');
    expect(drop).toBeDefined();
    expect(drop!.polarity).toBe('negative');
  });
});
