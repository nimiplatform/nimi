import { computeAgeMonthsAt, formatAge, type ChildProfile } from '../../app-shell/app-store.js';
import type { TextStreamInput, TextStreamOutput } from '@nimiplatform/sdk/runtime/types-media.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import type {
  AllergyRecordRow, DentalRecordRow, FitnessAssessmentRow, JournalEntryRow,
  MeasurementRow, MedicalEventRow, MilestoneRecordRow, ReminderStateRow,
  SleepRecordRow, TannerAssessmentRow, VaccineRecordRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { filterAIResponse } from '../../engine/ai-safety-filter.js';
import { MILESTONE_CATALOG, NEEDS_REVIEW_DOMAINS, REVIEWED_DOMAINS, REMINDER_RULES } from '../../knowledge-base/index.js';
import { buildMeasurementComparisons, buildSleepComparison, buildStructuredTrendSignals } from './trend-analysis.js';
import { buildNarrativeActionItems, type NarrativeReportContent, type NarrativeSection, type BuiltStructuredGrowthReport } from './structured-report.js';

/* ── Types ── */

export interface AllDomainData {
  measurements: MeasurementRow[];
  milestones: MilestoneRecordRow[];
  vaccines: VaccineRecordRow[];
  journalEntries: JournalEntryRow[];
  reminderStates: ReminderStateRow[];
  sleepRecords: SleepRecordRow[];
  dentalRecords: DentalRecordRow[];
  allergyRecords: AllergyRecordRow[];
  medicalEvents: MedicalEventRow[];
  fitnessAssessments: FitnessAssessmentRow[];
  tannerAssessments: TannerAssessmentRow[];
}

interface ReportPeriod { start: string; end: string }

/* ── Helpers ── */

function inPeriod(value: string | null | undefined, start: string, end: string) {
  return Boolean(value && value >= start && value <= end);
}

