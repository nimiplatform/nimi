import { describe, expect, it } from 'vitest';
import type {
  OrthodonticApplianceRow,
  OrthodonticCaseRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import {
  applianceSupportsWearGap,
  computeContextualPrompts,
  computeCycleProgress,
  computeOpenIntervalState,
  computeStageOptions,
  defaultPrescribedHoursPerDay,
  defaultReviewIntervalDays,
  formatDeterministicAiSummary,
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
    totalAligners: 30,
    daysPerAligner: 7,
    reviewIntervalDays: 56,
    lastReviewAt: null,
    nextReviewDate: '2026-05-27',
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

describe('computeContextualPrompts', () => {
  it('emits close-open-unwear when an open interval is older than 4h', () => {
    const caseRow = makeCase();
    const appliance = makeAppliance();
    const prompts = computeContextualPrompts({
      caseRow,
      appliances: [appliance],
      intervalsByAppliance: {
        [appliance.applianceId]: [
          makeInterval({ startAt: '2026-04-12T13:00:00.000Z', endAt: null }), // 5h
        ],
      },
      checkinsByAppliance: { [appliance.applianceId]: [] },
      journey: null,
      nowIso: NOW,
    });
    expect(prompts.find((p) => p.kind === 'close-open-unwear')).toBeDefined();
  });

  it('does NOT emit close-open-unwear when the open interval is younger than 4h', () => {
    const caseRow = makeCase();
    const appliance = makeAppliance();
    const prompts = computeContextualPrompts({
      caseRow,
      appliances: [appliance],
      intervalsByAppliance: {
        [appliance.applianceId]: [
          makeInterval({ startAt: '2026-04-12T15:00:00.000Z', endAt: null }), // 3h
        ],
      },
      checkinsByAppliance: { [appliance.applianceId]: [] },
      journey: null,
      nowIso: NOW,
    });
    expect(prompts.find((p) => p.kind === 'close-open-unwear')).toBeUndefined();
  });

  it('emits record-aligner-switch when daysPerAligner has elapsed since last anchor', () => {
    const caseRow = makeCase();
    const appliance = makeAppliance({ daysPerAligner: 7, totalAligners: 30 });
    // No aligner-change checkins yet, started 11 days ago → elapsed 11 ≥ 7.
    const prompts = computeContextualPrompts({
      caseRow,
      appliances: [appliance],
      intervalsByAppliance: { [appliance.applianceId]: [] },
      checkinsByAppliance: { [appliance.applianceId]: [] },
      journey: null,
      nowIso: NOW,
    });
    expect(prompts.find((p) => p.kind === 'record-aligner-switch')).toBeDefined();
  });

  it('does NOT emit record-aligner-switch after totalAligners reached', () => {
    const caseRow = makeCase();
    const appliance = makeAppliance({ daysPerAligner: 7, totalAligners: 2 });
    const prompts = computeContextualPrompts({
      caseRow,
      appliances: [appliance],
      intervalsByAppliance: { [appliance.applianceId]: [] },
      checkinsByAppliance: {
        [appliance.applianceId]: [
          makeCheckin({ checkinType: 'aligner-change', checkinDate: '2026-04-01', alignerIndex: 1 }),
          makeCheckin({ checkinType: 'aligner-change', checkinDate: '2026-04-08', alignerIndex: 2 }),
        ],
      },
      journey: null,
      nowIso: NOW,
    });
    expect(prompts.find((p) => p.kind === 'record-aligner-switch')).toBeUndefined();
  });

  it('always emits record-anomaly at p3', () => {
    const caseRow = makeCase();
    const appliance = makeAppliance();
    const prompts = computeContextualPrompts({
      caseRow,
      appliances: [appliance],
      intervalsByAppliance: { [appliance.applianceId]: [] },
      checkinsByAppliance: { [appliance.applianceId]: [] },
      journey: null,
      nowIso: NOW,
    });
    const anomaly = prompts.find((p) => p.kind === 'record-anomaly');
    expect(anomaly).toBeDefined();
    expect(anomaly?.priority).toBe('p3');
  });

  it('sorts prompts p1 → p2 → p3', () => {
    const caseRow = makeCase();
    const appliance = makeAppliance({ daysPerAligner: 7, totalAligners: 30 });
    const prompts = computeContextualPrompts({
      caseRow,
      appliances: [appliance],
      intervalsByAppliance: {
        [appliance.applianceId]: [
          makeInterval({ startAt: '2026-04-12T13:00:00.000Z', endAt: null }),
        ],
      },
      checkinsByAppliance: { [appliance.applianceId]: [] },
      journey: null,
      nowIso: NOW,
    });
    const priorities = prompts.map((p) => p.priority);
    for (let i = 1; i < priorities.length; i += 1) {
      const prev = priorities[i - 1]!;
      const cur = priorities[i]!;
      expect(prev <= cur).toBe(true);
    }
  });
});

describe('formatDeterministicAiSummary', () => {
  it('emits cycle line for clear-aligner', () => {
    const lines = formatDeterministicAiSummary({
      appliance: makeAppliance(),
      intervals: [],
      alignerChangeCheckins: [],
      nowIso: NOW,
    });
    expect(lines.join(' ')).toContain('本副已净戴');
  });

  it('emits review countdown when nextReviewDate is in the future', () => {
    const lines = formatDeterministicAiSummary({
      appliance: makeAppliance({ nextReviewDate: '2026-05-27' }),
      intervals: [],
      alignerChangeCheckins: [],
      nowIso: NOW,
    });
    expect(lines.some((l) => l.includes('下次复诊还有'))).toBe(true);
  });

  it('emits overdue countdown when nextReviewDate is in the past', () => {
    const lines = formatDeterministicAiSummary({
      appliance: makeAppliance({ nextReviewDate: '2026-04-01' }),
      intervals: [],
      alignerChangeCheckins: [],
      nowIso: NOW,
    });
    expect(lines.some((l) => l.includes('复诊已过期'))).toBe(true);
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
