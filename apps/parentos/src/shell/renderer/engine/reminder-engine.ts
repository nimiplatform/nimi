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
  profileCreatedAt: string;
  localToday: string;
  nurtureMode: NurtureMode;
  domainOverrides: Record<string, NurtureMode> | null;
}

export type ReminderDeliveryDisposition = 'normal' | 'cold_start';

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
  deliveryDisposition: ReminderDeliveryDisposition;
  state: ReminderState | null;
}

export interface ReminderHistoryItem extends ActiveReminder {
  historyType: 'completed' | 'scheduled' | 'snoozed' | 'not_applicable';
}

export interface ReminderAgenda {
  localToday: string;
  todayLimit: number;
  todayFocus: ActiveReminder[];
  p0Overflow: {
    count: number;
    items: ActiveReminder[];
  };
  onboardingCatchup: {
    count: number;
    items: ActiveReminder[];
  };
  upcoming: ActiveReminder[];
  history: ReminderHistoryItem[];
  overdueSummary: {
    count: number;
    items: ActiveReminder[];
  };
}

const PRIORITY_ORDER: Record<ReminderPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const DAY_MS = 24 * 60 * 60 * 1000;
const P0_TODAY_LIMIT = 3;

type ReminderRuleWithExpiryOverride = GenReminderRule & {
  expiryMonths?: number;
};

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

function getRuleExpiryOverride(rule: GenReminderRule) {
  const expiryMonths = (rule as ReminderRuleWithExpiryOverride).expiryMonths;
  if (typeof expiryMonths !== 'number' || !Number.isFinite(expiryMonths) || expiryMonths < 0) {
    return null;
  }
  return expiryMonths;
}

function deriveExpiryMonths(rule: GenReminderRule, intervalMonths?: number) {
  const override = getRuleExpiryOverride(rule);
  if (override != null) return override;
  if (rule.triggerAge.endMonths === -1) return null;

  const baseWindowMonths = rule.repeatRule
    ? intervalMonths ?? rule.repeatRule.intervalMonths
    : Math.max(rule.triggerAge.endMonths - rule.triggerAge.startMonths, 0);

  return Math.max(baseWindowMonths * 2, 3);
}

/** Hard ceiling: even with persisted state, expire instances whose window ended
 *  more than this many months ago. Prevents stale orphan instances from
 *  resurfacing indefinitely (e.g. "逾期 3000+ 天"). 1.5× the normal expiry
 *  (floor 12 months) gives snoozed/scheduled items room without keeping
 *  truly ancient instances alive. */
const PERSISTED_STATE_EXPIRY_FACTOR = 1.5;
const PERSISTED_STATE_EXPIRY_FLOOR = 12;

function isEligibleRepeatInstance(
  triggerAge: number,
  effectiveEndMonths: number,
  expiryMonths: number | null,
  ageMonths: number,
  hasPersistedState: boolean,
) {
  if (hasPersistedState) {
    if (expiryMonths != null) {
      const hardCeiling = Math.max(expiryMonths * PERSISTED_STATE_EXPIRY_FACTOR, PERSISTED_STATE_EXPIRY_FLOOR);
      if (ageMonths > effectiveEndMonths + hardCeiling) return false;
    }
    return true;
  }
  if (ageMonths < triggerAge - 1) return false;
  if (expiryMonths != null && ageMonths > effectiveEndMonths + expiryMonths) return false;
  return true;
}

/** Max months past the trigger window to keep showing an un-actioned reminder.
 *  Beyond this, the item silently expires — a 12-year-old should not see newborn vaccines. */
function isEligibleNonRepeat(rule: GenReminderRule, ageMonths: number, hasPersistedState: boolean, expiryMonths: number | null) {
  // If there's a persisted state (completed, dismissed, snoozed, etc.) always show it
  if (hasPersistedState) return true;

  const endAge = rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths;

  // Not yet in the trigger window (1 month lookahead)
  if (ageMonths < rule.triggerAge.startMonths - 1) return false;

  // Past the trigger window + expiry buffer → silently expire
  if (expiryMonths != null && ageMonths > endAge + expiryMonths) return false;

  return true;
}

