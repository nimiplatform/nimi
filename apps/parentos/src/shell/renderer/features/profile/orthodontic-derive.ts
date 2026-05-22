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

// ── Latest aligner-change derivation ────────────────────────────────────

export interface LatestAlignerChange {
  /** ISO datetime — `checkinAt` when present, else `checkinDate` at 00:00 UTC. */
  at: string;
  /** 1-based aligner index on that row. Clamped to >= 1. */
  index: number;
}

/**
 * Picks the LATEST-by-time `aligner-change` row for an appliance and returns
 * its anchor time + alignerIndex. PO-ORTHO-008's "latest-by-time" semantic is
 * the single source of which-tray-is-current truth — exported so the home
 * dashboard widget (`deriveOrthoCycle`) can't drift back to `Math.max`, which
 * traps a parent who mis-clicked 换下一副 (logging a stale higher index) into
 * never being able to correct themselves by logging a newer lower index.
 *
 * `checkinAt` (sub-day precision) is preferred over `checkinDate` (00:00 UTC
 * fallback for legacy rows) so a same-day correction overrides earlier rows
 * even when one row uses the legacy date-only format.
 */
export function findLatestAlignerChange(
  checkins: OrthodonticCheckinRow[],
  applianceId: string,
): LatestAlignerChange | null {
  const sorted = checkins
    .filter((c) => c.checkinType === 'aligner-change' && c.applianceId === applianceId)
    .map((c) => ({
      at: c.checkinAt ?? ymdToIsoMidnight(c.checkinDate),
      idx: c.alignerIndex,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (sorted.length === 0) return null;
  const latest = sorted[sorted.length - 1]!;
  return {
    at: latest.at,
    index: latest.idx !== null && latest.idx > 0 ? latest.idx : 1,
  };
}

// ── Aligner-context decoration (PO-ORTHO-006a) ──────────────────────────

export interface AlignerContext {
  /** 1-based tray index worn on the queried date. */
  alignerIndex: number;
  /** 1-based day within that tray; the anchor day (change/start) is day 1. */
  dayInTray: number;
  /** Prescribed wear days per tray, or null when the appliance has none set. */
  daysPerAligner: number | null;
}

/**
 * Derives the "第 X 副牙套·第 Y/Z 天" decoration for an orthodontic clinical
 * event rendered in the dental timeline (PO-ORTHO-006a). Returns null unless a
 * `clear-aligner` appliance window covers `eventDate` — so non-clear-aligner
 * cases and events dated outside any aligner window carry no aligner context.
 *
 * `eventDate` is a date-only `yyyy-mm-dd` string (dental records are
 * date-granular); all comparisons run on the UTC-midnight calendar date.
 */
export function deriveAlignerContextForDate(params: {
  appliances: OrthodonticApplianceRow[];
  checkins: OrthodonticCheckinRow[];
  eventDate: string;
}): AlignerContext | null {
  const { appliances, checkins, eventDate } = params;
  const dateOnly = eventDate.slice(0, 10);

  // Clear-aligner appliance whose [startedAt, endedAt] window covers the date.
  // On overlap (e.g. a refinement series) the latest-started appliance wins.
  const covering = appliances
    .filter(
      (a) =>
        a.applianceType === 'clear-aligner' &&
        a.startedAt.slice(0, 10) <= dateOnly &&
        (a.endedAt === null || dateOnly <= a.endedAt.slice(0, 10)),
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const appliance = covering[covering.length - 1];
  if (!appliance) return null;

  // Latest aligner-change on or before the date anchors the current tray;
  // before the first change the parent is still on tray 1 since startedAt.
  const priorChanges = checkins
    .filter(
      (c) =>
        c.checkinType === 'aligner-change' &&
        c.applianceId === appliance.applianceId &&
        c.checkinDate.slice(0, 10) <= dateOnly,
    )
    .map((c) => ({ row: c, at: c.checkinAt ?? ymdToIsoMidnight(c.checkinDate) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const latest = priorChanges.length > 0 ? priorChanges[priorChanges.length - 1]!.row : null;

  const anchorYmd = latest ? latest.checkinDate.slice(0, 10) : appliance.startedAt.slice(0, 10);
  const alignerIndex =
    latest && latest.alignerIndex !== null && latest.alignerIndex > 0 ? latest.alignerIndex : 1;
  const elapsedDays = Math.max(
    0,
    Math.round((parseIso(ymdToIsoMidnight(dateOnly)) - parseIso(ymdToIsoMidnight(anchorYmd))) / DAY_MS),
  );

  return { alignerIndex, dayInTray: elapsedDays + 1, daysPerAligner: appliance.daysPerAligner };
}

/** Formats an `AlignerContext` as the PO-ORTHO-006a badge text. */
export function formatAlignerContext(ctx: AlignerContext): string {
  const day = ctx.daysPerAligner !== null ? `${ctx.dayInTray}/${ctx.daysPerAligner}` : `${ctx.dayInTray}`;
  return `第${ctx.alignerIndex}副牙套·第${day}天`;
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

  const latestChange = findLatestAlignerChange(alignerChangeCheckins, appliance.applianceId);
  const cycleAnchor = latestChange
    ? latestChange.at
    : ymdToIsoMidnight(appliance.startedAt);

  const anchorMs = parseIso(cycleAnchor);
  const nowMs = parseIso(nowIso);
  const cycleElapsedHours = Math.max(0, (nowMs - anchorMs) / HOUR_MS);

  // PO-ORTHO-008 per-day baseline-gap accounting. Walk each UTC-day segment
  // inside the cycle window: if the parent logged any gap that overlaps the
  // segment, trust the logged total verbatim; otherwise presume a baseline
  // gap of `(24 − prescribedHoursPerDay)` h scaled to the segment length.
  // This keeps the "I logged 1 h take-out today" case truthful while
  // preventing un-logged days from silently awarding 24 h/day wear credit.
  const baselineGapRatePerHour = Math.max(0, Math.min(1, (24 - prescribedHours) / 24));
  const cycleGapHours = sumEffectiveGapHours(
    intervals,
    anchorMs,
    nowMs,
    baselineGapRatePerHour,
  );

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
  // (see `findLatestAlignerChange` above). Falls back to 1 before the first
  // logged change.
  const currentAlignerIndex = latestChange?.index ?? 1;
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

/**
 * Walks `[fromMs, toMs)` one UTC-day segment at a time and accumulates the
 * "effective" gap hours per PO-ORTHO-008: trust per-day logged totals when
 * any gap overlaps the segment, otherwise presume `baselineGapRatePerHour`
 * of the segment's hours are gap.
 */
function sumEffectiveGapHours(
  intervals: OrthodonticUnwearIntervalRow[],
  fromMs: number,
  toMs: number,
  baselineGapRatePerHour: number,
): number {
  if (toMs <= fromMs) return 0;
  // Pre-resolve each interval to its [startMs, endMs] in cycle, treating an
  // open interval as still accumulating up to `toMs`.
  const resolved: Array<{ startMs: number; endMs: number }> = [];
  for (const iv of intervals) {
    const ivStart = parseIso(iv.startAt);
    const ivEnd = iv.endAt ? parseIso(iv.endAt) : toMs;
    if (ivEnd <= fromMs || ivStart >= toMs) continue;
    resolved.push({
      startMs: Math.max(ivStart, fromMs),
      endMs: Math.min(ivEnd, toMs),
    });
  }
  let total = 0;
  let cursor = fromMs;
  while (cursor < toMs) {
    const nextMidnight = nextUtcMidnightMs(cursor);
    const segEnd = Math.min(toMs, nextMidnight);
    const segmentHours = (segEnd - cursor) / HOUR_MS;
    let loggedHoursInSegment = 0;
    for (const iv of resolved) {
      if (iv.endMs <= cursor || iv.startMs >= segEnd) continue;
      const overlap = Math.min(iv.endMs, segEnd) - Math.max(iv.startMs, cursor);
      if (overlap > 0) loggedHoursInSegment += overlap / HOUR_MS;
    }
    total +=
      loggedHoursInSegment > 0
        ? loggedHoursInSegment
        : segmentHours * baselineGapRatePerHour;
    cursor = segEnd;
  }
  return total;
}

/** First UTC midnight strictly after `ms`. */
function nextUtcMidnightMs(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

export {
  APPLIANCE_PHASES,
  computeAppliancePhaseOptions,
  computeAppliancePhaseProgress,
} from './orthodontic-phases.js';
export type {
  AppliancePhase,
  AppliancePhaseOption,
  AppliancePhaseProgress,
} from './orthodontic-phases.js';

/** Adds whole days to an ISO date/datetime, returning a `yyyy-mm-dd` date. */
function addDaysIso(iso: string, days: number): string {
  return new Date(parseIso(iso) + days * DAY_MS).toISOString().slice(0, 10);
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
