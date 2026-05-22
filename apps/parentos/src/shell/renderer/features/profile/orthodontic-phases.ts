import type {
  OrthodonticApplianceRow,
  OrthodonticApplianceType,
} from '../../bridge/sqlite-bridge.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function parseIso(iso: string): number {
  return new Date(iso).getTime();
}

function ymdToIsoMidnight(ymd: string): string {
  return `${ymd}T00:00:00.000Z`;
}

// ── Per-appliance treatment phase (PO-ORTHO-013) ────────────────────────

export interface AppliancePhase {
  phaseId: string;
  /** Short phase name shown on the appliance card pill. */
  label: string;
  /** One-sentence plain-language explanation surfaced in the phase dialog. */
  description: string;
  /** Typical phase duration — a projection for the month counter, never a deadline. */
  expectedMonths: number;
}

/**
 * Ordered per-appliance-type treatment-phase sequences. TS mirror of
 * `orthodontic-protocols.yaml#appliancePhases`; the YAML is the sole authority
 * and `orthodontic-protocol-catalog.test.ts` pins this against it.
 */
export const APPLIANCE_PHASES: Record<OrthodonticApplianceType, AppliancePhase[]> = {
  'twin-block': [
    {
      phaseId: 'functional',
      label: '功能导下颌',
      description: '矫治器引导下颌向前生长，改善上下颌的位置关系。',
      expectedMonths: 9,
    },
    {
      phaseId: 'settling',
      label: '咬合稳定',
      description: '下颌位置基本到位后，让新的咬合关系逐渐稳定下来。',
      expectedMonths: 3,
    },
  ],
  expander: [
    {
      phaseId: 'widening',
      label: '加力扩弓',
      description: '按医嘱定期加力，逐步把过窄的牙弓扩开。',
      expectedMonths: 3,
    },
    {
      phaseId: 'holding',
      label: '保持稳定',
      description: '停止加力，让扩开的牙弓在原位保持，等待骨质长稳。',
      expectedMonths: 6,
    },
  ],
  activator: [
    {
      phaseId: 'functional',
      label: '功能导下颌',
      description: '矫治器引导下颌向前生长，改善上下颌的位置关系。',
      expectedMonths: 9,
    },
    {
      phaseId: 'settling',
      label: '咬合稳定',
      description: '下颌位置基本到位后，让新的咬合关系逐渐稳定下来。',
      expectedMonths: 3,
    },
  ],
  'metal-braces': [
    {
      phaseId: 'leveling',
      label: '排齐整平',
      description: '用弓丝把拥挤、高低不齐的牙齿先排齐、整平。',
      expectedMonths: 8,
    },
    {
      phaseId: 'space-closure',
      label: '关闭间隙',
      description: '逐步关闭拔牙或牙缝留下的空隙。',
      expectedMonths: 6,
    },
    {
      phaseId: 'finishing',
      label: '咬合精调',
      description: '对每颗牙的位置和上下咬合做精细调整。',
      expectedMonths: 4,
    },
    {
      phaseId: 'debond-prep',
      label: '拆机准备',
      description: '效果达标后，准备拆除矫治器并转入保持期。',
      expectedMonths: 2,
    },
  ],
  'ceramic-braces': [
    {
      phaseId: 'leveling',
      label: '排齐整平',
      description: '用弓丝把拥挤、高低不齐的牙齿先排齐、整平。',
      expectedMonths: 8,
    },
    {
      phaseId: 'space-closure',
      label: '关闭间隙',
      description: '逐步关闭拔牙或牙缝留下的空隙。',
      expectedMonths: 6,
    },
    {
      phaseId: 'finishing',
      label: '咬合精调',
      description: '对每颗牙的位置和上下咬合做精细调整。',
      expectedMonths: 4,
    },
    {
      phaseId: 'debond-prep',
      label: '拆机准备',
      description: '效果达标后，准备拆除矫治器并转入保持期。',
      expectedMonths: 2,
    },
  ],
  'clear-aligner': [
    {
      phaseId: 'active-series',
      label: '主动序列',
      description: '按医嘱依次佩戴每一副牙套，把牙齿逐步移动到目标位置。',
      expectedMonths: 12,
    },
    {
      phaseId: 'refinement',
      label: '精调序列',
      description: '主体排齐后，用补充牙套对个别牙齿做最后微调。',
      expectedMonths: 3,
    },
  ],
  'retainer-fixed': [
    {
      phaseId: 'stabilizing',
      label: '稳定保持期',
      description: '矫治刚结束、牙齿仍易移动，靠固定保持器维持效果。',
      expectedMonths: 12,
    },
    {
      phaseId: 'long-term',
      label: '长期保持期',
      description: '牙齿位置趋于稳定，进入长期维持阶段。',
      expectedMonths: 24,
    },
  ],
  'retainer-removable': [
    {
      phaseId: 'full-time',
      label: '全日佩戴',
      description: '除进食、刷牙外全天佩戴保持器，巩固矫治效果。',
      expectedMonths: 6,
    },
    {
      phaseId: 'night-time',
      label: '夜间佩戴',
      description: '牙齿趋于稳定后，改为仅夜间睡觉时佩戴。',
      expectedMonths: 12,
    },
    {
      phaseId: 'intermittent',
      label: '间歇佩戴',
      description: '牙齿长期稳定后，按医嘱每周佩戴若干晚。',
      expectedMonths: 24,
    },
  ],
};