function isColdStartReminder(
  rule: GenReminderRule,
  kind: ReminderKind,
  state: ReminderState | null,
  effectiveEndDate: string,
  profileCreatedAt: string,
) {
  if (kind !== 'task') return false;
  if (state) return false;
  if (rule.triggerAge.endMonths === -1) return false;
  return effectiveEndDate < profileCreatedAt.slice(0, 10);
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
      const intervalMonths = override?.intervalMonths ?? rule.repeatRule.intervalMonths;
      const { maxRepeats } = rule.repeatRule;
      const maxCount = maxRepeats === -1 ? 100 : maxRepeats;
      const absoluteEndAge = rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths;
      const expiryMonths = deriveExpiryMonths(rule, intervalMonths);

      for (let repeatIndex = 0; repeatIndex <= maxCount; repeatIndex += 1) {
        const triggerAge = rule.triggerAge.startMonths + repeatIndex * intervalMonths;
        if (triggerAge > absoluteEndAge) break;

        const state = stateMap.get(reminderKey(rule.ruleId, repeatIndex)) ?? null;
        const effectiveEndMonths = Math.min(triggerAge + intervalMonths - 1, absoluteEndAge);
        if (!isEligibleRepeatInstance(triggerAge, effectiveEndMonths, expiryMonths, context.ageMonths, Boolean(state))) continue;

        const effectiveStartDate = addMonths(birthDate, triggerAge);
        const effectiveEndDate = addMonths(birthDate, effectiveEndMonths);
        const deliveryDisposition = isColdStartReminder(
          rule,
          kind,
          state,
          effectiveEndDate,
          context.profileCreatedAt,
        ) ? 'cold_start' : 'normal';
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
          deliveryDisposition,
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
    const expiryMonths = deriveExpiryMonths(rule);
    if (!isEligibleNonRepeat(rule, context.ageMonths, Boolean(state), expiryMonths)) continue;

    const effectiveStartDate = addMonths(birthDate, rule.triggerAge.startMonths);
    const effectiveEndDate = addMonths(birthDate, rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths);
    const deliveryDisposition = isColdStartReminder(
      rule,
      kind,
      state,
      effectiveEndDate,
      context.profileCreatedAt,
    ) ? 'cold_start' : 'normal';
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
      deliveryDisposition,
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
  const highestCompletedIndex = new Map<string, number>();

  for (const reminder of reminders) {
    if (!reminder.rule.repeatRule) {
      deduped.push(reminder);
      continue;
    }
    if (reminder.lifecycle === 'completed' || reminder.lifecycle === 'not_applicable') {
      deduped.push(reminder);
      // Track the highest completed repeatIndex per rule so we can detect
      // orphan uncompleted instances that sit below a completed sibling.
      if (reminder.lifecycle === 'completed') {
        const prev = highestCompletedIndex.get(reminder.rule.ruleId) ?? -1;
        if (reminder.repeatIndex > prev) {
          highestCompletedIndex.set(reminder.rule.ruleId, reminder.repeatIndex);
        }
      }
      continue;
    }
    const existing = latestByRule.get(reminder.rule.ruleId);
    if (!existing || reminder.repeatIndex > existing.repeatIndex) {
      latestByRule.set(reminder.rule.ruleId, reminder);
    }
  }
  for (const [ruleId, reminder] of latestByRule) {
    // Drop orphan instances: if a newer sibling was already completed the user
    // has moved on — showing the old uncompleted one would just be noise.
    const completedIdx = highestCompletedIndex.get(ruleId) ?? -1;
    if (completedIdx > reminder.repeatIndex) continue;
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

function isUpcomingCandidate(reminder: ActiveReminder) {
  if (reminder.lifecycle === 'completed' || reminder.lifecycle === 'not_applicable' || reminder.lifecycle === 'snoozed') return false;
  // Severely overdue items (>30 days) belong in the overdue summary, not here
  if (reminder.lifecycle === 'overdue' && reminder.overdueDays > 30) return false;
  if (reminder.kind === 'guidance') return true;
  // Tasks: scheduled, recently overdue, or starting within 30 days
  if (reminder.lifecycle === 'scheduled') return true;
  if (reminder.lifecycle === 'overdue') return true;
  return reminder.daysUntilStart >= 0 && reminder.daysUntilStart <= 30;
}

export function buildReminderAgenda(
  rules: readonly GenReminderRule[],
  context: ReminderEngineContext,
  states: ReminderState[],
  freqOverrides?: FreqOverrideMap,
): ReminderAgenda {
  const eligible = computeEligibleReminders(rules, context, states, freqOverrides);
  const normalEligible = eligible.filter((reminder) => reminder.deliveryDisposition === 'normal');
  const onboardingCatchupItems = eligible
    .filter((reminder) => reminder.deliveryDisposition === 'cold_start')
    .sort(compareTodayReminder);
  const stateMap = new Map(states.map((state) => [reminderKey(state.ruleId, state.repeatIndex), state]));
  const todayLimit = todayCap(context.nurtureMode);

  const preserved = normalEligible
    .filter((reminder) => reminder.state?.plannedForDate === context.localToday && reminder.state?.surfaceRank != null)
    .filter((reminder) => isTaskTodayCandidate(reminder, context.localToday))
    .sort((a, b) => (a.state?.surfaceRank ?? 999) - (b.state?.surfaceRank ?? 999));

  const preservedKeys = new Set(preserved.map((reminder) => reminderKey(reminder.rule.ruleId, reminder.repeatIndex)));
  const allP0Today = normalEligible
    .filter((reminder) => reminder.rule.priority === 'P0' && isTaskTodayCandidate(reminder, context.localToday))
    .sort(compareTodayReminder);

  const todayFocus: ActiveReminder[] = [];
  const todayKeys = new Set<string>();
  const p0OverflowItems: ActiveReminder[] = [];

  for (const reminder of allP0Today) {
    const key = reminderKey(reminder.rule.ruleId, reminder.repeatIndex);
    if (todayKeys.has(key)) continue;
    if (todayFocus.filter((item) => item.rule.priority === 'P0').length < P0_TODAY_LIMIT) {
      todayFocus.push(reminder);
      todayKeys.add(key);
      continue;
    }
    p0OverflowItems.push(reminder);
  }

  const p0OverflowKeys = new Set(p0OverflowItems.map((reminder) => reminderKey(reminder.rule.ruleId, reminder.repeatIndex)));

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

  const nonP0Candidates = normalEligible
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

  const upcoming = normalEligible
    .filter((reminder) => isUpcomingCandidate(reminder))
    .filter((reminder) => !todayKeys.has(reminderKey(reminder.rule.ruleId, reminder.repeatIndex)))
    .filter((reminder) => !p0OverflowKeys.has(reminderKey(reminder.rule.ruleId, reminder.repeatIndex)))
    .sort(compareWeekReminder)
    .slice(0, 15);

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
      deliveryDisposition: 'normal',
      state,
    } satisfies Omit<ActiveReminder, 'lifecycle'>;
    history.push({
      ...baseReminder,
      lifecycle: toLifecycle(baseReminder, context.localToday),
      historyType,
    });
  }
  history.sort(compareHistoryReminder);

  const overdueSummaryItems = normalEligible
    .filter((reminder) => reminder.kind === 'task')
    .filter((reminder) => reminder.lifecycle === 'overdue')
    .filter((reminder) => !todayKeys.has(reminderKey(reminder.rule.ruleId, reminder.repeatIndex)))
    .filter((reminder) => !p0OverflowKeys.has(reminderKey(reminder.rule.ruleId, reminder.repeatIndex)))
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
    p0Overflow: {
      count: p0OverflowItems.length,
      items: p0OverflowItems,
    },
    onboardingCatchup: {
      count: onboardingCatchupItems.length,
      items: onboardingCatchupItems,
    },
    upcoming,
    history,
    overdueSummary: {
      count: overdueSummaryItems.length,
      items: overdueSummaryItems.slice(0, 3),
    },
  };
}