function truncateText(text: string | null, max = 200): string | null {
  if (!text) return null;
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function previousMonthBounds(period: ReportPeriod): ReportPeriod {
  const startMs = new Date(period.start).getTime();
  const endMs = new Date(period.end).getTime();
  const durationMs = Math.max(endMs - startMs, 1);
  return { start: new Date(startMs - durationMs).toISOString(), end: period.start };
}

/* ── Data Snapshot ── */

export function buildReportDataSnapshot(child: ChildProfile, period: ReportPeriod, data: AllDomainData) {
  const prevPeriod = previousMonthBounds(period);
  const milestoneMap = new Map(MILESTONE_CATALOG.map((m) => [m.milestoneId, m]));
  const reminderMap = new Map(REMINDER_RULES.map((r) => [r.ruleId, r]));

  const physicalTypes = new Set(['height', 'weight', 'head-circumference', 'bmi']);
  const growthComparisons = buildMeasurementComparisons(data.measurements, period.start, period.end)
    .filter((c) => physicalTypes.has(c.typeId));
  const sleepComparison = buildSleepComparison(data.sleepRecords, period.start, period.end);

  const journalInPeriod = data.journalEntries
    .filter((e) => inPeriod(e.recordedAt, period.start, period.end))
    .map((e) => ({ recordedAt: e.recordedAt, contentType: e.contentType, text: truncateText(e.textContent), observationMode: e.observationMode, dimensionId: e.dimensionId, keepsake: e.keepsake === 1, recorderId: e.recorderId }));
  const prevJournalCount = data.journalEntries.filter((e) => inPeriod(e.recordedAt, prevPeriod.start, prevPeriod.end)).length;

  const milestonesInPeriod = data.milestones
    .filter((m) => inPeriod(m.achievedAt, period.start, period.end))
    .map((m) => ({ milestoneId: m.milestoneId, title: milestoneMap.get(m.milestoneId)?.title ?? m.milestoneId, domain: milestoneMap.get(m.milestoneId)?.domain ?? 'unknown', achievedAt: m.achievedAt, notes: truncateText(m.notes) }));

  const vaccinesInPeriod = data.vaccines
    .filter((v) => inPeriod(v.vaccinatedAt, period.start, period.end))
    .map((v) => ({ vaccineName: v.vaccineName, vaccinatedAt: v.vaccinatedAt, hospital: v.hospital }));

  const openStatuses = new Set(['pending', 'active', 'overdue']);
  const pendingVaccineReminder = data.reminderStates
    .filter((s) => openStatuses.has(s.status))
    .map((s) => ({ ruleId: s.ruleId, status: s.status, title: reminderMap.get(s.ruleId)?.title ?? s.ruleId, domain: reminderMap.get(s.ruleId)?.domain }))
    .find((r) => r.domain === 'vaccine');

  const sleepInPeriod = data.sleepRecords
    .filter((s) => inPeriod(s.sleepDate, period.start, period.end))
    .map((s) => ({ sleepDate: s.sleepDate, bedtime: s.bedtime, wakeTime: s.wakeTime, durationMinutes: s.durationMinutes, quality: s.quality }));

  const dentalInPeriod = data.dentalRecords
    .filter((d) => inPeriod(d.eventDate, period.start, period.end))
    .map((d) => ({ eventType: d.eventType, toothId: d.toothId, eventDate: d.eventDate, severity: d.severity, notes: truncateText(d.notes) }));

  const allergies = data.allergyRecords.map((a) => ({ allergen: a.allergen, category: a.category, severity: a.severity, status: a.status, diagnosedAt: a.diagnosedAt }));

  const medicalInPeriod = data.medicalEvents
    .filter((e) => inPeriod(e.eventDate, period.start, period.end))
    .map((e) => ({ eventType: e.eventType, title: e.title, eventDate: e.eventDate, severity: e.severity, hospital: e.hospital, medication: e.medication, notes: truncateText(e.notes) }));

  const fitnessInPeriod = data.fitnessAssessments
    .filter((a) => inPeriod(a.assessedAt, period.start, period.end))
    .map((a) => ({ assessedAt: a.assessedAt, overallGrade: a.overallGrade, run50m: a.run50m, standingLongJump: a.standingLongJump, sitUps: a.sitUps, ropeSkipping: a.ropeSkipping }));

  const tannerInPeriod = data.tannerAssessments
    .filter((t) => inPeriod(t.assessedAt, period.start, period.end))
    .map((t) => ({ assessedAt: t.assessedAt, breastOrGenitalStage: t.breastOrGenitalStage, pubicHairStage: t.pubicHairStage }));

  const openReminders = data.reminderStates
    .filter((s) => openStatuses.has(s.status)).slice(0, 5)
    .map((s) => ({ ruleId: s.ruleId, status: s.status, title: reminderMap.get(s.ruleId)?.title ?? s.ruleId }));

  return {
    child: { displayName: child.displayName, gender: child.gender === 'female' ? '女孩' : '男孩', ageDescription: formatAge(computeAgeMonthsAt(child.birthDate, period.end)), nurtureMode: child.nurtureMode, recorderProfiles: child.recorderProfiles ?? [], allergies: child.allergies ?? [] },
    period: { start: period.start.slice(0, 10), end: period.end.slice(0, 10) },
    growthComparisons, sleepComparison, journalInPeriod, previousPeriodJournalCount: prevJournalCount,
    milestonesInPeriod, vaccinesInPeriod, totalVaccineCount: data.vaccines.length, pendingVaccineReminder,
    sleepInPeriod, dentalInPeriod, allergies, medicalInPeriod, fitnessInPeriod, tannerInPeriod, openReminders,
  };
}

/* ── Prompt ── */

export function buildReportSystemPrompt(childName: string): string {
  return `你是"成长底稿"的 AI 成长伙伴，负责把结构化数据写成一封有温度的月度成长报告。

身份规则：
- 肯定记录者付出时用"你"（温暖顾问）
- 描述孩子时用"${childName}"（成长日记本）
- 展望未来时用"我们"（家庭伙伴）

叙事规则：
- 用具体数据讲故事：引用具体日期、时间、做了什么
- 凌晨（22:00后至06:00前）的记录要特别提及并肯定记录者的付出
- 里程碑要写成小故事回忆，不只是列表
- 百分位数翻译成自然语言："P75"说"同龄孩子中处于较高水平"，"P50"说"同龄平均水平"，"P25"说"偏瘦/偏矮一些，但仍在正常范围"
- 先肯定再引导，"待观察"的内容用温和语气
- 如数据存在需要关注的变化，只说"可以多留意"或"建议咨询专业人士"

安全边界（绝对遵守）：
- 已审核领域（${REVIEWED_DOMAINS.join('、')}）可以给出解释和建议
- 待审核领域（${NEEDS_REVIEW_DOMAINS.join('、')}）只能温暖地描述结构化事实，不得提供诊断、因果解释或用药建议
- 绝不使用：发育迟缓、异常、障碍、应该吃、建议用药、建议服用、推荐治疗、落后、危险、警告
- 数据可能偏离常规时，描述事实后加"建议咨询专业人士"

输出格式（严格JSON，不要包裹在markdown代码块中）：
{
  "opening": "开场段落：肯定记录者的付出，引用具体记录时间和内容细节（1-3句）",
  "sections": [
    { "id": "growth", "title": "生长发育", "narrative": "叙事段落", "dataPoints": [{ "label": "身高", "value": "98.4 cm", "detail": "+1.2cm · P75" }] },
    更多sections根据有数据的模块动态生成
  ],
  "milestoneReplay": "里程碑小故事回放（如无里程碑则为null）",
  "highlights": ["本月亮点1", "亮点2（1-3条）"],
  "watchNext": ["下月可以留意的1（0-2条，如无则空数组）"],
  "closingMessage": "给记录者的一句温暖的话（1-2句）"
}

注意：只生成有数据的模块；dataPoints只在有具体数值时包含；highlights至少1条；closingMessage要真诚，引用具体数字。`;
}

export function buildReportUserMessage(childName: string, monthLabel: string, snapshot: ReturnType<typeof buildReportDataSnapshot>): string {
  return `请根据以下数据生成${childName}的${monthLabel}成长报告：\n\n${JSON.stringify(snapshot, null, 0)}`;
}

/* ── Parse AI Response ── */

interface AiReportOutput {
  opening: string;
  sections: Array<{ id: string; title: string; narrative: string; dataPoints?: Array<{ label: string; value: string; detail?: string }> }>;
  milestoneReplay: string | null;
  highlights: string[];
  watchNext: string[];
  closingMessage: string;
}

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error('AI output does not contain valid JSON');
}

