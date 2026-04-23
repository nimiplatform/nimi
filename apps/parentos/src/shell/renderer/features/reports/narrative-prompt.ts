import { computeAgeMonthsAt, formatAge, type ChildProfile } from '../../app-shell/app-store.js';
import type { TextStreamInput, TextStreamOutput } from '@nimiplatform/sdk/runtime/types-media.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
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
import {
  buildNarrativeActionItems,
  type BuiltStructuredGrowthReport,
  type GrowthReportType,
  type NarrativeReportContent,
  type NarrativeSection,
} from './structured-report.js';

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

function buildReportLabel(reportType: GrowthReportType, period: ReportPeriod) {
  if (reportType === 'monthly') {
    return new Date(period.end).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  }
  if (reportType === 'quarterly' || reportType === 'quarterly-letter') {
    const date = new Date(period.end);
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    return `${date.getFullYear()}年Q${quarter}`;
  }
  return `${period.start.slice(0, 10)} 至 ${period.end.slice(0, 10)}`;
}

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
  return `你是"成长底稿"的 AI 成长伙伴，负责把结构化数据写成一篇关于 ${childName} 本月的成长记。

主角规则（最重要）：
- 报告的主角是 ${childName}，所有段落都在讲 ${childName} 这个月的成长故事
- 这不是写给父母/记录者的感谢信，也不是家书。不要出现"亲爱的妈妈""感谢你""你辛苦了""你记录了"这类面向记录者的称呼或感谢语
- 第一人称/第二人称一律避免。描述孩子时直接使用 ${childName} 或"她/他"
- 展望未来时不用"我们"，改用"${childName} 下个月可以…"或中性描述
- 记录者、家长、妈妈、爸爸只在客观需要说明数据来源或建议"家人可以…"时才出现，且不抒情

叙事规则：
- 用具体数据讲 ${childName} 的故事：引用具体日期、时间、${childName} 做了什么、测到了什么
- 里程碑写成 ${childName} 的小故事瞬间，不只是列表
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
  "keyword": "本月关键词（2-6个汉字，必须是描述 ${childName} 这个月状态/行为的【动词短语、形容词短语、或一句动作式短句】，要有动感和变化感。绝对不能是名词或领域词。好例：先行动、找到节奏、敢开口了、慢下来、越写越稳、开始专注、主动靠近、学会等待、自己睡着、爱上读书、把事做完、更敢说了、自律初现、第一次独立。坏例（不要用）：学习、健康、成长、作息、数学、编程、里程碑、Snow、本月、这个月、进步、发育。）",
  "keywordSub": "关键词副标（6-16字，对 keyword 做一句具体展开，用动词/描述式语言，引用本月一个具体场景；主语仍是 ${childName} 或省略；不要称呼记录者。好例：在数学课主动举手了三次、晨起节奏趋于稳定、夜里十点前就肯合眼）",
  "opening": "开场：用一两句话点出 ${childName} 本月的主题或最显著的变化，引用具体细节（1-3句，不要称呼记录者，不要感谢语）",
  "sections": [
    { "id": "growth", "title": "生长发育", "narrative": "讲 ${childName} 在这个领域本月的故事", "dataPoints": [{ "label": "身高", "value": "98.4 cm", "detail": "+1.2cm · P75" }] },
    更多sections根据有数据的模块动态生成
  ],
  "milestoneReplay": "${childName} 本月里程碑时刻的小故事回放（如无里程碑则为null）",
  "highlights": ["${childName} 本月亮点1", "亮点2（1-3条，主语是 ${childName}）"],
  "watchNext": ["${childName} 下月可以留意的1（0-2条，如无则空数组）"],
  "closingMessage": "对 ${childName} 本月的一句总结（1-2句，主语仍是 ${childName}，不要对记录者说话）",
  "professionalSummary": {
    "childSummary": "一句话基本信息行：${childName}，年龄，性别，记录周期（例：${childName}，9岁5个月，女，2026-04-01 至 2026-04-30）",
    "sections": [
      { "id": "growth",      "title": "生长发育测量", "body": "客观描述本期身高/体重/BMI/头围的测量值、百分位、与上一次测量的对比；引用具体测量日期；无数据时写「本期未记录」" },
      { "id": "health",      "title": "健康事件",     "body": "本期就医、过敏、口腔、皮肤等客观记录的摘要，含日期、事件类型、严重程度；无数据写「本期未记录」" },
      { "id": "vaccine",     "title": "疫苗接种",     "body": "本期新增的疫苗记录，含疫苗名称、接种日期；如有累计总数可一并说明；无数据写「本期未记录」" },
      { "id": "sleep",       "title": "睡眠与作息",   "body": "本期平均就寝/起床时间、平均睡眠时长、与上一周期的分钟级差值；无数据写「本期未记录」" },
      { "id": "milestones",  "title": "发育里程碑",   "body": "本期达成的里程碑列表，含领域分类与达成日期；无数据写「本期未记录」" },
      { "id": "fitness",     "title": "体能评估",     "body": "fitnessAssessments 的测试项与评级；无数据写「本期未记录」" },
      { "id": "observation", "title": "一般观察",     "body": "学习/社交/自理能力的【客观】摘要；去除家庭互动细节、情感描述、私密场景；只保留与教学或医疗相关的可观察行为" }
    ],
    "disclaimer": "本概要由家长基于本地记录整理，仅供老师/医生参考，不含诊断意见。如有疑问建议进一步评估。"
  }
}

professionalSummary 专项规则（必须严格遵守）：
- 语气：客观、医学/教育记录式、第三人称；不得使用"亲爱的""感谢""你辛苦了"等面向家长的词
- 不得出现：家庭成员互动细节、情感描述（开心/伤心/生气等主观情绪词）、私密场景、家人姓名昵称
- 每个 section.body 必须独立可读；无数据时直接填写"本期未记录"
- 引用的数值、日期必须与 sections（叙事版）中的数据一致，不得编造
- childSummary 必须是单行、不含换行、不含情感词

注意：只生成有数据的模块；dataPoints只在有具体数值时包含；highlights至少1条；closingMessage要真诚，引用具体数字，主语始终是 ${childName}。`;
}

