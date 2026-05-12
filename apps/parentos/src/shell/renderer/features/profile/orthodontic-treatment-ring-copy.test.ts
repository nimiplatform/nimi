import { describe, expect, it } from 'vitest';
import type { OrthodonticApplianceRow } from '../../bridge/sqlite-bridge.js';
import {
  computeTreatmentRingCopy,
  type TreatmentRingCopy,
} from './orthodontic-treatment-card.js';

/**
 * `computeTreatmentRingCopy` is the single source of every parent-facing
 * string the wearing ring shows. PO-ORTHO-010 boundary lives entirely here.
 * The tests pin each branch so that a future "small UX tweak" cannot quietly
 * resurrect a retired prescriptive verb ("应该 / 建议 / 请加长 / 保持节奏").
 *
 * This file replaces the retired `orthodontic-wearing-hero-copy.test.ts` — the
 * legacy hero copy emitted a long-form headline+subtitle pair that no longer
 * exists in the unified card layout. The semantics are equivalent: same set
 * of branches, same prescriptive-word ban, same fact-restatement posture.
 */

function makeAppliance(
  overrides: Partial<OrthodonticApplianceRow> = {},
): OrthodonticApplianceRow {
  return {
    applianceId: 'appl-1',
    caseId: 'case-1',
    childId: 'child-1',
    applianceType: 'clear-aligner',
    status: 'active',
    startedAt: '2026-04-01',
    endedAt: null,
    prescribedHoursPerDay: 22,
    prescribedActivations: null,
    completedActivations: 0,
    totalAligners: 30,
    daysPerAligner: 14,
    reviewIntervalDays: 56,
    lastReviewAt: null,
    nextReviewDate: null,
    pauseReason: null,
    notes: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

type Cycle = NonNullable<Parameters<typeof computeTreatmentRingCopy>[0]['cycle']>;
type Open = NonNullable<Parameters<typeof computeTreatmentRingCopy>[0]['openState']>;

function makeCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    currentAlignerIndex: overrides.currentAlignerIndex ?? 1,
    cycleAnchor: overrides.cycleAnchor ?? '2026-04-01T00:00:00.000Z',
    cycleElapsedHours: overrides.cycleElapsedHours ?? 100,
    cycleNetWearHours: overrides.cycleNetWearHours ?? 90,
    cycleGapHours: overrides.cycleGapHours ?? 10,
    cycleTargetHours: overrides.cycleTargetHours ?? 308, // 14 days × 22h
    cycleProgressRatio: overrides.cycleProgressRatio ?? 90 / 308,
    predictedSwitchDate: overrides.predictedSwitchDate ?? '2026-04-16T00:00:00.000Z',
    daysShifted: overrides.daysShifted ?? 1,
    cycleSeriesComplete: overrides.cycleSeriesComplete ?? false,
  };
}

function makeOpen(overrides: Partial<Open> = {}): Open {
  return {
    hasOpen: overrides.hasOpen ?? false,
    ageHours: overrides.ageHours ?? 0,
    intervalId: overrides.intervalId ?? null,
    startAt: overrides.startAt ?? null,
  };
}

const FORBIDDEN_PRESCRIPTIVE_WORDS = [
  '应该',
  '建议',
  '请加长',
  '请多戴',
  '保持节奏',
  '推荐治疗',
];

function expectFactRestatement(copy: TreatmentRingCopy) {
  const strings: string[] =
    copy.kind === 'cycle'
      ? [copy.caption, copy.primaryNumber, copy.unit, copy.footer ?? '']
      : [copy.message];
  for (const word of FORBIDDEN_PRESCRIPTIVE_WORDS) {
    for (const s of strings) {
      expect(s).not.toContain(word);
    }
  }
}

