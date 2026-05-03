import {
  HEALTH_REMINDER_CAPTURE_TARGETS,
  type HealthDateDefaultPolicy,
  type HealthRecordDataRuleId,
} from '../../knowledge-base/index.js';
import type { ActiveReminder } from '../../engine/reminder-engine.js';
import type { HealthCaptureIntent } from '../profile/health-capture-orchestrator.js';

const targetByRuleId = new Map(
  HEALTH_REMINDER_CAPTURE_TARGETS.map((target) => [target.ruleId, target]),
);

export function isRecordDataReminder(reminder: Pick<ActiveReminder, 'rule'>) {
  return reminder.rule.actionType === 'record_data';
}

export function buildRecordDataCaptureIntent(
  reminder: ActiveReminder,
  localToday: string,
): HealthCaptureIntent {
  if (!isRecordDataReminder(reminder)) {
    throw new Error(`Reminder ${reminder.rule.ruleId} is not a record_data reminder`);
  }

  const target = targetByRuleId.get(reminder.rule.ruleId as HealthRecordDataRuleId);
  if (!target) {
    throw new Error(`Missing reminder capture target for ${reminder.rule.ruleId}`);
  }

  const scheduledFor = reminder.state?.scheduledDate ?? reminder.effectiveStartDate;
  const dueDate = reminder.effectiveEndDate;

  return {
    protocolId: target.captureProtocolId,
    mode: 'reminder',
    effectiveDate: effectiveDateForPolicy(target.dateDefaultPolicy, {
      scheduledFor,
      dueDate,
      localToday,
    }),
    linkedReminder: {
      stateId: reminder.state?.stateId ?? null,
      ruleId: reminder.rule.ruleId,
      scheduledFor,
      dueDate,
    },
  };
}

function effectiveDateForPolicy(
  policy: HealthDateDefaultPolicy,
  input: { scheduledFor: string | null; dueDate: string | null; localToday: string },
) {
  switch (policy) {
    case 'scheduledDate':
      return (input.scheduledFor ?? input.localToday).slice(0, 10);
    case 'dueDate':
      return (input.dueDate ?? input.localToday).slice(0, 10);
    case 'today':
      return input.localToday.slice(0, 10);
  }
}
