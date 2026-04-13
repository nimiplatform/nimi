import type { MedicalAlert } from '../../engine/smart-alerts.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';

export const EVENT_TYPE_LABELS: Record<string, string> = {
  visit: '门诊',
  emergency: '急诊',
  hospitalization: '住院',
  checkup: '体检',
  medication: '用药',
  'lab-report': '检验报告',
  other: '其他',
};

export const EVENT_TYPE_COLORS: Record<string, string> = {
  visit: '#6366f1',
  emergency: '#ef4444',
  hospitalization: '#f59e0b',
  checkup: '#3b82f6',
  medication: '#10b981',
  'lab-report': '#8b5cf6',
  other: '#6b7280',
};

export const EVENT_TYPE_ICONS: Record<string, string> = {
  visit: '🏥',
  emergency: '🚑',
  hospitalization: '🛏️',
  checkup: '🩺',
  medication: '💊',
  'lab-report': '🧪',
  other: '📋',
};

export interface LabRange {
  max: number;
  color: string;
  label: string;
}

export interface LabItem {
  key: string;
  label: string;
  unit: string;
  ranges: LabRange[];
}

export const LAB_ITEMS: LabItem[] = [
  {
    key: 'vitamin-d',
    label: '维生素D',
    unit: 'ng/mL',
    ranges: [
      { max: 12, color: '#dc2626', label: '严重缺乏' },
      { max: 20, color: '#f59e0b', label: '缺乏' },
      { max: 30, color: '#eab308', label: '不足' },
      { max: 100, color: '#22c55e', label: '充足' },
    ],
  },
  {
    key: 'ferritin',
    label: '铁蛋白',
    unit: 'ng/mL',
    ranges: [
      { max: 12, color: '#dc2626', label: '耗竭' },
      { max: 30, color: '#f59e0b', label: '不足' },
      { max: 150, color: '#22c55e', label: '正常' },
    ],
  },
  {
    key: 'hemoglobin',
    label: '血红蛋白',
    unit: 'g/L',
    ranges: [
      { max: 110, color: '#dc2626', label: '贫血' },
      { max: 120, color: '#f59e0b', label: '偏低' },
      { max: 160, color: '#22c55e', label: '正常' },
    ],
  },
  {
    key: 'calcium',
    label: '血钙',
    unit: 'mmol/L',
    ranges: [
      { max: 2.20, color: '#dc2626', label: '偏低' },
      { max: 2.70, color: '#22c55e', label: '正常' },
      { max: Infinity, color: '#f59e0b', label: '偏高' },
    ],
  },
  {
    key: 'zinc',
    label: '血锌',
    unit: 'μmol/L',
    ranges: [
      { max: 10.7, color: '#dc2626', label: '缺乏' },
      { max: 17.6, color: '#22c55e', label: '正常' },
      { max: Infinity, color: '#f59e0b', label: '偏高' },
    ],
  },
];

export interface LabReportData {
  type: 'lab-report';
  values: Record<string, number | null>;
}

export const SEVERITY_OPTIONS = ['mild', 'moderate', 'severe'] as const;
export const SEVERITY_LABELS: Record<string, string> = {
  mild: '轻度',
  moderate: '中度',
  severe: '重度',
};
export const SEVERITY_COLORS: Record<string, string> = {
  mild: '#22c55e',
  moderate: '#f59e0b',
  severe: '#ef4444',
};
export const RESULT_OPTIONS = ['pass', 'refer', 'fail'] as const;
export const RESULT_LABELS: Record<string, string> = {
  pass: '通过',
  refer: '转诊',
  fail: '未通过',
};

export const COMMON_SYMPTOMS = ['发烧', '咳嗽', '流鼻涕', '呕吐', '腹泻', '皮疹', '腹痛', '头痛'] as const;
export const VISIT_TYPES = ['visit', 'emergency', 'hospitalization', 'checkup', 'medication', 'lab-report', 'other'] as const;

export const ALERT_STYLES: Record<MedicalAlert['level'], { bg: string; border: string; icon: string }> = {
  danger: { bg: '#fef2f2', border: '#fca5a5', icon: '🚨' },
  warning: { bg: '#fffbeb', border: '#fcd34d', icon: '⚠️' },
  info: { bg: '#eff6ff', border: '#93c5fd', icon: 'ℹ️' },
};

export function parseLabReport(notes: string | null): LabReportData | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>;
    return parsed.type === 'lab-report' ? (parsed as unknown as LabReportData) : null;
  } catch {
    return null;
  }
}

export function labRangeFor(item: LabItem, value: number): LabRange {
  return item.ranges.find((range) => value <= range.max) ?? item.ranges[item.ranges.length - 1]!;
}

export function groupByMonth(events: MedicalEventRow[]): [string, MedicalEventRow[]][] {
  const map = new Map<string, MedicalEventRow[]>();
  for (const event of events) {
    const yearMonth = event.eventDate.slice(0, 7);
    const list = map.get(yearMonth);
    if (list) list.push(event);
    else map.set(yearMonth, [event]);
  }
  return [...map.entries()].sort((left, right) => right[0].localeCompare(left[0]));
}

export function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year} 年 ${parseInt(month ?? '1', 10)} 月`;
}