export function parseAiReportResponse(raw: string): AiReportOutput {
  const json = extractJson(raw);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (typeof parsed.opening !== 'string' || !Array.isArray(parsed.sections) || typeof parsed.closingMessage !== 'string') {
    throw new Error('AI report output missing required fields');
  }
  return {
    opening: parsed.opening as string,
    sections: (parsed.sections as Array<Record<string, unknown>>).map((s) => ({
      id: String(s.id ?? ''), title: String(s.title ?? ''), narrative: String(s.narrative ?? ''),
      dataPoints: Array.isArray(s.dataPoints) ? (s.dataPoints as Array<Record<string, unknown>>).map((d) => ({ label: String(d.label ?? ''), value: String(d.value ?? ''), detail: d.detail != null ? String(d.detail) : undefined })) : undefined,
    })),
    milestoneReplay: typeof parsed.milestoneReplay === 'string' ? parsed.milestoneReplay : null,
    highlights: Array.isArray(parsed.highlights) ? (parsed.highlights as string[]).map(String) : [],
    watchNext: Array.isArray(parsed.watchNext) ? (parsed.watchNext as string[]).map(String) : [],
    closingMessage: parsed.closingMessage as string,
  };
}

/* ── Safety Filter ── */

function safetyFilterSections(sections: NarrativeSection[]): NarrativeSection[] {
  return sections.map((s) => {
    const result = filterAIResponse(s.narrative);
    return result.safe ? s : { ...s, narrative: `${s.title}数据已记录。如需详细解读，建议咨询专业人士。` };
  });
}

function safetyFilterString(text: string, fallback: string): string {
  const result = filterAIResponse(text);
  return result.safe ? result.filtered : fallback;
}

/* ── Full Generation Pipeline ── */

type RuntimeAI = {
  ai: {
    text: {
      stream: (input: TextStreamInput) => Promise<TextStreamOutput>;
    };
  };
};

