import { upsertReminderState } from '../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../bridge/ulid.js';
import type { ActiveReminder, ReminderAgenda, ReminderKind, ReminderState } from './reminder-engine.js';
import { getLocalToday, reminderKey } from './reminder-engine.js';
import {
  ProgressionViolationError,
  applyTransition,
  type ProgressionContext,
  type ProgressionDiff,
  type ReminderActionCommand,
} from './reminder-progression.js';

/**
 * Public UI-facing action vocabulary. Kept as a flat string union so the panel,
 * /reminders page, and drawer surfaces can dispatch without knowing per-kind
 * specifics. Internal routing resolves each coarse verb to the appropriate
 * progression command in reminder-progression.ts via `resolveProgressionCommand`.
 *
 * - 'complete' / 'acknowledge' — kind-scoped terminal-ish primary action
 * - 'reflect'                   — guide-only optional reflection marker (PO-REMI-003.guide)
 * - 'log_practice'              — practice-only re-entry event (PO-REMI-008)
 * - 'mark_habituated'           — practice-only terminal habituation marker
 * - 'open_advisor'              — consult-only routing intent; no writeback
 * - 'schedule' / 'snooze' / ... — kind-agnostic lifecycle actions
 */
export type ReminderActionType =
  | 'complete'
  | 'acknowledge'
  | 'reflect'
  | 'start_practicing'
  | 'log_practice'
  | 'mark_habituated'
  | 'open_advisor'
  | 'schedule'
  | 'snooze'
  | 'mark_not_applicable'
  | 'dismiss_today'
  | 'restore';

export interface ReminderActionInput {
  childId: string;
  reminder: Pick<ActiveReminder, 'rule' | 'repeatIndex' | 'kind'>;
  state: ReminderState | null;
  action: ReminderActionType;
  scheduledDate?: string | null;
  snoozedUntil?: string | null;
  now?: string;
}

/**
 * Resolve a UI-level action verb into the kind-specific progression command
 * per PO-REMI-005. The primary `complete`/`acknowledge` mapping here preserves
 * backward compatibility with the v4a coarse dispatch while letting each kind
 * drive its own progression column: guide.acknowledge, practice.start/log, and
 * consult.open_advisor (routing-only). `completeReminderByRule` call sites use
 * this translation as well.
 */
function resolveProgressionCommand(
  kind: ReminderKind,
  action: ReminderActionType,
  state: ReminderState | null,
  snoozedUntil: string | null,
  scheduledDate: string | null,
): ReminderActionCommand {
  switch (action) {
    case 'complete':
      if (kind !== 'task') {
        throw new ProgressionViolationError(kind, 'complete', 'complete is task-only per PO-REMI-005');
      }
      return { type: 'complete' };
    case 'acknowledge':
      if (kind === 'task') return { type: 'complete' };
      if (kind === 'guide') return { type: 'acknowledge' };
      if (kind === 'practice') {
        return state?.practiceStartedAt ? { type: 'log_practice' } : { type: 'start_practicing' };
      }
      return { type: 'open_advisor' }; // consult — routing only
    case 'reflect':
      return { type: 'reflect' };
    case 'start_practicing':
      return { type: 'start_practicing' };
    case 'log_practice':
      return { type: 'log_practice' };
    case 'mark_habituated':
      return { type: 'mark_habituated' };
    case 'open_advisor':
      return { type: 'open_advisor' };
    case 'schedule':
      return { type: 'schedule', scheduledDate };
    case 'snooze':
      return { type: 'snooze', snoozedUntil };
    case 'mark_not_applicable':
      return { type: 'mark_not_applicable' };
    case 'dismiss_today':
      return { type: 'dismiss_today' };
    case 'restore':
      return { type: 'restore' };
  }
}

function contextFromState(kind: ReminderKind, state: ReminderState | null): ProgressionContext {
  return {
    kind,
    acknowledgedAt: state?.acknowledgedAt ?? null,
    reflectedAt: state?.reflectedAt ?? null,
    practiceStartedAt: state?.practiceStartedAt ?? null,
    practiceLastAt: state?.practiceLastAt ?? null,
    practiceCount: state?.practiceCount ?? 0,
    practiceHabituatedAt: state?.practiceHabituatedAt ?? null,
    consultedAt: state?.consultedAt ?? null,
    consultationConversationId: state?.consultationConversationId ?? null,
    completedAt: state?.completedAt ?? null,
    notApplicable: state?.notApplicable ?? 0,
  };
}

interface BuildRowInput {
  childId: string;
  ruleId: string;
  repeatIndex: number;
  previous: ReminderState | null;
  diff: ProgressionDiff;
  snoozedUntil: string | null;
  scheduledDate: string | null;
  plannedForDate: string | null;
  surfaceRank: number | null;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  dismissedAt?: string | null;
  dismissReason?: string | null;
  now: string;
}

