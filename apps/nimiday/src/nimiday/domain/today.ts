import { stillInCare } from './care.js';
import { occurrencesBetween } from './recurrence.js';
import { isActive, isOverdue } from './reminders.js';
import { rhythmRunsOn } from './rhythms.js';
import { attentionOrder, type SourceChange } from './sources.js';
import { addDays, DAY_MS, HOUR_MS, parseInstant, toLocalDate } from './time.js';
import type { DayState, LifeItem, LocalDate, LocalTime, Rhythm, SkillRun } from './types.js';

export type TimelineEntry =
  | {
    readonly kind: 'item';
    readonly key: string;
    readonly item: LifeItem;
    readonly date: LocalDate;
    readonly time: LocalTime | null;
    /** A future repetition of a repeating item, shown for planning only. */
    readonly projected: boolean;
    readonly done: boolean;
  }
  | {
    readonly kind: 'rhythm';
    readonly key: string;
    readonly rhythm: Rhythm;
    readonly date: LocalDate;
    readonly time: LocalTime;
    readonly run: SkillRun | null;
  };

export type TodayModel = {
  readonly date: LocalDate;
  readonly attention: readonly LifeItem[];
  readonly timeline: readonly TimelineEntry[];
  readonly waiting: readonly LifeItem[];
  readonly missed: readonly LifeItem[];
  /** Reminders still open in other Apps: things to arrange or finish there. */
  readonly reminders: readonly SourceChange[];
  readonly remindersTotal: number;
  /** Everything else other Apps shared lately: records and interpretations. */
  readonly changes: readonly SourceChange[];
  readonly changesTotal: number;
  readonly runs: readonly SkillRun[];
  readonly counts: {
    readonly overdue: number;
    readonly today: number;
    readonly waiting: number;
    readonly week: number;
  };
};

function sortEntries(a: TimelineEntry, b: TimelineEntry): number {
  const left = `${a.date} ${a.time ?? '00:00'} ${a.kind === 'item' && a.time === null ? 0 : 1}`;
  const right = `${b.date} ${b.time ?? '00:00'} ${b.kind === 'item' && b.time === null ? 0 : 1}`;
  return left.localeCompare(right);
}

function completedOn(item: LifeItem, date: LocalDate): boolean {
  if (item.state === 'done' && item.completedAt) {
    const done = parseInstant(item.completedAt);
    return done !== null && toLocalDate(done) === date && item.date === date;
  }
  return false;
}

function occurrenceDoneOn(item: LifeItem, date: LocalDate): boolean {
  return item.history.some((event) => event.kind === 'occurrence-done' && event.note === date);
}

/** Items (including repetitions) and rhythms planned on one day. */
export function entriesForDay(state: DayState, date: LocalDate, runs: readonly SkillRun[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const item of state.items) {
    if (item.repeat && item.date && isActive(item)) {
      if (occurrenceDoneOn(item, date)) {
        entries.push({ kind: 'item', key: `${item.id}:${date}:done`, item, date, time: item.time, projected: false, done: true });
      }
      for (const occurrence of occurrencesBetween(item.repeat, item.date, date, date, 1)) {
        entries.push({
          kind: 'item',
          key: `${item.id}:${occurrence}`,
          item,
          date: occurrence,
          time: item.time,
          projected: occurrence !== item.date,
          done: false,
        });
      }
      continue;
    }
    if (item.date !== date) continue;
    if (isActive(item)) {
      entries.push({ kind: 'item', key: item.id, item, date, time: item.time, projected: false, done: false });
    } else if (completedOn(item, date)) {
      entries.push({ kind: 'item', key: item.id, item, date, time: item.time, projected: false, done: true });
    }
  }
  for (const rhythm of state.rhythms) {
    if (!rhythm.enabled || !rhythmRunsOn(rhythm.schedule, date)) continue;
    const run = runs.find((candidate) => candidate.rhythmId === rhythm.id && candidate.scheduledFor !== null
      && toLocalDate(new Date(candidate.scheduledFor)) === date) ?? null;
    entries.push({ kind: 'rhythm', key: `${rhythm.id}:${date}`, rhythm, date, time: rhythm.schedule.time, run });
  }
  return entries.sort(sortEntries);
}

