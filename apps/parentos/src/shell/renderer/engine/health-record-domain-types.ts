import type {
  HealthEvaluationStatus,
  HealthMetricDefinition,
  HealthMetricGroup,
  HealthMetricId,
  HealthStatusColorAlias,
} from '../knowledge-base/index.js';

export type HealthRecordEventKind = 'manual' | 'imported' | 'ocr_confirmed' | 'reminder_linked' | 'derived';
export type HealthRecordValueKind = 'measured' | 'derived' | 'parent_confirmed_import';

export interface HealthRecordEvent {
  eventId: string;
  childId: string;
  protocolId: string;
  groupId: string;
  recordKind: HealthRecordEventKind;
  sourceSurface: 'profile_console' | 'profile_detail' | 'reminder' | 'ocr_tool' | 'import';
  recordedAt: string;
  effectiveDate: string;
  ageMonths: number;
  recorderId?: string | null;
  linkedReminderStateId?: string | null;
  linkedReminderRuleId?: string | null;
  notes?: string | null;
  metadataJson?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HealthRecordValue {
  valueId: string;
  eventId: string;
  childId: string;
  metricId: HealthMetricId;
  valueNumber?: number | null;
  valueText?: string | null;
  valueJson?: string | null;
  unit?: string | null;
  qualifier?: string | null;
  recordKind: HealthRecordValueKind;
  sourceValueIds?: string | null;
  createdAt: string;
}

export interface HealthEvaluation {
  status: HealthEvaluationStatus;
  colorAlias: HealthStatusColorAlias;
  statusReasonCode: string;
  shortLabel: string;
  explanation: string;
  sourceRefs: readonly string[];
  computedAt: string;
  inputs: Record<string, unknown>;
  safetyBoundary: 'descriptive_only' | 'professional_review_prompt' | 'not_evaluated';
}

export interface HealthMetricSnapshot {
  metric: HealthMetricDefinition;
  latestValue: HealthRecordValue | null;
  latestEvent: HealthRecordEvent | null;
  nextRecordAt: string | null;
  freshness: 'missing' | 'fresh' | 'stale' | 'unscheduled' | 'error';
  evaluation: HealthEvaluation;
}

export interface HealthGroupSnapshot {
  group: HealthMetricGroup;
  metrics: readonly HealthMetricSnapshot[];
}

export interface HealthRecordSnapshot {
  childId: string;
  ageMonths: number;
  computedAt: string;
  groups: readonly HealthGroupSnapshot[];
}

export interface RecomputeDerivedValuesOptions {
  nowIso: string;
  makeValueId: (event: HealthRecordEvent, metricId: HealthMetricId, sourceValueIds: readonly string[]) => string;
}
