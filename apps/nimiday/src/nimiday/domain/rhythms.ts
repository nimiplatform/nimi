import { addDays, atLocal, MINUTE_MS, parseInstant, toLocalDate, weekdayOf } from './time.js';
import type { LocalDate, Rhythm, RhythmSchedule } from './types.js';

/** A rhythm that comes due this long after its time still counts as on time. */
export const RHYTHM_GRACE_MS = 15 * MINUTE_MS;

export function rhythmRunsOn(schedule: RhythmSchedule, date: LocalDate): boolean {
  const weekday = weekdayOf(date);
  switch (schedule.days) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekends':
      return weekday === 0 || weekday === 6;
    case 'custom':
      return schedule.weekdays.includes(weekday);
  }
}

/** The next scheduled moment strictly after `after`. */
export function nextRhythmOccurrence(schedule: RhythmSchedule, after: Date): Date | null {
  let date = toLocalDate(after);
  for (let step = 0; step < 15; step += 1) {
    if (rhythmRunsOn(schedule, date)) {
      const at = atLocal(date, schedule.time);
      if (at.getTime() > after.getTime()) return at;
    }
    date = addDays(date, 1);
  }
  return null;
}

/** The latest scheduled moment at or before `now`, looking back a week. */
export function latestRhythmOccurrence(schedule: RhythmSchedule, now: Date): Date | null {
  let date = toLocalDate(now);
  for (let step = 0; step < 8; step += 1) {
    if (rhythmRunsOn(schedule, date)) {
      const at = atLocal(date, schedule.time);
      if (at.getTime() <= now.getTime()) return at;
    }
    date = addDays(date, -1);
  }
  return null;
}

export type RhythmDue =
  | { readonly kind: 'none' }
  | { readonly kind: 'on-time'; readonly occurrence: Date }
  /** `closed`: it came due before NimiDay started. `late`: NimiDay was running but could not act in time (e.g. the computer slept). */
  | { readonly kind: 'missed'; readonly occurrence: Date; readonly reason: 'closed' | 'late' };

/**
 * Decide what the scheduler owes a rhythm right now. Only the latest
 * occurrence matters, and only one that came due after this session of
 * NimiDay started can start on its own: anything that came due before, even
 * seconds before, came due while NimiDay was closed. It is reported once and
 * can be started by hand, never replayed.
 */
export function rhythmDue(rhythm: Rhythm, now: Date, sessionStartedAt: Date): RhythmDue {
  if (!rhythm.enabled) return { kind: 'none' };
  const occurrence = latestRhythmOccurrence(rhythm.schedule, now);
  if (!occurrence) return { kind: 'none' };
  const handled = parseInstant(rhythm.handledFor);
  if (handled && handled.getTime() >= occurrence.getTime()) return { kind: 'none' };
  const created = parseInstant(rhythm.createdAt);
  if (!handled && created && created.getTime() > occurrence.getTime()) return { kind: 'none' };
  if (occurrence.getTime() < sessionStartedAt.getTime()) return { kind: 'missed', occurrence, reason: 'closed' };
  return now.getTime() - occurrence.getTime() <= RHYTHM_GRACE_MS
    ? { kind: 'on-time', occurrence }
    : { kind: 'missed', occurrence, reason: 'late' };
}

/** When a rhythm is switched on, occurrences already past today are not owed. */
export function handledMarkForEnable(schedule: RhythmSchedule, now: Date): string | null {
  return latestRhythmOccurrence(schedule, now)?.toISOString() ?? null;
}
