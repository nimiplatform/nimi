import { computeAgeMonthsAt, type ChildProfile } from '../../app-shell/app-store.js';
import type {
  JournalEntryRow,
  MeasurementRow,
  MilestoneRecordRow,
  ReminderStateRow,
  VaccineRecordRow,
} from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARDS, MILESTONE_CATALOG, REMINDER_RULES } from '../../knowledge-base/index.js';
import { mapReminderStateRow, summarizeReminderProgression } from '../../engine/reminder-engine.js';
import { buildStructuredTrendSignals, type StructuredTrendSignal } from './trend-analysis.js';

export type GrowthReportType = 'monthly' | 'quarterly' | 'quarterly-letter' | 'custom';

const GROWTH_REPORT_TYPES = ['monthly', 'quarterly', 'quarterly-letter', 'custom'] as const satisfies readonly GrowthReportType[];

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

/* ── Narrative report types (v2) ── */

export interface NarrativeSection {
  id: string;
  title: string;
  narrative: string;
  dataPoints?: Array<{ label: string; value: string; detail?: string }>;
}

export interface ActionItem {
  id: string;
  text: string;
  linkTo?: string;
  ruleId?: string;
}

/**
 * Parent-authored note attached to a specific anchor inside the report.
 * Stored inline in the report JSON so notes travel with the report.
 */
export interface UserNote {
  id: string;
  /**
   * Where the note is anchored. Must match a known location key:
   * - 'opening' | 'closingMessage' | 'milestoneReplay'
   * - 'section:<narrativeSection.id>'
   * - 'report' for whole-report notes
   */
  anchor: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One section of the redacted professional (teacher/doctor) summary.
 * `body` is the live text (user-edited overrides AI). `aiOriginal` is the
 * pristine AI-generated version so we can offer a "restore" affordance.
 * `enabled` is the user toggle — only enabled sections are included when
 * the summary is exported/copied.
 */
export interface ProfessionalSummarySection {
  id: string;
  title: string;
  body: string;
  aiOriginal: string;
  enabled: boolean;
}

export interface ProfessionalSummary {
  generatedAt: string;
  format: 'ai' | 'fallback';
  childSummary: string;
  sections: ProfessionalSummarySection[];
  disclaimer: string;
}

export interface NarrativeReportContent {
  version: 2;
  format: 'narrative' | 'narrative-ai';
  reportType: GrowthReportType;
  title: string;
  subtitle: string;
  teaser: string;
  /** 2–6 字的本月主题词，从数据中提炼（例："先行动"、"找到节奏"）。老报告可能没有此字段。 */
  keyword?: string;
  /** 关键词下方的一行副标（6–16 字），对关键词做展开。老报告可能没有此字段。 */
  keywordSub?: string;
  generatedAt: string;
  opening?: string;
  narrativeSections: NarrativeSection[];
  milestoneReplay?: string | null;
  highlights?: string[];
  watchNext?: string[];
  closingMessage?: string;
  actionItems: ActionItem[];
  trendSignals: StructuredTrendSignal[];
  metrics: StructuredGrowthReportMetric[];
  /** Parent-authored notes attached to specific anchors inside this report. */
  userNotes?: UserNote[];
  /** Redacted professional summary for teachers/doctors. */
  professionalSummary?: ProfessionalSummary;
  sources: string[];
  safetyNote: string;
}

export type ParsedReportContent = StructuredGrowthReportContent | NarrativeReportContent;

export interface BuiltStructuredGrowthReport {
  reportType: GrowthReportType;
  periodStart: string;
  periodEnd: string;
  ageMonthsStart: number;
  ageMonthsEnd: number;
  content: StructuredGrowthReportContent | NarrativeReportContent;
}

export interface StructuredGrowthReportSnapshot {
  child: ChildProfile;
  reportType: GrowthReportType;
  now: string;
  periodStart?: string;
  periodEnd?: string;
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
  // PO-REMI-009 progression evidence: cite kind-aware parent engagement, not
  // a flat "pending / active / overdue" count.
  const evidence = summarizeReminderProgression(reminderStates.map(mapReminderStateRow), REMINDER_RULES);

