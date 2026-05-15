// Dashboard Task Projection — pure, deterministic implementation of
// `apps/parentos/spec/kernel/timeline-contract.md#PO-TIME-010`.
//
// Functions in this module map 1:1 to the named spec functions:
//   rankDashboardTasks      → PO-TIME-010.a Ranking Function
//   dispersionEligible      → PO-TIME-010.b Dispersion Function
//   anchorTargetDay         → PO-TIME-010.c Anchor Function
//   decayDisplayState       → PO-TIME-010.d Decay Projection
//   snoozeCountdown         → PO-TIME-010.e Snooze Countdown Projection
//
// The module MUST stay pure: no React imports, no IO, no `Date.now()`,
// no randomness, no provider/model identifiers. The caller injects
// `today` and all inputs. See timeline-contract.md for the authority.

import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import type {
  DashboardTaskCatalogRow,
  DashboardTaskFamily,
  DashboardTaskDispersionWindow,
} from '../../knowledge-base/index.js';
import type { ActiveReminder, ReminderAgenda } from '../../engine/reminder-engine.js';

// ── Types ────────────────────────────────────────────────────────────

export type DashboardTaskDisplayState =
  | 'eligible-main'
  | 'eligible-pinned'
  | 'downgrade-indicator'
  | 'hidden-resurface';

export type DashboardTaskPriority = 'P0' | 'P1' | 'P2';

export type DashboardTaskRankingTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface DashboardTaskEntry {
  /** React key. Stable per (source, identity). */
  key: string;
  source: 'reminder' | 'catalog' | 'custom_todo';
  family: DashboardTaskFamily | 'personal';
  priority: DashboardTaskPriority | null;
  displayState: DashboardTaskDisplayState;
  rankingTier: DashboardTaskRankingTier;
  /** Present when `source = 'catalog'`. */
  catalogRow?: DashboardTaskCatalogRow;
  /** Present when `source = 'reminder'`. */
  reminder?: ActiveReminder;
  /** Present when `source = 'custom_todo'`. */
  customTodo?: CustomTodoRow;
}

/** Per-row surfacing record. Map key = catalog row `taskId`. */
export type SurfaceHistoryMap = ReadonlyMap<string, { lastSurfaced: string | null }>;

/** Per-row ephemeral snooze (Path 2 of PO-TIME-010.e). Map key = catalog row `taskId`. */
export type EphemeralSnoozeMap = ReadonlyMap<string, { snoozeUntil: string | null }>;

/** Map catalog row `taskId` → bound `record_data` reminder ruleId, when applicable. */
export type ReminderBindingMap = ReadonlyMap<string, string>;

export interface DashboardTaskInput {
  /** Local ISO date `YYYY-MM-DD`. Caller injects; the projection never calls `getLocalToday()`. */
  today: string;
  child: { childId: string; birthDate: string };
  reminderAgenda: ReminderAgenda;
  customTodos: readonly CustomTodoRow[];
  catalogRows: readonly DashboardTaskCatalogRow[];
  surfaceHistory?: SurfaceHistoryMap;
  ephemeralSnooze?: EphemeralSnoozeMap;
  reminderBindings?: ReminderBindingMap;
  /** Per-reminder snoozedUntil keyed by `${ruleId}:${repeatIndex}`. */
  reminderSnoozedUntil?: ReadonlyMap<string, string | null>;
}

export interface DashboardTaskProjection {
  mainList: DashboardTaskEntry[];
  /** Aggregated badge count: "档案有 N 项可更新". */
  downgradeIndicatorCount: number;
  /** Rows resurfacing next cycle; not displayed. */
  hiddenResurfaceCount: number;
}

// ── Date helpers (pure) ──────────────────────────────────────────────

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [yearStr, monthStr, dayStr] = iso.split('-');
  return {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  };
}

