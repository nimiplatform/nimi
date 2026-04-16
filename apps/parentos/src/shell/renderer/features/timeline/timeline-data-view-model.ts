import type { ChildProfile, NurtureMode } from '../../app-shell/app-store.js';
import type { ReminderAgenda } from '../../engine/reminder-engine.js';
import { MILESTONE_CATALOG, OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import { getKeepsakeReasonLabel } from '../journal/journal-page-helpers.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import type {
  DashData,
  DataGapAlertItem,
  DimensionDistributionItem,
  GrowthSnapshotMetric,
  GrowthTrendItem,
  MilestoneTimelineItem,
  MilestoneTimelineSummary,
  ObservationDistributionSummary,
  RecentChangeItem,
  RecentLineItem,
  SleepTrendPoint,
  SleepTrendSummary,
  TimelineHomeViewModel,
  VisionSnapshotSummary,
} from './timeline-data-types.js';
import { C } from './timeline-data-types.js';

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
  { id: 'outdoor', to: '/profile/outdoor', label: '户外目标', emoji: '🌳', ageGate: (age) => age >= 6 },
  { id: 'vision', to: '/profile/vision', label: '视力', emoji: '👁️', ageGate: (age) => age >= 36 },
  { id: 'dental', to: '/profile/dental', label: '口腔', emoji: '🦷', ageGate: (age) => age >= 6 },
  { id: 'fitness', to: '/profile/fitness', label: '体能', emoji: '🏃', ageGate: (age) => age >= 36 },
  { id: 'tanner', to: '/profile/tanner', label: '青春期', emoji: '🌱', ageGate: (age) => age >= 84 },
  { id: 'posture', to: '/profile/posture', label: '体态', emoji: '🧍', ageGate: (age) => age >= 60 },
];

const QLINKS_TIERS: Array<{ maxAge: number; topIds: string[] }> = [
  { maxAge: 12, topIds: ['growth', 'vaccines', 'sleep', 'milestones', 'medical', 'journal'] },
  { maxAge: 36, topIds: ['growth', 'vaccines', 'sleep', 'milestones', 'dental', 'journal'] },
  { maxAge: 72, topIds: ['growth', 'vision', 'outdoor', 'sleep', 'milestones', 'journal'] },
  { maxAge: 144, topIds: ['growth', 'vision', 'outdoor', 'fitness', 'dental', 'journal'] },
  { maxAge: Infinity, topIds: ['growth', 'vision', 'outdoor', 'fitness', 'tanner', 'journal'] },
];

const registryById = new Map(QLINKS_REGISTRY.map((link) => [link.id, link]));

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

export function buildSleepTrend(sleepRecords: DashData['sleepRecords']): SleepTrendSummary {
  const sorted = [...sleepRecords].sort((a, b) => a.sleepDate.localeCompare(b.sleepDate));
  const points: SleepTrendPoint[] = sorted
    .filter((record) => record.durationMinutes != null && record.durationMinutes > 0)
    .map((record) => ({
      date: record.sleepDate,
      durationMinutes: record.durationMinutes!,
      bedtime: record.bedtime,
      wakeTime: record.wakeTime,
    }));
  const totalDuration = points.reduce((sum, point) => sum + point.durationMinutes, 0);
  const avgDurationMinutes = points.length > 0 ? Math.round(totalDuration / points.length) : null;
  const latest = sorted[sorted.length - 1] ?? null;

  return {
    points,
    avgDurationMinutes,
    latestBedtime: latest?.bedtime ?? null,
    latestWakeTime: latest?.wakeTime ?? null,
    totalRecords: sorted.length,
  };
}

