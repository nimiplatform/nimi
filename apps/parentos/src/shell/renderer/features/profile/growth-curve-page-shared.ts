import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import type { WHOLMSDataset } from './who-lms-loader.js';

export type GrowthMetricDefinition = (typeof GROWTH_STANDARDS)[number];

export const TYPE_COLORS: Record<string, string> = {
  height: '#6366f1',
  weight: '#10b981',
  'head-circumference': '#f59e0b',
};

export const METRIC_CARDS: Array<{
  typeId: GrowthTypeId;
  emoji: string;
  label: string;
  unit: string;
  maxAgeMonths?: number;
  minAgeMonths?: number;
}> = [
  { typeId: 'height', emoji: '📏', label: '身高', unit: 'cm' },
  { typeId: 'weight', emoji: '⚖️', label: '体重', unit: 'kg' },
  { typeId: 'head-circumference', emoji: '📐', label: '头围', unit: 'cm', maxAgeMonths: 72 },
  { typeId: 'bmi', emoji: '🏃', label: 'BMI', unit: 'kg/m²', minAgeMonths: 24 },
];

export const OTHER_TYPE_IDS = [] as const;
export const CARD_TYPE_IDS = new Set(METRIC_CARDS.map((card) => card.typeId));

export interface MergedPoint {
  age: number;
  value?: number;
  date?: string;
  p3?: number;
  p10?: number;
  p25?: number;
  p50?: number;
  p75?: number;
  p90?: number;
  p97?: number;
}

export function computeBMI(heightCm: number, weightKg: number): number {
  const hm = heightCm / 100;
  return Math.round((weightKg / (hm * hm)) * 10) / 10;
}

export function bmiLabel(bmi: number): { tag: string; color: string } {
  if (bmi < 14) return { tag: '🔵 偏轻', color: '#3b82f6' };
  if (bmi < 18.5) return { tag: '🟢 正常', color: '#22c55e' };
  if (bmi < 24) return { tag: '🟡 偏重', color: '#eab308' };
  return { tag: '🔴 肥胖', color: '#ef4444' };
}

