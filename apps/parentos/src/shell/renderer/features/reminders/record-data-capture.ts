import {
  HEALTH_CAPTURE_PROTOCOLS,
  HEALTH_REMINDER_CAPTURE_TARGETS,
  type HealthRecordDataRuleId,
} from '../../knowledge-base/index.js';
import type { ActiveReminder } from '../../engine/reminder-engine.js';
import type { LinkedHealthRecordReminder } from '../profile/health-capture-orchestrator.js';

const targetByRuleId = new Map(
  HEALTH_REMINDER_CAPTURE_TARGETS.map((target) => [target.ruleId, target]),
);

const protocolGroup = new Map(
  HEALTH_CAPTURE_PROTOCOLS.map((protocol) => [protocol.protocolId, protocol.groupId] as const),
);

export function isRecordDataReminder(reminder: Pick<ActiveReminder, 'rule'>) {
  return reminder.rule.actionType === 'record_data';
}

export function canDirectlyCompleteReminder(reminder: Pick<ActiveReminder, 'rule'>) {
  return !isRecordDataReminder(reminder);
}

export interface RecordDataReminderSelection {
  /** Sidebar group to open in HealthCaptureModal. */
  groupId: string;
  /** Optional metric the reminder asks to capture (forwarded as initialMetricId). */
  metricId?: string | null;
  /** Reminder linkage forwarded into the per-group form's save. */
  linkedReminder: LinkedHealthRecordReminder;
}

/**
 * Resolve the sidebar group + reminder linkage for a record_data reminder so the
 * 记录 button can open the same sidebar modal that the profile page uses. The
 * `linkedReminder` payload satisfies capture-orchestrator-contract.md and lands
 * in `health_record_events.linkedReminderStateId/RuleId` via the per-group
 * form's insert path.
 */
export function getRecordDataReminderSelection(
  reminder: ActiveReminder,
): RecordDataReminderSelection {
  if (!isRecordDataReminder(reminder)) {
    throw new Error(`Reminder ${reminder.rule.ruleId} is not a record_data reminder`);
  }

  const target = targetByRuleId.get(reminder.rule.ruleId as HealthRecordDataRuleId);
  if (!target) {
    throw new Error(`Missing reminder capture target for ${reminder.rule.ruleId}`);
  }

  const groupId = protocolGroup.get(target.captureProtocolId);
  if (!groupId) {
    throw new Error(
      `Missing protocol group for capture protocol ${target.captureProtocolId}`,
    );
  }

  return {
    groupId,
    metricId: target.targetMetricIds[0] ?? null,
    linkedReminder: {
      stateId: reminder.state?.stateId ?? null,
      ruleId: reminder.rule.ruleId,
      scheduledFor: reminder.state?.scheduledDate ?? reminder.effectiveStartDate,
      dueDate: reminder.effectiveEndDate,
    },
  };
}
