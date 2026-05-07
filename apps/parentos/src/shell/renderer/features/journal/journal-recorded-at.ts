/**
 * Journal entry "recordedAt" helpers.
 *
 * The composer treats `null` as "use the moment of save". When the parent picks
 * a different time (e.g. logging yesterday's event), we store it as a real ISO
 * string so the save path can write it directly to the journal entry.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function diffInDays(target: Date, reference: Date): number {
  const t = startOfLocalDay(target).getTime();
  const r = startOfLocalDay(reference).getTime();
  return Math.round((r - t) / ONE_DAY_MS);
}

export function formatRecordedAtLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '现在';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '现在';

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const days = diffInDays(date, now);

  if (days === 0) {
    const minutesAgo = Math.round((now.getTime() - date.getTime()) / 60000);
    if (minutesAgo >= 0 && minutesAgo < 5) return '刚刚';
    return `今天 ${time}`;
  }
  if (days === 1) return `昨天 ${time}`;
  if (days === 2) return `前天 ${time}`;

  const sameYear = date.getFullYear() === now.getFullYear();
  const md = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return sameYear ? `${md} ${time}` : `${date.getFullYear()}-${md} ${time}`;
}

/** Convert ISO → value usable by `<input type="datetime-local">` (local TZ, minute precision). */
export function toDatetimeLocalValue(iso: string | null, fallback: Date = new Date()): string {
  const source = iso ? new Date(iso) : fallback;
  const safe = Number.isNaN(source.getTime()) ? fallback : source;
  return [
    safe.getFullYear(),
    '-',
    pad2(safe.getMonth() + 1),
    '-',
    pad2(safe.getDate()),
    'T',
    pad2(safe.getHours()),
    ':',
    pad2(safe.getMinutes()),
  ].join('');
}

/** Convert `<input type="datetime-local">` value → ISO string. Returns null on invalid. */
export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export interface RecordedAtPreset {
  key: string;
  label: string;
  /** Resolves the preset to an ISO string, or null for "now at save". */
  resolve: (now: Date) => string | null;
}

export const RECORDED_AT_PRESETS: RecordedAtPreset[] = [
  { key: 'now', label: '现在', resolve: () => null },
  {
    key: '1h-ago',
    label: '1 小时前',
    resolve: (now) => new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
  },
  {
    key: 'yesterday-evening',
    label: '昨天 19:00',
    resolve: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      d.setHours(19, 0, 0, 0);
      return d.toISOString();
    },
  },
  {
    key: 'day-before-yesterday-evening',
    label: '前天 19:00',
    resolve: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() - 2);
      d.setHours(19, 0, 0, 0);
      return d.toISOString();
    },
  },
];
