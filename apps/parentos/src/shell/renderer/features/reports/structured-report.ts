import { computeAgeMonthsAt, type ChildProfile } from '../../app-shell/app-store.js';
import type {
  JournalEntryRow,
  MeasurementRow,
  MilestoneRecordRow,
  ReminderStateRow,
  VaccineRecordRow,
} from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARDS, MILESTONE_CATALOG, REMINDER_RULES } from '../../knowledge-base/index.js';
import { buildStructuredTrendSignals, type StructuredTrendSignal } from './trend-analysis.js';

export type GrowthReportType = 'monthly' | 'quarterly' | 'quarterly-letter';

const GROWTH_REPORT_TYPES = ['monthly', 'quarterly', 'quarterly-letter'] as const satisfies readonly GrowthReportType[];

export interface StructuredGrowthReportMetric {
  id: string;
  label: string;
  value: string;
  detail?: string;
}

export interface StructuredGrowthReportSection {
  id: string;
  title: string;
  items: string[];
}

export interface StructuredGrowthReportContent {
  version: 1;
  format: 'structured-local';
  reportType: GrowthReportType;
  title: string;
  subtitle: string;
  generatedAt: string;
  overview: string[];
  metrics: StructuredGrowthReportMetric[];
  trendSignals: StructuredTrendSignal[];
  sections: StructuredGrowthReportSection[];
  sources: string[];
  safetyNote: string;
}

export interface BuiltStructuredGrowthReport {
  reportType: GrowthReportType;
  periodStart: string;
  periodEnd: string;
  ageMonthsStart: number;
  ageMonthsEnd: number;
  content: StructuredGrowthReportContent;
}

export interface StructuredGrowthReportSnapshot {
  child: ChildProfile;
  reportType: GrowthReportType;
  now: string;
  measurements: MeasurementRow[];
  milestones: MilestoneRecordRow[];
  vaccines: VaccineRecordRow[];
  journalEntries: JournalEntryRow[];
  reminderStates: ReminderStateRow[];
}

const growthStandardById = new Map(GROWTH_STANDARDS.map((item) => [item.typeId, item]));
const milestoneById = new Map(MILESTONE_CATALOG.map((item) => [item.milestoneId, item]));
const reminderRuleById = new Map(REMINDER_RULES.map((item) => [item.ruleId, item]));

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfUtcQuarter(date: Date) {
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
}

function formatDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function truncate(value: string, max = 160) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function getReportPeriod(reportType: GrowthReportType, now: string) {
  const target = new Date(now);
  const start = reportType === 'monthly' ? startOfUtcMonth(target) : startOfUtcQuarter(target);
  return {
    start: start.toISOString(),
    end: target.toISOString(),
  };
}

function inPeriod(value: string | null | undefined, start: string, end: string) {
  return Boolean(value && value >= start && value <= end);
}

function summarizeMeasurements(measurements: MeasurementRow[], start: string, end: string) {
  const inWindow = measurements.filter((item) => inPeriod(item.measuredAt, start, end));
  if (inWindow.length === 0) {
    return ['No growth measurements were recorded during this report window.'];
  }

  const latestByType = new Map<string, MeasurementRow>();
  for (const measurement of inWindow) {
    latestByType.set(measurement.typeId, measurement);
  }

  return Array.from(latestByType.values())
    .sort((left, right) => left.typeId.localeCompare(right.typeId))
    .map((measurement) => {
      const standard = growthStandardById.get(measurement.typeId as typeof GROWTH_STANDARDS[number]['typeId']);
      const label = standard?.displayName ?? measurement.typeId;
      const unit = standard?.unit ? ` ${standard.unit}` : '';
      return `${label}: ${measurement.value}${unit} on ${formatDate(measurement.measuredAt)}`;
    });
}

function summarizeMilestones(milestones: MilestoneRecordRow[], start: string, end: string) {
  const achieved = milestones.filter((item) => inPeriod(item.achievedAt, start, end));
  if (achieved.length === 0) {
    return ['No new milestone achievements were recorded during this report window.'];
  }

  return achieved.map((item) => {
    const milestone = milestoneById.get(item.milestoneId);
    const title = milestone?.title ?? item.milestoneId;
    const achievedAt = item.achievedAt ? formatDate(item.achievedAt) : 'date not recorded';
    return `${title} recorded on ${achievedAt}`;
  });
}