/** Pure: number of days in `month` of `year`. month is 1..12. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Pure: weekday (0=Sun, 6=Sat) for given Gregorian date. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isWeekend(year: number, month: number, day: number): boolean {
  const w = weekdayOf(year, month, day);
  return w === 0 || w === 6;
}

/** Whole days from `from` to `to`, both ISO `YYYY-MM-DD`. May be negative. */
function daysBetween(from: string, to: string): number {
  const f = parseIsoDate(from);
  const t = parseIsoDate(to);
  const fUtc = Date.UTC(f.year, f.month - 1, f.day);
  const tUtc = Date.UTC(t.year, t.month - 1, t.day);
  return Math.round((tUtc - fUtc) / 86_400_000);
}

// ── PO-TIME-010.c Anchor Function ────────────────────────────────────

export function anchorTargetDay(
  today: string,
  childBirthDate: string,
  catalogRow: DashboardTaskCatalogRow,
): { targetDay: number | null; slotMismatch: boolean } {
  if (catalogRow.biologicalAnchor === 'none') {
    return { targetDay: null, slotMismatch: false };
  }

  if (catalogRow.slotPreference === 'hard-time') {
    return { targetDay: null, slotMismatch: false };
  }

  const todayParts = parseIsoDate(today);
  const birth = parseIsoDate(childBirthDate);
  const dim = daysInMonth(todayParts.year, todayParts.month);
  const targetDay = Math.min(birth.day, dim);
  const targetWeekday = weekdayOf(todayParts.year, todayParts.month, targetDay);

  if (catalogRow.slotPreference === 'weekend-heavy' && !(targetWeekday === 0 || targetWeekday === 6)) {
    // Search forward 1..6 days for next weekend within same month.
    for (let delta = 1; delta <= 6; delta += 1) {
      const candidate = targetDay + delta;
      if (candidate > dim) break;
      if (isWeekend(todayParts.year, todayParts.month, candidate)) {
        return { targetDay: candidate, slotMismatch: false };
      }
    }
    // Backward 1..6 days for previous weekend within same month.
    for (let delta = 1; delta <= 6; delta += 1) {
      const candidate = targetDay - delta;
      if (candidate < 1) break;
      if (isWeekend(todayParts.year, todayParts.month, candidate)) {
        return { targetDay: candidate, slotMismatch: false };
      }
    }
    // Neither weekend within ±6 days: keep targetDay, flag slot_mismatch.
    return { targetDay, slotMismatch: true };
  }

  // weekday-evening-light on weekend, or weekend-heavy already on weekend.
  return { targetDay, slotMismatch: false };
}

// ── PO-TIME-010.b Dispersion Function ────────────────────────────────

const DISPERSION_RANGES: Record<DashboardTaskDispersionWindow, (day: number, dim: number) => boolean> = {
  'week-1': (day) => day >= 1 && day <= 7,
  'week-2': (day) => day >= 8 && day <= 14,
  'week-3': (day) => day >= 15 && day <= 21,
  'week-4': (day, dim) => day >= 22 && day <= dim,
  rolling: () => true,
};

