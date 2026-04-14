import * as React from 'react';
import type { ChildProfile, NurtureMode } from '../../app-shell/app-store.js';
import {
  getAllergyRecords,
  getGrowthReports,
  getJournalEntries,
  getMeasurements,
  getMilestoneRecords,
  getReminderStates,
  getSleepRecords,
  getVaccineRecords,
} from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow, SleepRecordRow, VaccineRecordRow } from '../../bridge/sqlite-bridge.js';
import type { ActiveReminder, ReminderAgenda } from '../../engine/reminder-engine.js';
import { mapReminderStateRow, type ReminderState } from '../../engine/reminder-engine.js';
import { MILESTONE_CATALOG } from '../../knowledge-base/index.js';

export interface AllergyRec {
  allergen: string;
  category: string;
  severity: string;
  status: string;
  notes: string | null;
}

export interface MonthlyReportSummary {
  reportId: string;
  content: string;
  periodStart: string;
  generatedAt: string;
}

export interface DashData {
  reminderStates: ReminderState[];
  measurements: MeasurementRow[];
  vaccineRecords: VaccineRecordRow[];
  vaccineCount: number;
  milestoneRecords: Array<{ milestoneId: string; achievedAt: string | null }>;
  journalEntries: Array<{
    entryId: string;
    contentType: string;
    textContent: string | null;
    recordedAt: string;
    observationMode: string | null;
    keepsake: number;
  }>;
  sleepRecords: SleepRecordRow[];
  allergyRecords: AllergyRec[];
  latestMonthlyReport: MonthlyReportSummary | null;
}

const EMPTY: DashData = {
  reminderStates: [],
  measurements: [],
  vaccineRecords: [],
  vaccineCount: 0,
  milestoneRecords: [],
  journalEntries: [],
  sleepRecords: [],
  allergyRecords: [],
  latestMonthlyReport: null,
};

