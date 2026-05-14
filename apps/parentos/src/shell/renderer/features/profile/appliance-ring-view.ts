/**
 * Ring-metric dispatch for the multi-appliance orthodontic surface.
 *
 * Every appliance card shows one progress ring, but the *metric* the ring
 * tracks depends on the appliance type and treatment context:
 *
 *   - clear-aligner            → PO-ORTHO-008 per-cycle continuous projection
 *   - expander (w/ prescribed) → PO-ORTHO-014 activation count (圈数)
 *   - retention removables     → PO-ORTHO-008a daily net-wear view
 *   - everything else          → PO-ORTHO-013 phase month counter
 *
 * This module is the single place that decision is made; it produces a
 * uniform `ApplianceRingView` the `ApplianceRing` component renders verbatim.
 * Wording stays factual (PO-ORTHO-010) — no prescriptive verbs.
 */
import type {
  OrthodonticApplianceRow,
  OrthodonticCaseRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { applianceIdentity } from './appliance-identity.js';
import {
  applianceSupportsWearGap,
  computeAppliancePhaseProgress,
  computeCycleProgress,
  computeDailyNetWear,
  computeExpanderActivationProjection,
  computeOpenIntervalState,
} from './orthodontic-derive.js';
import { computeTreatmentRingCopy } from './orthodontic-treatment-ring-copy.js';

const UNWEAR_AMBER = '#f59e0b';

export type ApplianceRingView =
  | {
      kind: 'metric';
      /** Small caption above the number. */
      caption: string;
      /** Big center value. */
      value: string;
      /** Unit suffix next to the value. */
      unit: string;
      /** Optional mono footer line. */
      footer: string | null;
      /** 0..1 fill ratio, or null for an unfilled track. */
      ratio: number | null;
      /** Ring stroke colour. */
      accent: string;
    }
  | { kind: 'message'; message: string; accent: string };

/** Picks the ring metric for one appliance and renders it to a uniform view. */
export function computeApplianceRingView(params: {
  appliance: OrthodonticApplianceRow;
  caseRow: Pick<OrthodonticCaseRow, 'stage'>;
  intervals: OrthodonticUnwearIntervalRow[];
  checkins: OrthodonticCheckinRow[];
  nowIso: string;
}): ApplianceRingView {
  const { appliance, caseRow, intervals, checkins, nowIso } = params;
  const identityColor = applianceIdentity(appliance.applianceType).solid;
  const openState = applianceSupportsWearGap(appliance.applianceType)
    ? computeOpenIntervalState(intervals, nowIso)
    : { hasOpen: false, intervalId: null, startAt: null, ageHours: 0 };
  const accent = openState.hasOpen ? UNWEAR_AMBER : identityColor;

  // ── clear-aligner: PO-ORTHO-008 cycle projection ──────────────────────
  if (appliance.applianceType === 'clear-aligner') {
    const cycle = computeCycleProgress({
      appliance,
      intervals,
      alignerChangeCheckins: checkins,
      nowIso,
    });
    const copy = computeTreatmentRingCopy({ primaryAppliance: appliance, cycle, openState });
    if (copy.kind === 'cycle') {
      return {
        kind: 'metric',
        caption: copy.caption,
        value: copy.primaryNumber,
        unit: copy.unit,
        footer: copy.footer,
        ratio: Math.max(0, Math.min(1, cycle.cycleProgressRatio)),
        accent,
      };
    }
    return { kind: 'message', message: copy.message, accent };
  }

  // ── expander with a prescribed cap: PO-ORTHO-014 activation count ─────
  if (appliance.applianceType === 'expander' && appliance.prescribedActivations !== null) {
    const proj = computeExpanderActivationProjection({
      appliance,
      activationCheckins: checkins,
      nowIso,
    });
    return {
      kind: 'metric',
      caption: proj.isComplete ? '扩弓已完成' : '扩弓进度',
      value: String(proj.completedActivations),
      unit: ` / ${proj.prescribedActivations} 圈`,
      footer: proj.isComplete
        ? '已完成加力'
        : `还差 ${Math.max(0, (proj.prescribedActivations ?? 0) - proj.completedActivations)} 圈`,
      ratio: proj.ratio,
      accent,
    };
  }

  // ── retention removables: PO-ORTHO-008a daily net-wear view ──────────
  const isRetentionDaily =
    appliance.applianceType === 'retainer-removable' ||
    (applianceSupportsWearGap(appliance.applianceType) && caseRow.stage === 'retention');
  if (isRetentionDaily) {
    const daily = computeDailyNetWear({
      intervals,
      prescribedHoursPerDay: appliance.prescribedHoursPerDay,
      nowIso,
    });
    const rounded = Math.round(daily.todayNetWearHours);
    return {
      kind: 'metric',
      caption: openState.hasOpen ? '未戴中' : '今日佩戴',
      value: String(rounded),
      unit: daily.todayTargetHours !== null ? ` / ${daily.todayTargetHours} h` : ' h',
      footer: '今日净戴近似',
      ratio:
        daily.todayTargetHours !== null && daily.todayTargetHours > 0
          ? Math.max(0, Math.min(1, daily.todayNetWearHours / daily.todayTargetHours))
          : null,
      accent,
    };
  }

  // ── everything else: PO-ORTHO-013 phase month counter ────────────────
  const phase = computeAppliancePhaseProgress(appliance, nowIso);
  if (!phase) {
    return { kind: 'message', message: '尚未设置治疗阶段', accent: identityColor };
  }
  return {
    kind: 'metric',
    caption: phase.label,
    value: String(phase.monthsInPhase),
    unit: ` / ${phase.expectedMonths} 个月`,
    footer: `第 ${phase.phaseNumber} / ${phase.phaseTotal} 阶段`,
    ratio: Math.max(0, Math.min(1, phase.monthsInPhase / phase.expectedMonths)),
    accent,
  };
}