export function buildToday(
  allState: DayState,
  allChanges: readonly SourceChange[],
  now: Date,
): TodayModel {
  const inCare = stillInCare(allState.circles);
  const state: DayState = { ...allState, items: allState.items.filter(inCare) };
  const changes = allChanges.filter(inCare);
  const today = toLocalDate(now);
  const weekEnd = addDays(today, 7);
  const active = state.items.filter(isActive);
  // A delivered reminder keeps the item in view until it is handled or half a day passes.
  const recentlyReminded = (item: LifeItem) => {
    const reminded = parseInstant(item.remindedFor);
    const pendingSnooze = parseInstant(item.snoozedUntil);
    return reminded !== null && pendingSnooze === null && now.getTime() - reminded.getTime() < 12 * HOUR_MS;
  };
  // "Later" means later: a snoozed item returns when its snooze reminder is delivered.
  const snoozedAhead = (item: LifeItem) => {
    const until = parseInstant(item.snoozedUntil);
    return until !== null && until.getTime() > now.getTime();
  };
  const missed = active.filter((item) => {
    const last = item.history[item.history.length - 1];
    return last?.kind === 'missed' && now.getTime() - Date.parse(last.at) < 36 * HOUR_MS;
  });
  // Reminders that came due while NimiDay was closed are listed once, under "while you were away".
  const missedIds = new Set(missed.map((item) => item.id));
  const attention = active
    .filter((item) => item.state === 'open' && !missedIds.has(item.id) && !snoozedAhead(item) && (isOverdue(item, now) || recentlyReminded(item)))
    .sort((a, b) => `${a.date ?? ''}${a.time ?? ''}`.localeCompare(`${b.date ?? ''}${b.time ?? ''}`));
  const startOfToday = now.getTime() - (now.getHours() * HOUR_MS + now.getMinutes() * 60_000);
  // Today shows where each skill stands: its latest run, plus anything still in motion.
  // Earlier attempts stay in the routines history.
  const inMotion = (run: SkillRun) => run.state === 'queued' || run.state === 'running' || run.state === 'waiting-start';
  const recentRuns = state.runs
    .filter((run) => Date.parse(run.createdAt) >= startOfToday - DAY_MS && run.state !== 'dismissed' && run.trigger !== 'chat')
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const latestSkill = new Set<string>();
  const runs = recentRuns.filter((run) => {
    const first = !latestSkill.has(run.skillId);
    latestSkill.add(run.skillId);
    return first || inMotion(run);
  });
  // An open reminder stays in view however long ago its window began; other news
  // is kept for a week, and a reminder already handled in its own App only while unread.
  const recentChanges = changes.filter((change) => (change.nature === 'reminder' && change.todoState === 'open')
    || (now.getTime() - Date.parse(change.occurredAt) < 7 * DAY_MS && (change.unread || change.todoState === null)));
  const isOpenReminder = (change: SourceChange) => change.nature === 'reminder' && change.todoState === 'open';
  const reminders = attentionOrder(recentChanges.filter(isOpenReminder));
  const news = attentionOrder(recentChanges.filter((change) => !isOpenReminder(change)));
  return {
    date: today,
    attention,
    timeline: entriesForDay(state, today, state.runs),
    waiting: active.filter((item) => item.state === 'waiting'),
    missed,
    reminders: reminders.slice(0, 5),
    remindersTotal: reminders.length,
    changes: news.slice(0, 5),
    changesTotal: news.length,
    runs,
    counts: {
      overdue: active.filter((item) => isOverdue(item, now)).length,
      today: active.filter((item) => item.date === today).length,
      waiting: active.filter((item) => item.state === 'waiting').length,
      week: active.filter((item) => item.date !== null && item.date >= today && item.date <= weekEnd).length,
    },
  };
}

export type AgendaDay = {
  readonly date: LocalDate;
  readonly entries: readonly TimelineEntry[];
};

export function buildAgenda(state: DayState, from: LocalDate, days: number): AgendaDay[] {
  const agenda: AgendaDay[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(from, offset);
    agenda.push({ date, entries: entriesForDay(state, date, state.runs) });
  }
  return agenda;
}

/** Active items with no date, for the "someday" shelf. */
export function undatedItems(state: DayState): LifeItem[] {
  return state.items.filter((item) => isActive(item) && item.date === null && item.state === 'open');
}
