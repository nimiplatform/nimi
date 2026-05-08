import { describe, expect, it } from 'vitest';
import type { ActiveReminder } from '../../engine/reminder-engine.js';
import { applyReminderAction } from '../../engine/reminder-actions.js';
import { buildRecordDataCaptureIntent, canDirectlyCompleteReminder } from './record-data-capture.js';

function reminder(overrides: Partial<ActiveReminder> = {}): ActiveReminder {
  return {
    rule: {
      ruleId: 'PO-REM-GRO-002',
      title: 'Record growth',
      description: '',
      category: 'age_based',
      domain: 'growth',
      priority: 'P1',
      visibility: 'push',
      kind: 'task',
      actionType: 'record_data',
      triggerAge: { startMonths: 24, endMonths: 27 },
      nurtureMode: { relaxed: 'push', balanced: 'push', advanced: 'push' },
    },
    visibility: 'push',
    repeatIndex: 0,
    effectiveAgeMonths: 24,
    effectiveStartDate: '2026-05-01',
    effectiveEndDate: '2026-08-01',
    kind: 'task',
    lifecycle: 'due',
    status: 'active',
    overdueDays: 0,
    daysUntilStart: 0,
    daysUntilEnd: 90,
    deliveryDisposition: 'normal',
    state: null,
    ...overrides,
  } as ActiveReminder;
}

describe('record-data reminder capture intent', () => {
  it('maps an admitted record_data rule to a locked capture protocol intent', () => {
    const intent = buildRecordDataCaptureIntent(reminder(), '2026-05-02');

    expect(intent.protocolId).toBe('growth-child-quarterly');
    expect(intent.mode).toBe('reminder');
    expect(intent.effectiveDate).toBe('2026-05-01');
    expect(intent.linkedReminder?.ruleId).toBe('PO-REM-GRO-002');
    expect(canDirectlyCompleteReminder(reminder())).toBe(false);
  });

  it('fails closed when a record_data rule has no capture target', () => {
    expect(() =>
      buildRecordDataCaptureIntent(
        reminder({
          rule: {
            ...reminder().rule,
            ruleId: 'PO-REM-NOT-ADMITTED',
          },
        }),
        '2026-05-02',
      ),
    ).toThrow(/Missing reminder capture target/);
  });

  it('rejects direct complete dispatch for record_data reminders before any state write', async () => {
    await expect(
      applyReminderAction({
        childId: 'child-1',
        reminder: reminder(),
        state: null,
        action: 'complete',
        now: '2026-05-02T10:00:00.000Z',
      }),
    ).rejects.toThrow(/record_data completion requires capture policy proof/);
  });
});