function buildRow(input: BuildRowInput): Parameters<typeof upsertReminderState>[0] {
  const { previous, diff } = input;
  return {
    stateId: previous?.stateId ?? ulid(),
    childId: input.childId,
    ruleId: input.ruleId,
    status: diff.status,
    activatedAt: previous?.activatedAt ?? null,
    completedAt: diff.completedAt,
    dismissedAt: input.dismissedAt ?? null,
    dismissReason: input.dismissReason ?? null,
    repeatIndex: input.repeatIndex,
    nextTriggerAt: previous?.nextTriggerAt ?? null,
    snoozedUntil: input.snoozedUntil,
    scheduledDate: input.scheduledDate,
    notApplicable: diff.notApplicable,
    plannedForDate: input.plannedForDate,
    surfaceRank: input.surfaceRank,
    lastSurfacedAt: input.lastSurfacedAt,
    surfaceCount: input.surfaceCount,
    notes: previous?.notes ?? null,
    acknowledgedAt: diff.acknowledgedAt,
    reflectedAt: diff.reflectedAt,
    practiceStartedAt: diff.practiceStartedAt,
    practiceLastAt: diff.practiceLastAt,
    practiceCount: diff.practiceCount,
    practiceHabituatedAt: diff.practiceHabituatedAt,
    consultedAt: diff.consultedAt,
    consultationConversationId: diff.consultationConversationId,
    now: input.now,
  };
}

function preservedDiff(state: ReminderState | null, kind: ReminderKind): ProgressionDiff {
  const ctx = contextFromState(kind, state);
  return {
    status: (state?.status as ProgressionDiff['status']) ?? 'active',
    completedAt: ctx.completedAt,
    acknowledgedAt: ctx.acknowledgedAt,
    reflectedAt: ctx.reflectedAt,
    practiceStartedAt: ctx.practiceStartedAt,
    practiceLastAt: ctx.practiceLastAt,
    practiceCount: ctx.practiceCount,
    practiceHabituatedAt: ctx.practiceHabituatedAt,
    consultedAt: ctx.consultedAt,
    consultationConversationId: ctx.consultationConversationId,
    notApplicable: ctx.notApplicable,
  };
}

export async function applyReminderAction(input: ReminderActionInput) {
  const now = input.now ?? isoNow();
  const localToday = now.slice(0, 10);
  const reminder = input.reminder;
  const previous = input.state;

  // Routing-only action: open_advisor writes no progression state. Persist nothing.
  // The advisor module invokes upsertReminderConsultation on AI first reply
  // (PO-REMI-007) which writes consultedAt / consultationConversationId atomically.
  if (input.action === 'open_advisor' || (input.action === 'acknowledge' && reminder.kind === 'consult')) {
    return;
  }

  const snoozedUntilInput = input.snoozedUntil ?? null;
  const scheduledDateInput = input.scheduledDate ?? null;

  const command = resolveProgressionCommand(
    reminder.kind,
    input.action,
    previous,
    snoozedUntilInput,
    scheduledDateInput,
  );

  const context = contextFromState(reminder.kind, previous);
  const diff = applyTransition(context, command, now);

  // Layer on agenda-stability metadata and action-specific lifecycle fields.
  let snoozedUntil: string | null = null;
  let scheduledDate: string | null = null;
  let dismissedAt: string | null = null;
  let dismissReason: string | null = null;
  let plannedForDate: string | null = null;
  let surfaceRank: number | null = null;
  let lastSurfacedAt: string | null = previous?.lastSurfacedAt ?? null;
  let surfaceCount: number = previous?.surfaceCount ?? 0;

  switch (input.action) {
    case 'snooze':
      snoozedUntil = snoozedUntilInput ?? defaultSnoozeUntil(reminder.kind, localToday);
      break;
    case 'schedule':
      scheduledDate = scheduledDateInput;
      break;
    case 'dismiss_today':
      dismissedAt = localToday;
      dismissReason = 'today';
      // Preserve existing snooze/schedule context on dismiss-today so it keeps
      // reappearing on its natural schedule rather than vanishing.
      snoozedUntil = previous?.snoozedUntil ?? null;
      scheduledDate = previous?.scheduledDate ?? null;
      break;
    case 'restore':
      // Hard reset of agenda metadata alongside progression reset.
      lastSurfacedAt = null;
      surfaceCount = 0;
      break;
    default:
      // Other actions preserve any previously-persisted snooze/schedule date.
      snoozedUntil = previous?.snoozedUntil ?? null;
      scheduledDate = previous?.scheduledDate ?? null;
      plannedForDate = previous?.plannedForDate ?? null;
      surfaceRank = previous?.surfaceRank ?? null;
      break;
  }

  await upsertReminderState(
    buildRow({
      childId: input.childId,
      ruleId: reminder.rule.ruleId,
      repeatIndex: reminder.repeatIndex,
      previous,
      diff,
      snoozedUntil,
      scheduledDate,
      dismissedAt,
      dismissReason,
      plannedForDate,
      surfaceRank,
      lastSurfacedAt,
      surfaceCount,
      now,
    }),
  );
}