export function dispersionEligible(
  today: string,
  catalogRow: DashboardTaskCatalogRow,
  lastSurfaced: string | null,
  childBirthDate: string,
): { eligible: boolean; reason: string } {
  const t = parseIsoDate(today);
  const dim = daysInMonth(t.year, t.month);
  const inWindow = DISPERSION_RANGES[catalogRow.dispersionWindow](t.day, dim);

  if (catalogRow.cadencePolicy === 'anchor') {
    const anchor = anchorTargetDay(today, childBirthDate, catalogRow);
    if (anchor.targetDay === null) {
      return { eligible: false, reason: 'anchor-not-applicable' };
    }
    if (t.day !== anchor.targetDay) {
      return { eligible: false, reason: 'not-on-anchor-day' };
    }
    if (!inWindow) {
      return { eligible: false, reason: 'anchor-outside-dispersion-window' };
    }
    return { eligible: true, reason: 'anchor-day-in-window' };
  }

  if (catalogRow.cadencePolicy === 'interval') {
    if (lastSurfaced === null) {
      return { eligible: true, reason: 'interval-initial' };
    }
    const gap = daysBetween(lastSurfaced, today);
    if (gap >= catalogRow.snoozeDefaultDays) {
      return { eligible: true, reason: 'interval-elapsed' };
    }
    return { eligible: false, reason: 'interval-not-elapsed' };
  }

  // windowed
  if (!inWindow) {
    return { eligible: false, reason: 'outside-dispersion-window' };
  }
  if (lastSurfaced === null) {
    return { eligible: true, reason: 'windowed-initial' };
  }
  const gap = daysBetween(lastSurfaced, today);
  if (gap >= catalogRow.snoozeDefaultDays) {
    return { eligible: true, reason: 'windowed-elapsed' };
  }
  return { eligible: false, reason: 'windowed-not-elapsed' };
}

// ── PO-TIME-010.d Decay Projection ───────────────────────────────────

export function decayDisplayState(
  catalogRow: DashboardTaskCatalogRow,
  lastSurfaced: string | null,
  today: string,
  isP0: boolean,
): DashboardTaskDisplayState {
  if (isP0) return 'eligible-pinned';
  if (lastSurfaced === null) return 'eligible-main';
  const gap = daysBetween(lastSurfaced, today);
  if (gap <= catalogRow.displayWindowDays) return 'eligible-main';
  if (catalogRow.decayStrategy === 'low-disturbance-downgrade') return 'downgrade-indicator';
  return 'hidden-resurface';
}

// ── PO-TIME-010.e Snooze Countdown Projection ────────────────────────

export function snoozeCountdown(
  catalogRow: DashboardTaskCatalogRow,
  today: string,
  reminderBinding: { ruleId: string } | null,
  reminderState: { snoozedUntil: string | null } | null,
  ephemeralSnooze: { snoozeUntil: string | null } | null,
): { snoozeRemainingDays: number; eligibleBySnooze: boolean } {
  if (reminderBinding !== null) {
    // Path 1: reminder-backed maintain row. PO-REMI-005 owns persistence.
    const snoozedUntil = reminderState?.snoozedUntil ?? null;
    if (!snoozedUntil) return { snoozeRemainingDays: 0, eligibleBySnooze: true };
    const remaining = Math.max(0, daysBetween(today, snoozedUntil));
    return {
      snoozeRemainingDays: remaining,
      eligibleBySnooze: daysBetween(today, snoozedUntil) <= 0,
    };
  }
  // Path 2: catalog-only ephemeral snooze.
  // NB: this projection MUST NOT synthesize a reminder_states row.
  const snoozeUntil = ephemeralSnooze?.snoozeUntil ?? null;
  if (!snoozeUntil) return { snoozeRemainingDays: 0, eligibleBySnooze: true };
  const remaining = Math.max(0, daysBetween(today, snoozeUntil));
  // Suppress unused-row warning at compile by referencing the row.
  void catalogRow;
  return {
    snoozeRemainingDays: remaining,
    eligibleBySnooze: daysBetween(today, snoozeUntil) <= 0,
  };
}

// ── PO-TIME-010.a Ranking Function ───────────────────────────────────

interface RankableEntry extends DashboardTaskEntry {
  /** lower = earlier; used as fine tiebreak after tier. */
  tiebreakWeight: number;
}

function slotMatchesToday(
  slotPreference: DashboardTaskCatalogRow['slotPreference'],
  todayIsWeekend: boolean,
): boolean {
  if (slotPreference === 'weekend-heavy') return todayIsWeekend;
  if (slotPreference === 'weekday-evening-light') return !todayIsWeekend;
  // hard-time always matches
  return true;
}

function priorityFromReminder(reminder: ActiveReminder): DashboardTaskPriority {
  const p = reminder.rule.priority;
  if (p === 'P0') return 'P0';
  if (p === 'P1') return 'P1';
  return 'P2';
}

