// Pure deterministic projection from health_record_events / health_record_values
// + WHO LMS dataset → GrowthDetailSnapshot.
//
// Per packet-wave-a-detail-projection.md:
//   - NO react / react-dom / recharts / runtime.ai.* / sdk runtime import.
//   - NO sqlite-bridge / bridge function call. Inputs are typed arrays
//     passed by the caller.
//   - NO Date.now(). Caller passes `nowIso`.
//   - Reuses existing helpers: computeApproxPercentile (from
//     growth-curve-page-shared.ts), buildHealthRecordSnapshot and
//     recomputeDerivedHealthRecordValues (from health-record-domain.ts).
//   - Consumes nextRecordAt transitively through
//     buildHealthRecordSnapshot(...).groups[i].metrics[j].nextRecordAt;
//     the underlying resolveNextRecordAt is private and must not be
//     imported directly.

import {
  buildHealthRecordSnapshot,
  recomputeDerivedHealthRecordValues,
  type HealthMetricSnapshot,
  type HealthRecordEvent,
  type HealthRecordValue,
} from '../../engine/health-record-domain.js';
import type { HealthMetricId } from '../../knowledge-base/index.js';
import {
  computeApproxPercentile,
  formatPercentileChange6m,
  formatRecencyLabel,
  formatYearOverYearDelta,
  LEDE_TEMPLATES,
  type LedeTemplateId,
  type LedeTemplateInputs,
} from './growth-curve-page-shared.js';
import {
  evaluateAllMilestones,
  type GrowthMilestone,
  type HistoryPoint,
} from './growth-milestone-rules.js';
import type { GrowthStandard, WHOLMSDataset } from './who-lms-loader.js';

// ---------------------------------------------------------------------------
// Public types (PO-GROWTH-DETAIL-002)
// ---------------------------------------------------------------------------

export type GrowthChipKind = 'height' | 'weight' | 'bmi' | 'head' | 'bone_age';

export type GrowthChipTone = 'success' | 'warn' | 'info' | 'neutral';

export type GrowthTrendKind = 'steady' | 'accelerating' | 'decelerating' | 'plateau';

export type GrowthFilterDateRangeKey = 'all' | '1y' | '6m' | '3m';
export type GrowthFilterSourceKey = 'all' | 'manual' | 'ocr' | 'imported' | 'reminder';

export interface GrowthDetailChild {
  childId: string;
  displayName: string;
  gender: 'M' | 'F';
  birthDate: string;
  ageMonths: number;
  ageLabel: string;
}

export interface GrowthSelectedMetric {
  metricId: HealthMetricId;
  displayName: string;
  unit: string;
  ageRangeMonths: { startMonths: number; endMonths: number } | null;
}

export interface GrowthHeadlineHasData {
  state: 'has_data' | 'out_of_reference';
  currentValueDisplay: string;
  currentPercentile: number | null;
  measuredAt: string;
  yearOverYearDelta: { value: number; unit: string; sign: '+' | '-' | '0' };
  trend: GrowthTrendKind;
  ledeTemplate: LedeTemplateId;
  ledeTemplateInputs: LedeTemplateInputs;
}

export type GrowthHeadline = GrowthHeadlineHasData | { state: 'no_data' };

export interface GrowthChip {
  kind: GrowthChipKind;
  visible: boolean;
  primary: string;
  secondary: string | null;
  tone: GrowthChipTone;
}

export interface GrowthNextCheckScheduled {
  state: 'scheduled';
  nextRecordAt: string;
  daysFromNow: number;
  badgeLabel: string;
  ledeTemplate: 'next_check_due_soon' | 'next_check_overdue' | 'next_check_upcoming';
  reminderActionability: 'has_writeback' | 'deep_link_only';
}

export type GrowthNextCheck = GrowthNextCheckScheduled | { state: 'unscheduled' };

export interface GrowthTrendStat {
  label: string;
  value: string;
  unit: string;
  caption: string;
}

export interface GrowthHistoryRow {
  eventId: string;
  valueId: string;
  effectiveDate: string;
  ageMonths: number;
  ageLabel: string;
  value: number;
  unit: string;
  source: GrowthFilterSourceKey;
  percentile: number | null;
}

