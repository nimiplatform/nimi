import type { OrthodonticApplianceRow } from '../../bridge/sqlite-bridge.js';
import type { CycleProgress, OpenIntervalState } from './orthodontic-derive.js';

// ── Copy generator (PO-ORTHO-010 fact-restatement only) ────

export type TreatmentRingCopy =
  | {
      kind: 'cycle';
      caption: string;
      primaryNumber: string;
      unit: string;
      footer: string | null;
    }
  | { kind: 'message'; message: string };

/**
 * Single source of every parent-facing string the wearing ring shows. The
 * PO-ORTHO-010 boundary lives entirely here — no other layer rewrites the
 * wording. Tests pin every branch (`orthodontic-treatment-ring-copy.test.ts`)
 * so a future "small UX tweak" cannot silently resurrect a retired
 * prescriptive verb ("应该 / 建议 / 请加长 / 保持节奏").
 */
export function computeTreatmentRingCopy(input: {
  primaryAppliance: OrthodonticApplianceRow | null;
  cycle: CycleProgress | null;
  openState: OpenIntervalState | null;
}): TreatmentRingCopy {
  const { primaryAppliance, cycle, openState } = input;

  if (!primaryAppliance) {
    return {
      kind: 'message',
      message: '当前疗程还没有进行中的装置。',
    };
  }

  const isOpen = openState?.hasOpen ?? false;
  const ageHours = openState?.ageHours ?? 0;

  if (cycle) {
    const netHours = Math.round(cycle.cycleNetWearHours);
    const remaining = Math.max(0, cycle.cycleTargetHours - cycle.cycleNetWearHours);
    const remainingRounded = Math.round(remaining);
    const pct = Math.max(0, Math.min(100, Math.round(cycle.cycleProgressRatio * 100)));

    if (isOpen) {
      // 未戴中 — number = open-interval age; footer keeps the cycle wear
      // tally + percentage so the parent still sees progress despite being off.
      const ageHoursRounded = Math.max(0, Math.round(ageHours));
      return {
        kind: 'cycle',
        caption: '未戴中',
        primaryNumber: String(ageHoursRounded),
        unit: 'h',
        footer: `本副已戴 ${netHours}h · ${pct}%`,
      };
    }

    if (cycle.cycleProgressRatio >= 1) {
      return {
        kind: 'cycle',
        caption: '本副已达标',
        primaryNumber: String(netHours),
        unit: 'h',
        footer: '100%',
      };
    }

    return {
      kind: 'cycle',
      caption: '本副已戴',
      primaryNumber: String(netHours),
      unit: 'h',
      footer: `还差 ${remainingRounded}h · ${pct}%`,
    };
  }

  // Non clear-aligner — no cycle math; surface a single-line fact only.
  if (isOpen) {
    const prescribed = primaryAppliance.prescribedHoursPerDay;
    return {
      kind: 'message',
      message: prescribed
        ? `未戴中 · 医嘱每日佩戴 ${prescribed} 小时`
        : '未戴中',
    };
  }
  if (primaryAppliance.prescribedHoursPerDay) {
    return {
      kind: 'message',
      message: `医嘱每日佩戴 ${primaryAppliance.prescribedHoursPerDay} 小时`,
    };
  }
  return { kind: 'message', message: '装置使用中' };
}