export function useDash(childId: string | null) {
  const [d, setD] = React.useState<DashData>(EMPTY);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    if (!childId) {
      setD(EMPTY);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [rs, ms, vs, mi, jo, sl, al, rp] = await Promise.allSettled([
      getReminderStates(childId),
      getMeasurements(childId),
      getVaccineRecords(childId),
      getMilestoneRecords(childId),
      getJournalEntries(childId, 8),
      getSleepRecords(childId, 14),
      getAllergyRecords(childId),
      getGrowthReports(childId),
    ]);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const allReports = rp.status === 'fulfilled' ? rp.value : [];
    const thisMonthReport = allReports.find((report) => report.periodStart >= monthStart) ?? null;
    const vaccineRecords = vs.status === 'fulfilled' ? vs.value : [];

    setD({
      reminderStates: rs.status === 'fulfilled' ? rs.value.map(mapReminderStateRow) : [],
      measurements: ms.status === 'fulfilled' ? ms.value : [],
      vaccineRecords,
      vaccineCount: vaccineRecords.length,
      milestoneRecords:
        mi.status === 'fulfilled'
          ? mi.value.map((item) => ({ milestoneId: item.milestoneId, achievedAt: item.achievedAt }))
          : [],
      journalEntries:
        jo.status === 'fulfilled'
          ? jo.value.map((entry) => ({
              entryId: entry.entryId,
              contentType: entry.contentType,
              textContent: entry.textContent,
              recordedAt: entry.recordedAt,
              observationMode: entry.observationMode,
              keepsake: entry.keepsake,
            }))
          : [],
      sleepRecords: sl.status === 'fulfilled' ? sl.value : [],
      allergyRecords:
        al.status === 'fulfilled'
          ? al.value.map((item) => ({
              allergen: item.allergen,
              category: item.category,
              severity: item.severity,
              status: item.status,
              notes: item.notes,
            }))
          : [],
      latestMonthlyReport:
        thisMonthReport
          ? {
              reportId: thisMonthReport.reportId,
              content: thisMonthReport.content,
              periodStart: thisMonthReport.periodStart,
              generatedAt: thisMonthReport.generatedAt,
            }
          : null,
    });
    setLoading(false);
  }, [childId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return { d, loading, reload: load };
}

export interface RecentChangeItem {
  id: string;
  domain: 'milestone' | 'vaccine' | 'growth' | 'vision' | 'bone-age' | 'sleep' | 'journal';
  label: string;
  title: string;
  detail: string;
  timestamp: string;
  to: string;
  icon: string;
}

export interface DataGapAlertItem {
  id: 'growth_freshness_gap' | 'growth_missing_baseline';
  title: string;
  detail: string;
  to: string;
}

export interface GrowthSnapshotMetric {
  id: string;
  label: string;
  value: string;
  unit: string;
}

export interface GrowthTrendItem {
  id: string;
  label: string;
  latestValue: string;
  unit: string;
  points: Array<{ date: string; value: number }>;
  delta: number | null;
  deltaPercent: number | null;
}

export interface RecentLineItem {
  id: string;
  title: string;
  detail: string;
  recordedAt: string;
  to: string;
  badge: string;
}

export interface TimelineHomeViewModel {
  recentChanges: RecentChangeItem[];
  dataGapAlert: DataGapAlertItem | null;
  growthSnapshot: {
    updatedAt: string | null;
    updatedLabel: string;
    metrics: GrowthSnapshotMetric[];
    trends: GrowthTrendItem[];
  };
  recentLines: RecentLineItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const milestoneById = new Map(MILESTONE_CATALOG.map((item) => [item.milestoneId, item]));
const MEASUREMENT_META: Record<
  string,
  { label: string; unit: string; domain: RecentChangeItem['domain']; to: string; icon: string }
> = {
  height: { label: '身高', unit: 'cm', domain: 'growth', to: '/profile/growth', icon: '📏' },
  weight: { label: '体重', unit: 'kg', domain: 'growth', to: '/profile/growth', icon: '⚖️' },
  'head-circumference': { label: '头围', unit: 'cm', domain: 'growth', to: '/profile/growth', icon: '🍼' },
  bmi: { label: 'BMI', unit: '', domain: 'growth', to: '/profile/growth', icon: '📈' },
  'vision-left': { label: '左眼视力', unit: '', domain: 'vision', to: '/profile/vision', icon: '👀' },
  'vision-right': { label: '右眼视力', unit: '', domain: 'vision', to: '/profile/vision', icon: '👀' },
  'bone-age': { label: '骨龄', unit: '岁', domain: 'bone-age', to: '/profile/tanner', icon: '🦴' },
};

export function pctComplete(child: ChildProfile): number {
  const fields = [
    child.birthWeightKg,
    child.birthHeightCm,
    child.birthHeadCircCm,
    child.avatarPath,
    child.allergies,
    child.medicalNotes,
    child.recorderProfiles,
  ];
  return Math.round((fields.filter((value) => value != null).length / fields.length) * 100);
}

export function latestByType(measurements: MeasurementRow[]) {
  const latest = new Map<string, MeasurementRow>();
  for (const measurement of measurements) {
    const existing = latest.get(measurement.typeId);
    if (!existing || measurement.measuredAt > existing.measuredAt) {
      latest.set(measurement.typeId, measurement);
    }
  }
  return latest;
}

export function wkActivity(
  journalEntries: DashData['journalEntries'],
  measurements: MeasurementRow[],
  sleepRecords: SleepRecordRow[],
): number[] {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);
  const counts = [0, 0, 0, 0, 0, 0, 0];

  const add = (value: string) => {
    const date = new Date(value);
    if (date >= monday) {
      const index = (date.getDay() + 6) % 7;
      counts[index] = (counts[index] ?? 0) + 1;
    }
  };

  journalEntries.forEach((entry) => add(entry.recordedAt));
  measurements.forEach((measurement) => add(measurement.measuredAt));
  sleepRecords.forEach((record) => add(record.sleepDate));
  return counts;
}

export function fmtRel(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / DAY_MS);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function formatAgeLabel(ageMonths: number) {
  if (ageMonths < 12) return `${ageMonths}个月`;
  const years = Math.floor(ageMonths / 12);
  const months = ageMonths % 12;
  return months > 0 ? `${years}岁${months}个月` : `${years}岁`;
}

export function describeNurtureMode(mode: NurtureMode) {
  switch (mode) {
    case 'relaxed':
      return '轻松模式';
    case 'advanced':
      return '进阶模式';
    default:
      return '平衡模式';
  }
}

function isWithinDays(value: string, days: number) {
  return Date.now() - new Date(value).getTime() <= days * DAY_MS;
}

function toNumber(value: string | number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDelta(delta: number, unit: string) {
  const rounded = Math.round(delta * 10) / 10;
  const prefix = rounded > 0 ? '+' : '';
  return `${prefix}${rounded}${unit ? ` ${unit}` : ''}`;
}

function formatMetricValue(measurement: MeasurementRow, unit: string) {
  return `${measurement.value}${unit ? ` ${unit}` : ''}`;
}

function sortByTimestamp<T extends { timestamp: string }>(items: T[]) {
  return [...items].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function buildMeasurementChanges(measurements: MeasurementRow[]): RecentChangeItem[] {
  const interesting = measurements
    .filter((measurement) => measurement.typeId in MEASUREMENT_META)
    .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt));

  const grouped = new Map<string, MeasurementRow[]>();
  for (const measurement of interesting) {
    const list = grouped.get(measurement.typeId) ?? [];
    list.push(measurement);
    grouped.set(measurement.typeId, list);
  }

  const changes: RecentChangeItem[] = [];
  for (const [typeId, records] of grouped.entries()) {
    const latest = records[0];
    if (!latest || !isWithinDays(latest.measuredAt, 7)) continue;

    const meta = MEASUREMENT_META[typeId];
    if (!meta) continue;

    const previous = records.find((record) => record.measurementId !== latest.measurementId);
    const currentValue = formatMetricValue(latest, meta.unit);
    let detail = `${currentValue} · ${fmtRel(latest.measuredAt)}`;

    if (previous) {
      const latestValue = toNumber(latest.value);
      const previousValue = toNumber(previous.value);
      if (latestValue != null && previousValue != null) {
        detail = `${currentValue}，与上次相比 ${formatDelta(latestValue - previousValue, meta.unit)} · ${fmtRel(latest.measuredAt)}`;
      }
    }

    changes.push({
      id: `measurement:${latest.measurementId}`,
      domain: meta.domain,
      label: meta.domain === 'growth' ? '生长' : meta.label,
      title: `${meta.label}已更新`,
      detail,
      timestamp: latest.measuredAt,
      to: meta.to,
      icon: meta.icon,
    });
  }

  return sortByTimestamp(changes);
}

function sleepDurationLabel(record: SleepRecordRow) {
  if (record.durationMinutes != null && record.durationMinutes > 0) {
    const hours = Math.floor(record.durationMinutes / 60);
    const minutes = record.durationMinutes % 60;
    if (minutes === 0) return `${hours}小时`;
    return `${hours}小时${minutes}分钟`;
  }
  return '已记录时长';
}

function buildSleepRecordChanges(sleepRecords: SleepRecordRow[]): RecentChangeItem[] {
  return sortByTimestamp(
    sleepRecords
      .filter((record) => isWithinDays(record.sleepDate, 7))
      .map((record) => {
        const parts = [record.bedtime, record.wakeTime].filter(Boolean);
        const timeLabel = parts.length === 2 ? `${parts[0]} - ${parts[1]}` : '作息时间';
        return {
          id: `sleep:${record.recordId}`,
          domain: 'sleep' as const,
          label: '睡眠',
          title: '新增睡眠记录',
          detail: `${timeLabel} · ${sleepDurationLabel(record)}`,
          timestamp: `${record.sleepDate}T00:00:00.000Z`,
          to: '/profile/sleep',
          icon: '😴',
        };
      }),
  );
}

function buildJournalChanges(journalEntries: DashData['journalEntries']): RecentChangeItem[] {
  return sortByTimestamp(
    journalEntries
      .filter((entry) => isWithinDays(entry.recordedAt, 7))
      .map((entry) => ({
        id: `journal:${entry.entryId}`,
        domain: 'journal' as const,
        label: '观察',
        title: entry.textContent?.slice(0, 28) ?? (entry.contentType === 'voice' ? '新语音记录' : '新观察记录'),
        detail: `已观察 · ${fmtRel(entry.recordedAt)}`,
        timestamp: entry.recordedAt,
        to: '/journal',
        icon: '📝',
      })),
  );
}

export function buildRecentChanges(d: DashData, _child: ChildProfile, _ageMonths: number): RecentChangeItem[] {
  const milestoneChanges = sortByTimestamp(
    d.milestoneRecords
      .filter((record) => Boolean(record.achievedAt) && isWithinDays(record.achievedAt!, 7))
      .map((record) => ({
        id: `milestone:${record.milestoneId}`,
        domain: 'milestone' as const,
        label: '里程碑',
        title: milestoneById.get(record.milestoneId)?.title ?? '新里程碑',
        detail: `已记录 · ${fmtRel(record.achievedAt!)}`,
        timestamp: record.achievedAt!,
        to: '/profile/milestones',
        icon: '🏆',
      })),
  );

  const vaccineChanges = sortByTimestamp(
    d.vaccineRecords
      .filter((record) => isWithinDays(record.vaccinatedAt, 7))
      .map((record) => ({
        id: `vaccine:${record.recordId}`,
        domain: 'vaccine' as const,
        label: '疫苗',
        title: record.vaccineName,
        detail: `疫苗已接种 · ${fmtRel(record.vaccinatedAt)}`,
        timestamp: record.vaccinatedAt,
        to: '/profile/vaccines',
        icon: '💉',
      })),
  );

  const groupedCandidates = [
    milestoneChanges,
    vaccineChanges,
    buildMeasurementChanges(d.measurements),
    buildSleepRecordChanges(d.sleepRecords),
    buildJournalChanges(d.journalEntries),
  ];

  const picked: RecentChangeItem[] = [];
  const seenDomains = new Set<RecentChangeItem['domain']>();
  for (const group of groupedCandidates) {
    for (const item of group) {
      if (picked.length >= 3) break;
      if (seenDomains.has(item.domain)) continue;
      seenDomains.add(item.domain);
      picked.push(item);
    }
    if (picked.length >= 3) break;
  }

  return picked;
}

function hasVisibleGrowthReminder(agenda: ReminderAgenda) {
  const visible = [...agenda.todayFocus, ...agenda.thisWeek, ...agenda.overdueSummary.items];
  return visible.some((reminder) => ['growth', 'checkup', 'nutrition'].includes(reminder.rule.domain));
}

export function buildDataGapAlert(
  d: DashData,
  _child: ChildProfile,
  ageMonths: number,
  _nurtureMode: NurtureMode,
  agenda: ReminderAgenda,
): DataGapAlertItem | null {
  if (hasVisibleGrowthReminder(agenda)) return null;

  const latestMeasurements = latestByType(d.measurements);
  const height = latestMeasurements.get('height') ?? null;
  const weight = latestMeasurements.get('weight') ?? null;

  if (!height && !weight && ageMonths > 3) {
    return {
      id: 'growth_missing_baseline',
      title: '尚未建立生长基线',
      detail: '首页还没有本地身高或体重记录。补充一次测量数据即可解锁更实用的趋势分析。',
      to: '/profile/growth',
    };
  }

  const staleParts = [height, weight]
    .filter((record): record is MeasurementRow => record !== null)
    .map((record) => {
      const meta = MEASUREMENT_META[record.typeId];
      if (!meta) return null;
      const staleDays = Math.floor((Date.now() - new Date(record.measuredAt).getTime()) / DAY_MS);
      return staleDays > 90 ? `${meta.label}上次更新在 ${staleDays} 天前` : null;
    })
    .filter((value): value is string => Boolean(value));

  if (staleParts.length === 0) return null;

  return {
    id: 'growth_freshness_gap',
    title: '生长数据需要更新',
    detail: `${staleParts.join('，')}。及时更新可以让首页摘要更准确。`,
    to: '/profile/growth',
  };
}

function buildGrowthSnapshot(measurements: MeasurementRow[]): TimelineHomeViewModel['growthSnapshot'] {
  const latestMeasurements = latestByType(measurements);
  const metrics: GrowthSnapshotMetric[] = ['height', 'weight', 'head-circumference', 'bmi']
    .map((typeId) => {
      const measurement = latestMeasurements.get(typeId);
      const meta = MEASUREMENT_META[typeId];
      if (!measurement || !meta) return null;
      return {
        id: typeId,
        label: meta.label,
        value: `${measurement.value}`,
        unit: meta.unit,
      };
    })
    .filter((item): item is GrowthSnapshotMetric => item !== null)
    .slice(0, 4);

  const trends: GrowthTrendItem[] = ['height', 'weight'].map((typeId) => {
    const meta = MEASUREMENT_META[typeId];
    if (!meta) return null;
    const records = measurements
      .filter((m) => m.typeId === typeId)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
    const recent = records.slice(-8);
    if (recent.length === 0) return null;
    const latest = recent[recent.length - 1]!;
    const latestVal = typeof latest.value === 'number' ? latest.value : Number(latest.value);

    let delta: number | null = null;
    let deltaPercent: number | null = null;
    if (recent.length >= 2) {
      const prev = recent[recent.length - 2]!;
      const prevVal = typeof prev.value === 'number' ? prev.value : Number(prev.value);
      if (Number.isFinite(latestVal) && Number.isFinite(prevVal)) {
        delta = Math.round((latestVal - prevVal) * 10) / 10;
        deltaPercent = prevVal !== 0 ? Math.round(((latestVal - prevVal) / prevVal) * 1000) / 10 : null;
      }
    }

    return {
      id: typeId,
      label: meta.label,
      latestValue: `${latest.value}`,
      unit: meta.unit,
      points: recent.map((m) => ({
        date: m.measuredAt.slice(0, 10),
        value: typeof m.value === 'number' ? m.value : Number(m.value),
      })),
      delta,
      deltaPercent,
    };
  }).filter((item): item is GrowthTrendItem => item !== null);

  const latestGrowthRecord = [...latestMeasurements.values()]
    .filter((measurement) => ['height', 'weight', 'head-circumference', 'bmi'].includes(measurement.typeId))
    .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt))[0] ?? null;

  return {
    updatedAt: latestGrowthRecord?.measuredAt ?? null,
    updatedLabel: latestGrowthRecord ? `${fmtRel(latestGrowthRecord.measuredAt)}更新` : '暂无成长测量记录',
    metrics,
    trends,
  };
}