export interface GrowthHistoryFilters {
  dateRangeKey: GrowthFilterDateRangeKey;
  sourceKey: GrowthFilterSourceKey;
}

export interface GrowthHistoryPage {
  rows: GrowthHistoryRow[];
  filters: GrowthHistoryFilters;
  page: number;
  perPage: number;
  total: number;
}

export interface GrowthDetailSnapshot {
  child: GrowthDetailChild;
  selectedMetric: GrowthSelectedMetric;
  recencyLabel: string | null;
  headline: GrowthHeadline;
  crossMetric: GrowthChip[];
  milestones: GrowthMilestone[];
  nextCheck: GrowthNextCheck;
  trendStats: GrowthTrendStat[];
  historyPage: GrowthHistoryPage;
  reference: { standardId: GrowthStandard; datasetCoverage: { startAgeMonths: number; endAgeMonths: number } | null; datasetAvailable: boolean };
  generatedAt: string;
}

export interface GrowthDetailProjectionInput {
  child: { childId: string; displayName: string; gender: 'M' | 'F'; birthDate: string };
  selectedMetricId: HealthMetricId;
  growthStandard: GrowthStandard;
  events: HealthRecordEvent[];
  values: HealthRecordValue[];
  /** LMS dataset for the selected metric — drives headline, history, trend
   *  stats and milestones. */
  whoDataset: WHOLMSDataset | null;
  /** Per-metric LMS datasets keyed by canonical metric id. Cross-metric chips
   *  use these so each chip's percentile is computed against its own standard.
   *  When omitted, cross-metric chips render without a percentile. */
  whoDatasetByMetricId?: Partial<Record<HealthMetricId, WHOLMSDataset | null>>;
  page: number;
  perPage: number;
  filters: GrowthHistoryFilters;
  nowIso: string;
}

// ---------------------------------------------------------------------------
// Internal helpers (kept private to this module)
// ---------------------------------------------------------------------------

const CROSS_METRIC_ORDER: ReadonlyArray<{ kind: GrowthChipKind; metricId: HealthMetricId | null }> = [
  { kind: 'height', metricId: 'growth.height' },
  { kind: 'weight', metricId: 'growth.weight' },
  { kind: 'bmi', metricId: 'growth.bmi' },
  { kind: 'head', metricId: 'growth.head_circumference' },
  { kind: 'bone_age', metricId: 'development.bone_age_years' },
];

function ageMonthsFromBirthIso(birthIso: string, nowIso: string): number {
  const birthMs = Date.parse(birthIso);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(birthMs) || Number.isNaN(nowMs)) return 0;
  const days = Math.floor((nowMs - birthMs) / 86400000);
  // 30.436875 days/month average for stable rounding.
  return Math.max(0, Math.floor(days / 30.436875));
}

function ageLabelFromMonths(months: number): string {
  if (months < 24) return `${months} 个月`;
  const years = Math.floor(months / 12);
  const remainderMonths = months % 12;
  return remainderMonths > 0 ? `${years} 岁 ${remainderMonths} 个月` : `${years} 岁`;
}

function sourceKeyFromEvent(event: HealthRecordEvent): GrowthFilterSourceKey {
  switch (event.recordKind) {
    case 'manual':
      return 'manual';
    case 'ocr_confirmed':
      return 'ocr';
    case 'imported':
      return 'imported';
    case 'reminder_linked':
      return 'reminder';
    case 'derived':
      // Derived (BMI) rows surface in history; classify as manual since there
      // is no separate filter chip for derived rows in the contract.
      return 'manual';
    default:
      return 'manual';
  }
}

function dateRangeCutoffIso(rangeKey: GrowthFilterDateRangeKey, nowIso: string): string | null {
  if (rangeKey === 'all') return null;
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) return null;
  const days = rangeKey === '1y' ? 365 : rangeKey === '6m' ? 183 : 92;
  return new Date(nowMs - days * 86400000).toISOString();
}

interface MetricSlice {
  events: HealthRecordEvent[];
  values: HealthRecordValue[];
}