describe('computeTreatmentRingCopy', () => {
  it('emits a message branch when no primary appliance is mounted', () => {
    const copy = computeTreatmentRingCopy({
      primaryAppliance: null,
      cycle: null,
      openState: null,
    });
    expect(copy.kind).toBe('message');
    if (copy.kind === 'message') {
      expect(copy.message).toContain('没有进行中的装置');
    }
    expectFactRestatement(copy);
  });

  it('emits "本副已达标 / net hours" with 100% footer when the cycle ratio is ≥ 1', () => {
    const copy = computeTreatmentRingCopy({
      primaryAppliance: makeAppliance(),
      cycle: makeCycle({ cycleProgressRatio: 1.05, cycleNetWearHours: 308 }),
      openState: makeOpen(),
    });
    expect(copy.kind).toBe('cycle');
    if (copy.kind === 'cycle') {
      expect(copy.caption).toBe('本副已达标');
      expect(copy.primaryNumber).toBe('308');
      expect(copy.unit).toBe('h');
      expect(copy.footer).toBe('100%');
    }
    expectFactRestatement(copy);
  });

  it('emits the "未戴中" caption with open-interval age when un-wear is in progress', () => {
    const copy = computeTreatmentRingCopy({
      primaryAppliance: makeAppliance(),
      cycle: makeCycle({
        cycleProgressRatio: 90 / 308,
        cycleNetWearHours: 90,
        cycleTargetHours: 308,
      }),
      openState: makeOpen({ hasOpen: true, ageHours: 3.5, intervalId: 'int-1' }),
    });
    expect(copy.kind).toBe('cycle');
    if (copy.kind === 'cycle') {
      expect(copy.caption).toBe('未戴中');
      // Number = rounded open-interval age hours.
      expect(copy.primaryNumber).toBe('4');
      // Footer keeps cycle wear + percentage so progress remains visible.
      expect(copy.footer).toContain('本副已戴 90h');
      expect(copy.footer).toMatch(/\d+%/);
    }
    expectFactRestatement(copy);
  });

  it('emits "本副已戴 N h · 还差 Mh · X%" when wearing and cycle ratio < 1', () => {
    const copy = computeTreatmentRingCopy({
      primaryAppliance: makeAppliance(),
      cycle: makeCycle({
        cycleProgressRatio: 200 / 308,
        cycleNetWearHours: 200,
        cycleTargetHours: 308,
      }),
      openState: makeOpen(),
    });
    expect(copy.kind).toBe('cycle');
    if (copy.kind === 'cycle') {
      expect(copy.caption).toBe('本副已戴');
      expect(copy.primaryNumber).toBe('200');
      expect(copy.unit).toBe('h');
      // 308 - 200 = 108; pct ≈ 65
      expect(copy.footer).toBe('还差 108h · 65%');
    }
    expectFactRestatement(copy);
  });

  it('falls back to a fact-only message for non clear-aligner with an open interval', () => {
    const copy = computeTreatmentRingCopy({
      primaryAppliance: makeAppliance({
        applianceType: 'twin-block',
        totalAligners: null,
        daysPerAligner: null,
        prescribedHoursPerDay: 14,
      }),
      cycle: null,
      openState: makeOpen({ hasOpen: true, ageHours: 5 }),
    });
    expect(copy.kind).toBe('message');
    if (copy.kind === 'message') {
      expect(copy.message).toContain('未戴中');
      expect(copy.message).toContain('医嘱每日佩戴 14 小时');
    }
    expectFactRestatement(copy);
  });

  it('emits a prescription-only message for non clear-aligner with no open interval', () => {
    const copy = computeTreatmentRingCopy({
      primaryAppliance: makeAppliance({
        applianceType: 'retainer-removable',
        totalAligners: null,
        daysPerAligner: null,
        prescribedHoursPerDay: 16,
      }),
      cycle: null,
      openState: makeOpen(),
    });
    expect(copy.kind).toBe('message');
    if (copy.kind === 'message') {
      expect(copy.message).toBe('医嘱每日佩戴 16 小时');
    }
    expectFactRestatement(copy);
  });

  it('degrades gracefully to "装置使用中" when no prescription and no cycle', () => {
    const copy = computeTreatmentRingCopy({
      primaryAppliance: makeAppliance({
        applianceType: 'metal-braces',
        totalAligners: null,
        daysPerAligner: null,
        prescribedHoursPerDay: null,
      }),
      cycle: null,
      openState: makeOpen(),
    });
    expect(copy.kind).toBe('message');
    if (copy.kind === 'message') {
      expect(copy.message).toBe('装置使用中');
    }
  });
});