function buildRecentLines(journalEntries: DashData['journalEntries']): RecentLineItem[] {
  return journalEntries.slice(0, 4).map((entry) => ({
    id: entry.entryId,
    title: entry.textContent?.slice(0, 56) ?? (entry.contentType === 'voice' ? '语音记录' : '观察记录'),
    detail: fmtRel(entry.recordedAt),
    recordedAt: entry.recordedAt,
    to: '/journal',
    badge: entry.keepsake === 1 ? '高光' : '笔记',
  }));
}

export function buildTimelineHomeViewModel(params: {
  child: ChildProfile;
  d: DashData;
  ageMonths: number;
  agenda: ReminderAgenda;
}): TimelineHomeViewModel {
  return {
    recentChanges: buildRecentChanges(params.d, params.child, params.ageMonths),
    dataGapAlert: buildDataGapAlert(params.d, params.child, params.ageMonths, params.child.nurtureMode, params.agenda),
    growthSnapshot: buildGrowthSnapshot(params.d.measurements),
    recentLines: buildRecentLines(params.d.journalEntries),
  };
}

export const C = {
  bg: '#E5ECEA',
  card: '#ffffff',
  accent: '#c8e64a',
  accentDim: '#c8e64a66',
  text: '#1a2b4a',
  sub: '#8a8f9a',
  brand: '#EEF3F1',
  cardProfile: '#86AFDA',
  shadow: '0 2px 12px rgba(0,0,0,0.06)',
  radius: 'rounded-[18px]',
} as const;