export function buildReportUserMessage(childName: string, monthLabel: string, snapshot: ReturnType<typeof buildReportDataSnapshot>): string {
  return `请根据以下数据生成${childName}的${monthLabel}成长报告：\n\n${JSON.stringify(snapshot, null, 0)}`;
}

/* ── Parse AI Response ── */

interface AiProfessionalSection {
  id: string;
  title: string;
  body: string;
}
interface AiProfessionalSummary {
  childSummary: string;
  sections: AiProfessionalSection[];
  disclaimer: string;
}

interface AiReportOutput {
  keyword: string | null;
  keywordSub: string | null;
  opening: string;
  sections: Array<{ id: string; title: string; narrative: string; dataPoints?: Array<{ label: string; value: string; detail?: string }> }>;
  milestoneReplay: string | null;
  highlights: string[];
  watchNext: string[];
  closingMessage: string;
  professionalSummary: AiProfessionalSummary | null;
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
    keyword: typeof parsed.keyword === 'string' && parsed.keyword.trim() ? parsed.keyword.trim() : null,
    keywordSub: typeof parsed.keywordSub === 'string' && parsed.keywordSub.trim() ? parsed.keywordSub.trim() : null,
    opening: parsed.opening as string,
    sections: (parsed.sections as Array<Record<string, unknown>>).map((s) => ({
      id: String(s.id ?? ''), title: String(s.title ?? ''), narrative: String(s.narrative ?? ''),
      dataPoints: Array.isArray(s.dataPoints) ? (s.dataPoints as Array<Record<string, unknown>>).map((d) => ({ label: String(d.label ?? ''), value: String(d.value ?? ''), detail: d.detail != null ? String(d.detail) : undefined })) : undefined,
    })),
    milestoneReplay: typeof parsed.milestoneReplay === 'string' ? parsed.milestoneReplay : null,
    highlights: Array.isArray(parsed.highlights) ? (parsed.highlights as string[]).map(String) : [],
    watchNext: Array.isArray(parsed.watchNext) ? (parsed.watchNext as string[]).map(String) : [],
    closingMessage: parsed.closingMessage as string,
    professionalSummary: parseAiProfessionalSummary(parsed.professionalSummary),
  };
}