function summarizeVaccines(vaccines: VaccineRecordRow[], start: string, end: string) {
  const inWindow = vaccines.filter((item) => inPeriod(item.vaccinatedAt, start, end));
  if (inWindow.length === 0) {
    return ['No vaccine records were added during this report window.'];
  }

  return inWindow.map((item) => `${item.vaccineName} on ${formatDate(item.vaccinatedAt)}`);
}

function summarizeJournalEntries(journalEntries: JournalEntryRow[], child: ChildProfile, start: string, end: string) {
  const inWindow = journalEntries.filter((item) => inPeriod(item.recordedAt, start, end));
  if (inWindow.length === 0) {
    return ['No journal entries were recorded during this report window.'];
  }

  const recorderCounts = new Map<string, number>();
  let keepsakeCount = 0;
  let voiceCount = 0;
  let mixedCount = 0;

  for (const entry of inWindow) {
    if (entry.keepsake === 1) keepsakeCount += 1;
    if (entry.contentType === 'voice') voiceCount += 1;
    if (entry.contentType === 'mixed') mixedCount += 1;
    if (entry.recorderId) {
      recorderCounts.set(entry.recorderId, (recorderCounts.get(entry.recorderId) ?? 0) + 1);
    }
  }

  const items = [
    `${inWindow.length} journal entries were saved in this report window.`,
    `${keepsakeCount} entries were marked as keepsakes.`,
    `${voiceCount} voice-only entries and ${mixedCount} mixed voice/text entries were saved.`,
  ];

  if (recorderCounts.size > 0) {
    const recorderNameById = new Map((child.recorderProfiles ?? []).map((item) => [item.id, item.name]));
    const recorderSummary = Array.from(recorderCounts.entries())
      .map(([recorderId, count]) => `${recorderNameById.get(recorderId) ?? recorderId}: ${count}`)
      .join(', ');
    items.push(`Recorder coverage: ${recorderSummary}.`);
  }

  return items;
}

function summarizeReminders(reminderStates: ReminderStateRow[]) {
  const openStatuses = new Set(['pending', 'active', 'overdue']);
  const openItems = reminderStates.filter((item) => openStatuses.has(item.status));
  if (openItems.length === 0) {
    return ['No pending or overdue reminders are open right now.'];
  }

  return openItems.slice(0, 5).map((item) => {
    const rule = reminderRuleById.get(item.ruleId);
    const title = rule?.title ?? item.ruleId;
    return `${title} (${item.status})`;
  });
}

function buildOverview(
  child: ChildProfile,
  reportType: GrowthReportType,
  periodStart: string,
  periodEnd: string,
  measurements: MeasurementRow[],
  milestones: MilestoneRecordRow[],
  vaccines: VaccineRecordRow[],
  journalEntries: JournalEntryRow[],
  reminderStates: ReminderStateRow[],
) {
  const measurementCount = measurements.filter((item) => inPeriod(item.measuredAt, periodStart, periodEnd)).length;
  const milestoneCount = milestones.filter((item) => inPeriod(item.achievedAt, periodStart, periodEnd)).length;
  const vaccineCount = vaccines.filter((item) => inPeriod(item.vaccinatedAt, periodStart, periodEnd)).length;
  const journalCount = journalEntries.filter((item) => inPeriod(item.recordedAt, periodStart, periodEnd)).length;
  const openReminderCount = reminderStates.filter((item) => ['pending', 'active', 'overdue'].includes(item.status)).length;

  return [
    `${child.displayName}'s ${reportType.replace('-', ' ')} report covers ${formatDate(periodStart)} to ${formatDate(periodEnd)}.`,
    `This window includes ${measurementCount} growth measurements, ${journalCount} journal entries, ${milestoneCount} milestone updates, and ${vaccineCount} vaccine records.`,
    `There are ${openReminderCount} reminder items currently pending, active, or overdue on the timeline.`,
  ];
}