interface QuickLink {
  id: string;
  to: string;
  label: string;
  emoji: string;
  ageGate?: (ageMonths: number) => boolean;
}

const QLINKS_REGISTRY: QuickLink[] = [
  { id: 'growth', to: '/profile/growth', label: '生长曲线', emoji: '📏' },
  { id: 'vaccines', to: '/profile/vaccines', label: '疫苗', emoji: '💉', ageGate: (age) => age <= 84 },
  { id: 'sleep', to: '/profile/sleep', label: '睡眠', emoji: '😴' },
  { id: 'journal', to: '/journal', label: '成长随记', emoji: '📝' },
  { id: 'reports', to: '/reports', label: '报告', emoji: '📄' },
  { id: 'medical', to: '/profile/medical-events', label: '就医记录', emoji: '🏥' },
  { id: 'milestones', to: '/profile/milestones', label: '里程碑', emoji: '🎯', ageGate: (age) => age <= 72 },
  { id: 'vision', to: '/profile/vision', label: '视力', emoji: '👁️', ageGate: (age) => age >= 36 },
  { id: 'dental', to: '/profile/dental', label: '口腔', emoji: '🦷', ageGate: (age) => age >= 6 },
  { id: 'fitness', to: '/profile/fitness', label: '体能', emoji: '🏃', ageGate: (age) => age >= 36 },
  { id: 'tanner', to: '/profile/tanner', label: '青春期', emoji: '🌱', ageGate: (age) => age >= 84 },
  { id: 'posture', to: '/profile/posture', label: '体态', emoji: '🧍', ageGate: (age) => age >= 60 },
];

