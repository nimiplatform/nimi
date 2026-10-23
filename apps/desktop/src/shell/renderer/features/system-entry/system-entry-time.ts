export type SystemEntryDayRange = Readonly<{
  date: string;
  timeZone: string;
  startMs: number;
  endMs: number;
  fromTime: Readonly<{ seconds: string; nanos: number }>;
  toTime: Readonly<{ seconds: string; nanos: number }>;
}>;

// @nimi-authority: rule.nimi.desktop.shell-ui.system-entry-projection
export function systemEntryDayRange(nowMs: number, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): SystemEntryDayRange {
  if (!Number.isFinite(nowMs)) throw new Error('system-entry-time-invalid');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'iso8601', year: 'numeric', month: '2-digit', day: '2-digit' });
  const localDate = (milliseconds: number): string => {
    const parts = formatter.formatToParts(milliseconds);
    const part = (name: string) => parts.find((value) => value.type === name)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const date = localDate(nowMs);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  const firstInstant = (target: string, nominalUtc: number): number => {
    let before = nominalUtc - 36 * 60 * 60 * 1_000;
    let after = nominalUtc + 36 * 60 * 60 * 1_000;
    while (after - before > 1) {
      const middle = Math.floor((before + after) / 2);
      if (localDate(middle) < target) before = middle;
      else after = middle;
    }
    return after;
  };
  const startMs = firstInstant(date, Date.UTC(year, month - 1, day));
  const endMs = firstInstant(nextDate, next.getTime());
  if (startMs > nowMs || endMs <= nowMs || startMs >= endMs) throw new Error('system-entry-day-range-invalid');
  return { date, timeZone, startMs, endMs, fromTime: systemEntryTimestamp(startMs), toTime: systemEntryTimestamp(endMs) };
}

export function systemEntryTimestamp(milliseconds: number): { seconds: string; nanos: number } {
  const seconds = Math.floor(milliseconds / 1_000);
  return { seconds: String(seconds), nanos: Math.round((milliseconds - seconds * 1_000) * 1_000_000) };
}

export function systemEntryTimestampIso(value: { seconds: string; nanos: number } | undefined): string | null {
  if (!value) return null;
  const milliseconds = Number(value.seconds) * 1_000 + value.nanos / 1_000_000;
  return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8_640_000_000_000_000 ? new Date(milliseconds).toISOString() : null;
}
