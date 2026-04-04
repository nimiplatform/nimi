import { KNOWLEDGE_SOURCES, NEEDS_REVIEW_DOMAINS, REVIEWED_DOMAINS } from '../../knowledge-base/index.js';
import type {
  JournalEntryRow,
  MeasurementRow,
  MilestoneRecordRow,
  VaccineRecordRow,
} from '../../bridge/sqlite-bridge.js';

export interface AdvisorSnapshot {
  child: {
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
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  sensitivity: ['敏感期', '蒙氏敏感期', 'sensitive period'],
  sleep: ['睡眠', '夜醒', '作息', '入睡', '午睡', 'sleep'],
  sexuality: ['性教育', '身体边界', '隐私', 'sexuality', 'sex education'],
  digital: ['屏幕', '手机', '平板', '电子设备', 'digital', 'screen time'],
  vaccine: ['疫苗', '接种', 'vaccin'],
  checkup: ['体检', '儿保', '检查', 'checkup'],
  growth: ['身高', '体重', '头围', '百分位', '生长', 'growth'],
  vision: ['视力', '散光', '远视储备', 'vision'],
  milestone: ['里程碑', '发育', '会不会', 'milestone'],
  nutrition: ['辅食', '营养', '吃饭', '饮食', 'nutrition'],
  dental: ['牙', '口腔', '龋', 'dental'],
  observation: ['观察', '日记', '专注', '情绪', '互动', 'observation'],
};

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

function summarizeJournal(journalEntries: JournalEntryRow[]) {
  const latest = journalEntries[0];
  if (!latest) {
    return '暂无观察日记记录';
  }

  return `最近记录于 ${latest.recordedAt.slice(0, 10)}，内容类型 ${latest.contentType}`;
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

export function appendAdvisorSources(text: string, domains: string[]) {
  const sources = getSourceLabels(domains);
  if (sources.length === 0) {
    return text.trim();
  }

  return `${text.trim()}\n\n来源：${sources.join('；')}`;
}

export function buildStructuredAdvisorFallback(
  question: string,
  domains: string[],
  snapshot: AdvisorSnapshot,
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

  if (allDomains.length === 1 && allDomains[0] === 'profile') {
    lines.push(
      `本地结构化记录：生长 ${snapshot.measurements.length} 条，疫苗 ${snapshot.vaccines.length} 条，里程碑 ${snapshot.milestones.length} 条，日记 ${snapshot.journalEntries.length} 条`,
    );
  }

  if (domains.some((domain) => NEEDS_REVIEW_DOMAINS.includes(domain))) {
    lines.push('当前问题涉及 needs-review 领域，Phase 1 仅返回结构化事实和来源标注，不提供自由知识解释。');
    lines.push('如需进一步判断，建议咨询专业人士。');
  } else {
    lines.push('当前无法安全调用自由生成解释，先返回本地结构化事实。');
  }

  if (sourceLabels.length > 0) {
    lines.push(`来源：${sourceLabels.join('；')}`);
  }

  return lines.join('\n');
}
