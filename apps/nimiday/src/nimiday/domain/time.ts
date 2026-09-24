import type { Instant, LocalDate, LocalTime } from './types.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function toLocalDate(date: Date): LocalDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalTime(date: Date): LocalTime {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDate(value: LocalDate): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid local date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function minutesOfDay(value: LocalTime): number {
  const match = TIME_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid local time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function timeFromMinutes(minutes: number): LocalTime {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

/** The instant a local wall-clock moment happens (DST gaps resolve forward). */
export function atLocal(date: LocalDate, time: LocalTime): Date {
  const { year, month, day } = parseLocalDate(date);
  const minutes = minutesOfDay(time);
  return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

export function startOfLocalDay(date: LocalDate): Date {
  return atLocal(date, '00:00');
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  return toLocalDate(new Date(year, month - 1, day + days));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(year, month - 1, day).getDay();
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const left = parseLocalDate(a);
  const right = parseLocalDate(b);
  const utcLeft = Date.UTC(left.year, left.month - 1, left.day);
  const utcRight = Date.UTC(right.year, right.month - 1, right.day);
  return Math.round((utcRight - utcLeft) / DAY_MS);
}

/** Monday-based start of the week containing `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  const weekday = weekdayOf(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function instant(date: Date): Instant {
  return date.toISOString();
}

export function parseInstant(value: Instant | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function todayLocal(now: Date): LocalDate {
  return toLocalDate(now);
}