export function buildStructuredGrowthReport(snapshot: StructuredGrowthReportSnapshot): BuiltStructuredGrowthReport {
  const { child, reportType, now, measurements, milestones, vaccines, journalEntries, reminderStates } = snapshot;
  const period = getReportPeriod(reportType, now);
  const ageMonthsStart = computeAgeMonthsAt(child.birthDate, period.start);
  const ageMonthsEnd = computeAgeMonthsAt(child.birthDate, period.end);

  const title = reportType === 'quarterly-letter'
    ? `${child.displayName}'s quarterly letter`
    : `${child.displayName}'s ${reportType.replace('-', ' ')} report`;

  const subtitle = `Structured local facts only. Generated ${formatDate(now)} for ages ${ageMonthsStart}-${ageMonthsEnd} months.`;
  const trendSignals = buildStructuredTrendSignals({
    measurements,
    journalEntries,
    periodStart: period.start,
    periodEnd: period.end,
  });

  const content: StructuredGrowthReportContent = {
    version: 1,
    format: 'structured-local',
    reportType,
    title,
    subtitle,
    generatedAt: now,
    overview: buildOverview(child, reportType, period.start, period.end, measurements, milestones, vaccines, journalEntries, reminderStates),
    metrics: [
      {
        id: 'age-range',
        label: 'Age window',
        value: `${ageMonthsStart}-${ageMonthsEnd} months`,
        detail: `${formatDate(period.start)} to ${formatDate(period.end)}`,
      },
      {
        id: 'measurement-count',
        label: 'Measurements',
        value: String(measurements.filter((item) => inPeriod(item.measuredAt, period.start, period.end)).length),
      },
      {
        id: 'journal-count',
        label: 'Journal entries',
        value: String(journalEntries.filter((item) => inPeriod(item.recordedAt, period.start, period.end)).length),
      },
      {
        id: 'milestone-count',
        label: 'Milestones recorded',
        value: String(milestones.filter((item) => inPeriod(item.achievedAt, period.start, period.end)).length),
      },
      {
        id: 'reminder-count',
        label: 'Open reminders',
        value: String(reminderStates.filter((item) => ['pending', 'active', 'overdue'].includes(item.status)).length),
      },
    ],
    trendSignals,
    sections: [
      { id: 'growth', title: 'Growth records', items: summarizeMeasurements(measurements, period.start, period.end) },
      { id: 'milestones', title: 'Milestones', items: summarizeMilestones(milestones, period.start, period.end) },
      { id: 'vaccines', title: 'Vaccines', items: summarizeVaccines(vaccines, period.start, period.end) },
      { id: 'journal', title: 'Journal coverage', items: summarizeJournalEntries(journalEntries, child, period.start, period.end) },
      { id: 'timeline', title: 'Current follow-ups', items: summarizeReminders(reminderStates) },
    ],
    sources: [
      'Local child profile',
      'Local growth measurements',
      'Local journal entries',
      'Local milestone records + milestone catalog',
      'Local vaccine records',
      'Local reminder states + reminder rules',
    ],
    safetyNote: 'Growth, milestone, vaccine, and observation domains remain structured facts only while they are marked needs-review. This report does not provide diagnosis, ranking, or treatment guidance.',
  };

  return {
    reportType,
    periodStart: period.start,
    periodEnd: period.end,
    ageMonthsStart,
    ageMonthsEnd,
    content,
  };
}

export function parseStructuredGrowthReportContent(raw: string): StructuredGrowthReportContent {
  const parsed = JSON.parse(raw) as Partial<StructuredGrowthReportContent>;
  const reportType = typeof parsed.reportType === 'string' ? parsed.reportType : null;
  if (
    parsed.version !== 1 ||
    parsed.format !== 'structured-local' ||
      !reportType ||
      !GROWTH_REPORT_TYPES.includes(reportType as GrowthReportType) ||
      typeof parsed.title !== 'string' ||
      !Array.isArray(parsed.overview) ||
      !Array.isArray(parsed.metrics) ||
      !Array.isArray(parsed.trendSignals) ||
      !Array.isArray(parsed.sections) ||
      !Array.isArray(parsed.sources) ||
      typeof parsed.safetyNote !== 'string'
  ) {
    throw new Error('Invalid structured growth report payload');
  }

  return {
    version: 1,
    format: 'structured-local',
    reportType,
    title: parsed.title,
    subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : '',
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    overview: parsed.overview.map((item) => truncate(String(item))),
    metrics: parsed.metrics.map((item) => ({
      id: String(item.id),
      label: String(item.label),
      value: String(item.value),
      detail: item.detail == null ? undefined : String(item.detail),
    })),
    trendSignals: parsed.trendSignals.map((signal) => ({
      id: String(signal.id),
      title: String(signal.title),
      summary: truncate(String(signal.summary)),
      evidence: Array.isArray(signal.evidence) ? signal.evidence.map((item) => truncate(String(item))) : [],
      sources: Array.isArray(signal.sources) ? signal.sources.map((item) => String(item)) : [],
    })),
    sections: parsed.sections.map((section) => ({
      id: String(section.id),
      title: String(section.title),
      items: Array.isArray(section.items) ? section.items.map((item) => truncate(String(item))) : [],
    })),
    sources: parsed.sources.map((item) => String(item)),
    safetyNote: parsed.safetyNote,
  };
}
