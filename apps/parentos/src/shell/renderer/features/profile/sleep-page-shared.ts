import { S } from '../../app-shell/page-style.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';

export const QUALITY_OPTIONS = ['good', 'fair', 'poor'] as const;
export const QUALITY_LABELS: Record<string, string> = { good: '好', fair: '一般', poor: '差' };
export const QUALITY_COLOR: Record<string, { bg: string; text: string }> = {
  good: { bg: '#dcfce7', text: '#15803d' },
  fair: { bg: '#fef3c7', text: '#b45309' },
  poor: { bg: '#fee2e2', text: '#dc2626' },
};

export type SleepAgeTier = 'infant' | 'toddler' | 'preschool' | 'school';

export const TIER_LABELS: Record<SleepAgeTier, string> = {
  infant: '婴儿期',
  toddler: '幼儿期',
  preschool: '学龄前',
  school: '学龄期',
};

export const TIER_DEFAULTS: Record<SleepAgeTier, { bed: string; wake: string }> = {
  infant: { bed: '20:00', wake: '06:00' },
  toddler: { bed: '20:30', wake: '06:30' },
  preschool: { bed: '21:00', wake: '07:00' },
  school: { bed: '21:00', wake: '07:00' },
};

export const inputCls = (extra = '') =>
  `w-full ${S.radiusSm} pl-3 pr-8 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50 ${extra}`;

export const inputSty = {
  borderColor: S.border,
  borderWidth: 1,
  borderStyle: 'solid' as const,
  background: '#ffffff',
};

export function sleepAgeTier(ageMonths: number): SleepAgeTier {
  if (ageMonths < 12) return 'infant';
  if (ageMonths < 36) return 'toddler';
  if (ageMonths < 72) return 'preschool';
  return 'school';
}

export function referenceSleepRange(ageMonths: number): [number, number] {
  if (ageMonths < 4) return [14, 17];
  if (ageMonths < 12) return [12, 16];
  if (ageMonths < 24) return [11, 14];
  if (ageMonths < 36) return [11, 14];
  if (ageMonths < 72) return [10, 13];
  if (ageMonths < 144) return [9, 12];
  return [8, 10];
}

export function calcDuration(bedtime: string, wakeTime: string): number | null {
  if (!bedtime || !wakeTime) return null;
  const bParts = bedtime.split(':').map(Number);
  const wParts = wakeTime.split(':').map(Number);
  const bh = bParts[0] ?? 0;
  const bm = bParts[1] ?? 0;
  const wh = wParts[0] ?? 0;
  const wm = wParts[1] ?? 0;
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

export function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function parseDateValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

export function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateDisplay(value: string): string {
  const [year, month, day] = value.split('-');
  return `${year}/${month}/${day}`;
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1, 12, 0, 0, 0);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function isAfterDay(a: Date, b: Date): boolean {
  if (a.getFullYear() !== b.getFullYear()) return a.getFullYear() > b.getFullYear();
  if (a.getMonth() !== b.getMonth()) return a.getMonth() > b.getMonth();
  return a.getDate() > b.getDate();
}

export function clampDateToToday(date: Date): Date {
  const today = new Date();
  const safeToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  return isAfterDay(date, safeToday) ? safeToday : date;
}

export function startOfCalendarMonth(date: Date): Date {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  const day = first.getDay();
  const offset = (day + 6) % 7;
  first.setDate(first.getDate() - offset);
  return first;
}

export function packNotes(nightWakings: string, napNotes: string, freeNotes: string): string | null {
  const parts: string[] = [];
  const nw = parseInt(nightWakings, 10);
  if (Number.isFinite(nw) && nw > 0) parts.push(`night_wakings:${nw}`);
  if (napNotes.trim()) parts.push(`nap_notes:${napNotes.trim()}`);
  if (freeNotes.trim()) parts.push(freeNotes.trim());
  return parts.length > 0 ? parts.join(' | ') : null;
}

export function unpackNotes(notes: string | null): {
  nightWakings: number | null;
  napNotes: string;
  freeNotes: string;
} {
  if (!notes) return { nightWakings: null, napNotes: '', freeNotes: '' };
  let nightWakings: number | null = null;
  let napNotes = '';
  const remaining: string[] = [];
  for (const part of notes.split(' | ')) {
    const nwMatch = part.match(/^night_wakings:(\d+)$/);
    if (nwMatch) {
      nightWakings = parseInt(nwMatch[1] ?? '0', 10);
      continue;
    }
    const napMatch = part.match(/^nap_notes:(.+)$/);
    if (napMatch) {
      napNotes = napMatch[1] ?? '';
      continue;
    }
    remaining.push(part);
  }
  return { nightWakings, napNotes, freeNotes: remaining.join(' | ') };
}

export function sortSleepRecordsDesc(records: SleepRecordRow[]) {
  return [...records].sort(
    (left, right) => new Date(right.sleepDate).getTime() - new Date(left.sleepDate).getTime(),
  );
}