function sliceForMetric(
  input: GrowthDetailProjectionInput,
  metricId: HealthMetricId,
): MetricSlice {
  const childEvents = input.events.filter((e) => e.childId === input.child.childId);
  const eventById = new Map(childEvents.map((e) => [e.eventId, e]));
  const values = input.values.filter(
    (v) => v.childId === input.child.childId && v.metricId === metricId && eventById.has(v.eventId),
  );
  return { events: childEvents, values };
}

function latestValueWithEvent(
  slice: MetricSlice,
): { value: HealthRecordValue; event: HealthRecordEvent } | null {
  let best: { value: HealthRecordValue; event: HealthRecordEvent } | null = null;
  for (const value of slice.values) {
    const event = slice.events.find((e) => e.eventId === value.eventId);
    if (!event) continue;
    if (!best || event.effectiveDate.localeCompare(best.event.effectiveDate) > 0) {
      best = { value, event };
    }
  }
  return best;
}

function historyPointsForMetric(
  slice: MetricSlice,
  metricId: HealthMetricId,
): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const value of slice.values) {
    const event = slice.events.find((e) => e.eventId === value.eventId);
    if (!event || value.valueNumber == null) continue;
    out.push({
      eventId: event.eventId,
      measuredAt: event.effectiveDate,
      ageMonths: event.ageMonths,
      value: value.valueNumber,
      metricId,
    });
  }
  out.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  return out;
}

function allGrowthHistoryPoints(input: GrowthDetailProjectionInput): HistoryPoint[] {
  const childEvents = input.events.filter((e) => e.childId === input.child.childId);
  const eventById = new Map(childEvents.map((e) => [e.eventId, e]));
  const out: HistoryPoint[] = [];
  for (const value of input.values) {
    if (value.childId !== input.child.childId) continue;
    const event = eventById.get(value.eventId);
    if (!event || event.groupId !== 'growth') continue;
    if (value.valueNumber == null) continue;
    out.push({
      eventId: event.eventId,
      measuredAt: event.effectiveDate,
      ageMonths: event.ageMonths,
      value: value.valueNumber,
      metricId: value.metricId,
    });
  }
  out.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  return out;
}

function computeTrend(points: HistoryPoint[]): GrowthTrendKind {
  if (points.length < 6) {
    // Not enough samples to call accelerate/decelerate; default steady when
    // we have any history, plateau when nothing has changed for ≥3 records.
    if (points.length >= 3) {
      const last3 = points.slice(-3);
      const constant = last3.every((p) => Math.abs(p.value - last3[0]!.value) < 0.1);
      if (constant) return 'plateau';
    }
    return 'steady';
  }
  const prior = points.slice(-6, -3);
  const recent = points.slice(-3);
  const slope = (xs: HistoryPoint[]) => {
    const first = xs[0]!;
    const last = xs[xs.length - 1]!;
    const dt = (Date.parse(last.measuredAt) - Date.parse(first.measuredAt)) / 86400000;
    if (dt <= 0) return 0;
    return (last.value - first.value) / dt;
  };
  const priorSlope = slope(prior);
  const recentSlope = slope(recent);
  if (Math.abs(recentSlope) < 0.0005 && Math.abs(priorSlope) < 0.0005) return 'plateau';
  if (recentSlope > priorSlope * 1.25) return 'accelerating';
  if (recentSlope < priorSlope * 0.75) return 'decelerating';
  return 'steady';
}

function pickLedeTemplate(
  metricId: HealthMetricId,
  trend: GrowthTrendKind,
  percentile: number | null,
): LedeTemplateId {
  if (metricId === 'growth.height') {
    if (trend === 'accelerating') return 'height_accelerating';
    if (trend === 'decelerating') return 'height_decelerating';
    if (trend === 'plateau') return 'height_plateau';
    if (percentile != null && percentile >= 50) return 'height_steady_above_p50';
    return 'height_steady_below_p50';
  }
  if (metricId === 'growth.weight') {
    if (trend === 'accelerating') return 'weight_accelerating';
    if (trend === 'decelerating') return 'weight_decelerating';
    return 'weight_steady';
  }
  if (metricId === 'growth.bmi') {
    if (percentile != null && percentile >= 90) return 'bmi_above_range';
    if (percentile != null && percentile <= 10) return 'bmi_below_range';
    return 'bmi_in_range';
  }
  if (metricId === 'growth.head_circumference') return 'head_steady';
  return 'no_data';
}