function rankingTierForCatalog(family: DashboardTaskFamily): DashboardTaskRankingTier {
  if (family === 'must-do') return 3;
  if (family === 'maintain') return 4;
  if (family === 'observe') return 4;
  if (family === 'connect') return 5;
  // future-proof: must-do already handled above
  return 4;
}

/** Identifies orthodontic protocol rule ids per `orthodontic-protocols.yaml#rules`. */
function isOrthodonticProtocolRule(ruleId: string): boolean {
  return ruleId.startsWith('PO-ORTHO-') || ruleId.startsWith('PO-DEN-FOLLOWUP-');
}

function tierForReminder(reminder: ActiveReminder): DashboardTaskRankingTier {
  if (reminder.rule.priority === 'P0') return 1;
  // record_data with admitted target = tier 2 candidate; the engine already
  // returns only reminders with resolvable rules so we treat record_data as
  // tier 2 by convention here.
  if (reminder.rule.actionType === 'record_data') return 2;
  if (isOrthodonticProtocolRule(reminder.rule.ruleId)) return 3;
  return 3;
}

/** Implements PO-TIME-010.a Ranking Function tier + tiebreak. Pure. */
export function rankDashboardTasks(entries: RankableEntry[]): DashboardTaskEntry[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.rankingTier !== b.rankingTier) return a.rankingTier - b.rankingTier;
    if (a.tiebreakWeight !== b.tiebreakWeight) return a.tiebreakWeight - b.tiebreakWeight;
    return a.key.localeCompare(b.key);
  });
  return sorted.map(({ tiebreakWeight: _unused, ...entry }) => entry);
}

// ── Orchestrator ─────────────────────────────────────────────────────

/**
 * Build the dashboard task projection.
 *
 * Determinism: same input MUST produce same output. The function must not
 * consult `Date.now()`, locale, randomness, or any provider/model identifier.
 *
 * P0 invariant: PO-TIME-003 P0 delivery is restated verbatim in
 * `timeline-contract.md#PO-TIME-010.a` and enforced here. A P0 must-do
 * reminder always lands in `mainList` regardless of catalog row count,
 * dispersion, mutual exclusion, decay, or snooze.
 */
