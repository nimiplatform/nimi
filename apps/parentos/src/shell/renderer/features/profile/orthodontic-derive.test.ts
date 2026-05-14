import { describe, expect, it } from 'vitest';
import type {
  OrthodonticApplianceRow,
  OrthodonticCaseRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import {
  APPLIANCE_PHASES,
  applianceSupportsWearGap,
  computeAppliancePhaseOptions,
  computeAppliancePhaseProgress,
  computeCycleProgress,
  computeDailyNetWear,
  computeExpanderActivationProjection,
  computeOpenIntervalState,
  computeStageOptions,
  defaultPrescribedHoursPerDay,
  defaultReviewIntervalDays,
  formatHours,
} from './orthodontic-derive.js';

const NOW = '2026-04-12T18:00:00.000Z';

function makeAppliance(overrides: Partial<OrthodonticApplianceRow> = {}): OrthodonticApplianceRow {
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
    activationIntervalDays: null,
    totalAligners: 30,
    daysPerAligner: 7,
    currentPhase: null,
    phaseStartedAt: null,
    reviewIntervalDays: 56,
    lastReviewAt: null,
    nextReviewDate: '2026-05-27',
    nextReviewAgenda: null,
    pauseReason: null,
    notes: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCase(overrides: Partial<OrthodonticCaseRow> = {}): OrthodonticCaseRow {
  return {
    caseId: 'case-1',
    childId: 'child-1',
    caseType: 'clear-aligners',
    stage: 'active',
    startedAt: '2026-04-01',
    plannedEndAt: null,
    actualEndAt: null,
    primaryIssues: null,
    providerName: null,
    providerInstitution: null,
    nextReviewDate: '2026-05-27',
    notes: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeInterval(
  overrides: Partial<OrthodonticUnwearIntervalRow> & { startAt: string },
): OrthodonticUnwearIntervalRow {
  const { startAt, ...rest } = overrides;
  return {
    intervalId: `int-${startAt}`,
    childId: 'child-1',
    caseId: 'case-1',
    applianceId: 'appl-1',
    startAt,
    endAt: null,
    reason: null,
    notes: null,
    createdAt: startAt,
    updatedAt: startAt,
    ...rest,
  };
}

function makeCheckin(
  overrides: Partial<OrthodonticCheckinRow> & { checkinDate: string; checkinType: 'aligner-change' | 'expander-activation' },
): OrthodonticCheckinRow {
  const { checkinDate, checkinType, ...rest } = overrides;
  return {
    checkinId: `chk-${checkinDate}-${checkinType}`,
    childId: 'child-1',
    caseId: 'case-1',
    applianceId: 'appl-1',
    checkinDate,
    checkinAt: null,
    checkinType,
    activationIndex: null,
    alignerIndex: null,
    notes: null,
    createdAt: `${checkinDate}T00:00:00.000Z`,
    updatedAt: `${checkinDate}T00:00:00.000Z`,
    ...rest,
  };
}

describe('spec defaults', () => {
  it('defaultReviewIntervalDays mirrors yaml per applianceType', () => {
    expect(defaultReviewIntervalDays('clear-aligner')).toBe(56);
    expect(defaultReviewIntervalDays('metal-braces')).toBe(28);
    expect(defaultReviewIntervalDays('twin-block')).toBe(42);
    expect(defaultReviewIntervalDays('retainer-removable')).toBe(180);
  });

  it('applianceSupportsWearGap returns true only for the four removable types', () => {
    for (const t of ['clear-aligner', 'twin-block', 'activator', 'retainer-removable'] as const) {
      expect(applianceSupportsWearGap(t)).toBe(true);
    }
    for (const t of ['metal-braces', 'ceramic-braces', 'expander', 'retainer-fixed'] as const) {
      expect(applianceSupportsWearGap(t)).toBe(false);
    }
  });

  it('defaultPrescribedHoursPerDay returns sensible defaults', () => {
    expect(defaultPrescribedHoursPerDay('clear-aligner')).toBe(22);
    expect(defaultPrescribedHoursPerDay('twin-block')).toBe(14);
    expect(defaultPrescribedHoursPerDay('retainer-removable')).toBe(16);
    expect(defaultPrescribedHoursPerDay('metal-braces')).toBe(0);
  });
});

describe('computeOpenIntervalState', () => {
  it('returns hasOpen=false when no open interval exists', () => {
    const state = computeOpenIntervalState(
      [makeInterval({ startAt: '2026-04-10T12:00:00.000Z', endAt: '2026-04-10T13:00:00.000Z' })],
      NOW,
    );
    expect(state.hasOpen).toBe(false);
    expect(state.intervalId).toBeNull();
    expect(state.ageHours).toBe(0);
  });

  it('returns the open interval and its age in hours', () => {
    const state = computeOpenIntervalState(
      [makeInterval({ startAt: '2026-04-12T15:00:00.000Z', endAt: null })],
      NOW,
    );
    expect(state.hasOpen).toBe(true);
    expect(state.ageHours).toBeCloseTo(3, 5);
  });

  it('age is non-negative when startAt is in the future (sanity clamp)', () => {
    const state = computeOpenIntervalState(
      [makeInterval({ startAt: '2099-04-10T00:00:00.000Z', endAt: null })],
      NOW,
    );
    expect(state.ageHours).toBe(0);
  });
});

describe('computeCycleProgress (clear-aligner)', () => {
  it('on schedule when no gaps and we are mid-cycle', () => {
    // Anchor = 2026-04-10 (via aligner-change), now = 2026-04-12T18:00 → 2.75d elapsed
    // Target = 7d × 22h = 154h. Net wear = 2.75 × 24 = 66h. No gaps means rate = 1.0,
    // so predictedSwitch ≈ anchor + 7d = ideal day; daysShifted ≈ 0.
    const appliance = makeAppliance();
    const cycle = computeCycleProgress({
      appliance,
      intervals: [],
      alignerChangeCheckins: [
        makeCheckin({ checkinType: 'aligner-change', checkinDate: '2026-04-10', alignerIndex: 2 }),
      ],
      nowIso: NOW,
    });
    expect(cycle.cycleTargetHours).toBe(154);
    expect(cycle.cycleGapHours).toBe(0);
    expect(cycle.cycleNetWearHours).toBeCloseTo(2.75 * 24, 1);
    expect(Math.abs(cycle.daysShifted)).toBeLessThanOrEqual(1);
  });

  it('predicted switch pushes back when there are gaps', () => {
    const appliance = makeAppliance({ daysPerAligner: 7, prescribedHoursPerDay: 22 });
    const intervals = [
      makeInterval({ startAt: '2026-04-04T12:00:00.000Z', endAt: '2026-04-04T20:00:00.000Z' }), // 8h gap
      makeInterval({ startAt: '2026-04-08T08:00:00.000Z', endAt: '2026-04-08T16:00:00.000Z' }), // 8h gap
    ];
    const cycle = computeCycleProgress({
      appliance,
      intervals,
      alignerChangeCheckins: [],
      nowIso: NOW,
    });
    expect(cycle.cycleGapHours).toBe(16);
    expect(cycle.cycleNetWearHours).toBeCloseTo(11.75 * 24 - 16, 1);
  });

  it('open interval continues to accumulate gap time', () => {
    const appliance = makeAppliance();
    const intervals = [
      makeInterval({ startAt: '2026-04-12T12:00:00.000Z', endAt: null }), // open 6h
    ];
    const cycle = computeCycleProgress({
      appliance,
      intervals,
      alignerChangeCheckins: [],
      nowIso: NOW,
    });
    expect(cycle.cycleGapHours).toBeCloseTo(6, 1);
  });

  it('uses latest aligner-change as cycle anchor', () => {
    const appliance = makeAppliance({ startedAt: '2026-04-01' });
    const cycle = computeCycleProgress({
      appliance,
      intervals: [],
      alignerChangeCheckins: [
        makeCheckin({ checkinType: 'aligner-change', checkinDate: '2026-04-08', alignerIndex: 2 }),
      ],
      nowIso: NOW,
    });
    expect(cycle.cycleAnchor.startsWith('2026-04-08')).toBe(true);
    expect(cycle.currentAlignerIndex).toBe(2);
  });

  it('prefers checkinAt over checkinDate when present (PO-ORTHO-008 sub-day anchor)', () => {
    // Parent clicks 换下一副 mid-afternoon. Without sub-day anchoring the new
    // cycle would back-date to 00:00 UTC and "本副已净戴" would show several
    // hours of phantom wear; with checkinAt it starts at the actual moment.
    const appliance = makeAppliance({ startedAt: '2026-04-01' });
    const cycle = computeCycleProgress({
      appliance,
      intervals: [],
      alignerChangeCheckins: [
        makeCheckin({
          checkinType: 'aligner-change',
          checkinDate: '2026-04-08',
          checkinAt: '2026-04-08T14:00:00.000Z',
          alignerIndex: 2,
        }),
      ],
      nowIso: '2026-04-08T16:00:00.000Z',
    });
    expect(cycle.cycleAnchor).toBe('2026-04-08T14:00:00.000Z');
    expect(cycle.cycleElapsedHours).toBeCloseTo(2, 3);
  });

  it('uses LATEST-by-time alignerIndex, not max — so a correction with a lower index wins', () => {
    // Regression: a parent mis-clicks 换下一副 (logging idx=3 yesterday at
    // 09:00) and then corrects today (logging idx=2 at 10:00). The display
    // must reflect their correction (2), not the stale max (3). Prior code
    // used `Math.max(...alignerIndices)` and prevented downward correction.
    const appliance = makeAppliance({ startedAt: '2026-04-01' });
    const cycle = computeCycleProgress({
      appliance,
      intervals: [],
      alignerChangeCheckins: [
        makeCheckin({
          checkinType: 'aligner-change',
          checkinDate: '2026-04-07',
          checkinAt: '2026-04-07T09:00:00.000Z',
          alignerIndex: 3,
        }),
        makeCheckin({
          checkinType: 'aligner-change',
          checkinDate: '2026-04-08',
          checkinAt: '2026-04-08T10:00:00.000Z',
          alignerIndex: 2,
        }),
      ],
      nowIso: '2026-04-08T12:00:00.000Z',
    });
    expect(cycle.currentAlignerIndex).toBe(2);
    expect(cycle.cycleAnchor).toBe('2026-04-08T10:00:00.000Z');
  });

  it('falls back to checkinDate at 00:00 UTC for legacy rows (checkinAt = null)', () => {
    const appliance = makeAppliance({ startedAt: '2026-04-01' });
    const cycle = computeCycleProgress({
      appliance,
      intervals: [],
      alignerChangeCheckins: [
        makeCheckin({
          checkinType: 'aligner-change',
          checkinDate: '2026-04-08',
          checkinAt: null,
          alignerIndex: 2,
        }),
      ],
      nowIso: '2026-04-08T16:00:00.000Z',
    });
    expect(cycle.cycleAnchor).toBe('2026-04-08T00:00:00.000Z');
    expect(cycle.cycleElapsedHours).toBeCloseTo(16, 3);
  });

  it('flags series complete when latest index reaches totalAligners and progress ≥ 1', () => {
    // daysPerAligner=3, anchor=2026-04-08 (4.75d ago), elapsed×24 ≫ target (3×22=66h),
    // so cycleProgressRatio ≥ 1 and currentAlignerIndex (2) === totalAligners (2).
    const appliance = makeAppliance({ totalAligners: 2, daysPerAligner: 3 });
    const cycle = computeCycleProgress({
      appliance,
      intervals: [],
      alignerChangeCheckins: [
        makeCheckin({ checkinType: 'aligner-change', checkinDate: '2026-04-01', alignerIndex: 1 }),
        makeCheckin({ checkinType: 'aligner-change', checkinDate: '2026-04-08', alignerIndex: 2 }),
      ],
      nowIso: NOW,
    });
    expect(cycle.cycleProgressRatio).toBeGreaterThanOrEqual(1);
    expect(cycle.cycleSeriesComplete).toBe(true);
  });

  it('handles missing daysPerAligner with a sensible default for non-clear-aligner', () => {
    const appliance = makeAppliance({
      applianceType: 'twin-block',
      daysPerAligner: null,
      totalAligners: null,
      prescribedHoursPerDay: 14,
      reviewIntervalDays: 42,
    });
    const cycle = computeCycleProgress({
      appliance,
      intervals: [],
      alignerChangeCheckins: [],
      nowIso: NOW,
    });
    expect(cycle.cycleTargetHours).toBe(42 * 14);
  });
});

describe('computeStageOptions', () => {
  it('marks past, current, and future correctly', () => {
    const options = computeStageOptions(makeCase({ stage: 'active' }));
    expect(options.find((o) => o.stage === 'assessment')!.state).toBe('past');
    expect(options.find((o) => o.stage === 'planning')!.state).toBe('past');
    expect(options.find((o) => o.stage === 'active')!.state).toBe('current');
    expect(options.find((o) => o.stage === 'retention')!.state).toBe('future');
  });

  it('only the immediate-next stage is advanceable', () => {
    const options = computeStageOptions(makeCase({ stage: 'planning' }));
    const advanceable = options.filter((o) => o.advanceable);
    expect(advanceable.map((o) => o.stage)).toEqual(['active']);
  });

  it('blocks completed when actualEndAt is missing', () => {
    const options = computeStageOptions(makeCase({ stage: 'retention', actualEndAt: null }));
    const completed = options.find((o) => o.stage === 'completed')!;
    expect(completed.advanceable).toBe(false);
    expect(completed.blockedReason).toContain('实际结束日期');
  });

  it('allows completed when actualEndAt is set', () => {
    const options = computeStageOptions(makeCase({ stage: 'retention', actualEndAt: '2027-01-01' }));
    const completed = options.find((o) => o.stage === 'completed')!;
    expect(completed.advanceable).toBe(true);
  });
});

describe('formatHours', () => {
  it('formats sub-hour as minutes', () => {
    expect(formatHours(0.5)).toBe('30 分钟');
  });
  it('formats single-digit hours with one decimal', () => {
    expect(formatHours(3.4)).toBe('3.4 小时');
  });
  it('formats double-digit hours rounded', () => {
    expect(formatHours(22.7)).toBe('23 小时');
  });
});

describe('computeAppliancePhaseProgress (PO-ORTHO-013)', () => {
  it('returns null when the appliance has no phase set', () => {
    const appliance = makeAppliance({ currentPhase: null, phaseStartedAt: null });
    expect(computeAppliancePhaseProgress(appliance, NOW)).toBeNull();
  });

  it('returns null defensively when the persisted phase is not in the type sequence', () => {
    const appliance = makeAppliance({
      applianceType: 'expander',
      currentPhase: 'leveling', // belongs to fixed braces, not expander
      phaseStartedAt: '2026-04-01',
    });
    expect(computeAppliancePhaseProgress(appliance, NOW)).toBeNull();
  });

  it('projects phase number, label and ceil month counter from phaseStartedAt', () => {
    const appliance = makeAppliance({
      applianceType: 'metal-braces',
      totalAligners: null,
      daysPerAligner: null,
      prescribedHoursPerDay: null,
      currentPhase: 'space-closure',
      phaseStartedAt: '2026-03-01',
    });
    const progress = computeAppliancePhaseProgress(appliance, NOW);
    expect(progress).not.toBeNull();
    expect(progress!.phaseId).toBe('space-closure');
    expect(progress!.label).toBe('关闭间隙');
    expect(progress!.phaseNumber).toBe(2);
    expect(progress!.phaseTotal).toBe(4);
    expect(progress!.expectedMonths).toBe(6);
    // 2026-03-01 → 2026-04-12 is 42 days → ceil(42/30) = 2 months.
    expect(progress!.monthsInPhase).toBe(2);
  });

  it('falls back to startedAt when phaseStartedAt is null is not possible (paired nullness), so uses phaseStartedAt', () => {
    const appliance = makeAppliance({
      applianceType: 'retainer-removable',
      totalAligners: null,
      daysPerAligner: null,
      prescribedHoursPerDay: 16,
      currentPhase: 'full-time',
      phaseStartedAt: '2026-04-11',
    });
    const progress = computeAppliancePhaseProgress(appliance, NOW);
    // 2026-04-11 → 2026-04-12 is ~1 day → ceil → 1 month.
    expect(progress!.monthsInPhase).toBe(1);
  });
});

describe('computeAppliancePhaseOptions (PO-ORTHO-013)', () => {
  it('marks the first phase advanceable when no phase is set', () => {
    const opts = computeAppliancePhaseOptions({
      applianceType: 'expander',
      currentPhase: null,
    });
    expect(opts.map((o) => o.phaseId)).toEqual(['widening', 'holding']);
    expect(opts[0]!.state).toBe('future');
    expect(opts[0]!.advanceable).toBe(true);
    expect(opts[1]!.advanceable).toBe(false);
  });

  it('marks the immediate next phase advanceable and prior phases past', () => {
    const opts = computeAppliancePhaseOptions({
      applianceType: 'metal-braces',
      currentPhase: 'space-closure',
    });
    expect(opts.find((o) => o.phaseId === 'leveling')!.state).toBe('past');
    expect(opts.find((o) => o.phaseId === 'space-closure')!.state).toBe('current');
    const finishing = opts.find((o) => o.phaseId === 'finishing')!;
    expect(finishing.state).toBe('future');
    expect(finishing.advanceable).toBe(true);
    expect(opts.find((o) => o.phaseId === 'debond-prep')!.advanceable).toBe(false);
  });

  it('marks nothing advanceable at the final phase', () => {
    const opts = computeAppliancePhaseOptions({
      applianceType: 'metal-braces',
      currentPhase: 'debond-prep',
    });
    expect(opts.every((o) => !o.advanceable)).toBe(true);
    expect(opts.find((o) => o.phaseId === 'debond-prep')!.state).toBe('current');
  });
});

describe('computeExpanderActivationProjection (PO-ORTHO-014)', () => {
  it('projects the next activation from the latest event + per-appliance cadence', () => {
    const appliance = makeAppliance({
      applianceType: 'expander',
      totalAligners: null,
      daysPerAligner: null,
      prescribedHoursPerDay: null,
      prescribedActivations: 28,
      completedActivations: 4,
      activationIntervalDays: 3,
    });
    const activationCheckins = [
      makeCheckin({ checkinDate: '2026-04-10', checkinType: 'expander-activation', activationIndex: 4 }),
      makeCheckin({ checkinDate: '2026-04-07', checkinType: 'expander-activation', activationIndex: 3 }),
    ];
    const proj = computeExpanderActivationProjection({ appliance, activationCheckins, nowIso: NOW });
    expect(proj.completedActivations).toBe(4);
    expect(proj.prescribedActivations).toBe(28);
    expect(proj.ratio).toBeCloseTo(4 / 28);
    expect(proj.isComplete).toBe(false);
    // latest event 2026-04-10 + 3 days = 2026-04-13.
    expect(proj.nextActivationDate).toBe('2026-04-13');
  });

  it('anchors on startedAt when there are no activation events yet', () => {
    const appliance = makeAppliance({
      applianceType: 'expander',
      totalAligners: null,
      daysPerAligner: null,
      prescribedHoursPerDay: null,
      prescribedActivations: 28,
      completedActivations: 0,
      activationIntervalDays: 2,
      startedAt: '2026-04-01',
    });
    const proj = computeExpanderActivationProjection({ appliance, activationCheckins: [], nowIso: NOW });
    expect(proj.nextActivationDate).toBe('2026-04-03');
  });

  it('stops projecting once the prescribed cap is reached', () => {
    const appliance = makeAppliance({
      applianceType: 'expander',
      totalAligners: null,
      daysPerAligner: null,
      prescribedHoursPerDay: null,
      prescribedActivations: 28,
      completedActivations: 28,
      activationIntervalDays: 3,
    });
    const proj = computeExpanderActivationProjection({ appliance, activationCheckins: [], nowIso: NOW });
    expect(proj.isComplete).toBe(true);
    expect(proj.ratio).toBe(1);
    expect(proj.nextActivationDate).toBeNull();
  });
});

describe('computeDailyNetWear (PO-ORTHO-008a)', () => {
  it('reports a full day of net wear when there are no gaps today', () => {
    const result = computeDailyNetWear({
      intervals: [],
      prescribedHoursPerDay: 22,
      nowIso: NOW,
    });
    expect(result.todayNetWearHours).toBe(24);
    expect(result.todayTargetHours).toBe(22);
  });

  it('subtracts a closed gap that falls within today', () => {
    // NOW is 2026-04-12T18:00Z; a 2h closed gap today.
    const result = computeDailyNetWear({
      intervals: [
        makeInterval({
          startAt: '2026-04-12T09:00:00.000Z',
          endAt: '2026-04-12T11:00:00.000Z',
          reason: 'school',
        }),
      ],
      prescribedHoursPerDay: 22,
      nowIso: NOW,
    });
    expect(result.todayNetWearHours).toBe(22);
  });

  it('counts an open gap only up to now and ignores gaps before today', () => {
    const result = computeDailyNetWear({
      intervals: [
        // yesterday — fully outside today's window, ignored.
        makeInterval({
          startAt: '2026-04-11T08:00:00.000Z',
          endAt: '2026-04-11T20:00:00.000Z',
        }),
        // open gap that started 3h ago (NOW = 18:00Z) — counts 3h.
        makeInterval({ startAt: '2026-04-12T15:00:00.000Z', endAt: null }),
      ],
      prescribedHoursPerDay: 16,
      nowIso: NOW,
    });
    expect(result.todayNetWearHours).toBe(21);
  });
});

describe('APPLIANCE_PHASES', () => {
  it('declares an ordered sequence for every admitted applianceType', () => {
    const types: (keyof typeof APPLIANCE_PHASES)[] = [
      'twin-block', 'expander', 'activator', 'metal-braces',
      'ceramic-braces', 'clear-aligner', 'retainer-fixed', 'retainer-removable',
    ];
    for (const t of types) {
      expect(APPLIANCE_PHASES[t].length).toBeGreaterThan(0);
    }
    expect(APPLIANCE_PHASES['metal-braces'].map((p) => p.phaseId)).toEqual([
      'leveling', 'space-closure', 'finishing', 'debond-prep',
    ]);
  });
});
