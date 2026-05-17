import { describe, expect, it } from 'vitest';
import type { ActiveReminder, ReminderState } from '../../engine/reminder-engine.js';
import {
  ORTHODONTIC_RECORD_DATA_RULE_IDS,
  isOrthodonticRecordDataReminder,
  parseOrthodonticReminderBinding,
} from './orthodontic-record-data-capture.js';

function state(notes: string | null): ReminderState {
  return {
    stateId: 'st-1',
    childId: 'child-1',
    ruleId: 'PO-ORTHO-EXPANDER-ACTIVATION',
    status: 'active',
    activatedAt: '2026-05-10T00:00:00.000Z',
    completedAt: null,
    dismissedAt: null,
    dismissReason: null,
    repeatIndex: 0,
    nextTriggerAt: '2026-05-14T00:00:00.000Z',
    snoozedUntil: null,
    scheduledDate: null,
    notApplicable: 0,
    plannedForDate: null,
    surfaceRank: null,
    lastSurfacedAt: null,
    surfaceCount: 0,
    notes,
    acknowledgedAt: null,
    reflectedAt: null,
    practiceStartedAt: null,
    practiceLastAt: null,
    practiceCount: 0,
    practiceHabituatedAt: null,
    consultedAt: null,
    consultationConversationId: null,
  } as unknown as ReminderState;
}

function reminder(ruleId: string, notes: string | null = '[ortho-protocol] applianceId=appl-99'): ActiveReminder {
  return {
    rule: {
      ruleId,
      title: 'x',
      description: '',
      domain: 'dental',
      priority: 'P1',
      kind: 'task',
      actionType: 'record_data',
      nurtureMode: { relaxed: 'push', balanced: 'push', advanced: 'push' },
    },
    visibility: 'push',
    repeatIndex: 0,
    effectiveAgeMonths: 156,
    effectiveStartDate: '2026-05-14',
    effectiveEndDate: '2026-05-21',
    kind: 'task',
    lifecycle: 'overdue',
    status: 'active',
    overdueDays: 3,
    daysUntilStart: -3,
    daysUntilEnd: 4,
    deliveryDisposition: 'normal',
    state: state(notes),
  } as unknown as ActiveReminder;
}

describe('orthodontic record_data dispatch', () => {
  it('exposes the three admitted ortho record_data ruleIds', () => {
    expect(ORTHODONTIC_RECORD_DATA_RULE_IDS).toEqual(
      new Set(['PO-ORTHO-EXPANDER-ACTIVATION', 'PO-ORTHO-ALIGNER-CHANGE', 'PO-ORTHO-UNWEAR-OPEN']),
    );
  });

  it('flags ortho record_data reminders', () => {
    expect(isOrthodonticRecordDataReminder(reminder('PO-ORTHO-EXPANDER-ACTIVATION'))).toBe(true);
    expect(isOrthodonticRecordDataReminder(reminder('PO-ORTHO-ALIGNER-CHANGE'))).toBe(true);
    expect(isOrthodonticRecordDataReminder(reminder('PO-ORTHO-UNWEAR-OPEN'))).toBe(true);
    expect(isOrthodonticRecordDataReminder(reminder('PO-REM-GRO-002'))).toBe(false);
  });

  it('parses applianceId from the protocol-reminder notes for expander activation', () => {
    const binding = parseOrthodonticReminderBinding(
      reminder('PO-ORTHO-EXPANDER-ACTIVATION', '[ortho-protocol] applianceId=appl-7'),
    );
    expect(binding).toEqual({
      kind: 'expander-activation',
      applianceId: 'appl-7',
      intervalId: null,
    });
  });

  it('parses both applianceId and intervalId for unwear-open', () => {
    const binding = parseOrthodonticReminderBinding(
      reminder('PO-ORTHO-UNWEAR-OPEN', '[ortho-protocol] applianceId=appl-2; intervalId=int-9'),
    );
    expect(binding).toEqual({
      kind: 'unwear-open',
      applianceId: 'appl-2',
      intervalId: 'int-9',
    });
  });

  it('returns null for non-ortho reminders', () => {
    expect(parseOrthodonticReminderBinding(reminder('PO-REM-GRO-002'))).toBeNull();
  });

  it('fails closed when notes are missing the applianceId', () => {
    expect(() =>
      parseOrthodonticReminderBinding(reminder('PO-ORTHO-EXPANDER-ACTIVATION', '[ortho-protocol] something else')),
    ).toThrow(/missing applianceId/);
  });

  it('fails closed when notes are absent', () => {
    expect(() =>
      parseOrthodonticReminderBinding(reminder('PO-ORTHO-EXPANDER-ACTIVATION', null)),
    ).toThrow(/no reminder_state.notes binding/);
  });
});