  const engagementParts: string[] = [];
  if (evidence.tasksCompleted > 0) engagementParts.push(`completed ${evidence.tasksCompleted} tasks`);
  if (evidence.guidesAcknowledged > 0) {
    engagementParts.push(
      evidence.guidesReflected > 0
        ? `acknowledged ${evidence.guidesAcknowledged} guides (${evidence.guidesReflected} with reflection)`
        : `acknowledged ${evidence.guidesAcknowledged} guides`,
    );
  }
  if (evidence.practicesInProgress > 0 || evidence.practicesHabituated > 0) {
    const base = evidence.practicesInProgress > 0
      ? `practicing ${evidence.practicesInProgress} behavior guides (${evidence.practiceTotalEvents} engagements logged)`
      : '';
    const hab = evidence.practicesHabituated > 0
      ? `${evidence.practicesHabituated} practice${evidence.practicesHabituated === 1 ? '' : 's'} marked habituated`
      : '';
    if (base) engagementParts.push(base);
    if (hab) engagementParts.push(hab);
  }
  if (evidence.consultsCompleted > 0) engagementParts.push(`consulted the AI advisor on ${evidence.consultsCompleted} topics`);

  const engagementLine = engagementParts.length > 0
    ? `Parent engagement this window: ${engagementParts.join('; ')}.`
    : `No reminder engagement recorded this window.`;

  return [
    `${child.displayName}'s ${reportType.replace('-', ' ')} report covers ${formatDate(periodStart)} to ${formatDate(periodEnd)}.`,
    `This window includes ${measurementCount} growth measurements, ${journalCount} journal entries, ${milestoneCount} milestone updates, and ${vaccineCount} vaccine records.`,
    `${engagementLine} ${evidence.unfinished} reminder items are still open on the timeline.`,
  ];
}

export function buildStructuredGrowthReport(snapshot: StructuredGrowthReportSnapshot): BuiltStructuredGrowthReport {
  const {
    child,
    reportType,
    now,
    periodStart,
    periodEnd,
    measurements,
    milestones,
    vaccines,
    journalEntries,
    reminderStates,
  } = snapshot;
  const period = periodStart && periodEnd
    ? { start: periodStart, end: periodEnd }
    : getReportPeriod(reportType, now);
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

/* ── Action items builder (used by narrative-prompt.ts) ── */

const DOMAIN_ROUTES: Record<string, string> = {
  vaccine: '/profile/vaccines', checkup: '/profile/medical-events', growth: '/profile/growth',
  vision: '/profile/vision', dental: '/profile/dental', sleep: '/profile/sleep',
  'bone-age': '/profile/tanner', sensitivity: '/journal', milestone: '/profile/milestones',
  posture: '/profile/posture', fitness: '/profile/fitness', tanner: '/profile/tanner',
};

export function buildNarrativeActionItems(reminderStates: ReminderStateRow[]): ActionItem[] {
  const openStatuses = new Set(['pending', 'active', 'overdue']);
  return reminderStates
    .filter((s) => openStatuses.has(s.status))
    .map((s) => ({ state: s, rule: reminderRuleById.get(s.ruleId) }))
    .filter((item) => item.rule != null)
    .slice(0, 3)
    .map((item) => {
      const rule = item.rule!;
      const statusLabel = item.state.status === 'overdue' ? '（逾期）' : '';
      const route = DOMAIN_ROUTES[rule.domain] ?? '/profile';
      return {
        id: `action-${item.state.ruleId}`,
        text: `${rule.title}${statusLabel}`,
        linkTo: `/advisor?topic=${encodeURIComponent(rule.title)}&desc=${encodeURIComponent(rule.description)}&record=${encodeURIComponent(route)}`,
        ruleId: item.state.ruleId,
      };
    });
}

/* ── Parsers ── */

function parseNarrativeReportContent(parsed: Record<string, unknown>): NarrativeReportContent {
  const fmt = parsed.format;
  if (parsed.version !== 2 || (fmt !== 'narrative' && fmt !== 'narrative-ai') || typeof parsed.title !== 'string' ||
    !Array.isArray(parsed.narrativeSections) || !Array.isArray(parsed.actionItems) ||
    !Array.isArray(parsed.sources) || typeof parsed.safetyNote !== 'string') {
    throw new Error('Invalid narrative report payload');
  }
  return {
    version: 2, format: fmt as 'narrative' | 'narrative-ai',
    reportType: typeof parsed.reportType === 'string' ? parsed.reportType as GrowthReportType : 'custom',
    title: parsed.title,
    subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : '',
    teaser: typeof parsed.teaser === 'string' ? parsed.teaser : '',
    keyword: typeof parsed.keyword === 'string' ? parsed.keyword : undefined,
    keywordSub: typeof parsed.keywordSub === 'string' ? parsed.keywordSub : undefined,
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    opening: typeof parsed.opening === 'string' ? parsed.opening : undefined,
    milestoneReplay: typeof parsed.milestoneReplay === 'string' ? parsed.milestoneReplay : undefined,
    highlights: Array.isArray(parsed.highlights) ? (parsed.highlights as string[]).map(String) : undefined,
    watchNext: Array.isArray(parsed.watchNext) ? (parsed.watchNext as string[]).map(String) : undefined,
    closingMessage: typeof parsed.closingMessage === 'string' ? parsed.closingMessage : undefined,
    narrativeSections: (parsed.narrativeSections as Array<Record<string, unknown>>).map((s) => ({
      id: String(s.id ?? ''), title: String(s.title ?? ''), narrative: String(s.narrative ?? ''),
      dataPoints: Array.isArray(s.dataPoints) ? (s.dataPoints as Array<Record<string, unknown>>).map((d) => ({
        label: String(d.label ?? ''), value: String(d.value ?? ''), detail: d.detail != null ? String(d.detail) : undefined,
      })) : undefined,
    })),
    actionItems: (parsed.actionItems as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id ?? ''), text: String(a.text ?? ''),
      linkTo: typeof a.linkTo === 'string' ? a.linkTo : undefined,
      ruleId: typeof a.ruleId === 'string' ? a.ruleId : undefined,
    })),
    trendSignals: Array.isArray(parsed.trendSignals)
      ? (parsed.trendSignals as Array<Record<string, unknown>>).map((s) => ({
        id: String(s.id ?? ''), title: String(s.title ?? ''), summary: truncate(String(s.summary ?? '')),
        evidence: Array.isArray(s.evidence) ? (s.evidence as string[]).map((e) => truncate(String(e))) : [],
        sources: Array.isArray(s.sources) ? (s.sources as string[]).map((e) => String(e)) : [],
      })) : [],
    metrics: Array.isArray(parsed.metrics)
      ? (parsed.metrics as Array<Record<string, unknown>>).map((m) => ({
        id: String(m.id ?? ''), label: String(m.label ?? ''), value: String(m.value ?? ''),
        detail: m.detail != null ? String(m.detail) : undefined,
      })) : [],
    userNotes: parseUserNotes(parsed.userNotes),
    professionalSummary: parseProfessionalSummary(parsed.professionalSummary),
    sources: (parsed.sources as string[]).map((s) => String(s)),
    safetyNote: parsed.safetyNote as string,
  };
}