function parseAiProfessionalSummary(raw: unknown): AiProfessionalSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.sections)) return null;
  const sections: AiProfessionalSection[] = [];
  for (const entry of data.sections as Array<Record<string, unknown>>) {
    if (typeof entry?.id !== 'string' || typeof entry?.title !== 'string' || typeof entry?.body !== 'string') continue;
    sections.push({ id: entry.id, title: entry.title, body: entry.body });
  }
  if (sections.length === 0) return null;
  return {
    childSummary: typeof data.childSummary === 'string' ? data.childSummary : '',
    sections,
    disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : '本概要由家长基于本地记录整理，仅供老师/医生参考，不含诊断意见。',
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

/* ── Professional summary (redacted, for teachers/doctors) ── */

function genderLabel(gender: ChildProfile['gender']): string {
  return gender === 'female' ? '女' : gender === 'male' ? '男' : '未标注';
}

function buildChildSummaryLine(child: ChildProfile, period: ReportPeriod, ageMonthsEnd: number): string {
  const age = `${Math.floor(ageMonthsEnd / 12)}岁${ageMonthsEnd % 12}个月`;
  return `${child.displayName}，${age}，${genderLabel(child.gender)}，${period.start.slice(0, 10)} 至 ${period.end.slice(0, 10)}`;
}

/** Canonical ordering + titles for professional sections. Used to normalize
 * AI output and to build the fallback. */
const PROFESSIONAL_SECTION_CATALOG: Array<{ id: string; title: string }> = [
  { id: 'growth',      title: '生长发育测量' },
  { id: 'health',      title: '健康事件' },
  { id: 'vaccine',     title: '疫苗接种' },
  { id: 'sleep',       title: '睡眠与作息' },
  { id: 'milestones',  title: '发育里程碑' },
  { id: 'fitness',     title: '体能评估' },
  { id: 'observation', title: '一般观察' },
];

interface ProfessionalBuildContext {
  child: ChildProfile;
  period: ReportPeriod;
  data: AllDomainData;
  ageMonthsEnd: number;
  now: string;
}

function buildProfessionalSummaryFromAi(
  ai: AiProfessionalSummary | null,
  ctx: ProfessionalBuildContext,
): NarrativeReportContent['professionalSummary'] {
  const childSummary = (ai?.childSummary && ai.childSummary.trim())
    || buildChildSummaryLine(ctx.child, ctx.period, ctx.ageMonthsEnd);

  const byId = new Map<string, AiProfessionalSection>();
  for (const s of ai?.sections ?? []) byId.set(s.id, s);

  const fallback = buildProfessionalSummaryFromData(ctx);
  const fallbackById = new Map(fallback.sections.map((s) => [s.id, s]));

  const sections = PROFESSIONAL_SECTION_CATALOG.map(({ id, title }) => {
    const aiSection = byId.get(id);
    const fb = fallbackById.get(id);
    const rawBody = aiSection?.body && aiSection.body.trim()
      ? aiSection.body.trim()
      : (fb?.body ?? '本期未记录。');
    const body = safetyFilterString(rawBody, fb?.body ?? '本期未记录。');
    return {
      id,
      title: aiSection?.title?.trim() || title,
      body,
      aiOriginal: body,
      enabled: true,
    };
  });

  return {
    generatedAt: ctx.now,
    format: ai ? 'ai' : 'fallback',
    childSummary,
    sections,
    disclaimer: ai?.disclaimer?.trim() || '本概要由家长基于本地记录整理，仅供老师/医生参考，不含诊断意见。如有疑问建议进一步评估。',
  };
}

/** Build a professional summary purely from the snapshot data when no AI is
 * available. Prose is intentionally minimal and factual. */
export function buildProfessionalSummaryFromData(
  ctx: ProfessionalBuildContext,
): NonNullable<NarrativeReportContent['professionalSummary']> {
  const snapshot = buildReportDataSnapshot(ctx.child, ctx.period, ctx.data);
  const sections = PROFESSIONAL_SECTION_CATALOG.map(({ id, title }) => {
    const body = buildFallbackProfessionalBody(id, snapshot);
    return { id, title, body, aiOriginal: body, enabled: true };
  });
  return {
    generatedAt: ctx.now,
    format: 'fallback',
    childSummary: buildChildSummaryLine(ctx.child, ctx.period, ctx.ageMonthsEnd),
    sections,
    disclaimer: '本概要由家长基于本地记录整理，仅供老师/医生参考，不含诊断意见。如有疑问建议进一步评估。',
  };
}

type Snapshot = ReturnType<typeof buildReportDataSnapshot>;

function buildFallbackProfessionalBody(id: string, snap: Snapshot): string {
  switch (id) {
    case 'growth': {
      if (snap.growthComparisons.length === 0) return '本期未记录生长测量数据。';
      return snap.growthComparisons.map((c) => {
        const delta = c.delta != null ? `（较上次 ${c.delta >= 0 ? '+' : ''}${c.delta}${c.unit ?? ''}）` : '';
        const pct = c.currentPercentile != null ? ` · P${c.currentPercentile}` : '';
        return `${c.label}：${c.currentValue}${c.unit ?? ''}${pct}，测量于 ${c.currentDate.slice(0, 10)}${delta}`;
      }).join('；') + '。';
    }
    case 'health': {
      const items = snap.medicalInPeriod.concat(snap.dentalInPeriod.map((d) => ({
        eventType: d.eventType ?? '口腔记录', title: d.eventType ?? '口腔记录', eventDate: d.eventDate,
        severity: d.severity ?? null, hospital: null, medication: null, notes: d.notes,
      })));
      if (items.length === 0) return '本期未记录健康事件。';
      return items.map((m) => {
        const date = (m.eventDate ?? '').slice(0, 10);
        const sev = m.severity ? ` · ${m.severity}` : '';
        return `${date}：${m.title ?? m.eventType ?? '健康事件'}${sev}`;
      }).join('；') + '。';
    }
    case 'vaccine': {
      if (snap.vaccinesInPeriod.length === 0) {
        return `本期未新增疫苗记录（累计 ${snap.totalVaccineCount} 条）。`;
      }
      return snap.vaccinesInPeriod.map((v) => {
        return `${(v.vaccinatedAt ?? '').slice(0, 10)}：${v.vaccineName}${v.hospital ? ` · ${v.hospital}` : ''}`;
      }).join('；') + `。累计 ${snap.totalVaccineCount} 条。`;
    }
    case 'sleep': {
      const { currentAvgBedtime, currentAvgDuration, previousAvgBedtime, previousAvgDuration, currentCount, bedtimeDeltaMinutes, durationDeltaMinutes } = snap.sleepComparison;
      if (currentCount === 0) return '本期未记录睡眠数据。';
      const parts: string[] = [];
      if (currentAvgBedtime) {
        const delta = bedtimeDeltaMinutes != null ? `（较上期 ${bedtimeDeltaMinutes >= 0 ? '+' : ''}${bedtimeDeltaMinutes} 分钟）` : '';
        parts.push(`平均就寝 ${currentAvgBedtime}${delta}`);
      }
      if (currentAvgDuration != null) {
        const delta = durationDeltaMinutes != null ? `（较上期 ${durationDeltaMinutes >= 0 ? '+' : ''}${durationDeltaMinutes} 分钟）` : '';
        parts.push(`平均睡眠 ${currentAvgDuration} 分钟${delta}`);
      }
      if (previousAvgBedtime || previousAvgDuration != null) {
        parts.push(`记录 ${currentCount} 条`);
      }
      return parts.length > 0 ? parts.join('；') + '。' : '本期有睡眠记录但数据不足以汇总。';
    }
    case 'milestones': {
      if (snap.milestonesInPeriod.length === 0) return '本期未记录新达成的里程碑。';
      return snap.milestonesInPeriod.map((m) => {
        const date = (m.achievedAt ?? '').slice(0, 10);
        return `${date}：${m.title}（${m.domain}）`;
      }).join('；') + '。';
    }
    case 'fitness': {
      if (snap.fitnessInPeriod.length === 0) return '本期未记录体能评估。';
      return snap.fitnessInPeriod.map((f) => {
        const bits: string[] = [];
        if (f.overallGrade) bits.push(`综合评级 ${f.overallGrade}`);
        if (f.run50m != null) bits.push(`50米 ${f.run50m}s`);
        if (f.standingLongJump != null) bits.push(`立定跳远 ${f.standingLongJump}cm`);
        if (f.sitUps != null) bits.push(`仰卧起坐 ${f.sitUps}`);
        if (f.ropeSkipping != null) bits.push(`跳绳 ${f.ropeSkipping}/min`);
        const date = (f.assessedAt ?? '').slice(0, 10);
        return `${date}：${bits.join('；') || '评估已记录'}`;
      }).join('；') + '。';
    }
    case 'observation': {
      const count = snap.journalInPeriod.length;
      if (count === 0) return '本期未累计可共享的一般性观察。';
      const prev = snap.previousPeriodJournalCount;
      const delta = prev > 0 ? `（上期 ${prev} 条）` : '';
      return `本期累计 ${count} 条观察记录${delta}。具体个人化内容未导出至本版本。`;
    }
    default:
      return '本期未记录。';
  }
}

/* ── Full Generation Pipeline ── */

type RuntimeAI = {
  ai: {
    text: {
      stream: (input: TextStreamInput) => Promise<TextStreamOutput>;
    };
  };
};

export async function generateNarrativeReportForPeriod(input: {
  child: ChildProfile;
  period: ReportPeriod;
  data: AllDomainData;
  runtime: RuntimeAI;
  reportType: GrowthReportType;
  signal?: AbortSignal;
}): Promise<BuiltStructuredGrowthReport> {
  const { child, period, data, runtime, reportType, signal } = input;
  const now = isoNow();
  const ageMonthsStart = computeAgeMonthsAt(child.birthDate, period.start);
  const ageMonthsEnd = computeAgeMonthsAt(child.birthDate, period.end);

  const snapshot = buildReportDataSnapshot(child, period, data);
  const periodLabel = buildReportLabel(reportType, period);
  const monthLabel = periodLabel;

  const aiParams = await resolveParentosTextRuntimeConfig('parentos.report', { temperature: 0.7, maxTokens: 2048 });
  await ensureParentosLocalRuntimeReady({
    route: aiParams.route,
    localModelId: aiParams.localModelId,
    timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  });
  const out = await runtime.ai.text.stream({
    ...aiParams,
    input: [{ role: 'user', content: buildReportUserMessage(child.displayName, periodLabel, snapshot) }],
    system: buildReportSystemPrompt(child.displayName),
    signal,
    metadata: buildParentosRuntimeMetadata('parentos.report'),
  });

  let full = '';
  for await (const p of out.stream) {
    if (p.type === 'delta' && p.text) full += p.text;
    else if (p.type === 'error') throw p.error;
  }

  const aiOutput = parseAiReportResponse(full);
  const filteredSections = safetyFilterSections(aiOutput.sections);
  const opening = safetyFilterString(aiOutput.opening, `${child.displayName}这个月在稳稳地长大。`);
  const closingMessage = safetyFilterString(aiOutput.closingMessage, `${child.displayName}的本月在持续积累，值得被看见。`);
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

  // Keyword sanitation: reject if absent, matches the child's name, or is a
  // low-signal placeholder. Keep output short (2–6 chars).
  const childNameLower = child.displayName.trim().toLowerCase();
  // Reject keywords that are pure domain nouns, time placeholders, or bare
  // state words — we want descriptive/verbal phrases (先行动、找到节奏、敢开口了).
  const placeholderKeywords = new Set([
    '本月', '这个月', '四月', '三月', '五月', '本季度', '季度', '月度',
    '成长', '发育', '进步', '继续', '健康', '正常', '稳定', '平稳',
    '学习', '作息', '睡眠', '饮食', '运动', '情感', '情绪',
    '数学', '语文', '英语', '编程', '阅读',
    '里程碑', '成就', '记录',
  ]);
  const isUsableKeyword = (k: string | null): k is string => {
    if (!k) return false;
    const t = k.trim();
    if (!t || t.length > 8) return false;
    if (t.toLowerCase().includes(childNameLower)) return false;
    if (placeholderKeywords.has(t)) return false;
    return true;
  };
  const keyword = isUsableKeyword(aiOutput.keyword)
    ? safetyFilterString(aiOutput.keyword, '') || undefined
    : undefined;
  const keywordSub = keyword && aiOutput.keywordSub
    ? safetyFilterString(aiOutput.keywordSub, '') || undefined
    : undefined;

  const professionalSummary = buildProfessionalSummaryFromAi(
    aiOutput.professionalSummary,
    { child, period, data, ageMonthsEnd, now },
  );

  const content: NarrativeReportContent = {
    version: 2, format: 'narrative-ai', reportType: 'monthly',
    title, subtitle, teaser,
    keyword,
    keywordSub,
    generatedAt: now, opening,
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
    userNotes: undefined,
    professionalSummary,
    sources: ['本地儿童档案', '本地生长测量数据', '本地睡眠记录', '本地观察日志', '本地里程碑记录', '本地疫苗记录', '本地口腔记录', '本地过敏记录', '本地就医记录', '本地提醒规则'],
    safetyNote: '本报告由AI基于本地数据撰写，仅供参考。如有疑问请咨询专业人士。',
  };

  return { reportType, periodStart: period.start, periodEnd: period.end, ageMonthsStart, ageMonthsEnd, content };
}

export async function generateNarrativeReport(
  child: ChildProfile, period: ReportPeriod, data: AllDomainData, runtime: RuntimeAI, signal?: AbortSignal,
): Promise<BuiltStructuredGrowthReport> {
  return generateNarrativeReportForPeriod({
    child,
    period,
    data,
    runtime,
    reportType: 'monthly',
    signal,
  });
}