const QLINKS_TIERS: Array<{ maxAge: number; topIds: string[] }> = [
  { maxAge: 12, topIds: ['growth', 'vaccines', 'sleep', 'milestones', 'medical', 'journal'] },
  { maxAge: 36, topIds: ['growth', 'vaccines', 'sleep', 'milestones', 'dental', 'journal'] },
  { maxAge: 72, topIds: ['growth', 'vision', 'sleep', 'milestones', 'dental', 'journal'] },
  { maxAge: 144, topIds: ['growth', 'vision', 'fitness', 'dental', 'medical', 'journal'] },
  { maxAge: Infinity, topIds: ['growth', 'vision', 'fitness', 'tanner', 'medical', 'journal'] },
];

const registryById = new Map(QLINKS_REGISTRY.map((link) => [link.id, link]));

export function buildQuickLinks(ageMonths: number): QuickLink[] {
  const visible = QLINKS_REGISTRY.filter((link) => !link.ageGate || link.ageGate(ageMonths));
  const tier = QLINKS_TIERS.find((t) => ageMonths <= t.maxAge)!;
  const ordered: QuickLink[] = [];
  const seen = new Set<string>();
  for (const id of tier.topIds) {
    const link = registryById.get(id);
    if (link && visible.includes(link)) {
      ordered.push(link);
      seen.add(id);
    }
  }
  for (const link of visible) {
    if (!seen.has(link.id) && ordered.length < 6) {
      ordered.push(link);
    }
  }
  return ordered.slice(0, 6);
}

export const DOMAIN_ROUTES: Record<string, string> = {
  milestone: '/profile/milestones',
  vaccine: '/profile/vaccines',
  growth: '/profile/growth',
  vision: '/profile/vision',
  dental: '/profile/dental',
  sleep: '/profile/sleep',
  'bone-age': '/profile/tanner',
  checkup: '/profile/medical-events',
  nutrition: '/profile/growth',
  posture: '/profile/posture',
  fitness: '/profile/fitness',
  tanner: '/profile/tanner',
};

export const DAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function fmtDate() {
  return new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}
