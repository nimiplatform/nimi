import { addDays, atLocal, HOUR_MS, minutesOfDay, MINUTE_MS, parseInstant, toLocalDate, toLocalTime } from './time.js';
import type { Instant, LifeItem, LocalTime, QuietHours } from './types.js';

export type ReminderSettings = {
  readonly allDayRemindTime: LocalTime;
  readonly quiet: QuietHours;
};

export function isActive(item: LifeItem): boolean {
  return item.state === 'open' || item.state === 'waiting';
}

/** The moment the current occurrence is due (all-day items: start of day). */
export function dueInstant(item: LifeItem): Date | null {
  if (!item.date) return null;
  return atLocal(item.date, item.time ?? '00:00');
}

/**
 * When the reminder for the current occurrence should reach the user.
 * A snooze always wins; otherwise the rule is applied to the due moment.
 */
export function reminderInstant(item: LifeItem, settings: ReminderSettings): Date | null {
  if (!isActive(item)) return null;
  const snoozed = parseInstant(item.snoozedUntil);
  if (snoozed) return snoozed;
  if (!item.date || item.remind.kind === 'none') return null;
  if (item.time === null) {
    // All-day items remind at the user's chosen morning time.
    const base = atLocal(item.date, settings.allDayRemindTime);
    if (item.remind.kind === 'before') {
      // "N minutes before" on an all-day item means the day before when it spans days.
      const days = Math.floor(item.remind.minutes / 1440);
      return days > 0 ? atLocal(addDays(item.date, -days), settings.allDayRemindTime) : base;
    }
    return base;
  }
  const due = atLocal(item.date, item.time);
  if (item.remind.kind === 'before') return new Date(due.getTime() - item.remind.minutes * MINUTE_MS);
  return due;
}

/** A reminder is pending when its instant has passed and it was not handled yet. */
export function isReminderPending(item: LifeItem, now: Date, settings: ReminderSettings): boolean {
  const at = reminderInstant(item, settings);
  if (!at || at.getTime() > now.getTime()) return false;
  return item.remindedFor !== at.toISOString();
}

export function isOverdue(item: LifeItem, now: Date): boolean {
  if (!isActive(item) || !item.date) return false;
  if (item.time === null) return item.date < toLocalDate(now);
  const due = dueInstant(item);
  return due !== null && due.getTime() < now.getTime();
}

export function isDueToday(item: LifeItem, now: Date): boolean {
  return isActive(item) && item.date === toLocalDate(now);
}

/** Quiet hours may wrap past midnight (22:00–07:30). */
export function inQuietHours(now: Date, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  if (start === end) return false;
  const current = minutesOfDay(toLocalTime(now));
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** The next moment quiet hours end, strictly after `now` when inside them. */
export function quietHoursEnd(now: Date, quiet: QuietHours): Date {
  const today = toLocalDate(now);
  const endToday = atLocal(today, quiet.end);
  return endToday.getTime() > now.getTime() ? endToday : atLocal(addDays(today, 1), quiet.end);
}

export type SnoozeChoice = 'ten-minutes' | 'one-hour' | 'this-evening' | 'tomorrow-morning';

export type SnoozeOption = {
  readonly choice: SnoozeChoice;
  readonly at: Date;
};

const EVENING: LocalTime = '20:00';

export function snoozeOptions(now: Date, settings: ReminderSettings): SnoozeOption[] {
  const options: SnoozeOption[] = [
    { choice: 'ten-minutes', at: new Date(now.getTime() + 10 * MINUTE_MS) },
    { choice: 'one-hour', at: new Date(now.getTime() + HOUR_MS) },
  ];
  const today = toLocalDate(now);
  const evening = atLocal(today, EVENING);
  if (evening.getTime() - now.getTime() > HOUR_MS) options.push({ choice: 'this-evening', at: evening });
  const morningTime = settings.quiet.enabled ? settings.quiet.end : settings.allDayRemindTime;
  options.push({ choice: 'tomorrow-morning', at: atLocal(addDays(today, 1), morningTime) });
  return options;
}

export function snoozeInstant(choice: SnoozeChoice, now: Date, settings: ReminderSettings): Instant {
  const option = snoozeOptions(now, settings).find((candidate) => candidate.choice === choice)
    ?? { choice, at: new Date(now.getTime() + HOUR_MS) };
  return option.at.toISOString();
}
