import { describe, expect, it } from 'vitest';
import type {
  OrthodonticApplianceRow,
  OrthodonticCheckinRow,
} from '../../bridge/sqlite-bridge.js';
import { computeApplianceRingView } from './appliance-ring-view.js';
import { computeApplianceNextAction } from './appliance-next-action.js';

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
    daysPerAligner: 14,
    currentPhase: null,
    phaseStartedAt: null,
    reviewIntervalDays: 56,
    lastReviewAt: null,
    nextReviewDate: null,
    nextReviewAgenda: null,
    pauseReason: null,
    notes: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCheckin(
  overrides: Partial<OrthodonticCheckinRow> & {
    checkinDate: string;
    checkinType: 'aligner-change' | 'expander-activation';
  },
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

describe('computeApplianceRingView', () => {
  it('clear-aligner → cycle-relative metric ring', () => {
    const view = computeApplianceRingView({
      appliance: makeAppliance(),
      caseRow: { stage: 'active' },
      intervals: [],
      checkins: [],
      nowIso: NOW,
    });
    expect(view.kind).toBe('metric');
    if (view.kind === 'metric') {
      // cycle-relative caption from computeTreatmentRingCopy.
      expect(view.caption).toBe('本副已戴');
      expect(view.accent).toBe('#818CF8');
    }
  });

  it('expander with prescribed cap → activation-count ring (圈)', () => {
    const appliance = makeAppliance({
      applianceType: 'expander',
      totalAligners: null,
      daysPerAligner: null,
      prescribedHoursPerDay: null,
      prescribedActivations: 28,
      completedActivations: 12,
      activationIntervalDays: 3,
    });
    const view = computeApplianceRingView({
      appliance,
      caseRow: { stage: 'active' },
      intervals: [],
      checkins: [],
      nowIso: NOW,
    });
    expect(view.kind).toBe('metric');
    if (view.kind === 'metric') {
      expect(view.caption).toBe('扩弓进度');
      expect(view.value).toBe('12');
      expect(view.unit).toBe(' / 28 圈');
      expect(view.ratio).toBeCloseTo(12 / 28);
    }
  });

  it('retainer-removable → daily net-wear ring (PO-ORTHO-008a)', () => {
    const appliance = makeAppliance({
      applianceType: 'retainer-removable',
      totalAligners: null,
      daysPerAligner: null,
      prescribedHoursPerDay: 16,
    });
    const view = computeApplianceRingView({
      appliance,
      caseRow: { stage: 'retention' },
      intervals: [],
      checkins: [],
      nowIso: NOW,
    });
    expect(view.kind).toBe('metric');
    if (view.kind === 'metric') {
      expect(view.caption).toBe('今日佩戴');
      expect(view.unit).toBe(' / 16 h');
      expect(view.footer).toBe('今日净戴近似');
    }
  });

  it('fixed braces → phase month ring, or a message when no phase set', () => {
    const noPhase = computeApplianceRingView({
      appliance: makeAppliance({
        applianceType: 'metal-braces',
        totalAligners: null,
        daysPerAligner: null,
        prescribedHoursPerDay: null,
      }),
      caseRow: { stage: 'active' },
      intervals: [],
      checkins: [],
      nowIso: NOW,
    });
    expect(noPhase.kind).toBe('message');

    const withPhase = computeApplianceRingView({
      appliance: makeAppliance({
        applianceType: 'metal-braces',
        totalAligners: null,
        daysPerAligner: null,
        prescribedHoursPerDay: null,
        currentPhase: 'leveling',
        phaseStartedAt: '2026-03-01',
      }),
      caseRow: { stage: 'active' },
      intervals: [],
      checkins: [],
      nowIso: NOW,
    });
    expect(withPhase.kind).toBe('metric');
    if (withPhase.kind === 'metric') {
      expect(withPhase.caption).toBe('排齐整平');
      expect(withPhase.unit).toBe(' / 8 个月');
    }
  });
});

describe('computeApplianceNextAction', () => {
  it('clear-aligner → 下次换套 / switch-aligner', () => {
    const action = computeApplianceNextAction({
      appliance: makeAppliance(),
      intervals: [],
      checkins: [],
      nowIso: NOW,
    });
    expect(action.label).toBe('下次换套');
    expect(action.actionKind).toBe('switch-aligner');
    expect(action.actionLabel).toBe('换下一副');
  });

  it('expander → 下次转动 / log-activation, anchored on the latest activation', () => {
    const appliance = makeAppliance({
      applianceType: 'expander',
      totalAligners: null,
      daysPerAligner: null,
      prescribedHoursPerDay: null,
      prescribedActivations: 28,
      completedActivations: 2,
      activationIntervalDays: 3,
    });
    const action = computeApplianceNextAction({
      appliance,
      intervals: [],
      checkins: [
        makeCheckin({ checkinDate: '2026-04-10', checkinType: 'expander-activation', activationIndex: 2 }),
      ],
      nowIso: NOW,
    });
    expect(action.label).toBe('下次转动');
    expect(action.actionKind).toBe('log-activation');
    expect(action.date).toBe('2026-04-13'); // 2026-04-10 + 3 days
    expect(action.detail).toBe('每 3 天转一次');
  });

  it('clear-aligner daysAway uses calendar-day diff, not 24h rounding', () => {
    // Regression: target = 2026-05-19 (anchor 5-12 + 7d), now = 5-17T13:00Z.
    // The pre-fix code did Math.round((target − now)/24h) = round(35/24) =
    // round(1.46) = 1, so the profile read "还有 1 天" while the home
    // widget (which uses calendar-day diff) read "还有 2 天". Calendar diff
    // matches the parent's mental model ("5-17 → 5-19 is 2 days") and the
    // home widget's projection, so they stay consistent across surfaces.
    const appliance = makeAppliance({
      startedAt: '2026-05-04',
      daysPerAligner: 7,
      prescribedHoursPerDay: 22,
      totalAligners: 35,
    });
    const action = computeApplianceNextAction({
      appliance,
      intervals: [],
      checkins: [
        makeCheckin({
          checkinType: 'aligner-change',
          checkinDate: '2026-05-12',
          alignerIndex: 2,
        }),
      ],
      nowIso: '2026-05-17T13:00:00.000Z',
    });
    expect(action.date).toBe('2026-05-19');
    expect(action.daysAway).toBe(2);
  });

  it('fixed braces → 下次复诊 / log-review with the parent-entered agenda', () => {
    const action = computeApplianceNextAction({
      appliance: makeAppliance({
        applianceType: 'metal-braces',
        totalAligners: null,
        daysPerAligner: null,
        prescribedHoursPerDay: null,
        nextReviewDate: '2026-06-03',
        nextReviewAgenda: '换主弓丝',
      }),
      intervals: [],
      checkins: [],
      nowIso: NOW,
    });
    expect(action.label).toBe('下次复诊');
    expect(action.actionKind).toBe('log-review');
    expect(action.date).toBe('2026-06-03');
    expect(action.detail).toBe('换主弓丝');
  });
});
