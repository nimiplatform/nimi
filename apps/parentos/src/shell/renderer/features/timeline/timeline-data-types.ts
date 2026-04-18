import type * as React from 'react';
import type { ReminderState } from '../../engine/reminder-engine.js';
import type { CustomTodoRow, MeasurementRow, OutdoorRecordRow, SleepRecordRow, VaccineRecordRow } from '../../bridge/sqlite-bridge.js';
import type { KeepsakeReason } from '../journal/journal-page-helpers.js';

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
    keepsakeTitle: string | null;
    keepsakeReason: KeepsakeReason | null;
    dimensionId: string | null;
  }>;
  sleepRecords: SleepRecordRow[];
  allergyRecords: AllergyRec[];
  customTodos: CustomTodoRow[];
  latestMonthlyReport: MonthlyReportSummary | null;
  outdoorRecords: OutdoorRecordRow[];
  outdoorGoalMinutes: number | null;
}

export type RecentChangeIconName =
  | 'moon'
  | 'book'
  | 'mic'
  | 'sparkle'
  | 'trophy'
  | 'syringe'
  | 'ruler'
  | 'eye'
  | 'bone';

export interface RecentChangeItem {
  id: string;
  domain: 'milestone' | 'vaccine' | 'growth' | 'vision' | 'bone-age' | 'sleep' | 'journal';
  label: string;
  title: string;
  detail: string;
  timestamp: string;
  to: string;
  icon: string;
  /** Optional structured fields — allow the card to render a hero metric + soft secondary line. */
  metric?: { value: string; unit?: string | null } | null;
  subtitle?: string | null;
  summary?: string | null;
  iconName?: RecentChangeIconName | null;
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
  badgeTone?: 'default' | 'keepsake';
  tag?: string | null;
}

export interface SleepTrendPoint {
  date: string;
  durationMinutes: number;
  bedtime: string | null;
  wakeTime: string | null;
}

export interface SleepTrendSummary {
  points: SleepTrendPoint[];
  avgDurationMinutes: number | null;
  latestBedtime: string | null;
  latestWakeTime: string | null;
  totalRecords: number;
}

export interface MilestoneTimelineItem {
  milestoneId: string;
  title: string;
  domain: string;
  achievedAt?: string;
  typicalAgeLabel: string;
}

export interface MilestoneTimelineSummary {
  recentlyAchieved: MilestoneTimelineItem[];
  upcoming: MilestoneTimelineItem[];
}

export interface DimensionDistributionItem {
  dimensionId: string;
  displayName: string;
  count: number;
  ratio: number;
}

export interface ObservationDistributionSummary {
  items: DimensionDistributionItem[];
  totalEntries: number;
}

export interface VisionSnapshotSummary {
  leftEye: string | null;
  rightEye: string | null;
  measuredAt: string | null;
  measuredLabel: string;
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
  sleepTrend: SleepTrendSummary;
  visionSnapshot: VisionSnapshotSummary;
  milestoneTimeline: MilestoneTimelineSummary;
  observationDistribution: ObservationDistributionSummary;
  recentLines: RecentLineItem[];
}

export const C = {
  bg: '#f1f5f9',
  card: '#ffffff',
  accent: '#4ECCA3',
  accentDim: '#4ECCA344',
  text: '#1e293b',
  sub: '#475569',
  brand: '#f1f5f9',
  cardProfile: '#818CF8',
  shadow: '0 8px 32px rgba(31,38,135,0.04)',
  radius: 'rounded-[24px]',
} as const satisfies Record<string, string>;

export type TimelineCardStyleTokens = typeof C;
export type TimelineReactNode = React.ReactNode;