const KIND_SYNTHETIC_ACTION_TYPE: Record<ReminderKind, 'record_data' | 'read_guide' | 'observe' | 'ai_consult'> = {
  task: 'record_data',
  guide: 'read_guide',
  practice: 'observe',
  consult: 'ai_consult',
};

export async function completeReminderByRule(params: {
  childId: string;
  ruleId: string;
  repeatIndex?: number;
  kind?: ReminderKind;
  state?: ReminderState | null;
}) {
  const kind = params.kind ?? 'task';
  return applyReminderAction({
    childId: params.childId,
    reminder: {
      rule: {
        ruleId: params.ruleId,
        actionType: KIND_SYNTHETIC_ACTION_TYPE[kind],
        kind,
      } as ActiveReminder['rule'],
      repeatIndex: params.repeatIndex ?? 0,
      kind,
    },
    state: params.state ?? null,
    action: kind === 'task' ? 'complete' : 'acknowledge',
  });
}

export async function persistAgendaPlan(childId: string, agenda: ReminderAgenda, states: ReminderState[], now = isoNow()) {
  const localToday = agenda.localToday;
  const todayKeys = new Set(agenda.todayFocus.map((reminder) => reminderKey(reminder.rule.ruleId, reminder.repeatIndex)));
  const stateMap = new Map(states.map((state) => [reminderKey(state.ruleId, state.repeatIndex), state]));
  const updates: Array<ReturnType<typeof buildRow>> = [];

  agenda.todayFocus.forEach((reminder, index) => {
    const key = reminderKey(reminder.rule.ruleId, reminder.repeatIndex);
    const previous = stateMap.get(key) ?? null;
    const surfacedToday = previous?.lastSurfacedAt?.slice(0, 10) === localToday;
    const needsUpdate =
      previous?.plannedForDate !== localToday
      || previous?.surfaceRank !== index + 1
      || !surfacedToday;

    if (!needsUpdate) {
      return;
    }

    // Preserve all progression columns — this is agenda-stability bookkeeping,
    // not a progression transition. Missing this preservation would wipe a guide
    // item's acknowledgedAt or a practice item's practiceCount on resurface.
    const diff = preservedDiff(previous, reminder.kind);
    updates.push(
      buildRow({
        childId,
        ruleId: reminder.rule.ruleId,
        repeatIndex: reminder.repeatIndex,
        previous,
        diff,
        snoozedUntil: previous?.snoozedUntil ?? null,
        scheduledDate: previous?.scheduledDate ?? null,
        plannedForDate: localToday,
        surfaceRank: index + 1,
        lastSurfacedAt: surfacedToday ? previous?.lastSurfacedAt ?? now : now,
        surfaceCount: surfacedToday ? previous?.surfaceCount ?? 0 : (previous?.surfaceCount ?? 0) + 1,
        now,
      }),
    );
  });

  states
    .filter((state) => state.plannedForDate === localToday)
    .filter((state) => !todayKeys.has(reminderKey(state.ruleId, state.repeatIndex)))
    .forEach((state) => {
      // Kind is unknown here (state doesn't carry it); use 'task' as the preservation
      // default since preservedDiff only reads existing timestamps and practiceCount.
      const diff = preservedDiff(state, 'task');
      updates.push(
        buildRow({
          childId,
          ruleId: state.ruleId,
          repeatIndex: state.repeatIndex,
          previous: state,
          diff,
          snoozedUntil: state.snoozedUntil,
          scheduledDate: state.scheduledDate,
          plannedForDate: null,
          surfaceRank: null,
          lastSurfacedAt: state.lastSurfacedAt,
          surfaceCount: state.surfaceCount,
          now,
        }),
      );
    });

  if (updates.length === 0) {
    return false;
  }

  await Promise.all(updates.map((row) => upsertReminderState(row)));
  return true;
}

/**
 * PO-REMI-010: P0 task rules are the only kind barred from mark_not_applicable.
 * All non-P0 tasks plus every guide / practice / consult rule are admissible.
 */
export function canMarkNotApplicable(reminder: Pick<ActiveReminder, 'kind' | 'rule'>) {
  return !(reminder.kind === 'task' && reminder.rule.priority === 'P0');
}

/**
 * PO-REMI-005 default snooze durations per kind. Values chosen to match the
 * natural cadence of each progression type: task items are typically time-boxed
 * (3 days), guides are read-and-return (7 days), practice items are habit-
 * forming (14 days), and consult items are conversation triggers (7 days).
 */
const SNOOZE_DAYS_BY_KIND: Record<ReminderKind, number> = {
  task: 3,
  guide: 7,
  practice: 14,
  consult: 7,
};

export function defaultSnoozeUntil(kind: ReminderKind, localToday = getLocalToday()) {
  // TZ-safe date arithmetic: parse YYYY-MM-DD as UTC midnight and advance via
  // UTC setters so the returned date key matches the intended local calendar
  // offset regardless of the host timezone.
  const [year, month, day] = localToday.split('-').map(Number);
  const base = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  base.setUTCDate(base.getUTCDate() + (SNOOZE_DAYS_BY_KIND[kind] ?? 3));
  return base.toISOString().slice(0, 10);
}
