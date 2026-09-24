import { addDays, daysInMonth, diffDays, parseLocalDate, startOfWeek, weekdayOf } from './time.js';
import type { LocalDate, Repeat, RepeatFreq } from './types.js';

const MAX_SCAN_DAYS = 800;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function weeklyDays(repeat: Repeat): readonly number[] {
  if (repeat.weekdays.length > 0) return [...new Set(repeat.weekdays)].sort((a, b) => a - b);
  return [weekdayOf(repeat.anchor)];
}

function weekIndex(repeat: Repeat, date: LocalDate): number {
  return Math.floor(diffDays(startOfWeek(repeat.anchor), startOfWeek(date)) / 7);
}

export function normalizeRepeat(input: {
  freq: RepeatFreq;
  interval?: number;
  weekdays?: readonly number[];
  anchor: LocalDate;
}): Repeat {
  const interval = Math.max(1, Math.min(365, Math.floor(input.interval ?? 1)));
  const weekdays = input.freq === 'weekly'
    ? [...new Set((input.weekdays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
    : [];
  return { freq: input.freq, interval, weekdays, anchor: input.anchor };
}

/** Whether `date` is one of the repeat's occurrence dates (on or after the anchor). */
export function matchesRepeat(repeat: Repeat, date: LocalDate): boolean {
  if (date < repeat.anchor) return false;
  const anchor = parseLocalDate(repeat.anchor);
  const target = parseLocalDate(date);
  switch (repeat.freq) {
    case 'daily':
      return diffDays(repeat.anchor, date) % repeat.interval === 0;
    case 'weekly': {
      if (!weeklyDays(repeat).includes(weekdayOf(date))) return false;
      return weekIndex(repeat, date) % repeat.interval === 0;
    }
    case 'monthly': {
      const months = (target.year - anchor.year) * 12 + (target.month - anchor.month);
      if (months % repeat.interval !== 0) return false;
      return target.day === Math.min(anchor.day, daysInMonth(target.year, target.month));
    }
    case 'yearly': {
      const years = target.year - anchor.year;
      if (years % repeat.interval !== 0 || target.month !== anchor.month) return false;
      return target.day === Math.min(anchor.day, daysInMonth(target.year, target.month));
    }
  }
}

/** The first occurrence on or after `date`. */
export function alignToRepeat(repeat: Repeat, date: LocalDate): LocalDate {
  let cursor = date < repeat.anchor ? repeat.anchor : date;
  if (repeat.freq === 'monthly' || repeat.freq === 'yearly' || repeat.freq === 'daily') {
    if (matchesRepeat(repeat, cursor)) return cursor;
    return nextOccurrence(repeat, cursor);
  }
  for (let step = 0; step < MAX_SCAN_DAYS; step += 1) {
    if (matchesRepeat(repeat, cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/** The occurrence after `current`. */
export function nextOccurrence(repeat: Repeat, current: LocalDate): LocalDate {
  const anchor = parseLocalDate(repeat.anchor);
  switch (repeat.freq) {
    case 'daily': {
      const offset = diffDays(repeat.anchor, current);
      if (offset < 0) return repeat.anchor;
      const remainder = offset % repeat.interval;
      return addDays(current, repeat.interval - remainder);
    }
    case 'weekly': {
      let cursor = addDays(current, 1);
      for (let step = 0; step < MAX_SCAN_DAYS; step += 1) {
        if (matchesRepeat(repeat, cursor)) return cursor;
        cursor = addDays(cursor, 1);
      }
      return cursor;
    }
    case 'monthly': {
      if (current < repeat.anchor) return repeat.anchor;
      const now = parseLocalDate(current);
      const elapsed = (now.year - anchor.year) * 12 + (now.month - anchor.month);
      for (let offset = elapsed - (elapsed % repeat.interval); ; offset += repeat.interval) {
        const candidate = monthlyOccurrence(repeat, offset);
        if (candidate > current) return candidate;
      }
    }
    case 'yearly': {
      if (current < repeat.anchor) return repeat.anchor;
      const now = parseLocalDate(current);
      const elapsed = now.year - anchor.year;
      for (let offset = elapsed - (elapsed % repeat.interval); ; offset += repeat.interval) {
        const year = anchor.year + offset;
        const candidate = `${year}-${pad(anchor.month)}-${pad(Math.min(anchor.day, daysInMonth(year, anchor.month)))}`;
        if (candidate > current) return candidate;
      }
    }
  }
}

function monthlyOccurrence(repeat: Repeat, offset: number): LocalDate {
  const anchor = parseLocalDate(repeat.anchor);
  const totalMonth = anchor.month - 1 + offset;
  const year = anchor.year + Math.floor(totalMonth / 12);
  const month = (totalMonth % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(anchor.day, daysInMonth(year, month)))}`;
}

/** Occurrence dates within [from, to], starting at the current occurrence. */
export function occurrencesBetween(
  repeat: Repeat,
  current: LocalDate,
  from: LocalDate,
  to: LocalDate,
  limit = 62,
): LocalDate[] {
  const dates: LocalDate[] = [];
  let cursor = current;
  for (let step = 0; step < limit * 8 && dates.length < limit; step += 1) {
    if (cursor > to) break;
    if (cursor >= from) dates.push(cursor);
    const next = nextOccurrence(repeat, cursor);
    if (next <= cursor) break;
    cursor = next;
  }
  return dates;
}