export function buildDashboardTaskProjection(input: DashboardTaskInput): DashboardTaskProjection {
  const {
    today,
    child,
    reminderAgenda,
    customTodos,
    catalogRows,
    surfaceHistory,
    ephemeralSnooze,
    reminderBindings,
    reminderSnoozedUntil,
  } = input;

  const todayParts = parseIsoDate(today);
  const todayWeekend = isWeekend(todayParts.year, todayParts.month, todayParts.day);

  const candidates: RankableEntry[] = [];
  let downgradeIndicatorCount = 0;
  let hiddenResurfaceCount = 0;

  // (1) Must-do entries from reminderAgenda.todayFocus.
  for (const reminder of reminderAgenda.todayFocus) {
    const priority = priorityFromReminder(reminder);
    const isP0 = priority === 'P0';
    candidates.push({
      key: `reminder:${reminder.rule.ruleId}:${reminder.repeatIndex}`,
      source: 'reminder',
      family: 'must-do',
      priority,
      displayState: isP0 ? 'eligible-pinned' : 'eligible-main',
      rankingTier: tierForReminder(reminder),
      tiebreakWeight: 0,
      reminder,
    });
  }

  // (2) Catalog rows.
  for (const row of catalogRows) {
    const history = surfaceHistory?.get(row.taskId);
    const lastSurfaced = history?.lastSurfaced ?? null;

    const dispersion = dispersionEligible(today, row, lastSurfaced, child.birthDate);
    const decayState = decayDisplayState(row, lastSurfaced, today, /* isP0 */ false);

    if (decayState === 'hidden-resurface') {
      hiddenResurfaceCount += 1;
      continue;
    }
    if (decayState === 'downgrade-indicator') {
      downgradeIndicatorCount += 1;
      continue;
    }

    if (!dispersion.eligible) continue;

    const ruleId = reminderBindings?.get(row.taskId) ?? null;
    const reminderBinding = ruleId !== null ? { ruleId } : null;
    const reminderState = ruleId !== null
      ? { snoozedUntil: reminderSnoozedUntil?.get(`${ruleId}:0`) ?? null }
      : null;
    const ephemeral = ephemeralSnooze?.get(row.taskId) ?? null;
    const snooze = snoozeCountdown(row, today, reminderBinding, reminderState, ephemeral);
    if (!snooze.eligibleBySnooze) continue;

    const slotExact = slotMatchesToday(row.slotPreference, todayWeekend);
    const tiebreakWeight = (slotExact ? 0 : 1_000) + row.displayWindowDays;

    candidates.push({
      key: `catalog:${row.taskId}`,
      source: 'catalog',
      family: row.family,
      priority: null,
      displayState: 'eligible-main',
      rankingTier: rankingTierForCatalog(row.family),
      tiebreakWeight,
      catalogRow: row,
    });
  }

  // (3) Personal rows from custom_todos.
  for (const todo of customTodos) {
    candidates.push({
      key: `custom_todo:${todo.todoId}`,
      source: 'custom_todo',
      family: 'personal',
      priority: null,
      displayState: 'eligible-main',
      rankingTier: 6,
      tiebreakWeight: 0,
      customTodo: todo,
    });
  }

  const ranked = rankDashboardTasks(candidates);

  // (4) Apply per-family caps: max 1 maintain, 1 observe, 1 connect (per day).
  // must-do and personal are not capped here; P0 invariant binds must-do
  // visibility regardless.
  const mainList: DashboardTaskEntry[] = [];
  const familyCount = new Map<string, number>();
  const FAMILY_CAPS: Record<string, number> = {
    maintain: 1,
    observe: 1,
    connect: 1,
  };
  const mutexUsed = new Set<string>();

  for (const entry of ranked) {
    // P0 must-do always included.
    if (entry.priority === 'P0') {
      mainList.push(entry);
      continue;
    }

    // For catalog rows, enforce family cap + mutualExclusionGroup.
    if (entry.source === 'catalog' && entry.catalogRow) {
      const cap = FAMILY_CAPS[entry.family] ?? Infinity;
      const used = familyCount.get(entry.family) ?? 0;
      if (used >= cap) continue;
      const group = entry.catalogRow.mutualExclusionGroup;
      if (group && mutexUsed.has(group)) continue;
      mainList.push(entry);
      familyCount.set(entry.family, used + 1);
      if (group) mutexUsed.add(group);
      continue;
    }

    mainList.push(entry);
  }

  return { mainList, downgradeIndicatorCount, hiddenResurfaceCount };
}

// ── Capture intent helper ─────────────────────────────────────────────

/**
 * Build the `PO-CAPT-005a` Dashboard-Task Capture intent shape for a
 * `family=maintain` catalog row. The renderer feeds the returned object into
 * the existing `HealthCaptureModal` via `setCaptureIntent`. PO-CAPT-004 save
 * transaction rules apply unchanged.
 */
export function buildDashboardTaskCaptureIntent(
  row: DashboardTaskCatalogRow,
  childId: string,
): {
  origin: 'dashboard_task';
  dashboardTaskId: string;
  childId: string;
  captureProtocolId: string;
  metricIds: readonly string[];
} | null {
  if (row.family !== 'maintain') return null;
  if (!row.captureProtocolIdRef) return null;
  return {
    origin: 'dashboard_task',
    dashboardTaskId: row.taskId,
    childId,
    captureProtocolId: row.captureProtocolIdRef,
    metricIds: row.metricIdRefs ?? [],
  };
}
