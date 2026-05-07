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
  OrthodonticJourney,
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

function addDaysIso(iso: string, days: number): string {
  const ms = parseIso(iso) + days * DAY_MS;
  return new Date(ms).toISOString();
}

function isoToYmd(iso: string): string {
  return iso.slice(0, 10);
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

  // Cycle anchor = latest aligner-change date (at 00:00 UTC), else appliance.startedAt 00:00 UTC.
  const latestAlignerChange = alignerChangeCheckins
    .filter((c) => c.checkinType === 'aligner-change' && c.applianceId === appliance.applianceId)
    .map((c) => c.checkinDate)
    .sort()
    .pop();
  const cycleAnchor = latestAlignerChange
    ? ymdToIsoMidnight(latestAlignerChange)
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

  // Aligner indices.
  const alignerIndices = alignerChangeCheckins
    .filter((c) => c.applianceId === appliance.applianceId && c.alignerIndex !== null)
    .map((c) => c.alignerIndex as number);
  const latestIndex = alignerIndices.length > 0 ? Math.max(...alignerIndices) : 0;
  // The "current" aligner is the one the parent is actively wearing now.
  // If they have logged N changes, they are wearing aligner N (1-based);
  // before the first logged change, they are wearing aligner 1.
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

// ── Contextual prompts ──────────────────────────────────────────────────

export type ContextualPromptKind =
  | 'record-aligner-switch'
  | 'close-open-unwear'
  | 'recent-review-undocumented'
  | 'record-anomaly';

export interface ContextualPrompt {
  kind: ContextualPromptKind;
  priority: 'p1' | 'p2' | 'p3';
  /** Display headline; deterministic, PO-ORTHO-010 admitted wording. */
  headline: string;
  /** Display body; deterministic. */
  body: string;
  /** When applicable, the appliance/interval the prompt is anchored to. */
  applianceId: string | null;
  intervalId: string | null;
}

/**
 * Computes the active contextual prompts for the today/cycle surfaces. All
 * triggers are deterministic (no AI, no probability). Empty array means no
 * prompt is currently applicable.
 */
export function computeContextualPrompts(params: {
  caseRow: OrthodonticCaseRow;
  appliances: OrthodonticApplianceRow[];
  intervalsByAppliance: Record<string, OrthodonticUnwearIntervalRow[]>;
  checkinsByAppliance: Record<string, OrthodonticCheckinRow[]>;
  journey: OrthodonticJourney | null;
  nowIso: string;
}): ContextualPrompt[] {
  const { appliances, intervalsByAppliance, checkinsByAppliance, journey, nowIso } = params;
  const out: ContextualPrompt[] = [];
  const todayYmd = isoToYmd(nowIso);

  for (const appliance of appliances) {
    if (appliance.status !== 'active') continue;
    const intervals = intervalsByAppliance[appliance.applianceId] ?? [];
    const checkins = checkinsByAppliance[appliance.applianceId] ?? [];

    // 1. close-open-unwear: open interval > 4h.
    const openState = computeOpenIntervalState(intervals, nowIso);
    if (openState.hasOpen && openState.ageHours >= 4) {
      out.push({
        kind: 'close-open-unwear',
        priority: 'p1',
        headline: '可能忘记戴回了',
        body: `已未戴 ${formatHours(openState.ageHours)}。如果已经戴回，请关闭这一段记录。`,
        applianceId: appliance.applianceId,
        intervalId: openState.intervalId,
      });
    }

    // 2. record-aligner-switch: clear-aligner, daysPerAligner elapsed since
    //    last anchor, more aligners remaining.
    if (
      appliance.applianceType === 'clear-aligner' &&
      appliance.daysPerAligner !== null &&
      appliance.totalAligners !== null
    ) {
      const lastChangeYmd = checkins
        .filter((c) => c.checkinType === 'aligner-change')
        .map((c) => c.checkinDate)
        .sort()
        .pop();
      const anchorYmd = lastChangeYmd ?? appliance.startedAt;
      const elapsedDays = Math.floor(
        (parseIso(ymdToIsoMidnight(todayYmd)) - parseIso(ymdToIsoMidnight(anchorYmd))) / DAY_MS,
      );
      const latestIndex = checkins
        .filter((c) => c.alignerIndex !== null)
        .map((c) => c.alignerIndex as number)
        .reduce((acc, v) => Math.max(acc, v), 0);
      if (
        elapsedDays >= appliance.daysPerAligner &&
        latestIndex < appliance.totalAligners
      ) {
        out.push({
          kind: 'record-aligner-switch',
          priority: 'p1',
          headline: '该换下一副了',
          body: `本副已戴 ${elapsedDays} 天（医嘱 ${appliance.daysPerAligner} 天）。如果已经更换，请记录下一副的序号。`,
          applianceId: appliance.applianceId,
          intervalId: null,
        });
      }
    }

    // 3. recent-review-undocumented: appliance.nextReviewDate < today AND
    //    no ortho-review event in past 7 days.
    if (appliance.nextReviewDate && appliance.nextReviewDate < todayYmd) {
      const sevenDaysAgo = isoToYmd(addDaysIso(nowIso, -7));
      const recentReview = (journey?.past ?? []).some(
        (entry) =>
          entry.kind === 'clinical-event' &&
          entry.eventType === 'ortho-review' &&
          isoToYmd(entry.occurredAt) >= sevenDaysAgo,
      );
      if (!recentReview) {
        out.push({
          kind: 'recent-review-undocumented',
          priority: 'p2',
          headline: '复诊已过期未记录',
          body: `预定复诊日 ${appliance.nextReviewDate} 已过。如果已经复诊，请补一笔临床事件以推进周期。`,
          applianceId: appliance.applianceId,
          intervalId: null,
        });
      }
    }
  }

  // 4. record-anomaly: always available, priority p3.
  out.push({
    kind: 'record-anomaly',
    priority: 'p3',
    headline: '有异常想记一笔？',
    body: '脱落、断裂、疼痛、肿胀都可以写下来，便于复诊时与医生沟通。',
    applianceId: null,
    intervalId: null,
  });

  // Stable priority sort: p1 > p2 > p3.
  const rank: Record<ContextualPrompt['priority'], number> = { p1: 0, p2: 1, p3: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

// ── Deterministic AI summary (PO-ORTHO-010) ─────────────────────────────

/**
 * Produces the "AI summary" sentences shown below the weekly strip. These are
 * deterministic, computed-only descriptions of admitted facts (PO-ORTHO-010
 * fact-restatement + descriptive trend wording). No SDK call, no inference.
 *
 * Returns an empty array when there is not enough data.
 */
export function formatDeterministicAiSummary(params: {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  alignerChangeCheckins: OrthodonticCheckinRow[];
  nowIso: string;
}): string[] {
  const { appliance, intervals, alignerChangeCheckins, nowIso } = params;
  const out: string[] = [];

  // Last 7 days net wear.
  const sevenDaysAgoMs = parseIso(nowIso) - 7 * DAY_MS;
  const nowMs = parseIso(nowIso);
  let last7GapHours = 0;
  for (const iv of intervals) {
    const startMs = parseIso(iv.startAt);
    const endMs = iv.endAt ? parseIso(iv.endAt) : nowMs;
    if (endMs <= sevenDaysAgoMs || startMs >= nowMs) continue;
    last7GapHours +=
      Math.max(0, Math.min(endMs, nowMs) - Math.max(startMs, sevenDaysAgoMs)) / HOUR_MS;
  }
  const last7ElapsedHours = (nowMs - sevenDaysAgoMs) / HOUR_MS;
  const last7NetHours = Math.max(0, last7ElapsedHours - last7GapHours);
  if (last7ElapsedHours > 0) {
    const avgPerDay = last7NetHours / 7;
    out.push(`近 7 天净戴约 ${formatHours(last7NetHours)} · 日均 ${formatHours(avgPerDay)}（任务达成率近似）`);
  }

  // Cycle ratio + days shifted (clear-aligner only).
  if (appliance.applianceType === 'clear-aligner') {
    const cycle = computeCycleProgress({
      appliance,
      intervals,
      alignerChangeCheckins,
      nowIso,
    });
    out.push(
      `本副已净戴 ${formatHours(cycle.cycleNetWearHours)} / 共 ${formatHours(cycle.cycleTargetHours)}（PO-ORTHO-008 任务达成率近似）`,
    );
    if (cycle.daysShifted > 0) {
      out.push(`下次换套预计推后 ${cycle.daysShifted} 天`);
    } else if (cycle.daysShifted < 0) {
      out.push(`下次换套预计提前 ${-cycle.daysShifted} 天`);
    }
  }

  // Next review.
  if (appliance.nextReviewDate) {
    const daysToReview = Math.round(
      (parseIso(ymdToIsoMidnight(appliance.nextReviewDate)) - parseIso(nowIso)) / DAY_MS,
    );
    if (daysToReview >= 0) {
      out.push(`下次复诊还有 ${daysToReview} 天 · ${appliance.nextReviewDate}`);
    } else {
      out.push(`复诊已过期 ${-daysToReview} 天 · 原定 ${appliance.nextReviewDate}`);
    }
  }

  return out;
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
