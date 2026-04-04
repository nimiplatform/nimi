import type { JournalEntryRow, MeasurementRow } from '../../bridge/sqlite-bridge.js';
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
      title: `${label} trend`,
      summary: `${label} changed by ${formatSignedDelta(delta)}${unit ? ` ${unit}` : ''} between ${formatDate(previous.measuredAt)} and ${formatDate(latestInPeriod.measuredAt)}.`,
      evidence: [
        `Previous record: ${previous.value}${unit ? ` ${unit}` : ''} on ${formatDate(previous.measuredAt)}.`,
        `Latest record: ${latestInPeriod.value}${unit ? ` ${unit}` : ''} on ${formatDate(latestInPeriod.measuredAt)}.`,
      ],
      sources: ['Local growth measurements'],
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
    title: 'Journal activity trend',
    summary: `Journal capture count was ${currentWindow.length} in the current window versus ${previousWindow.length} in the previous window of the same length.`,
    evidence: [
      `${currentVoice} voice-only entries and ${currentMixed} voice-plus-text entries were saved in the current window.`,
      `${currentKeepsakes} entries were marked as keepsakes in the current window.`,
    ],
    sources: ['Local journal entries'],
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
    title: 'Observation focus trend',
    summary: `${label} was the most-recorded observation dimension in the current window with ${count} entries.`,
    evidence: [
      `Dimension id: ${dimensionId}.`,
      `Recorded entries in the current window: ${count}.`,
    ],
    sources: ['Local journal entries', 'Observation framework'],
  };
}

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
