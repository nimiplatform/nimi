import { upsertReminderState } from '../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../bridge/ulid.js';
import type { ActiveReminder, ReminderAgenda, ReminderKind, ReminderState } from './reminder-engine.js';
import { getLocalToday, reminderKey } from './reminder-engine.js';

export type ReminderActionType = 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today';

export interface ReminderActionInput {
  childId: string;
  reminder: Pick<ActiveReminder, 'rule' | 'repeatIndex' | 'kind'>;
  state: ReminderState | null;
  action: ReminderActionType;
  scheduledDate?: string | null;
  snoozedUntil?: string | null;
  now?: string;
}

function buildRow(input: {
  childId: string;
  ruleId: string;
  repeatIndex: number;
  previous: ReminderState | null;
  status: string;
  completedAt: string | null;
  snoozedUntil: string | null;
  scheduledDate: string | null;
  notApplicable: number;
  plannedForDate: string | null;
  surfaceRank: number | null;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  now: string;
}): Parameters<typeof upsertReminderState>[0] {
  const previous = input.previous;
  return {
    stateId: previous?.stateId ?? ulid(),
    childId: input.childId,
    ruleId: input.ruleId,
    status: input.status,
    activatedAt: previous?.activatedAt ?? null,
    completedAt: input.completedAt,
    dismissedAt: null,
    dismissReason: null,
    repeatIndex: input.repeatIndex,
    nextTriggerAt: previous?.nextTriggerAt ?? null,
    snoozedUntil: input.snoozedUntil,
    scheduledDate: input.scheduledDate,
    notApplicable: input.notApplicable,
    plannedForDate: input.plannedForDate,
    surfaceRank: input.surfaceRank,
    lastSurfacedAt: input.lastSurfacedAt,
    surfaceCount: input.surfaceCount,
    notes: previous?.notes ?? null,
    now: input.now,
  };
}

export async function applyReminderAction(input: ReminderActionInput) {
  const now = input.now ?? isoNow();
  const localToday = now.slice(0, 10);
  const reminder = input.reminder;
  const previous = input.state;

  switch (input.action) {
    case 'complete':
    case 'acknowledge':
      await upsertReminderState(
        buildRow({
          childId: input.childId,
          ruleId: reminder.rule.ruleId,
          repeatIndex: reminder.repeatIndex,
          previous,
          status: 'completed',
          completedAt: now,
          snoozedUntil: null,
          scheduledDate: null,
          notApplicable: 0,
          plannedForDate: null,
          surfaceRank: null,
          lastSurfacedAt: previous?.lastSurfacedAt ?? null,
          surfaceCount: previous?.surfaceCount ?? 0,
          now,
        }),
      );
      return;
    case 'schedule':
      await upsertReminderState(
        buildRow({
          childId: input.childId,
          ruleId: reminder.rule.ruleId,
          repeatIndex: reminder.repeatIndex,
          previous,
          status: 'active',
          completedAt: null,
          snoozedUntil: null,
          scheduledDate: input.scheduledDate ?? null,
          notApplicable: 0,
          plannedForDate: null,
          surfaceRank: null,
          lastSurfacedAt: previous?.lastSurfacedAt ?? null,
          surfaceCount: previous?.surfaceCount ?? 0,
          now,
        }),
      );
      return;
    case 'snooze':
      await upsertReminderState(
        buildRow({
          childId: input.childId,
          ruleId: reminder.rule.ruleId,
          repeatIndex: reminder.repeatIndex,
          previous,
          status: 'active',
          completedAt: null,
          snoozedUntil:
            input.snoozedUntil ??
            (reminder.kind === 'task'
              ? new Date(new Date(`${localToday}T00:00:00`).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
              : new Date(new Date(`${localToday}T00:00:00`).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
          scheduledDate: null,
          notApplicable: 0,
          plannedForDate: null,
          surfaceRank: null,
          lastSurfacedAt: previous?.lastSurfacedAt ?? null,
          surfaceCount: previous?.surfaceCount ?? 0,
          now,
        }),
      );
      return;
    case 'mark_not_applicable':
      await upsertReminderState(
        buildRow({
          childId: input.childId,
          ruleId: reminder.rule.ruleId,
          repeatIndex: reminder.repeatIndex,
          previous,
          status: 'active',
          completedAt: null,
          snoozedUntil: null,
          scheduledDate: null,
          notApplicable: 1,
          plannedForDate: null,
          surfaceRank: null,
          lastSurfacedAt: previous?.lastSurfacedAt ?? null,
          surfaceCount: previous?.surfaceCount ?? 0,
          now,
        }),
      );
      return;
    case 'dismiss_today': {
      // Dismiss for today only — sets dismissedAt to today's date.
      // The reminder will reappear tomorrow or on its next trigger.
      const row = buildRow({
        childId: input.childId,
        ruleId: reminder.rule.ruleId,
        repeatIndex: reminder.repeatIndex,
        previous,
        status: previous?.status ?? 'active',
        completedAt: previous?.completedAt ?? null,
        snoozedUntil: previous?.snoozedUntil ?? null,
        scheduledDate: previous?.scheduledDate ?? null,
        notApplicable: previous?.notApplicable ?? 0,
        plannedForDate: null,
        surfaceRank: null,
        lastSurfacedAt: previous?.lastSurfacedAt ?? null,
        surfaceCount: previous?.surfaceCount ?? 0,
        now,
      });
      row.dismissedAt = localToday;
      row.dismissReason = 'today';
      await upsertReminderState(row);
      return;
    }
  }
}

export async function completeReminderByRule(params: {
  childId: string;
  ruleId: string;
  repeatIndex?: number;
  kind?: ReminderKind;
  state?: ReminderState | null;
}) {
  return applyReminderAction({
    childId: params.childId,
    reminder: {
      rule: {
        ruleId: params.ruleId,
        actionType: params.kind === 'guidance' ? 'observe' : 'record_data',
      } as ActiveReminder['rule'],
      repeatIndex: params.repeatIndex ?? 0,
      kind: params.kind ?? 'task',
    },
    state: params.state ?? null,
    action: params.kind === 'guidance' ? 'acknowledge' : 'complete',
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

    updates.push(
      buildRow({
        childId,
        ruleId: reminder.rule.ruleId,
        repeatIndex: reminder.repeatIndex,
        previous,
        status: previous?.completedAt ? 'completed' : previous?.status ?? 'active',
        completedAt: previous?.completedAt ?? null,
        snoozedUntil: previous?.snoozedUntil ?? null,
        scheduledDate: previous?.scheduledDate ?? null,
        notApplicable: previous?.notApplicable ?? 0,
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
      updates.push(
        buildRow({
          childId,
          ruleId: state.ruleId,
          repeatIndex: state.repeatIndex,
          previous: state,
          status: state.status,
          completedAt: state.completedAt,
          snoozedUntil: state.snoozedUntil,
          scheduledDate: state.scheduledDate,
          notApplicable: state.notApplicable,
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

export function canMarkNotApplicable(reminder: Pick<ActiveReminder, 'kind' | 'rule'>) {
  return !(reminder.kind === 'task' && reminder.rule.priority === 'P0');
}

export function defaultSnoozeUntil(kind: ReminderKind, localToday = getLocalToday()) {
  const base = new Date(`${localToday}T00:00:00`);
  base.setDate(base.getDate() + (kind === 'task' ? 3 : 7));
  return base.toISOString().slice(0, 10);
}