export async function generateNarrativeReport(
  child: ChildProfile, period: ReportPeriod, data: AllDomainData, runtime: RuntimeAI, signal?: AbortSignal,
): Promise<BuiltStructuredGrowthReport> {
  const now = isoNow();
  const ageMonthsStart = computeAgeMonthsAt(child.birthDate, period.start);
  const ageMonthsEnd = computeAgeMonthsAt(child.birthDate, period.end);

  const snapshot = buildReportDataSnapshot(child, period, data);
  const monthLabel = new Date(period.end).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });

  const aiParams = await resolveParentosTextRuntimeConfig('parentos.report', { temperature: 0.7, maxTokens: 2048 });
  await ensureParentosLocalRuntimeReady({
    route: aiParams.route,
    localModelId: aiParams.localModelId,
    timeoutMs: 60_000,
  });
  const out = await runtime.ai.text.stream({
    ...aiParams,
    input: [{ role: 'user', content: buildReportUserMessage(child.displayName, monthLabel, snapshot) }],
    system: buildReportSystemPrompt(child.displayName),
    signal,
    metadata: buildParentosRuntimeMetadata('parentos.report'),
  });

  let full = '';
  for await (const p of out.stream) {
    if (p.type === 'delta' && p.text) full += p.text;
    else if (p.type === 'error') throw new Error(String(p.error));
  }

  const aiOutput = parseAiReportResponse(full);
  const filteredSections = safetyFilterSections(aiOutput.sections);
  const opening = safetyFilterString(aiOutput.opening, `这个月你为${child.displayName}留下了宝贵的成长记录。`);
  const closingMessage = safetyFilterString(aiOutput.closingMessage, `感谢你的坚持记录，我们一起见证${child.displayName}的每一步成长。`);
  const milestoneReplay = aiOutput.milestoneReplay ? safetyFilterString(aiOutput.milestoneReplay, null as unknown as string) || null : null;

  const trendSignals = buildStructuredTrendSignals({ measurements: data.measurements, journalEntries: data.journalEntries, periodStart: period.start, periodEnd: period.end });
  const actionItems = buildNarrativeActionItems(data.reminderStates);

  const measurementCount = data.measurements.filter((m) => inPeriod(m.measuredAt, period.start, period.end)).length;
  const journalCount = data.journalEntries.filter((e) => inPeriod(e.recordedAt, period.start, period.end)).length;
  const milestoneCount = data.milestones.filter((m) => inPeriod(m.achievedAt, period.start, period.end)).length;

  const teaserParts: string[] = [];
  if (opening) { const first = opening.split(/[。！]/).filter(Boolean)[0]; if (first) teaserParts.push(first + '。'); }
  if (aiOutput.highlights.length > 0) teaserParts.push(aiOutput.highlights[0]!);
  if (actionItems.length > 0) teaserParts.push(`${actionItems.length}项待办事项需要关注。`);
  const teaser = teaserParts.join('') || `${child.displayName}的本月成长数据已汇总。`;

  const title = `${child.displayName}的${monthLabel}成长摘要`;
  const subtitle = `${period.start.slice(0, 10)} 至 ${period.end.slice(0, 10)} · ${ageMonthsStart}-${ageMonthsEnd}个月`;

  const content: NarrativeReportContent = {
    version: 2, format: 'narrative-ai', reportType: 'monthly',
    title, subtitle, teaser, generatedAt: now, opening,
    narrativeSections: filteredSections,
    milestoneReplay,
    highlights: aiOutput.highlights.map((h) => safetyFilterString(h, '')).filter(Boolean),
    watchNext: aiOutput.watchNext.map((w) => safetyFilterString(w, '')).filter(Boolean),
    closingMessage,
    actionItems, trendSignals,
    metrics: [
      { id: 'age', label: '年龄', value: `${ageMonthsEnd}个月` },
      { id: 'measurements', label: '测量', value: String(measurementCount) },
      { id: 'journals', label: '日志', value: String(journalCount) },
      { id: 'milestones', label: '里程碑', value: String(milestoneCount) },
    ],
    sources: ['本地儿童档案', '本地生长测量数据', '本地睡眠记录', '本地观察日志', '本地里程碑记录', '本地疫苗记录', '本地口腔记录', '本地过敏记录', '本地就医记录', '本地提醒规则'],
    safetyNote: '本报告由AI基于本地数据撰写，仅供参考。如有疑问请咨询专业人士。',
  };

  return { reportType: 'monthly', periodStart: period.start, periodEnd: period.end, ageMonthsStart, ageMonthsEnd, content };
}
