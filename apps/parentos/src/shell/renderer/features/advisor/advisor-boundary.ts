import { KNOWLEDGE_SOURCES, NEEDS_REVIEW_DOMAINS, REVIEWED_DOMAINS } from '../../knowledge-base/index.js';
import type {
  JournalEntryRow,
  MeasurementRow,
  MilestoneRecordRow,
  OutdoorRecordRow,
  VaccineRecordRow,
} from '../../bridge/sqlite-bridge.js';
import {
  getJournalEntries,
  getMeasurements,
  getMilestoneRecords,
  getOutdoorGoal,
  getOutdoorRecords,
  getVaccineRecords,
} from '../../bridge/sqlite-bridge.js';

export interface AdvisorSnapshot {
  child: {
    childId: string;
    displayName: string;
    gender: string;
    birthDate: string;
    nurtureMode: string;
  };
  ageMonths: number;
  measurements: MeasurementRow[];
  vaccines: VaccineRecordRow[];
  milestones: MilestoneRecordRow[];
  journalEntries: JournalEntryRow[];
  outdoorRecords: OutdoorRecordRow[];
  outdoorGoalMinutes: number | null;
}

export interface BuildAdvisorSnapshotInput {
  childId: string;
  displayName: string;
  gender: string;
  birthDate: string;
  nurtureMode: string;
  ageMonths: number;
}

export type AdvisorPromptStrategy =
  | 'reviewed-advice'
  | 'needs-review-descriptive'
  | 'unknown-clarifier'
  | 'generic-chat';

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  sensitivity: ['敏感期', '蒙氏敏感期', 'sensitive period'],
  sleep: ['睡眠', '夜醒', '作息', '入睡', '午睡', 'sleep'],
  sexuality: ['性教育', '身体边界', '隐私', 'sexuality', 'sex education'],
  digital: ['屏幕', '手机', '平板', '电子设备', 'digital', 'screen time'],
  vaccine: ['疫苗', '接种', 'vaccin'],
  checkup: ['体检', '儿保', '检查', 'checkup'],
  growth: ['身高', '体重', '头围', '百分位', '生长', 'growth'],
  vision: ['视力', '散光', '远视储备', 'vision'],
  outdoor: ['户外', '户外活动', '户外时间', '户外目标', 'outdoor', '近视防控', '日光'],
  milestone: ['里程碑', '发育', '会不会', 'milestone'],
  nutrition: ['辅食', '营养', '吃饭', '饮食', 'nutrition'],
  dental: ['牙', '口腔', '龋', 'dental'],
  observation: ['观察', '日记', '专注', '情绪', '互动', 'observation'],
};

const GENERIC_RUNTIME_PATTERNS = [
  /你的模型/i,
  /你是什么模型/i,
  /你是谁/i,
  /你能做什么/i,
  /介绍一下你自己/i,
  /在吗/i,
  /测试/i,
  /^(你好|您好|hello|hi|hey)[！!,.，。?？]*$/i,
] as const;

function normalize(text: string) {
  return text.toLowerCase();
}

function getSourceLabels(domains: string[]) {
  return KNOWLEDGE_SOURCES
    .filter((source) => domains.includes(source.domain))
    .map((source) => `${source.domain}: ${source.source}`);
}

function summarizeMeasurements(measurements: MeasurementRow[]) {
  const latestByType = new Map<string, MeasurementRow>();
  for (const measurement of [...measurements].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))) {
    if (!latestByType.has(measurement.typeId)) {
      latestByType.set(measurement.typeId, measurement);
    }
  }

  return [...latestByType.values()]
    .map((measurement) => `${measurement.typeId}: ${measurement.value} (${measurement.measuredAt.slice(0, 10)})`)
    .join('；');
}

function summarizeVaccines(vaccines: VaccineRecordRow[]) {
  if (vaccines.length === 0) {
    return '暂无已记录疫苗接种';
  }

  const latest = [...vaccines].sort((a, b) => b.vaccinatedAt.localeCompare(a.vaccinatedAt))[0];
  if (!latest) {
    return '暂无已记录疫苗接种';
  }

  return `已记录 ${vaccines.length} 条，最近一次为 ${latest.vaccineName ?? '未知疫苗'}（${latest.vaccinatedAt.slice(0, 10)}）`;
}