function percentileLabel(percentile: number | null): string {
  if (percentile == null) return '参考数据未加载';
  return `P${percentile}`;
}

function priorYearValue(points: HistoryPoint[], referenceIso: string): number | null {
  const refMs = Date.parse(referenceIso);
  if (Number.isNaN(refMs)) return null;
  const yearAgoMs = refMs - 365 * 86400000;
  let candidate: HistoryPoint | null = null;
  for (const p of points) {
    const ms = Date.parse(p.measuredAt);
    if (Number.isNaN(ms)) continue;
    if (ms <= refMs && ms >= yearAgoMs) {
      if (!candidate || Date.parse(candidate.measuredAt) > ms) candidate = p;
    }
  }
  return candidate?.value ?? null;
}

function chipForMetric(
  kind: GrowthChipKind,
  metricId: HealthMetricId | null,
  input: GrowthDetailProjectionInput,
): GrowthChip {
  if (!metricId) {
    return { kind, visible: false, primary: '—', secondary: null, tone: 'neutral' };
  }
  const slice = sliceForMetric(input, metricId);
  const latest = latestValueWithEvent(slice);
  if (!latest || latest.value.valueNumber == null) {
    return { kind, visible: false, primary: '—', secondary: null, tone: 'neutral' };
  }
  const unit = latest.value.unit ?? '';
  // Each chip compares against its own metric's LMS dataset, not the selected
  // metric's — otherwise e.g. a weight value gets scored against height bands.
  const metricDataset = input.whoDatasetByMetricId?.[metricId] ?? null;
  const percentile = computeApproxPercentile(latest.value.valueNumber, latest.event.ageMonths, metricDataset);
  return {
    kind,
    visible: true,
    primary: `${latest.value.valueNumber} ${unit}`.trim(),
    secondary: percentile != null ? `P${percentile}` : null,
    tone: tonifyPercentile(percentile),
  };
}

function tonifyPercentile(p: number | null): GrowthChipTone {
  if (p == null) return 'neutral';
  if (p >= 90 || p <= 10) return 'warn';
  if (p >= 25 && p <= 75) return 'success';
  return 'info';
}

function paginateHistory(
  input: GrowthDetailProjectionInput,
): { rows: GrowthHistoryRow[]; total: number } {
  const cutoffIso = dateRangeCutoffIso(input.filters.dateRangeKey, input.nowIso);
  const childEvents = input.events.filter((e) => e.childId === input.child.childId);
  const eventById = new Map(childEvents.map((e) => [e.eventId, e]));

  const rows: GrowthHistoryRow[] = [];
  for (const value of input.values) {
    if (value.childId !== input.child.childId) continue;
    if (value.metricId !== input.selectedMetricId) continue;
    const event = eventById.get(value.eventId);
    if (!event || event.groupId !== 'growth') continue;
    if (cutoffIso && event.effectiveDate < cutoffIso) continue;
    const source = sourceKeyFromEvent(event);
    if (input.filters.sourceKey !== 'all' && input.filters.sourceKey !== source) continue;
    if (value.valueNumber == null) continue;
    const percentile = computeApproxPercentile(value.valueNumber, event.ageMonths, input.whoDataset);
    rows.push({
      eventId: event.eventId,
      valueId: value.valueId,
      effectiveDate: event.effectiveDate,
      ageMonths: event.ageMonths,
      ageLabel: ageLabelFromMonths(event.ageMonths),
      value: value.valueNumber,
      unit: value.unit ?? '',
      source,
      percentile,
    });
  }
  rows.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const total = rows.length;
  const start = Math.max(0, (input.page - 1) * input.perPage);
  const sliced = rows.slice(start, start + input.perPage);
  return { rows: sliced, total };
}

function badgeLabelFromDaysFromNow(daysFromNow: number): string {
  if (daysFromNow < 0) return '已逾期';
  if (daysFromNow <= 30) return '月度复测';
  if (daysFromNow <= 90) return '季度复测';
  return '半年复测';
}

