import { describe, expect, it } from 'vitest';
import { REMINDER_RULES, type ReminderRule } from '../knowledge-base/index.js';
import { computeActiveReminders, partitionReminders } from './reminder-engine.js';

describe('reminder-engine phase 1 acceptance', () => {
  it('keeps every P0 rule on push visibility in every nurture mode', () => {
    const p0Rules = REMINDER_RULES.filter((rule) => rule.priority === 'P0' && rule.category !== 'personalized');

    expect(p0Rules.length).toBeGreaterThan(0);

    for (const rule of p0Rules) {
      const activeAge = rule.triggerAge.startMonths;

      for (const mode of ['relaxed', 'balanced', 'advanced'] as const) {
        const reminders = computeActiveReminders([rule], activeAge, mode, null, []);
        expect(reminders.length, `${rule.ruleId} should be active in ${mode}`).toBeGreaterThan(0);
        expect(reminders[0]?.visibility, `${rule.ruleId} should stay push in ${mode}`).toBe('push');
      }
    }
  });

  it('projects active push reminders into today and pending reminders into upcoming', () => {
    const activeRule: ReminderRule = {
      ruleId: 'PO-REM-TEST-001',
      domain: 'sleep',
      category: 'rigid',
      title: 'Active rule',
      description: 'Now',
      triggerAge: { startMonths: 12, endMonths: 12 },
      priority: 'P1',
      nurtureMode: { relaxed: 'push', balanced: 'push', advanced: 'push' },
      actionType: 'observe',
      source: 'test',
    };

    const pendingRule: ReminderRule = {
      ...activeRule,
      ruleId: 'PO-REM-TEST-002',
      title: 'Pending rule',
      triggerAge: { startMonths: 13, endMonths: 13 },
    };

    const reminders = computeActiveReminders([activeRule, pendingRule], 12, 'balanced', null, []);
    const buckets = partitionReminders(reminders);

    expect(buckets.today.map((item) => item.rule.ruleId)).toContain('PO-REM-TEST-001');
    expect(buckets.upcoming.map((item) => item.rule.ruleId)).toContain('PO-REM-TEST-002');
  });
});
