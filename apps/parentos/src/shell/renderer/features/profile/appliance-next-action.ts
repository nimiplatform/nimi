/**
 * Per-appliance "next action" projection for the multi-appliance surface.
 *
 * Each appliance has one forward-looking action keyed off its type:
 *   - clear-aligner → 下次换套 (PO-ORTHO-008 predicted switch date)
 *   - expander      → 下次转动 (PO-ORTHO-014 next activation date)
 *   - everything else → 下次复诊 (appliance.nextReviewDate)
 *
 * Hero cards externalise this into `appliance-next-action-row`; the full-width
 * compact card embeds it inline. The agenda detail line is parent-entered
 * (`nextReviewAgenda`, PO-ORTHO-015) — never inferred.
 */
import type {
  OrthodonticApplianceRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import {
  computeCycleProgress,
  computeExpanderActivationProjection,
} from './orthodontic-derive.js';

export type ApplianceNextActionKind = 'switch-aligner' | 'log-activation' | 'log-review';

export interface ApplianceNextAction {
  /** "下次换套" / "下次转动" / "下次复诊" */
  label: string;
  /** yyyy-mm-dd, or null when there is no projected date. */
  date: string | null;
  /** Whole days from today; negative = overdue; null when no date. */
  daysAway: number | null;
  /** Secondary line — cadence / shift hint / parent-entered agenda. */
  detail: string | null;
  /** Button label for the inline / row action. */
  actionLabel: string;
  actionKind: ApplianceNextActionKind;
}

function daysBetween(targetYmd: string, nowIso: string): number {
  // Calendar-day diff in UTC: how many wall days from today to target. The
  // earlier `Math.round((target − now) / 24h)` form mixed midnight-target
  // with wall-clock-now, so a target on day+2 read as "1 day" whenever it
  // was already past noon (35h / 24 = 1.46 → round 1). The home dashboard's
  // `deriveOrthoCycle` uses the same calendar-day model — keeping them
  // aligned is what makes "下次换套" days-away consistent across surfaces.
  const targetMs = Date.UTC(
    Number(targetYmd.slice(0, 4)),
    Number(targetYmd.slice(5, 7)) - 1,
    Number(targetYmd.slice(8, 10)),
  );
  const now = new Date(nowIso);
  const todayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));
}

export function computeApplianceNextAction(params: {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  checkins: OrthodonticCheckinRow[];
  nowIso: string;
}): ApplianceNextAction {
  const { appliance, intervals, checkins, nowIso } = params;

  if (appliance.applianceType === 'clear-aligner') {
    const cycle = computeCycleProgress({
      appliance,
      intervals,
      alignerChangeCheckins: checkins,
      nowIso,
    });
    const date = cycle.predictedSwitchDate.slice(0, 10);
    // On-schedule (daysShifted === 0) renders no detail line — the date +
    // days-away pill already convey "you're on track", and the redundant
    // "按计划" word felt like editorialising for the common-case parent.
    const detail =
      cycle.daysShifted > 0
        ? `预计推后 ${cycle.daysShifted} 天`
        : cycle.daysShifted < 0
          ? `预计提前 ${-cycle.daysShifted} 天`
          : null;
    return {
      label: '下次换套',
      date,
      daysAway: daysBetween(date, nowIso),
      detail,
      actionLabel: '换下一副',
      actionKind: 'switch-aligner',
    };
  }

  if (appliance.applianceType === 'expander') {
    const proj = computeExpanderActivationProjection({
      appliance,
      activationCheckins: checkins,
      nowIso,
    });
    const cadence = appliance.activationIntervalDays ?? 1;
    return {
      label: '下次转动',
      date: proj.nextActivationDate,
      daysAway: proj.nextActivationDate ? daysBetween(proj.nextActivationDate, nowIso) : null,
      detail: proj.isComplete ? '已完成加力' : `每 ${cadence} 天转一次`,
      actionLabel: '记录转动',
      actionKind: 'log-activation',
    };
  }

  return {
    label: '下次复诊',
    date: appliance.nextReviewDate,
    daysAway: appliance.nextReviewDate
      ? daysBetween(appliance.nextReviewDate, nowIso)
      : null,
    detail: appliance.nextReviewAgenda,
    actionLabel: '记录就诊',
    actionKind: 'log-review',
  };
}