/**
 * Whole months elapsed since an ISO date/datetime, ceil semantics matching the
 * case-level `monthsElapsed` projection: 0 before day 1, else
 * `max(1, ceil(days / 30))` so day 1 already reads as "第 1 月".
 */
function monthsSinceCeil(fromIso: string, nowIso: string): number {
  const fromMs = parseIso(fromIso.length > 10 ? fromIso : ymdToIsoMidnight(fromIso));
  const days = Math.max(0, (parseIso(nowIso) - fromMs) / DAY_MS);
  return days > 0 ? Math.max(1, Math.ceil(days / 30)) : 0;
}

export interface AppliancePhaseProgress {
  phaseId: string;
  label: string;
  /** 1-based position of the current phase in the type sequence. */
  phaseNumber: number;
  phaseTotal: number;
  /** Whole months since `phaseStartedAt` (ceil). */
  monthsInPhase: number;
  /** Typical-duration projection — never a deadline (PO-ORTHO-013). */
  expectedMonths: number;
}

/**
 * Per-appliance phase view-model (PO-ORTHO-013). Returns null when the
 * appliance has no phase set yet (the admitted "未设置" intermediate state) or
 * — defensively — when the persisted phase is not in the type's sequence (the
 * Rust read path already fail-closes on that, so this is belt-and-braces).
 */
export function computeAppliancePhaseProgress(
  appliance: OrthodonticApplianceRow,
  nowIso: string,
): AppliancePhaseProgress | null {
  if (!appliance.currentPhase) return null;
  const seq = APPLIANCE_PHASES[appliance.applianceType];
  const idx = seq.findIndex((p) => p.phaseId === appliance.currentPhase);
  if (idx < 0) return null;
  const phase = seq[idx]!;
  const anchor = appliance.phaseStartedAt ?? appliance.startedAt;
  return {
    phaseId: phase.phaseId,
    label: phase.label,
    phaseNumber: idx + 1,
    phaseTotal: seq.length,
    monthsInPhase: monthsSinceCeil(anchor, nowIso),
    expectedMonths: phase.expectedMonths,
  };
}

export interface AppliancePhaseOption {
  phaseId: string;
  label: string;
  /** Plain-language explanation of the phase, mirrored from the protocol catalog. */
  description: string;
  /** Typical-duration projection for the phase (months); never a deadline. */
  expectedMonths: number;
  state: 'past' | 'current' | 'future';
  /** True when the parent can advance to this phase from the current one. */
  advanceable: boolean;
}

/**
 * Per-appliance phase stepper view-model — the PO-ORTHO-013 mirror of
 * `computeStageOptions`. With a null `currentPhase` the first phase is the
 * single advanceable target; otherwise the immediate next phase is advanceable.
 */
export function computeAppliancePhaseOptions(
  appliance: Pick<OrthodonticApplianceRow, 'applianceType' | 'currentPhase'>,
): AppliancePhaseOption[] {
  const seq = APPLIANCE_PHASES[appliance.applianceType];
  const currentIdx = appliance.currentPhase
    ? seq.findIndex((p) => p.phaseId === appliance.currentPhase)
    : -1;
  return seq.map((phase, idx) => {
    const state: AppliancePhaseOption['state'] =
      idx < currentIdx ? 'past' : idx === currentIdx ? 'current' : 'future';
    return {
      phaseId: phase.phaseId,
      label: phase.label,
      description: phase.description,
      expectedMonths: phase.expectedMonths,
      state,
      advanceable: idx === currentIdx + 1,
    };
  });
}