export function buildMilestoneTimeline(
  milestoneRecords: DashData['milestoneRecords'],
  ageMonths: number,
): MilestoneTimelineSummary {
  const achievedIds = new Set(milestoneRecords.filter((record) => record.achievedAt).map((record) => record.milestoneId));
  const recentlyAchieved: MilestoneTimelineItem[] = milestoneRecords
    .filter((record) => record.achievedAt && isWithinDays(record.achievedAt, 60))
    .sort((left, right) => (right.achievedAt ?? '').localeCompare(left.achievedAt ?? ''))
    .slice(0, 3)
    .map((record) => {
      const catalogEntry = milestoneById.get(record.milestoneId);
      return {
        milestoneId: record.milestoneId,
        title: catalogEntry?.title ?? record.milestoneId,
        domain: catalogEntry?.domain ?? 'unknown',
        achievedAt: record.achievedAt!,
        typicalAgeLabel: catalogEntry ? formatAgeLabel(catalogEntry.typicalAge.medianMonths) : '',
      };
    });
  const upcoming: MilestoneTimelineItem[] = MILESTONE_CATALOG
    .filter((milestone) => !achievedIds.has(milestone.milestoneId)
      && milestone.typicalAge.rangeStart <= ageMonths + 6
      && milestone.typicalAge.rangeEnd >= ageMonths)
    .sort((left, right) => left.typicalAge.medianMonths - right.typicalAge.medianMonths)
    .slice(0, 3)
    .map((milestone) => ({
      milestoneId: milestone.milestoneId,
      title: milestone.title,
      domain: milestone.domain,
      typicalAgeLabel: formatAgeLabel(milestone.typicalAge.medianMonths),
    }));

  return { recentlyAchieved, upcoming };
}

export function buildObservationDistribution(journalEntries: DashData['journalEntries']): ObservationDistributionSummary {
  const cutoff = Date.now() - 30 * DAY_MS;
  const counts = new Map<string, number>();
  let totalEntries = 0;
  for (const entry of journalEntries) {
    if (!entry.dimensionId || new Date(entry.recordedAt).getTime() < cutoff) continue;
    counts.set(entry.dimensionId, (counts.get(entry.dimensionId) ?? 0) + 1);
    totalEntries += 1;
  }
  const dimById = new Map(OBSERVATION_DIMENSIONS.map((dimension) => [dimension.dimensionId, dimension]));
  const items: DimensionDistributionItem[] = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([dimensionId, count]) => ({
      dimensionId,
      displayName: dimById.get(dimensionId)?.displayName ?? dimensionId,
      count,
      ratio: totalEntries > 0 ? count / totalEntries : 0,
    }));

  return { items, totalEntries };
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

function buildMeasurementChanges(measurements: DashData['measurements']): RecentChangeItem[] {
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

function sleepDurationLabel(record: DashData['sleepRecords'][number]) {
  if (record.durationMinutes != null && record.durationMinutes > 0) {
    const hours = Math.floor(record.durationMinutes / 60);
    const minutes = record.durationMinutes % 60;
    if (minutes === 0) return `${hours}小时`;
    return `${hours}小时${minutes}分钟`;
  }
  return '已记录时长';
}

function buildSleepRecordChanges(sleepRecords: DashData['sleepRecords']): RecentChangeItem[] {
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
      .map((entry) => {
        const reasonLabel = getKeepsakeReasonLabel(entry.keepsakeReason);
        const fallbackTitle = entry.textContent?.slice(0, 28) ?? (entry.contentType === 'voice' ? '新的语音记录' : '新的观察记录');
        const isKeepsake = entry.keepsake === 1;
        return {
          id: `journal:${entry.entryId}`,
          domain: 'journal' as const,
          label: isKeepsake ? '珍藏' : '观察',
          title: entry.keepsakeTitle?.trim() || fallbackTitle,
          detail: isKeepsake
            ? reasonLabel
              ? `珍藏 · ${reasonLabel} · ${fmtRel(entry.recordedAt)}`
              : `已加入珍藏 · ${fmtRel(entry.recordedAt)}`
            : `已记录观察 · ${fmtRel(entry.recordedAt)}`,
          timestamp: entry.recordedAt,
          to: isKeepsake ? '/journal?filter=keepsake' : '/journal',
          icon: '📝',
        };
      }),
  );
}

