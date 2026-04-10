import type { JournalEntryRow, MeasurementRow, SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARDS, OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';

export interface StructuredTrendSignal {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  sources: string[];
}

const growthStandardById = new Map(GROWTH_STANDARDS.map((item) => [item.typeId, item]));
const observationDimensionById = new Map(
  OBSERVATION_DIMENSIONS.map((item) => [item.dimensionId, item]),
);

function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function isInPeriod(value: string, start: string, end: string) {
  return value >= start && value <= end;
}

function previousPeriodStart(periodStart: string, periodEnd: string) {
  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  const durationMs = Math.max(endMs - startMs, 1);
  return new Date(startMs - durationMs).toISOString();
}

function formatSignedDelta(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

function buildMeasurementTrendSignals(
  measurements: MeasurementRow[],
  periodStart: string,
  periodEnd: string,
): StructuredTrendSignal[] {
  const grouped = new Map<string, MeasurementRow[]>();
  for (const measurement of measurements) {
    const bucket = grouped.get(measurement.typeId) ?? [];
    bucket.push(measurement);
    grouped.set(measurement.typeId, bucket);
  }

  const signals: StructuredTrendSignal[] = [];
  for (const [typeId, rows] of grouped.entries()) {
    const sorted = [...rows].sort((left, right) => left.measuredAt.localeCompare(right.measuredAt));
    const latestInPeriod = [...sorted].reverse().find((row) => isInPeriod(row.measuredAt, periodStart, periodEnd));
    if (!latestInPeriod) continue;

    const latestIndex = sorted.findIndex((row) => row.measurementId === latestInPeriod.measurementId);
    if (latestIndex <= 0) continue;

    const previous = sorted[latestIndex - 1];
    if (!previous) continue;
    const growthType = growthStandardById.get(typeId as typeof GROWTH_STANDARDS[number]['typeId']);
    const label = growthType?.displayName ?? typeId;
    const unit = growthType?.unit ?? '';
    const delta = latestInPeriod.value - previous.value;

    signals.push({
      id: `measurement-${typeId}`,
      title: `${label}趋势`,
      summary: `${label}在 ${formatDate(previous.measuredAt)} 至 ${formatDate(latestInPeriod.measuredAt)} 期间变化了 ${formatSignedDelta(delta)}${unit ? ` ${unit}` : ''}。`,
      evidence: [
        `上次记录：${previous.value}${unit ? ` ${unit}` : ''}，${formatDate(previous.measuredAt)}。`,
        `最新记录：${latestInPeriod.value}${unit ? ` ${unit}` : ''}，${formatDate(latestInPeriod.measuredAt)}。`,
      ],
      sources: ['本地生长测量数据'],
    });
  }

  return signals.sort((left, right) => left.title.localeCompare(right.title));
}

function buildJournalVolumeSignal(
  journalEntries: JournalEntryRow[],
  periodStart: string,
  periodEnd: string,
): StructuredTrendSignal | null {
  const previousStart = previousPeriodStart(periodStart, periodEnd);
  const currentWindow = journalEntries.filter((entry) => isInPeriod(entry.recordedAt, periodStart, periodEnd));
  const previousWindow = journalEntries.filter((entry) => isInPeriod(entry.recordedAt, previousStart, periodStart));

  if (currentWindow.length === 0 && previousWindow.length === 0) {
    return null;
  }

  const currentVoice = currentWindow.filter((entry) => entry.contentType === 'voice').length;
  const currentMixed = currentWindow.filter((entry) => entry.contentType === 'mixed').length;
  const currentKeepsakes = currentWindow.filter((entry) => entry.keepsake === 1).length;

  return {
    id: 'journal-volume',
    title: '日志活跃度趋势',
    summary: `当前周期日志记录 ${currentWindow.length} 条，上一同等周期 ${previousWindow.length} 条。`,
    evidence: [
      `当前周期内 ${currentVoice} 条纯语音记录，${currentMixed} 条语音+文字记录。`,
      `当前周期内 ${currentKeepsakes} 条标记为珍藏。`,
    ],
    sources: ['本地观察日志'],
  };
}

function buildJournalDimensionSignal(
  journalEntries: JournalEntryRow[],
  periodStart: string,
  periodEnd: string,
): StructuredTrendSignal | null {
  const counts = new Map<string, number>();
  for (const entry of journalEntries) {
    if (!entry.dimensionId || !isInPeriod(entry.recordedAt, periodStart, periodEnd)) continue;
    counts.set(entry.dimensionId, (counts.get(entry.dimensionId) ?? 0) + 1);
  }

  const topDimension = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  if (!topDimension) {
    return null;
  }

  const [dimensionId, count] = topDimension;
  const dimension = observationDimensionById.get(dimensionId);
  const label = dimension?.displayName ?? dimensionId;

  return {
    id: 'journal-dimension',
    title: '观察维度趋势',
    summary: `${label}是当前周期记录最多的观察维度，共 ${count} 条。`,
    evidence: [
      `维度 ID：${dimensionId}。`,
      `当前周期记录条数：${count}。`,
    ],
    sources: ['本地观察日志', '观察框架'],
  };
}

/* ── Comparison data extractors (for narrative reports) ── */

export interface MeasurementComparison {
  typeId: string;
  label: string;
  unit: string;
  currentValue: number;
  currentDate: string;
  currentPercentile: number | null;
  previousValue: number | null;
  previousDate: string | null;
  delta: number | null;
}

export function buildMeasurementComparisons(
  measurements: MeasurementRow[],
  periodStart: string,
  periodEnd: string,
): MeasurementComparison[] {
  const grouped = new Map<string, MeasurementRow[]>();
  for (const m of measurements) {
    const bucket = grouped.get(m.typeId) ?? [];
    bucket.push(m);
    grouped.set(m.typeId, bucket);
  }

  const results: MeasurementComparison[] = [];
  for (const [typeId, rows] of grouped.entries()) {
    const sorted = [...rows].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
    const latestInPeriod = [...sorted].reverse().find((r) => isInPeriod(r.measuredAt, periodStart, periodEnd));
    if (!latestInPeriod) continue;

    const latestIndex = sorted.findIndex((r) => r.measurementId === latestInPeriod.measurementId);
    const previous = latestIndex > 0 ? sorted[latestIndex - 1]! : null;
    const gs = growthStandardById.get(typeId as typeof GROWTH_STANDARDS[number]['typeId']);

    results.push({
      typeId,
      label: gs?.displayName ?? typeId,
      unit: gs?.unit ?? '',
      currentValue: latestInPeriod.value,
      currentDate: latestInPeriod.measuredAt,
      currentPercentile: latestInPeriod.percentile ?? null,
      previousValue: previous ? previous.value : null,
      previousDate: previous ? previous.measuredAt : null,
      delta: previous ? Math.round((latestInPeriod.value - previous.value) * 10) / 10 : null,
    });
  }

  return results.sort((a, b) => a.typeId.localeCompare(b.typeId));
}

export interface SleepComparison {
  currentAvgBedtime: string | null;
  currentAvgDuration: number | null;
  previousAvgBedtime: string | null;
  previousAvgDuration: number | null;
  currentCount: number;
  previousCount: number;
  bedtimeDeltaMinutes: number | null;
  durationDeltaMinutes: number | null;
}

function parseBedtimeMinutes(bedtime: string): number | null {
  const parts = bedtime.match(/^(\d{1,2}):(\d{2})/);
  if (!parts) return null;
  let h = parseInt(parts[1]!, 10);
  const m = parseInt(parts[2]!, 10);
  // Normalize: times after midnight (0-5) treated as 24+
  if (h < 6) h += 24;
  return h * 60 + m;
}

function minutesToTimeStr(minutes: number): string {
  const h = Math.floor(minutes % (24 * 60) / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildSleepComparison(
  sleepRecords: SleepRecordRow[],
  periodStart: string,
  periodEnd: string,
): SleepComparison {
  const prevStart = previousPeriodStart(periodStart, periodEnd);
  const current = sleepRecords.filter((r) => isInPeriod(r.sleepDate, periodStart, periodEnd));
  const previous = sleepRecords.filter((r) => isInPeriod(r.sleepDate, prevStart, periodStart));

  const avgBedtime = (records: SleepRecordRow[]): { avgStr: string | null; avgMin: number | null } => {
    const mins = records.map((r) => r.bedtime ? parseBedtimeMinutes(r.bedtime) : null).filter((v): v is number => v !== null);
    if (mins.length === 0) return { avgStr: null, avgMin: null };
    const avg = mins.reduce((s, v) => s + v, 0) / mins.length;
    return { avgStr: minutesToTimeStr(avg), avgMin: avg };
  };

  const avgDuration = (records: SleepRecordRow[]): number | null => {
    const durations = records.map((r) => r.durationMinutes).filter((v): v is number => v !== null);
    if (durations.length === 0) return null;
    return Math.round(durations.reduce((s, v) => s + v, 0) / durations.length);
  };

  const curBt = avgBedtime(current);
  const prevBt = avgBedtime(previous);
  const curDur = avgDuration(current);
  const prevDur = avgDuration(previous);

  return {
    currentAvgBedtime: curBt.avgStr,
    currentAvgDuration: curDur,
    previousAvgBedtime: prevBt.avgStr,
    previousAvgDuration: prevDur,
    currentCount: current.length,
    previousCount: previous.length,
    bedtimeDeltaMinutes: (curBt.avgMin != null && prevBt.avgMin != null) ? Math.round(curBt.avgMin - prevBt.avgMin) : null,
    durationDeltaMinutes: (curDur != null && prevDur != null) ? Math.round(curDur - prevDur) : null,
  };
}

/* ── Structured trend signals (v1 format) ── */

export function buildStructuredTrendSignals(input: {
  measurements: MeasurementRow[];
  journalEntries: JournalEntryRow[];
  periodStart: string;
  periodEnd: string;
}): StructuredTrendSignal[] {
  const signals = [
    ...buildMeasurementTrendSignals(input.measurements, input.periodStart, input.periodEnd),
  ];

  const journalVolumeSignal = buildJournalVolumeSignal(
    input.journalEntries,
    input.periodStart,
    input.periodEnd,
  );
  if (journalVolumeSignal) {
    signals.push(journalVolumeSignal);
  }

  const journalDimensionSignal = buildJournalDimensionSignal(
    input.journalEntries,
    input.periodStart,
    input.periodEnd,
  );
  if (journalDimensionSignal) {
    signals.push(journalDimensionSignal);
  }

  return signals;
}