function summarizeMilestones(milestones: MilestoneRecordRow[]) {
  const achieved = milestones.filter((item) => item.achievedAt);
  if (achieved.length === 0) {
    return '暂无已记录里程碑达成';
  }

  const latest = [...achieved].sort((a, b) => (b.achievedAt ?? '').localeCompare(a.achievedAt ?? ''))[0];
  if (!latest?.achievedAt) {
    return `已达成 ${achieved.length} 项`;
  }

  return `已达成 ${achieved.length} 项，最近记录 ${latest.milestoneId ?? '未知里程碑'}（${latest.achievedAt.slice(0, 10)}）`;
}

function summarizeOutdoor(records: OutdoorRecordRow[], goalMinutes: number | null) {
  if (records.length === 0) {
    return '暂无户外活动记录';
  }

  // Compute this week's total
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(monday.getDate() + mondayOffset);
  const weekStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

  const thisWeek = records.filter((r) => r.activityDate >= weekStart);
  const thisWeekTotal = thisWeek.reduce((sum, r) => sum + r.durationMinutes, 0);
  const goal = goalMinutes ?? 630;

  return `共 ${records.length} 条记录，本周累计 ${thisWeekTotal} 分钟（目标 ${goal} 分钟/周）`;
}

function summarizeJournal(journalEntries: JournalEntryRow[]) {
  const latest = journalEntries[0];
  if (!latest) {
    return '暂无观察日记记录';
  }

  return `最近记录于 ${latest.recordedAt.slice(0, 10)}，内容类型 ${latest.contentType}`;
}

export async function buildAdvisorSnapshot(input: BuildAdvisorSnapshotInput): Promise<AdvisorSnapshot> {
  const [measurements, vaccines, milestones, journalEntries, outdoorRecords, outdoorGoal] = await Promise.all([
    getMeasurements(input.childId),
    getVaccineRecords(input.childId),
    getMilestoneRecords(input.childId),
    getJournalEntries(input.childId, 20),
    getOutdoorRecords(input.childId),
    getOutdoorGoal(input.childId),
  ]);

  return {
    child: {
      childId: input.childId,
      displayName: input.displayName,
      gender: input.gender,
      birthDate: input.birthDate,
      nurtureMode: input.nurtureMode,
    },
    ageMonths: input.ageMonths,
    measurements,
    vaccines,
    milestones,
    journalEntries,
    outdoorRecords,
    outdoorGoalMinutes: outdoorGoal,
  };
}

export function serializeAdvisorSnapshot(snapshot: AdvisorSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseAdvisorSnapshot(raw: string): AdvisorSnapshot {
  const parsed = JSON.parse(raw) as AdvisorSnapshot;
  if (!parsed?.child?.childId || !Array.isArray(parsed.measurements) || !Array.isArray(parsed.vaccines)
    || !Array.isArray(parsed.milestones) || !Array.isArray(parsed.journalEntries)) {
    throw new Error('advisor snapshot payload is malformed');
  }
  return parsed;
}

export function inferRequestedDomains(question: string): string[] {
  const normalized = normalize(question);
  return Object.entries(DOMAIN_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword.toLowerCase())))
    .map(([domain]) => domain);
}

export function canUseAdvisorRuntime(domains: string[]) {
  return domains.length > 0 && domains.every((domain) => REVIEWED_DOMAINS.includes(domain));
}