export function buildRecentChanges(dash: DashData): RecentChangeItem[] {
  const milestoneChanges = sortByTimestamp(
    dash.milestoneRecords
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
    dash.vaccineRecords
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
    buildMeasurementChanges(dash.measurements),
    buildSleepRecordChanges(dash.sleepRecords),
    buildJournalChanges(dash.journalEntries),
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
  const visible = [...agenda.todayFocus, ...agenda.upcoming, ...agenda.overdueSummary.items];
  return visible.some((reminder) => ['growth', 'checkup', 'nutrition'].includes(reminder.rule.domain));
}

export function buildDataGapAlert(
  dash: DashData,
  ageMonths: number,
  agenda: ReminderAgenda,
): DataGapAlertItem | null {
  if (hasVisibleGrowthReminder(agenda)) return null;
  const latestMeasurements = latestByType(dash.measurements);
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

function buildGrowthSnapshot(measurements: DashData['measurements']): TimelineHomeViewModel['growthSnapshot'] {
  const latestMeasurements = latestByType(measurements);
  const metrics: GrowthSnapshotMetric[] = ['height', 'weight', 'head-circumference', 'bmi']
    .map((typeId) => {
      const measurement = latestMeasurements.get(typeId);
      const meta = MEASUREMENT_META[typeId];
      if (!measurement || !meta) return null;
      return { id: typeId, label: meta.label, value: `${measurement.value}`, unit: meta.unit };
    })
    .filter((item): item is GrowthSnapshotMetric => item !== null)
    .slice(0, 4);
  const trends: GrowthTrendItem[] = ['height', 'weight']
    .map((typeId) => {
      const meta = MEASUREMENT_META[typeId];
      if (!meta) return null;
      const records = measurements.filter((measurement) => measurement.typeId === typeId).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
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
        points: recent.map((measurement) => ({
          date: measurement.measuredAt.slice(0, 10),
          value: typeof measurement.value === 'number' ? measurement.value : Number(measurement.value),
        })),
        delta,
        deltaPercent,
      };
    })
    .filter((item): item is GrowthTrendItem => item !== null);
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

function buildVisionSnapshot(measurements: DashData['measurements']): VisionSnapshotSummary {
  const latest = latestByType(measurements);
  const left = latest.get('vision-left');
  const right = latest.get('vision-right');
  const latestRecord = [left, right]
    .filter((record): record is MeasurementRow => record != null)
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0] ?? null;

  return {
    leftEye: left ? `${left.value}` : null,
    rightEye: right ? `${right.value}` : null,
    measuredAt: latestRecord?.measuredAt ?? null,
    measuredLabel: latestRecord ? `${fmtRel(latestRecord.measuredAt)}检查` : '暂无视力记录',
  };
}

function buildRecentLines(journalEntries: DashData['journalEntries']): RecentLineItem[] {
  return journalEntries.slice(0, 4).map((entry) => {
    const reasonLabel = getKeepsakeReasonLabel(entry.keepsakeReason);
    const isKeepsake = entry.keepsake === 1;
    return {
      id: entry.entryId,
      title: entry.keepsakeTitle?.trim() || entry.textContent?.slice(0, 56) || (entry.contentType === 'voice' ? '语音记录' : '观察记录'),
      detail: isKeepsake
        ? reasonLabel
          ? `珍藏原因：${reasonLabel}`
          : '值得回看的成长瞬间'
        : fmtRel(entry.recordedAt),
      recordedAt: entry.recordedAt,
      to: isKeepsake ? '/journal?filter=keepsake' : '/journal',
      badge: isKeepsake ? '珍藏' : '随记',
      badgeTone: isKeepsake ? 'keepsake' : 'default',
      tag: reasonLabel,
    };
  });
}

export function buildTimelineHomeViewModel(params: {
  child: ChildProfile;
  d: DashData;
  ageMonths: number;
  agenda: ReminderAgenda;
}): TimelineHomeViewModel {
  return {
    recentChanges: buildRecentChanges(params.d),
    dataGapAlert: buildDataGapAlert(params.d, params.ageMonths, params.agenda),
    growthSnapshot: buildGrowthSnapshot(params.d.measurements),
    sleepTrend: buildSleepTrend(params.d.sleepRecords),
    visionSnapshot: buildVisionSnapshot(params.d.measurements),
    milestoneTimeline: buildMilestoneTimeline(params.d.milestoneRecords, params.ageMonths),
    observationDistribution: buildObservationDistribution(params.d.journalEntries),
    recentLines: buildRecentLines(params.d.journalEntries),
  };
}

export function buildQuickLinks(ageMonths: number): QuickLink[] {
  const visible = QLINKS_REGISTRY.filter((link) => !link.ageGate || link.ageGate(ageMonths));
  const tier = QLINKS_TIERS.find((item) => ageMonths <= item.maxAge)!;
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

export function fmtDate() {
  return new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

export { C };
