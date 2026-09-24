import { addDays, diffDays, parseLocalDate, toLocalDate, weekdayOf } from '../domain/time.js';
import type { Instant, Language, LanguagePreference, LifeItem, LocalDate, RemindRule, Repeat, RhythmSchedule, SkillRun } from '../domain/types.js';
import { keptChanges } from '../domain/undo.js';
import { en } from './en.js';
import { zh, type Copy } from './zh.js';

export type { Copy } from './zh.js';

export function systemLanguage(): Language {
  const languages = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'zh'];
  for (const value of languages) {
    const lower = String(value).toLowerCase();
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('en')) return 'en';
  }
  return 'zh';
}

export function resolveLanguage(preference: LanguagePreference): Language {
  return preference === 'auto' ? systemLanguage() : preference;
}

/** What an undone run says afterwards: undone, or how many of its changes the user had made their own. */
export function describeUndone(copy: Copy, run: SkillRun, items: readonly LifeItem[]): string {
  const kept = keptChanges(run, items).size;
  return kept === 0 ? copy.run.undone : copy.run.undoneWithKept(kept, run.changes.length);
}

export function copyFor(language: Language): Copy {
  return language === 'en' ? en : zh;
}

export function formatDate(copy: Copy, date: LocalDate, today: LocalDate): string {
  const { year, month, day } = parseLocalDate(date);
  const base = year === Number(today.slice(0, 4)) ? copy.time.dateShort(month, day) : copy.time.dateWithYear(year, month, day);
  return `${base} ${copy.time.weekdays[weekdayOf(date)]}`;
}

/** "今天" / "明天" / "周五" within a week, otherwise the date. */
export function formatDay(copy: Copy, date: LocalDate, today: LocalDate): string {
  const offset = diffDays(today, date);
  if (offset === 0) return copy.time.today;
  if (offset === 1) return copy.time.tomorrow;
  if (offset === -1) return copy.time.yesterday;
  if (offset > 1 && offset < 7) return copy.time.weekdays[weekdayOf(date)]!;
  const { month, day } = parseLocalDate(date);
  return copy.time.dateShort(month, day);
}

export function formatWhen(copy: Copy, item: Pick<LifeItem, 'date' | 'time'>, today: LocalDate): string {
  if (!item.date) return copy.time.noDate;
  const day = formatDay(copy, item.date, today);
  return item.time ? `${day} ${item.time}` : `${day} · ${copy.time.allDay}`;
}

export function formatInstant(copy: Copy, value: Instant, today: LocalDate): string {
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${formatDay(copy, toLocalDate(date), today)} ${hh}:${mm}`;
}

export function timeAgo(copy: Copy, value: Instant, now: Date): string {
  const minutes = Math.round((now.getTime() - Date.parse(value)) / 60_000);
  if (minutes < 1) return copy.time.justNow;
  if (minutes < 60) return copy.time.minutesAgo(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return copy.time.hoursAgo(hours);
  return copy.time.daysAgo(Math.round(hours / 24));
}

export function describeRepeat(copy: Copy, repeat: Repeat | null): string {
  if (!repeat) return copy.repeat.none;
  const { month, day } = parseLocalDate(repeat.anchor);
  switch (repeat.freq) {
    case 'daily':
      return copy.repeat.daily(repeat.interval);
    case 'weekly':
      return copy.repeat.weekly(repeat.interval, repeat.weekdays.map((weekday) => copy.time.weekdays[weekday]).join(copy.repeat.joiner));
    case 'monthly':
      return copy.repeat.monthly(repeat.interval, day);
    case 'yearly':
      return copy.repeat.yearly(month, day);
  }
}

export function describeRemind(copy: Copy, rule: RemindRule, allDay: boolean, allDayTime: string): string {
  if (rule.kind === 'none') return copy.remind.none;
  if (allDay && rule.kind === 'at-time') return copy.remind.allDayAt(allDayTime);
  if (rule.kind === 'at-time') return copy.remind.atTime;
  return copy.remind.before(rule.minutes);
}

export function describeSchedule(copy: Copy, schedule: RhythmSchedule): string {
  const days = schedule.days === 'daily'
    ? copy.schedule.daily
    : schedule.days === 'weekdays'
      ? copy.schedule.weekdays
      : schedule.days === 'weekends'
        ? copy.schedule.weekends
        : copy.schedule.custom(schedule.weekdays.map((weekday) => copy.time.weekdays[weekday]).join(copy.repeat.joiner));
  return copy.schedule.at(days, schedule.time);
}

export function greeting(copy: Copy, now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return copy.greeting.night;
  if (hour < 11) return copy.greeting.morning;
  if (hour < 13) return copy.greeting.noon;
  if (hour < 18) return copy.greeting.afternoon;
  return copy.greeting.evening;
}

export function upcomingDates(today: LocalDate, days: number): LocalDate[] {
  return Array.from({ length: days }, (_, offset) => addDays(today, offset));
}