export function canUseAdvisorGenericRuntime(question: string, domains: string[]) {
  if (domains.length > 0) {
    return false;
  }
  const normalized = question.trim();
  if (!normalized) {
    return false;
  }
  return GENERIC_RUNTIME_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveAdvisorPromptStrategy(question: string, domains: string[]): AdvisorPromptStrategy {
  if (canUseAdvisorGenericRuntime(question, domains)) {
    return 'generic-chat';
  }
  if (domains.length === 0) {
    return 'unknown-clarifier';
  }
  if (canUseAdvisorRuntime(domains)) {
    return 'reviewed-advice';
  }
  return 'needs-review-descriptive';
}

export function appendAdvisorSources(text: string, domains: string[]) {
  const sources = getSourceLabels(domains);
  if (sources.length === 0) {
    return text.trim();
  }

  return `${text.trim()}\n\n来源：${sources.join('；')}`;
}

export function buildAdvisorRuntimeUserMessage(
  question: string,
  domains: string[],
  snapshot: AdvisorSnapshot,
) {
  return [
    '请仅基于以下 ParentOS 本地结构化快照回答。',
    '如果快照中没有足够证据，就明确说当前仅能根据本地记录描述事实。',
    `问题：${question}`,
    `已判定领域：${domains.join('、')}`,
    `本地快照：${serializeAdvisorSnapshot(snapshot)}`,
  ].join('\n');
}

export function buildAdvisorGenericRuntimeUserMessage(question: string) {
  return [
    '当前消息属于 ParentOS 顾问中的泛闲聊或产品能力澄清，不是具体育儿领域咨询。',
    '你可以正常回应问候、测试、身份说明、能力边界和下一步引导。',
    '不要把回答扩展成针对孩子的个性化建议；如果用户转向育儿问题，先请对方明确主题方向。',
    `用户消息：${question}`,
  ].join('\n');
}

export function buildAdvisorNeedsReviewRuntimeUserMessage(
  question: string,
  domains: string[],
  snapshot: AdvisorSnapshot,
) {
  return [
    '当前消息涉及 needs-review 或 mixed domains，只能走描述型回答策略。',
    '你只能基于 ParentOS 本地结构化快照整理、重述、澄清事实。',
    '不得提供诊断、治疗、用药、风险评级、因果判断或权威结论。',
    '如果用户在追问判断或建议，只能说明当前范围限于本地记录描述，并建议咨询专业人士。',
    `问题：${question}`,
    `涉及领域：${domains.join('、')}`,
    `本地快照：${serializeAdvisorSnapshot(snapshot)}`,
  ].join('\n');
}

export function buildAdvisorUnknownClarifierRuntimeUserMessage(
  question: string,
  snapshot: AdvisorSnapshot,
) {
  return [
    '当前消息尚未明确到具体顾问主题，先走澄清型回答策略。',
    '不要直接给出个性化育儿结论，只做简短澄清和话题引导。',
    '你可以结合当前孩子已有本地记录类别，提示用户可继续追问的方向。',
    `用户消息：${question}`,
    `当前本地记录概况：生长 ${snapshot.measurements.length} 条，疫苗 ${snapshot.vaccines.length} 条，里程碑 ${snapshot.milestones.length} 条，日记 ${snapshot.journalEntries.length} 条`,
  ].join('\n');
}

export function buildStructuredAdvisorFallback(
  question: string,
  domains: string[],
  snapshot: AdvisorSnapshot,
  options: {
    note?: string;
  } = {},
) {
  const allDomains = domains.length > 0 ? domains : ['profile'];
  const sourceLabels = getSourceLabels(domains);
  const lines = [
    `问题：${question}`,
    `孩子：${snapshot.child.displayName}，${snapshot.ageMonths} 个月，养育模式 ${snapshot.child.nurtureMode}`,
    `档案事实：出生日期 ${snapshot.child.birthDate}，性别 ${snapshot.child.gender}`,
  ];

  if (allDomains.includes('growth')) {
    lines.push(`生长记录：${summarizeMeasurements(snapshot.measurements) || '暂无可用生长记录'}`);
  }

  if (allDomains.includes('vaccine')) {
    lines.push(`疫苗记录：${summarizeVaccines(snapshot.vaccines)}`);
  }

  if (allDomains.includes('milestone')) {
    lines.push(`里程碑记录：${summarizeMilestones(snapshot.milestones)}`);
  }

  if (allDomains.includes('observation')) {
    lines.push(`观察记录：${summarizeJournal(snapshot.journalEntries)}`);
  }

  if (allDomains.includes('outdoor') || allDomains.includes('vision')) {
    lines.push(`户外活动：${summarizeOutdoor(snapshot.outdoorRecords, snapshot.outdoorGoalMinutes)}`);
  }

  if (allDomains.length === 1 && allDomains[0] === 'profile') {
    lines.push(
      `本地结构化记录：生长 ${snapshot.measurements.length} 条，疫苗 ${snapshot.vaccines.length} 条，里程碑 ${snapshot.milestones.length} 条，日记 ${snapshot.journalEntries.length} 条`,
    );
  }

  if (domains.some((domain) => NEEDS_REVIEW_DOMAINS.includes(domain))) {
    lines.push('当前问题涉及 needs-review 领域，Phase 1 仅返回结构化事实和来源标注，不提供自由知识解释。');
    lines.push('如需进一步判断，建议咨询专业人士。');
  } else if (domains.length === 0) {
    lines.push('当前问题尚未明确到已审核领域，先返回本地结构化事实。');
    lines.push(`如需继续，请尽量明确想了解的方向，例如：${REVIEWED_DOMAINS.join('、')}。`);
  } else {
    lines.push('当前无法安全调用自由生成解释，先返回本地结构化事实。');
  }

  if (sourceLabels.length > 0) {
    lines.push(`来源：${sourceLabels.join('；')}`);
  }

  if (options.note) {
    lines.push(options.note);
  }

  return lines.join('\n');
}