function nextCheckFromSnapshotMetric(
  metricSnapshot: HealthMetricSnapshot | null,
  nowIso: string,
): GrowthNextCheck {
  if (!metricSnapshot || !metricSnapshot.nextRecordAt) {
    return { state: 'unscheduled' };
  }
  const nextMs = Date.parse(metricSnapshot.nextRecordAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nextMs) || Number.isNaN(nowMs)) return { state: 'unscheduled' };
  const daysFromNow = Math.round((nextMs - nowMs) / 86400000);
  const ledeTemplate: GrowthNextCheckScheduled['ledeTemplate'] =
    daysFromNow < 0 ? 'next_check_overdue' : daysFromNow <= 14 ? 'next_check_due_soon' : 'next_check_upcoming';
  return {
    state: 'scheduled',
    nextRecordAt: metricSnapshot.nextRecordAt,
    daysFromNow,
    badgeLabel: badgeLabelFromDaysFromNow(daysFromNow),
    ledeTemplate,
    // Per design.md §11 wave-C entry — wave-A defaults conservatively to
    // deep_link_only. Wave-C resolves the actual writeback availability.
    reminderActionability: 'deep_link_only',
  };
}

function findMetricSnapshot(
  events: HealthRecordEvent[],
  values: HealthRecordValue[],
  childId: string,
  ageMonths: number,
  metricId: HealthMetricId,
  nowIso: string,
  gender: 'M' | 'F',
  growthStandard: GrowthStandard,
): HealthMetricSnapshot | null {
  const snapshot = buildHealthRecordSnapshot({
    childId,
    ageMonths,
    events,
    values,
    nowIso,
    sex: gender === 'M' ? 'male' : 'female',
    growthStandard,
  });
  for (const group of snapshot.groups) {
    for (const metric of group.metrics) {
      if (metric.metric.metricId === metricId) return metric;
    }
  }
  return null;
}