export function fmtMeasDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return '今天记录';
  if (diffDays === 1) return '昨天记录';
  if (diffDays < 7) return `${diffDays}天前记录`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前记录`;
  if (diffDays < 365) return `${d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} 记录`;
  return `${d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })} 记录`;
}

export function getLatestMeasurement(measurements: MeasurementRow[], typeId: string): MeasurementRow | undefined {
  let best: MeasurementRow | undefined;
  for (const measurement of measurements) {
    if (measurement.typeId === typeId && (!best || measurement.measuredAt > best.measuredAt)) {
      best = measurement;
    }
  }
  return best;
}

export function getPreviousMeasurement(measurements: MeasurementRow[], typeId: string): MeasurementRow | undefined {
  const sorted = measurements
    .filter((measurement) => measurement.typeId === typeId)
    .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt));
  return sorted[1];
}

export function buildMergedChartData(
  userData: Array<{ age: number; value: number; date?: string }>,
  refDataset: WHOLMSDataset | null,
): MergedPoint[] {
  if (!refDataset) return userData;

  const refByAge = new Map<number, Record<string, number>>();
  for (const line of refDataset.lines) {
    for (const point of line.points) {
      const key = Math.round(point.ageMonths * 100) / 100;
      const entry = refByAge.get(key) ?? {};
      entry[`p${line.percentile}`] = point.value;
      refByAge.set(key, entry);
    }
  }

  const userAges = new Set(userData.map((item) => item.age));
  const minAge = userData.length > 0 ? Math.min(...userData.map((item) => item.age)) : 0;
  const maxAge = userData.length > 0 ? Math.max(...userData.map((item) => item.age)) : 0;

  const allAges = new Set<number>();
  for (const age of userAges) allAges.add(age);
  for (const age of refByAge.keys()) {
    if (age >= minAge - 12 && age <= maxAge + 12 && Number.isInteger(age)) allAges.add(age);
  }

  const sorted = [...allAges].sort((left, right) => left - right);
  const userMap = new Map(userData.map((item) => [item.age, item]));

  return sorted.map((age) => {
    const userPoint = userMap.get(age);
    const refPoint = refByAge.get(age) ?? {};
    return {
      age,
      value: userPoint?.value,
      date: userPoint?.date,
      p3: refPoint.p3,
      p10: refPoint.p10,
      p25: refPoint.p25,
      p50: refPoint.p50,
      p75: refPoint.p75,
      p90: refPoint.p90,
      p97: refPoint.p97,
    };
  });
}

export function getPercentileHint(
  value: number,
  refs: {
    p3?: number;
    p10?: number;
    p25?: number;
    p50?: number;
    p75?: number;
    p90?: number;
    p97?: number;
  },
) {
  if (refs.p97 != null && value >= refs.p97) return { text: '超过同龄 97% 的孩子（偏高）', color: '#f59e0b' };
  if (refs.p90 != null && value >= refs.p90) return { text: '超过同龄 90% 的孩子', color: '#22c55e' };
  if (refs.p75 != null && value >= refs.p75) return { text: '超过同龄 75% 的孩子', color: '#22c55e' };
  if (refs.p50 != null && value >= refs.p50) return { text: '处于同龄中等偏上水平', color: '#22c55e' };
  if (refs.p25 != null && value >= refs.p25) return { text: '处于同龄平均水平', color: '#8a8f9a' };
  if (refs.p10 != null && value >= refs.p10) return { text: '偏低，建议关注', color: '#f59e0b' };
  if (refs.p3 != null && value >= refs.p3) return { text: '明显偏低，建议咨询专业人士', color: '#ef4444' };
  if (refs.p3 != null) return { text: '低于同龄 97% 的孩子，建议就医评估', color: '#ef4444' };
  return null;
}

export function computeChartYDomain(merged: MergedPoint[], selectedType: string): [number, number] {
  const values: number[] = [];
  for (const point of merged) {
    if (point.value != null) values.push(point.value);
    if (point.p3 != null) values.push(point.p3);
    if (point.p97 != null) values.push(point.p97);
  }
  if (values.length === 0) return [0, 100];
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = (max - min) * 0.1 || 5;
  min = min - pad;
  max = max + pad;
  const step = selectedType === 'weight' ? 2 : selectedType === 'bmi' ? 1 : 5;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  if (min < 0) min = 0;
  return [min, max];
}

export function computeApproxPercentile(
  value: number,
  ageMonths: number,
  whoDataset: WHOLMSDataset | null,
): number | null {
  if (!whoDataset) return null;
  if (ageMonths < whoDataset.coverage.startAgeMonths || ageMonths > whoDataset.coverage.endAgeMonths) return null;

  const percentileValues: Array<{ percentile: number; value: number }> = [];
  for (const line of whoDataset.lines) {
    let lo: { ageMonths: number; value: number } | null = null;
    let hi: { ageMonths: number; value: number } | null = null;
    for (const point of line.points) {
      if (point.ageMonths <= ageMonths) lo = point;
      if (point.ageMonths >= ageMonths && !hi) hi = point;
    }
    if (!lo && !hi) continue;
    let interpolatedValue: number;
    if (!lo) interpolatedValue = hi!.value;
    else if (!hi) interpolatedValue = lo.value;
    else if (lo.ageMonths === hi.ageMonths) interpolatedValue = lo.value;
    else {
      interpolatedValue = lo.value + (hi.value - lo.value) * (ageMonths - lo.ageMonths) / (hi.ageMonths - lo.ageMonths);
    }
    percentileValues.push({ percentile: line.percentile, value: interpolatedValue });
  }
  if (percentileValues.length === 0) return null;

  percentileValues.sort((left, right) => left.percentile - right.percentile);

  if (value <= percentileValues[0]!.value) return percentileValues[0]!.percentile;
  if (value >= percentileValues[percentileValues.length - 1]!.value) return percentileValues[percentileValues.length - 1]!.percentile;

  for (let index = 0; index < percentileValues.length - 1; index++) {
    const lo = percentileValues[index]!;
    const hi = percentileValues[index + 1]!;
    if (value >= lo.value && value <= hi.value) {
      const fraction = (value - lo.value) / (hi.value - lo.value);
      return Math.round(lo.percentile + fraction * (hi.percentile - lo.percentile));
    }
  }
  return null;
}

export function formatAgeLabel(age: number): string {
  if (age >= 24) {
    const years = Math.floor(age / 12);
    const months = age % 12;
    return months > 0 ? `${years}岁${months}个月` : `${years}岁`;
  }
  return `${age}个月`;
}

export function buildGrowthSummaryContext(
  measurements: MeasurementRow[],
  computedBmi: number | null,
): string {
  const latestHeight = getLatestMeasurement(measurements, 'height');
  const latestWeight = getLatestMeasurement(measurements, 'weight');
  const latestHeadCirc = getLatestMeasurement(measurements, 'head-circumference');
  const lines: string[] = [];
  if (latestHeight) lines.push(`身高: ${latestHeight.value}cm (${latestHeight.measuredAt.split('T')[0]})`);
  if (latestWeight) lines.push(`体重: ${latestWeight.value}kg (${latestWeight.measuredAt.split('T')[0]})`);
  if (computedBmi != null) lines.push(`BMI: ${computedBmi}`);
  if (latestHeadCirc) lines.push(`头围: ${latestHeadCirc.value}cm (${latestHeadCirc.measuredAt.split('T')[0]})`);
  lines.push(`共 ${measurements.length} 条测量记录`);
  return lines.length > 1 ? lines.join('\n') : '';
}

export function getStaleMeasurementDays(measurements: MeasurementRow[]): number | null {
  const timestamps = measurements.map((measurement) => new Date(measurement.measuredAt).getTime());
  if (timestamps.length === 0) return null;
  return Math.floor((Date.now() - Math.max(...timestamps)) / 86400000);
}

export function getMeasurementSourceLabel(source: MeasurementRow['source']): string {
  if (source === 'manual') return '手动';
  if (source === 'ocr') return 'OCR';
  if (source === 'computed') return '计算';
  return '-';
}

export function getGrowthStandardTooltip(standard: 'china' | 'who'): string {
  if (standard === 'china') {
    return '0-7岁: WS/T 423-2022《7岁以下儿童生长标准》\n(国家卫健委, 2023年实施, 基于2015年九市调查)\n\n7-18岁: 《中国0-18岁儿童青少年身高体重标准化生长曲线》\n(李辉等, 首都儿科研究所, 2009)';
  }
  return 'WHO Child Growth Standards (2006)\n0-5岁多中心生长参照研究\n\nWHO Growth Reference (2007)\n5-19岁生长参照数据';
}
