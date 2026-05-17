/**
 * Pure derivation helpers for the orthodontic feature surface.
 *
 * Authority: spec/kernel/orthodontic-contract.md (PO-ORTHO-005a, PO-ORTHO-008,
 *            PO-ORTHO-010) and spec/kernel/tables/orthodontic-protocols.yaml.
 *
 * This module is the single TS-side mirror of orthodontic spec defaults and
 * the per-cycle compliance projection (PO-ORTHO-008). All functions are pure
 * and unit-tested in `orthodontic-derive.test.ts`. The Rust catalog
 * (queries/orthodontic.rs + queries/orthodontic_journey.inc.rs) and the YAML
 * remain the sole authority; drift is caught by the cargo
 * `protocol_catalog_drift_guard` and the vitest
 * `orthodontic-protocol-catalog.test.ts`.
 */

import type {
  OrthodonticApplianceRow,
  OrthodonticApplianceType,
  OrthodonticCaseRow,
  OrthodonticCheckinRow,
  OrthodonticStage,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';

// ── Spec defaults (mirror Rust `default_review_interval_days_for_rule` /
//    `appliance_supports_wear_gap`) ───────────────────────────────────────

/**
 * Default days between review visits per applianceType. Mirrors
 * `orthodontic-protocols.yaml#rules.defaultIntervalDays` and the Rust
 * `default_review_interval_days_for_rule`.
 */
export function defaultReviewIntervalDays(applianceType: OrthodonticApplianceType): number {
  switch (applianceType) {
    case 'clear-aligner':
      return 56;
    case 'metal-braces':
    case 'ceramic-braces':
      return 28;
    case 'twin-block':
    case 'expander':
    case 'activator':
      return 42;
    case 'retainer-fixed':
    case 'retainer-removable':
      return 180;
  }
}

/**
 * True when the appliance type uses the wear-gap interval stream
 * (PO-ORTHO-005a). Mirrors the Rust `appliance_supports_wear_gap`.
 */
export function applianceSupportsWearGap(applianceType: OrthodonticApplianceType): boolean {
  return (
    applianceType === 'clear-aligner' ||
    applianceType === 'twin-block' ||
    applianceType === 'activator' ||
    applianceType === 'retainer-removable'
  );
}

/**
 * Default prescribed wear hours per day when the appliance row's
 * `prescribedHoursPerDay` is null. Used by cycle-target math when the row is
 * missing a value (e.g. early creation states).
 */
export function defaultPrescribedHoursPerDay(applianceType: OrthodonticApplianceType): number {
  switch (applianceType) {
    case 'clear-aligner':
      return 22;
    case 'twin-block':
    case 'activator':
      return 14;
    case 'retainer-removable':
      return 16;
    case 'metal-braces':
    case 'ceramic-braces':
    case 'retainer-fixed':
    case 'expander':
      return 0;
  }
}

// ── Datetime arithmetic (UTC-based; PO-ORTHO-008 cycle math) ────────────

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Parses an ISO 8601 datetime ("2026-04-10T12:00:00.000Z" or date-only "2026-04-10"). */
function parseIso(iso: string): number {
  return new Date(iso).getTime();
}

function ymdToIsoMidnight(ymd: string): string {
  return `${ymd}T00:00:00.000Z`;
}

// ── Open-interval state ─────────────────────────────────────────────────

export interface OpenIntervalState {
  hasOpen: boolean;
  intervalId: string | null;
  startAt: string | null;
  ageHours: number;
}

/**
 * Identifies whether the appliance has an active "still un-worn" interval and
 * how long it has been open. Returns hasOpen=false when none exists.
 */
export function computeOpenIntervalState(
  intervals: OrthodonticUnwearIntervalRow[],
  nowIso: string,
): OpenIntervalState {
  const open = intervals.find((iv) => iv.endAt === null);
  if (!open) {
    return { hasOpen: false, intervalId: null, startAt: null, ageHours: 0 };
  }
  const ageMs = Math.max(0, parseIso(nowIso) - parseIso(open.startAt));
  return {
    hasOpen: true,
    intervalId: open.intervalId,
    startAt: open.startAt,
    ageHours: ageMs / HOUR_MS,
  };
}

// ── Cycle progress (PO-ORTHO-008) ───────────────────────────────────────

export interface CycleProgress {
  /** Cycle anchor: latest aligner-change checkin (ISO datetime), or appliance.startedAt midnight. */
  cycleAnchor: string;
  /** Hours elapsed from anchor to now. */
  cycleElapsedHours: number;
  /** Σ hours of all (closed + open) unwear intervals overlapping the cycle window. */
  cycleGapHours: number;
  /** Net wear hours = max(0, elapsed − gaps). */
  cycleNetWearHours: number;
  /** Target hours = daysPerAligner × prescribedHoursPerDay (with defaults). */
  cycleTargetHours: number;
  /** 0..1+ ratio. >=1 means on schedule. */
  cycleProgressRatio: number;
  /** Predicted ISO date when net wear reaches target. */
  predictedSwitchDate: string;
  /** Days the predicted switch is shifted vs. the anchor + daysPerAligner ideal. Positive = pushed back. */
  daysShifted: number;
  /** True when the appliance has reached `totalAligners` and no further switch is expected. */
  cycleSeriesComplete: boolean;
  /** 1-based index of the aligner the parent is currently wearing. */
  currentAlignerIndex: number;
}

/**
 * Computes the per-cycle continuous compliance projection for a clear-aligner
 * (or other removable) appliance, per PO-ORTHO-008.
 *
 * Cycle anchor = latest `aligner-change` checkin date (treated at 00:00 UTC),
 * else `appliance.startedAt` midnight.
 *
 * For non-clear-aligner removables the cycle uses `reviewIntervalDays` as the
 * cycle length (the protocol catalog's review cadence is the natural cycle).
 */
export function computeCycleProgress(params: {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  alignerChangeCheckins: OrthodonticCheckinRow[];
  nowIso: string;
}): CycleProgress {
  const { appliance, intervals, alignerChangeCheckins, nowIso } = params;
  const prescribedHours =
    appliance.prescribedHoursPerDay ?? defaultPrescribedHoursPerDay(appliance.applianceType);
  const cycleDays = (() => {
    if (appliance.applianceType === 'clear-aligner') {
      return appliance.daysPerAligner ?? 14;
    }
    return appliance.reviewIntervalDays ?? defaultReviewIntervalDays(appliance.applianceType);
  })();
  const cycleTargetHours = cycleDays * prescribedHours;

  // Cycle anchor + current-aligner index (PO-ORTHO-008): both derive from
  // the LATEST aligner-change row by event time, NOT max(alignerIndex).
  // Latest-by-time means a parent who mis-clicked 换下一副 (creating an idx=3
  // row) can correct themselves by logging a new change with idx=2 — the
  // newer event overrides. Prefer `checkinAt` (sub-day precision) when
  // present; legacy rows (pre-v19) fall back to `checkinDate` at 00:00 UTC.
  const relevantChanges = alignerChangeCheckins
    .filter((c) => c.checkinType === 'aligner-change' && c.applianceId === appliance.applianceId)
    .map((c) => ({
      at: c.checkinAt ?? ymdToIsoMidnight(c.checkinDate),
      idx: c.alignerIndex,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const latestChange = relevantChanges.length > 0
    ? relevantChanges[relevantChanges.length - 1]
    : null;
  const cycleAnchor = latestChange
    ? latestChange.at
    : ymdToIsoMidnight(appliance.startedAt);

  const anchorMs = parseIso(cycleAnchor);
  const nowMs = parseIso(nowIso);
  const cycleElapsedHours = Math.max(0, (nowMs - anchorMs) / HOUR_MS);

  // Σ gap hours within the cycle window.
  let cycleGapHours = 0;
  for (const iv of intervals) {
    const startMs = parseIso(iv.startAt);
    const endMs = iv.endAt ? parseIso(iv.endAt) : nowMs;
    if (endMs <= anchorMs || startMs >= nowMs) continue;
    const overlapStart = Math.max(startMs, anchorMs);
    const overlapEnd = Math.min(endMs, nowMs);
    cycleGapHours += Math.max(0, (overlapEnd - overlapStart) / HOUR_MS);
  }

  const cycleNetWearHours = Math.max(0, cycleElapsedHours - cycleGapHours);
  const cycleProgressRatio = cycleTargetHours > 0 ? cycleNetWearHours / cycleTargetHours : 0;

  // Predict switch date. Net-wear rate is net hours / elapsed hours; fall back
  // to ideal rate (prescribed/24) if no data yet.
  const idealRate = Math.max(0.001, prescribedHours / 24);
  const observedRate =
    cycleElapsedHours > 0 ? cycleNetWearHours / cycleElapsedHours : idealRate;
  const effectiveRate = Math.max(0.001, observedRate || idealRate);
  const remainingTargetHours = Math.max(0, cycleTargetHours - cycleNetWearHours);
  const remainingRealHours = remainingTargetHours / effectiveRate;
  const predictedSwitchMs = nowMs + remainingRealHours * HOUR_MS;
  const idealSwitchMs = anchorMs + cycleDays * DAY_MS;
  const daysShifted = Math.round((predictedSwitchMs - idealSwitchMs) / DAY_MS);

  // Current aligner = the index on the LATEST-by-time aligner-change row
  // (see the sorted `relevantChanges` above). Falls back to 1 before the
  // first logged change. Critically NOT `Math.max(alignerIndex)` — that
  // semantic prevents the parent from ever correcting a mis-clicked higher
  // index by logging a new lower one.
  const latestIndex = latestChange && latestChange.idx !== null ? latestChange.idx : 0;
  const currentAlignerIndex = Math.max(1, latestIndex);
  const totalAligners = appliance.totalAligners ?? null;
  const cycleSeriesComplete =
    totalAligners !== null && currentAlignerIndex >= totalAligners && cycleProgressRatio >= 1;

  return {
    cycleAnchor,
    cycleElapsedHours,
    cycleGapHours,
    cycleNetWearHours,
    cycleTargetHours,
    cycleProgressRatio,
    predictedSwitchDate: new Date(predictedSwitchMs).toISOString(),
    daysShifted,
    cycleSeriesComplete,
    currentAlignerIndex,
  };
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

/** Adds whole days to an ISO date/datetime, returning a `yyyy-mm-dd` date. */
function addDaysIso(iso: string, days: number): string {
  return new Date(parseIso(iso) + days * DAY_MS).toISOString().slice(0, 10);
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

// ── Expander activation cadence (PO-ORTHO-014) ──────────────────────────

export interface ExpanderActivationProjection {
  completedActivations: number;
  prescribedActivations: number | null;
  /** completedActivations / prescribedActivations clamped to [0,1]; null when
   *  there is no prescribed denominator. */
  ratio: number | null;
  /** ISO `yyyy-mm-dd` of the next projected activation, or null when the series
   *  is complete or the appliance is not an expander. */
  nextActivationDate: string | null;
  /** True once `completedActivations >= prescribedActivations`. */
  isComplete: boolean;
}

/**
 * Expander activation progress + next-turn projection (PO-ORTHO-014).
 * `nextActivationDate = max(latest expander-activation event, startedAt) +
 * activationIntervalDays`, with the cadence falling back to 1 day when the
 * appliance has no per-appliance override.
 */
export function computeExpanderActivationProjection(params: {
  appliance: OrthodonticApplianceRow;
  activationCheckins: OrthodonticCheckinRow[];
  nowIso: string;
}): ExpanderActivationProjection {
  const { appliance, activationCheckins } = params;
  const completed = appliance.completedActivations;
  const prescribed = appliance.prescribedActivations;
  const isComplete = prescribed !== null && completed >= prescribed;
  const ratio =
    prescribed !== null && prescribed > 0
      ? Math.max(0, Math.min(1, completed / prescribed))
      : null;
  let nextActivationDate: string | null = null;
  if (appliance.applianceType === 'expander' && !isComplete) {
    const cadenceDays = appliance.activationIntervalDays ?? 1;
    const events = activationCheckins
      .filter(
        (c) =>
          c.checkinType === 'expander-activation' &&
          c.applianceId === appliance.applianceId,
      )
      .map((c) => c.checkinAt ?? ymdToIsoMidnight(c.checkinDate))
      .sort((a, b) => a.localeCompare(b));
    // PO-ORTHO-014: anchor is max(latest activation event, startedAt) — never
    // earlier than the appliance start even if a stray event predates it.
    const startedIso = ymdToIsoMidnight(appliance.startedAt);
    const latestEventIso = events.length > 0 ? events[events.length - 1]! : null;
    const anchorIso =
      latestEventIso !== null && latestEventIso > startedIso ? latestEventIso : startedIso;
    nextActivationDate = addDaysIso(anchorIso, cadenceDays);
  }
  return {
    completedActivations: completed,
    prescribedActivations: prescribed,
    ratio,
    nextActivationDate,
    isComplete,
  };
}

// ── Daily net-wear view (PO-ORTHO-008a) ─────────────────────────────────

export interface DailyNetWear {
  /** Today's net wear hours = 24 − Σ today's gap hours, clamped to [0, 24]. */
  todayNetWearHours: number;
  /** Prescribed daily wear target (`appliance.prescribedHoursPerDay`), or null. */
  todayTargetHours: number | null;
}

/**
 * PO-ORTHO-008a daily net-wear view: today's net wear derived from the same
 * wear-gap stream as the cycle projection, scoped to `[today 00:00 local, now]`.
 * Surfaced as the ring metric for retention removable appliances; the
 * underlying per-cycle projection is unchanged.
 */
export function computeDailyNetWear(params: {
  intervals: OrthodonticUnwearIntervalRow[];
  prescribedHoursPerDay: number | null;
  nowIso: string;
}): DailyNetWear {
  const { intervals, prescribedHoursPerDay, nowIso } = params;
  const now = new Date(nowIso);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const nowMs = now.getTime();
  let gapMs = 0;
  for (const iv of intervals) {
    const startMs = parseIso(iv.startAt);
    const endMs = iv.endAt ? parseIso(iv.endAt) : nowMs;
    const overlapStart = Math.max(startMs, dayStartMs);
    const overlapEnd = Math.min(endMs, nowMs);
    if (overlapEnd > overlapStart) gapMs += overlapEnd - overlapStart;
  }
  const todayNetWearHours = Math.max(0, Math.min(24, 24 - gapMs / HOUR_MS));
  return { todayNetWearHours, todayTargetHours: prescribedHoursPerDay };
}

// ── Stage stepper ───────────────────────────────────────────────────────

export const STAGE_ORDER: OrthodonticStage[] = [
  'assessment',
  'planning',
  'active',
  'retention',
  'completed',
];

export interface StageOption {
  stage: OrthodonticStage;
  state: 'past' | 'current' | 'future';
  /** True when the parent can advance to this stage from the current one. */
  advanceable: boolean;
  /** Human-readable reason if NOT advanceable, else null. */
  blockedReason: string | null;
}

/**
 * Builds the stage stepper view-model. Stages are parent-initiated only
 * (PO-ORTHO-002); `completed` requires `actualEndAt` to be set.
 */
export function computeStageOptions(
  caseRow: Pick<OrthodonticCaseRow, 'stage' | 'actualEndAt'>,
): StageOption[] {
  const currentIdx = STAGE_ORDER.indexOf(caseRow.stage);
  return STAGE_ORDER.map((stage, idx) => {
    const state: StageOption['state'] =
      idx < currentIdx ? 'past' : idx === currentIdx ? 'current' : 'future';
    const isImmediateNext = idx === currentIdx + 1;
    let advanceable = false;
    let blockedReason: string | null = null;
    if (state === 'future') {
      if (!isImmediateNext) {
        blockedReason = '只能依次推进相邻阶段';
      } else if (stage === 'completed' && !caseRow.actualEndAt) {
        blockedReason = '完成阶段需要先填写实际结束日期';
      } else {
        advanceable = true;
      }
    }
    return { stage, state, advanceable, blockedReason };
  });
}

// ── Formatting ──────────────────────────────────────────────────────────

export function formatHours(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} 分钟`;
  }
  if (hours < 10) {
    return `${hours.toFixed(1)} 小时`;
  }
  return `${Math.round(hours)} 小时`;
}

export function caseTypeLabel(t: OrthodonticCaseRow['caseType']): string {
  switch (t) {
    case 'early-intervention':
      return '早期矫治';
    case 'fixed-braces':
      return '固定矫治';
    case 'clear-aligners':
      return '隐形矫治';
    case 'unknown-legacy':
      return '历史疗程';
  }
}

export function stageLabel(s: OrthodonticStage): string {
  switch (s) {
    case 'assessment':
      return '初评';
    case 'planning':
      return '方案规划';
    case 'active':
      return '治疗中';
    case 'retention':
      return '保持期';
    case 'completed':
      return '已完成';
  }
}

export function applianceTypeLabel(t: OrthodonticApplianceType): string {
  switch (t) {
    case 'twin-block':
      return 'Twin-Block 功能矫治器';
    case 'expander':
      return '扩弓器';
    case 'activator':
      return '功能性矫治器';
    case 'metal-braces':
      return '金属固定矫治器';
    case 'ceramic-braces':
      return '陶瓷固定矫治器';
    case 'clear-aligner':
      return '隐形牙套';
    case 'retainer-fixed':
      return '固定保持器';
    case 'retainer-removable':
      return '活动保持器';
  }
}