function parseUserNotes(raw: unknown): UserNote[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const notes: UserNote[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (typeof entry?.id !== 'string' || typeof entry?.anchor !== 'string' || typeof entry?.text !== 'string') continue;
    notes.push({
      id: entry.id,
      anchor: entry.anchor,
      text: entry.text,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
    });
  }
  return notes.length > 0 ? notes : undefined;
}

function parseProfessionalSummary(raw: unknown): ProfessionalSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.sections)) return undefined;
  const sections: ProfessionalSummarySection[] = [];
  for (const entry of data.sections as Array<Record<string, unknown>>) {
    if (typeof entry?.id !== 'string' || typeof entry?.title !== 'string' || typeof entry?.body !== 'string') continue;
    sections.push({
      id: entry.id,
      title: entry.title,
      body: entry.body,
      aiOriginal: typeof entry.aiOriginal === 'string' ? entry.aiOriginal : entry.body,
      enabled: entry.enabled !== false,
    });
  }
  if (sections.length === 0) return undefined;
  return {
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : '',
    format: data.format === 'fallback' ? 'fallback' : 'ai',
    childSummary: typeof data.childSummary === 'string' ? data.childSummary : '',
    sections,
    disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : '本概要由家长基于本地记录整理，仅供老师/医生参考，不含诊断意见。',
  };
}

export function parseReportContent(raw: string): ParsedReportContent {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.version === 2) return parseNarrativeReportContent(parsed);
  return parseStructuredGrowthReportContent(raw);
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
