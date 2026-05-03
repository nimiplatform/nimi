import type { HealthRecordEventRow, HealthRecordValueRow } from '../../bridge/sqlite-bridge.js';
import type {
  HealthRecordEvent,
  HealthRecordEventKind,
  HealthRecordValue,
  HealthRecordValueKind,
} from '../../engine/health-record-domain.js';
import type { HealthMetricId } from '../../knowledge-base/index.js';

export function eventRowToDomain(row: HealthRecordEventRow): HealthRecordEvent {
  return {
    eventId: row.eventId,
    childId: row.childId,
    protocolId: row.protocolId,
    groupId: row.groupId,
    recordKind: row.recordKind as HealthRecordEventKind,
    sourceSurface: row.sourceSurface as HealthRecordEvent['sourceSurface'],
    recordedAt: row.recordedAt,
    effectiveDate: row.effectiveDate,
    ageMonths: row.ageMonths,
    recorderId: row.recorderId,
    linkedReminderStateId: row.linkedReminderStateId,
    linkedReminderRuleId: row.linkedReminderRuleId,
    notes: row.notes,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function valueRowToDomain(row: HealthRecordValueRow): HealthRecordValue {
  return {
    valueId: row.valueId,
    eventId: row.eventId,
    childId: row.childId,
    metricId: row.metricId as HealthMetricId,
    valueNumber: row.valueNumber,
    valueText: row.valueText,
    valueJson: row.valueJson,
    unit: row.unit,
    qualifier: row.qualifier,
    recordKind: row.recordKind as HealthRecordValueKind,
    sourceValueIds: row.sourceValueIds,
    createdAt: row.createdAt,
  };
}
