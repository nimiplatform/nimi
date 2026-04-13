import type { NurtureMode } from '../app-shell/app-store.js';
import type {
  ReminderPriority,
  ReminderRule as GenReminderRule,
  ReminderVisibility,
} from '../knowledge-base/index.js';
import type { FreqOverrideMap } from './reminder-freq-overrides.js';

export type { ReminderPriority, ReminderVisibility };
export type { GenReminderRule as ReminderRule };

export type ReminderStatus = 'pending' | 'active' | 'completed' | 'dismissed' | 'overdue';
export type ReminderKind = 'task' | 'guidance';
export type ReminderLifecycle =
  | 'upcoming'
  | 'due'
  | 'scheduled'
  | 'snoozed'
  | 'overdue'
  | 'completed'
  | 'not_applicable';

export interface ReminderState {
  stateId: string;
  childId: string;
  ruleId: string;
  status: ReminderStatus;
  activatedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  dismissReason: string | null;
  repeatIndex: number;
  nextTriggerAt: string | null;
  snoozedUntil: string | null;
  scheduledDate: string | null;
  notApplicable: number;
  plannedForDate: string | null;
  surfaceRank: number | null;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  notes: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ReminderEngineContext {
  birthDate: string;
  gender: 'male' | 'female';
  ageMonths: number;
  localToday: string;
  nurtureMode: NurtureMode;
  domainOverrides: Record<string, NurtureMode> | null;
}

export interface ActiveReminder {
  rule: GenReminderRule;
  visibility: ReminderVisibility;
  repeatIndex: number;
  effectiveAgeMonths: number;
  effectiveStartDate: string;
  effectiveEndDate: string;
  kind: ReminderKind;
  lifecycle: ReminderLifecycle;
  status: ReminderStatus;
  overdueDays: number;
  daysUntilStart: number;
  daysUntilEnd: number;
  state: ReminderState | null;
}

export interface ReminderHistoryItem extends ActiveReminder {
  historyType: 'completed' | 'scheduled' | 'snoozed' | 'not_applicable';
}

export interface ReminderAgenda {
  localToday: string;
  todayLimit: number;
  todayFocus: ActiveReminder[];
  thisWeek: ActiveReminder[];
  stageFocus: ActiveReminder[];
  history: ReminderHistoryItem[];
  overdueSummary: {
    count: number;
    items: ActiveReminder[];
  };
}

const PRIORITY_ORDER: Record<ReminderPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function reminderKey(ruleId: string, repeatIndex: number) {
  return `${ruleId}:${repeatIndex}`;
}

export function getLocalToday() {
  return new Date().toISOString().slice(0, 10);
}

export function toReminderKind(rule: Pick<GenReminderRule, 'actionType'>): ReminderKind {
  return ['go_hospital', 'record_data', 'start_training'].includes(rule.actionType) ? 'task' : 'guidance';
}

export function mapReminderStateRow(row: {
  stateId: string;
  childId: string;
  ruleId: string;
  status: string;
  activatedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  dismissReason: string | null;
  repeatIndex: number;
  nextTriggerAt: string | null;
  snoozedUntil: string | null;
  scheduledDate: string | null;
  notApplicable: number;
  plannedForDate: string | null;
  surfaceRank: number | null;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}): ReminderState {
  return {
    stateId: row.stateId,
    childId: row.childId,
    ruleId: row.ruleId,
    status: row.status as ReminderStatus,
    activatedAt: row.activatedAt,
    completedAt: row.completedAt,
    dismissedAt: row.dismissedAt,
    dismissReason: row.dismissReason,
    repeatIndex: row.repeatIndex,
    nextTriggerAt: row.nextTriggerAt,
    snoozedUntil: row.snoozedUntil,
    scheduledDate: row.scheduledDate,
    notApplicable: row.notApplicable,
    plannedForDate: row.plannedForDate,
    surfaceRank: row.surfaceRank,
    lastSurfacedAt: row.lastSurfacedAt,
    surfaceCount: row.surfaceCount,
    notes: row.notes,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function parseDateKey(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function addMonths(dateKey: string, months: number) {
  const date = parseDateKey(dateKey);
  date.setMonth(date.getMonth() + months);
  return formatDateKey(date);
}

function diffDays(left: string, right: string) {
  const leftDate = parseDateKey(left);
  const rightDate = parseDateKey(right);
  return Math.floor((leftDate.getTime() - rightDate.getTime()) / DAY_MS);
}

function comparePriority(a: ReminderPriority, b: ReminderPriority) {
  return (PRIORITY_ORDER[a] ?? 9) - (PRIORITY_ORDER[b] ?? 9);
}

function todayCap(mode: NurtureMode) {
  switch (mode) {
    case 'relaxed':
      return 2;
    case 'advanced':
      return 5;
    default:
      return 3;
  }
}

function stageCap(mode: NurtureMode) {
  switch (mode) {
    case 'relaxed':
      return 1;
    case 'advanced':
      return 3;
    default:
      return 2;
  }
}

function resurfacingGap(surfaceCount: number) {
  if (surfaceCount <= 0) return 0;
  if (surfaceCount === 1) return 1;
  if (surfaceCount === 2) return 3;
  return 7;
}

function canResurface(state: ReminderState | null, localToday: string) {
  if (!state?.lastSurfacedAt) return true;
  return diffDays(localToday, state.lastSurfacedAt.slice(0, 10)) >= resurfacingGap(state.surfaceCount);
}

function isEligibleRepeatInstance(
  triggerAge: number,
  intervalMonths: number,
  ageMonths: number,
  hasPersistedState: boolean,
) {
  // If there's a persisted state, always show
  if (hasPersistedState) return true;
  // Only show if within the current window: not too far in the past, and not too far in the future
  return triggerAge <= ageMonths + 1 && triggerAge >= ageMonths - Math.max(intervalMonths, OVERDUE_EXPIRY_MONTHS);
}

/** Max months past the trigger window to keep showing an un-actioned reminder.
 *  Beyond this, the item silently expires — a 12-year-old should not see newborn vaccines. */
const OVERDUE_EXPIRY_MONTHS = 12;

function isEligibleNonRepeat(rule: GenReminderRule, kind: ReminderKind, ageMonths: number, hasPersistedState: boolean) {
  // If there's a persisted state (completed, dismissed, snoozed, etc.) always show it
  if (hasPersistedState) return true;

  const endAge = rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths;

  // Not yet in the trigger window (1 month lookahead)
  if (ageMonths < rule.triggerAge.startMonths - 1) return false;

  // Past the trigger window + expiry buffer → silently expire
  if (ageMonths > endAge + OVERDUE_EXPIRY_MONTHS) return false;

  return true;
}

function toLifecycle(reminder: Omit<ActiveReminder, 'lifecycle'>, localToday: string): ReminderLifecycle {
  const state = reminder.state;
  if (state?.notApplicable === 1) return 'not_applicable';
  if (state?.completedAt) return 'completed';
  // Dismissed today → treat as snoozed (hidden from today's agenda, reappears tomorrow)
  if (state?.dismissedAt === localToday) return 'snoozed';
  if (state?.snoozedUntil && state.snoozedUntil > localToday) return 'snoozed';
  if (state?.scheduledDate) {
    if (state.scheduledDate < localToday) return 'overdue';
    if (localToday >= addDays(state.scheduledDate, -1)) return 'due';
    return 'scheduled';
  }
  if (reminder.daysUntilStart > 7) return 'upcoming';
  if (reminder.daysUntilStart > 0) return 'upcoming';
  if (reminder.overdueDays > 0) return 'overdue';
  return 'due';
}

export function computeEligibleReminders(
  rules: readonly GenReminderRule[],
  context: ReminderEngineContext,
  existingStates: ReminderState[],
  freqOverrides?: FreqOverrideMap,
): ActiveReminder[] {
  const birthDate = context.birthDate.slice(0, 10);
  const stateMap = new Map(existingStates.map((state) => [reminderKey(state.ruleId, state.repeatIndex), state]));
  const reminders: ActiveReminder[] = [];

  for (const rule of rules) {
    if (rule.category === 'personalized') continue;

    // Skip disabled rules
    const override = freqOverrides?.get(rule.ruleId);
    if (override?.disabled) continue;

    // Skip gender-specific rules that don't match the child's gender
    const tags = rule.tags ?? [];
    if (tags.includes('gender:female') && context.gender !== 'female') continue;
    if (tags.includes('gender:male') && context.gender !== 'male') continue;

    const effectiveMode = context.domainOverrides?.[rule.domain] ?? context.nurtureMode;
    const visibility = rule.nurtureMode[effectiveMode];
    if (visibility === 'hidden') continue;

    const kind = toReminderKind(rule);

    if (rule.repeatRule) {
      const intervalMonths = override?.intervalMonths || rule.repeatRule.intervalMonths;
      const { maxRepeats } = rule.repeatRule;
      const maxCount = maxRepeats === -1 ? 100 : maxRepeats;
      const absoluteEndAge = rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths;

      for (let repeatIndex = 0; repeatIndex <= maxCount; repeatIndex += 1) {
        const triggerAge = rule.triggerAge.startMonths + repeatIndex * intervalMonths;
        if (triggerAge > absoluteEndAge) break;

        const state = stateMap.get(reminderKey(rule.ruleId, repeatIndex)) ?? null;
        if (!isEligibleRepeatInstance(triggerAge, intervalMonths, context.ageMonths, Boolean(state))) continue;

        const effectiveStartDate = addMonths(birthDate, triggerAge);
        const effectiveEndMonths = Math.min(triggerAge + intervalMonths - 1, absoluteEndAge);
        const effectiveEndDate = addMonths(birthDate, effectiveEndMonths);
        const baseReminder = {
          rule,
          visibility,
          repeatIndex,
          effectiveAgeMonths: triggerAge,
          effectiveStartDate,
          effectiveEndDate,
          kind,
          status: state?.status ?? (context.ageMonths >= triggerAge ? 'active' : 'pending'),
          overdueDays: Math.max(0, diffDays(context.localToday, effectiveEndDate)),
          daysUntilStart: diffDays(effectiveStartDate, context.localToday),
          daysUntilEnd: diffDays(effectiveEndDate, context.localToday),
          state,
        } satisfies Omit<ActiveReminder, 'lifecycle'>;

        reminders.push({
          ...baseReminder,
          lifecycle: toLifecycle(baseReminder, context.localToday),
        });
      }
      continue;
    }

    const state = stateMap.get(reminderKey(rule.ruleId, 0)) ?? null;
    if (!isEligibleNonRepeat(rule, kind, context.ageMonths, Boolean(state))) continue;

    const effectiveStartDate = addMonths(birthDate, rule.triggerAge.startMonths);
    const effectiveEndDate = addMonths(birthDate, rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths);
    const baseReminder = {
      rule,
      visibility,
      repeatIndex: 0,
      effectiveAgeMonths: rule.triggerAge.startMonths,
      effectiveStartDate,
      effectiveEndDate,
      kind,
      status: state?.status ?? (context.ageMonths < rule.triggerAge.startMonths ? 'pending' : 'active'),
      overdueDays: Math.max(0, diffDays(context.localToday, effectiveEndDate)),
      daysUntilStart: diffDays(effectiveStartDate, context.localToday),
      daysUntilEnd: diffDays(effectiveEndDate, context.localToday),
      state,
    } satisfies Omit<ActiveReminder, 'lifecycle'>;

    reminders.push({
      ...baseReminder,
      lifecycle: toLifecycle(baseReminder, context.localToday),
    });
  }

  // Deduplicate repeating rules: keep only the latest uncompleted instance per ruleId.
  // Completed / not_applicable instances are preserved for history.
  const deduped: ActiveReminder[] = [];
  const latestByRule = new Map<string, ActiveReminder>();

  for (const reminder of reminders) {
    if (!reminder.rule.repeatRule) {
      deduped.push(reminder);
      continue;
    }
    if (reminder.lifecycle === 'completed' || reminder.lifecycle === 'not_applicable') {
      deduped.push(reminder);
      continue;
    }
    const existing = latestByRule.get(reminder.rule.ruleId);
    if (!existing || reminder.repeatIndex > existing.repeatIndex) {
      latestByRule.set(reminder.rule.ruleId, reminder);
    }
  }
  for (const reminder of latestByRule.values()) {
    deduped.push(reminder);
  }

  return deduped;
}

function compareTodayReminder(a: ActiveReminder, b: ActiveReminder) {
  const p = comparePriority(a.rule.priority, b.rule.priority);
  if (p !== 0) return p;
  if (a.lifecycle === 'overdue' && b.lifecycle === 'overdue') {
    return b.overdueDays - a.overdueDays;
  }
  if (a.lifecycle === 'overdue') return -1;
  if (b.lifecycle === 'overdue') return 1;
  return a.effectiveAgeMonths - b.effectiveAgeMonths;
}

function compareWeekReminder(a: ActiveReminder, b: ActiveReminder) {
  if (a.daysUntilStart !== b.daysUntilStart) return a.daysUntilStart - b.daysUntilStart;
  const p = comparePriority(a.rule.priority, b.rule.priority);
  if (p !== 0) return p;
  return a.effectiveAgeMonths - b.effectiveAgeMonths;
}

function compareHistoryReminder(a: ReminderHistoryItem, b: ReminderHistoryItem) {
  const aDate = a.state?.completedAt ?? a.state?.scheduledDate ?? a.state?.snoozedUntil ?? a.state?.updatedAt ?? '';
  const bDate = b.state?.completedAt ?? b.state?.scheduledDate ?? b.state?.snoozedUntil ?? b.state?.updatedAt ?? '';
  return bDate.localeCompare(aDate);
}

function isTaskTodayCandidate(reminder: ActiveReminder, localToday: string) {
  if (reminder.kind !== 'task') return false;
  if (reminder.visibility !== 'push' && reminder.rule.priority !== 'P0') return false;
  if (reminder.lifecycle === 'completed' || reminder.lifecycle === 'not_applicable' || reminder.lifecycle === 'snoozed') return false;
  if (reminder.lifecycle === 'scheduled') return false;
  if (reminder.state?.scheduledDate && reminder.state.scheduledDate < localToday) return false;
  if (reminder.lifecycle === 'overdue') return true;
  if (reminder.rule.priority === 'P0' && reminder.lifecycle === 'due') return true;
  if (reminder.rule.priority !== 'P0' && reminder.lifecycle === 'due' && reminder.daysUntilEnd <= 2) return true;
  if (reminder.rule.priority !== 'P0' && reminder.lifecycle === 'due') return canResurface(reminder.state, localToday);
  return false;
}

function isTaskThisWeekCandidate(reminder: ActiveReminder) {
  if (reminder.kind !== 'task') return false;
  if (reminder.lifecycle === 'completed' || reminder.lifecycle === 'not_applicable' || reminder.lifecycle === 'snoozed') return false;
  if (reminder.lifecycle === 'scheduled') return true;
  if (reminder.lifecycle === 'overdue') return true;
  return reminder.daysUntilStart >= 0 && reminder.daysUntilStart <= 7;
}

function isStageFocusCandidate(reminder: ActiveReminder) {
  return reminder.kind === 'guidance'
    && reminder.lifecycle !== 'completed'
    && reminder.lifecycle !== 'not_applicable'
    && reminder.lifecycle !== 'snoozed';
}

export function buildReminderAgenda(
  rules: readonly GenReminderRule[],
  context: ReminderEngineContext,
  states: ReminderState[],
  freqOverrides?: FreqOverrideMap,
): ReminderAgenda {
  const eligible = computeEligibleReminders(rules, context, states, freqOverrides);
  const stateMap = new Map(states.map((state) => [reminderKey(state.ruleId, state.repeatIndex), state]));
  const todayLimit = todayCap(context.nurtureMode);

  const preserved = eligible
    .filter((reminder) => reminder.state?.plannedForDate === context.localToday && reminder.state?.surfaceRank != null)
    .filter((reminder) => isTaskTodayCandidate(reminder, context.localToday))
    .sort((a, b) => (a.state?.surfaceRank ?? 999) - (b.state?.surfaceRank ?? 999));

  const preservedKeys = new Set(preserved.map((reminder) => reminderKey(reminder.rule.ruleId, reminder.repeatIndex)));
  const allP0Today = eligible
    .filter((reminder) => reminder.rule.priority === 'P0' && isTaskTodayCandidate(reminder, context.localToday))
    .sort(compareTodayReminder);

  const todayFocus: ActiveReminder[] = [];
  const todayKeys = new Set<string>();

  for (const reminder of allP0Today) {
    const key = reminderKey(reminder.rule.ruleId, reminder.repeatIndex);
    if (todayKeys.has(key)) continue;
    todayFocus.push(reminder);
    todayKeys.add(key);
  }

  const nonP0Preserved = preserved
    .filter((reminder) => reminder.rule.priority !== 'P0')
    .sort((a, b) => (a.state?.surfaceRank ?? 999) - (b.state?.surfaceRank ?? 999));

  const usedDomains = new Set<string>();
  for (const reminder of todayFocus) {
    if (reminder.rule.priority !== 'P0') usedDomains.add(reminder.rule.domain);
  }

  for (const reminder of nonP0Preserved) {
    if (todayFocus.filter((item) => item.rule.priority !== 'P0').length >= todayLimit) break;
    const key = reminderKey(reminder.rule.ruleId, reminder.repeatIndex);
    if (todayKeys.has(key)) continue;
    usedDomains.add(reminder.rule.domain);
    todayFocus.push(reminder);
    todayKeys.add(key);
  }

  const nonP0Candidates = eligible
    .filter((reminder) => reminder.rule.priority !== 'P0')
    .filter((reminder) => !preservedKeys.has(reminderKey(reminder.rule.ruleId, reminder.repeatIndex)))
    .filter((reminder) => isTaskTodayCandidate(reminder, context.localToday))
    .sort(compareTodayReminder);

  for (const reminder of nonP0Candidates) {
    if (todayFocus.filter((item) => item.rule.priority !== 'P0').length >= todayLimit) break;
    if (usedDomains.has(reminder.rule.domain)) continue;
    const key = reminderKey(reminder.rule.ruleId, reminder.repeatIndex);
    if (todayKeys.has(key)) continue;
    usedDomains.add(reminder.rule.domain);
    todayFocus.push(reminder);
    todayKeys.add(key);
  }

  const thisWeek = eligible
    .filter((reminder) => isTaskThisWeekCandidate(reminder))
    .filter((reminder) => !todayKeys.has(reminderKey(reminder.rule.ruleId, reminder.repeatIndex)))
    .sort(compareWeekReminder)
    .slice(0, 12);

  const stageFocus = eligible
    .filter((reminder) => isStageFocusCandidate(reminder))
    .sort(compareTodayReminder)
    .slice(0, stageCap(context.nurtureMode));

  const history: ReminderHistoryItem[] = [];
  for (const state of states) {
    const rule = rules.find((candidate) => candidate.ruleId === state.ruleId);
    if (!rule) continue;
    const visibility = rule.nurtureMode[context.domainOverrides?.[rule.domain] ?? context.nurtureMode];
    if (visibility === 'hidden') continue;
    const kind = toReminderKind(rule);
    const intervalMonths = freqOverrides?.get(rule.ruleId)?.intervalMonths ?? rule.repeatRule?.intervalMonths ?? null;
    const effectiveAgeMonths = rule.repeatRule
      ? rule.triggerAge.startMonths + state.repeatIndex * (intervalMonths ?? rule.repeatRule.intervalMonths)
      : rule.triggerAge.startMonths;
    const effectiveStartDate = addMonths(context.birthDate.slice(0, 10), effectiveAgeMonths);
    const effectiveEndDate = addMonths(
      context.birthDate.slice(0, 10),
      rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths,
    );
    let historyType: ReminderHistoryItem['historyType'] | null = null;
    if (state.completedAt) historyType = 'completed';
    else if (state.notApplicable === 1) historyType = 'not_applicable';
    else if (state.scheduledDate && state.scheduledDate >= context.localToday) historyType = 'scheduled';
    else if (state.snoozedUntil && state.snoozedUntil > context.localToday) historyType = 'snoozed';
    if (!historyType) continue;
    const baseReminder = {
      rule,
      visibility,
      repeatIndex: state.repeatIndex,
      effectiveAgeMonths,
      effectiveStartDate,
      effectiveEndDate,
      kind,
      status: state.status,
      overdueDays: Math.max(0, diffDays(context.localToday, effectiveEndDate)),
      daysUntilStart: diffDays(effectiveStartDate, context.localToday),
      daysUntilEnd: diffDays(effectiveEndDate, context.localToday),
      state,
    } satisfies Omit<ActiveReminder, 'lifecycle'>;
    history.push({
      ...baseReminder,
      lifecycle: toLifecycle(baseReminder, context.localToday),
      historyType,
    });
  }
  history.sort(compareHistoryReminder);

  const overdueSummaryItems = eligible
    .filter((reminder) => reminder.kind === 'task')
    .filter((reminder) => reminder.lifecycle === 'overdue')
    .filter((reminder) => !todayKeys.has(reminderKey(reminder.rule.ruleId, reminder.repeatIndex)))
    .sort(compareTodayReminder);

  return {
    localToday: context.localToday,
    todayLimit,
    todayFocus: todayFocus.sort((a, b) => {
      const aRank = stateMap.get(reminderKey(a.rule.ruleId, a.repeatIndex))?.surfaceRank ?? 999;
      const bRank = stateMap.get(reminderKey(b.rule.ruleId, b.repeatIndex))?.surfaceRank ?? 999;
      if (aRank !== bRank && a.state?.plannedForDate === context.localToday && b.state?.plannedForDate === context.localToday) {
        return aRank - bRank;
      }
      return compareTodayReminder(a, b);
    }),
    thisWeek,
    stageFocus,
    history,
    overdueSummary: {
      count: overdueSummaryItems.length,
      items: overdueSummaryItems.slice(0, 3),
    },
  };
}
