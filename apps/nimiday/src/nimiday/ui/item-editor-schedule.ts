import { atLocal, MINUTE_MS, toLocalDate, toLocalTime } from '../domain/time.js';
import type { LifeItem } from '../domain/types.js';

export type EditorSchedule = { date: string; time: string; allDay: boolean };

/** Earliest selectable minute; seconds already elapsed cannot be scheduled again. */
export function nextScheduleMinute(now: Date): Date {
  return new Date(Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS);
}

// @nimi-authority: rule.nimi.nimiday.assistant.item-editor-scheduling
export function isEditorScheduleValid(
  schedule: EditorSchedule,
  original: Pick<LifeItem, 'date' | 'time'> | null,
  now: Date,
): boolean {
  const date = schedule.date || null;
  const time = date && !schedule.allDay ? schedule.time : null;
  if (original && date === original.date && time === original.time) return true;
  if (!date) return true;
  if (date < toLocalDate(now)) return false;
  return time === null || atLocal(date, time).getTime() >= now.getTime();
}

/** Only a deliberate scheduling edit adjusts the draft's default time. */
export function updateEditorSchedule<T extends EditorSchedule>(
  current: T,
  patch: Partial<EditorSchedule>,
  now: Date,
): T {
  const next = { ...current, ...patch };
  const earliest = nextScheduleMinute(now);
  if (!next.allDay && next.date === toLocalDate(earliest) && next.time < toLocalTime(earliest)) {
    next.time = toLocalTime(earliest);
  }
  return next;
}