function buildTrendStats(
  selectedMetricId: HealthMetricId,
  selectedUnit: string,
  selectedPoints: HistoryPoint[],
  whoDataset: WHOLMSDataset | null,
  nowIso: string,
): GrowthTrendStat[] {
  const latest = selectedPoints[selectedPoints.length - 1];
  if (!latest) {
    return [
      { label: '年增速', value: '—', unit: selectedUnit, caption: '需要更多数据' },
      { label: '距 P50', value: '—', unit: selectedUnit, caption: '需要更多数据' },
      { label: '百分位', value: '—', unit: '', caption: '需要更多数据' },
    ];
  }
  const yearAgoValue = priorYearValue(selectedPoints, latest.measuredAt);
  const yoy = formatYearOverYearDelta(latest.value, yearAgoValue, selectedUnit);
  // Year-over-year framed against the prior-year value as a percentage, e.g.
  // "较去年同期 138.5 cm，增长了 4.0%". Falls back when no prior-year point.
  const yoyCaption = ((): string => {
    if (yearAgoValue == null || yearAgoValue <= 0) return '暂无去年同期数据';
    const unitSuffix = selectedUnit ? ` ${selectedUnit}` : '';
    const pctText = Math.abs(((latest.value - yearAgoValue) / yearAgoValue) * 100).toFixed(1);
    const direction =
      latest.value > yearAgoValue
        ? `增长了 ${pctText}%`
        : latest.value < yearAgoValue
          ? `降低了 ${pctText}%`
          : '基本持平';
    return `较去年同期 ${yearAgoValue}${unitSuffix}，${direction}`;
  })();
  const currentPercentile = computeApproxPercentile(latest.value, latest.ageMonths, whoDataset);

  let p50: number | null = null;
  if (whoDataset) {
    const p50Line = whoDataset.lines.find((l) => l.percentile === 50);
    if (p50Line) {
      const closest = p50Line.points.reduce<
        { ageMonths: number; value: number } | null
      >((acc, point) => {
        if (!acc) return point;
        return Math.abs(point.ageMonths - latest.ageMonths) <
          Math.abs(acc.ageMonths - latest.ageMonths)
          ? point
          : acc;
      }, null);
      p50 = closest?.value ?? null;
    }
  }
  const distanceToP50 =
    p50 != null
      ? `${(Math.round((latest.value - p50) * 10) / 10) >= 0 ? '+' : '−'}${Math.abs(Math.round((latest.value - p50) * 10) / 10)}`
      : '—';

  // 6-month-ago percentile (closest measurement at ≥ 6 months prior)
  const refMs = Date.parse(latest.measuredAt);
  const sixMonthsAgoMs = refMs - 183 * 86400000;
  let priorPoint: HistoryPoint | null = null;
  for (const p of selectedPoints) {
    const ms = Date.parse(p.measuredAt);
    if (ms <= sixMonthsAgoMs) priorPoint = p;
  }
  const priorPercentile = priorPoint
    ? computeApproxPercentile(priorPoint.value, priorPoint.ageMonths, whoDataset)
    : null;
  const percentileChange6m = formatPercentileChange6m(currentPercentile, priorPercentile);
  // Reference `nowIso` so the future-time signal flows through every stat.
  // Currently used for recency caption only.
  const recencyCaption = formatRecencyLabel(latest.measuredAt, nowIso) ?? '';
  // selectedMetricId could be used for metric-specific captions later;
  // referenced here so the parameter participates in the type signature.
  void selectedMetricId;
  return [
    { label: '年增速', value: yoy, unit: '', caption: yoyCaption },
    { label: '距 P50', value: distanceToP50, unit: selectedUnit, caption: recencyCaption },
    {
      label: '百分位',
      value: currentPercentile != null ? `P${currentPercentile}` : '—',
      unit: '',
      caption: `近 6 月 ${percentileChange6m}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Public entry: buildGrowthDetailSnapshot
// ---------------------------------------------------------------------------

export function buildGrowthDetailSnapshot(
  input: GrowthDetailProjectionInput,
): GrowthDetailSnapshot {
  const ageMonths = ageMonthsFromBirthIso(input.child.birthDate, input.nowIso);
  const child: GrowthDetailChild = {
    childId: input.child.childId,
    displayName: input.child.displayName,
    gender: input.child.gender,
    birthDate: input.child.birthDate,
    ageMonths,
    ageLabel: ageLabelFromMonths(ageMonths),
  };

  // Recompute derived health record values (e.g. BMI from height + weight)
  // exactly once so downstream slices, snapshots, and history rows all see
  // the same derived view. Reuses the same makeValueId convention as
  // buildHealthRecordSnapshot to keep ids stable across calls.
  const enrichedValues = recomputeDerivedHealthRecordValues(input.events, input.values, {
    nowIso: input.nowIso,
    makeValueId: (event, metricId, sourceValueIds) =>
      `${event.eventId}:${metricId}:${sourceValueIds.join('+')}`,
  });
  const enrichedInput: GrowthDetailProjectionInput = { ...input, values: enrichedValues };

  // selectedMetric — lookup via snapshot (which sources from
  // health-metric-registry.yaml). buildHealthRecordSnapshot also gives us
  // freshness / nextRecordAt for free.
  const metricSnapshot = findMetricSnapshot(
    enrichedInput.events,
    enrichedInput.values,
    enrichedInput.child.childId,
    ageMonths,
    enrichedInput.selectedMetricId,
    enrichedInput.nowIso,
    enrichedInput.child.gender,
    enrichedInput.growthStandard,
  );

  const selectedMetric: GrowthSelectedMetric = metricSnapshot
    ? {
        metricId: metricSnapshot.metric.metricId,
        displayName: metricSnapshot.metric.displayName,
        unit: metricSnapshot.metric.unit ?? '',
        ageRangeMonths: metricSnapshot.metric.applicableAgeRange
          ? {
              startMonths: metricSnapshot.metric.applicableAgeRange.startMonths,
              endMonths: metricSnapshot.metric.applicableAgeRange.endMonths,
            }
          : null,
      }
    : {
        metricId: input.selectedMetricId,
        displayName: '',
        unit: '',
        ageRangeMonths: null,
      };

  const selectedSlice = sliceForMetric(enrichedInput, enrichedInput.selectedMetricId);
  const selectedLatest = latestValueWithEvent(selectedSlice);
  const selectedPoints = historyPointsForMetric(selectedSlice, enrichedInput.selectedMetricId);

  const recencyLabel = selectedLatest
    ? formatRecencyLabel(selectedLatest.event.effectiveDate, enrichedInput.nowIso)
    : null;

  // ---- Headline -----------------------------------------------------------
  let headline: GrowthHeadline;
  if (!selectedLatest || selectedLatest.value.valueNumber == null) {
    headline = { state: 'no_data' };
  } else {
    const value = selectedLatest.value.valueNumber;
    const unit = selectedLatest.value.unit ?? selectedMetric.unit ?? '';
    const measuredAt = selectedLatest.event.effectiveDate;
    const currentPercentile = computeApproxPercentile(
      value,
      selectedLatest.event.ageMonths,
      enrichedInput.whoDataset,
    );
    const yearAgo = priorYearValue(selectedPoints, measuredAt);
    const yoy = formatYearOverYearDelta(value, yearAgo, unit);
    const trend = computeTrend(selectedPoints);
    const ledeTemplate = pickLedeTemplate(enrichedInput.selectedMetricId, trend, currentPercentile);
    const ledeTemplateInputs: LedeTemplateInputs = {
      currentValueDisplay: `${value} ${unit}`.trim(),
      unit,
      measuredAt,
      yearOverYearDeltaDisplay: yoy,
      currentPercentileLabel: percentileLabel(currentPercentile),
    };
    const referenceAvailable =
      enrichedInput.whoDataset != null &&
      selectedLatest.event.ageMonths >= enrichedInput.whoDataset.coverage.startAgeMonths &&
      selectedLatest.event.ageMonths <= enrichedInput.whoDataset.coverage.endAgeMonths;
    const deltaValue =
      yearAgo == null ? 0 : Math.round((value - yearAgo) * 10) / 10;
    const sign: '+' | '-' | '0' = deltaValue > 0 ? '+' : deltaValue < 0 ? '-' : '0';
    headline = {
      state: referenceAvailable ? 'has_data' : 'out_of_reference',
      currentValueDisplay: `${value} ${unit}`.trim(),
      currentPercentile,
      measuredAt,
      yearOverYearDelta: { value: Math.abs(deltaValue), unit, sign },
      trend,
      ledeTemplate,
      ledeTemplateInputs,
    };
  }

  // ---- Cross-metric chips ------------------------------------------------
  const crossMetric: GrowthChip[] = CROSS_METRIC_ORDER.map(({ kind, metricId }) =>
    chipForMetric(kind, metricId, enrichedInput),
  );

  // ---- Milestones --------------------------------------------------------
  const milestonesInput = allGrowthHistoryPoints(enrichedInput);
  // Full-record milestone set: the history table renders all of it and the
  // hero card a recent slice, so both surfaces stay in sync.
  const milestones = evaluateAllMilestones(milestonesInput, enrichedInput.nowIso, true);

  // ---- nextCheck via HealthRecordSnapshot --------------------------------
  const nextCheck = nextCheckFromSnapshotMetric(metricSnapshot, enrichedInput.nowIso);

  // ---- Trend stats -------------------------------------------------------
  const trendStats = buildTrendStats(
    enrichedInput.selectedMetricId,
    selectedMetric.unit,
    selectedPoints,
    enrichedInput.whoDataset,
    enrichedInput.nowIso,
  );

  // ---- History page ------------------------------------------------------
  const paginated = paginateHistory(enrichedInput);
  const historyPage: GrowthHistoryPage = {
    rows: paginated.rows,
    filters: enrichedInput.filters,
    page: enrichedInput.page,
    perPage: enrichedInput.perPage,
    total: paginated.total,
  };

  // Touch LEDE_TEMPLATES so the registry remains importable even when no
  // headline path renders. (The headline branch above uses ledeTemplate ids
  // by name; consumers render through LEDE_TEMPLATES at the view layer.)
  void LEDE_TEMPLATES;

  return {
    child,
    selectedMetric,
    recencyLabel,
    headline,
    crossMetric,
    milestones,
    nextCheck,
    trendStats,
    historyPage,
    reference: {
      standardId: enrichedInput.growthStandard,
      datasetCoverage: enrichedInput.whoDataset
        ? {
            startAgeMonths: enrichedInput.whoDataset.coverage.startAgeMonths,
            endAgeMonths: enrichedInput.whoDataset.coverage.endAgeMonths,
          }
        : null,
      datasetAvailable: enrichedInput.whoDataset != null,
    },
    generatedAt: enrichedInput.nowIso,
  };
}
