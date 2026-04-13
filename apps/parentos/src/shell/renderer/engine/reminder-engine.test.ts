import { describe, expect, it } from 'vitest';
import type { ReminderRule } from '../knowledge-base/index.js';
import { buildReminderAgenda, computeEligibleReminders, toReminderKind, type ReminderState } from './reminder-engine.js';

const baseRule: ReminderRule = {
  ruleId: 'PO-REM-TEST-001',
  domain: 'sleep',
  category: 'rigid',
  title: 'Test rule',
  description: 'Test description',
  triggerAge: { startMonths: 12, endMonths: 12 },
  priority: 'P1',
  nurtureMode: { relaxed: 'push', balanced: 'push', advanced: 'push' },
  actionType: 'observe',
  source: 'test',
};

function makeState(overrides: Partial<ReminderState>): ReminderState {
  return {
    stateId: overrides.stateId ?? 'state-1',
    childId: overrides.childId ?? 'child-1',
    ruleId: overrides.ruleId ?? 'PO-REM-TEST-001',
    status: overrides.status ?? 'active',
    activatedAt: overrides.activatedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    dismissedAt: overrides.dismissedAt ?? null,
    dismissReason: overrides.dismissReason ?? null,
    repeatIndex: overrides.repeatIndex ?? 0,
    nextTriggerAt: overrides.nextTriggerAt ?? null,
    snoozedUntil: overrides.snoozedUntil ?? null,
    scheduledDate: overrides.scheduledDate ?? null,
    notApplicable: overrides.notApplicable ?? 0,
    plannedForDate: overrides.plannedForDate ?? null,
    surfaceRank: overrides.surfaceRank ?? null,
    lastSurfacedAt: overrides.lastSurfacedAt ?? null,
    surfaceCount: overrides.surfaceCount ?? 0,
    notes: overrides.notes ?? null,
    createdAt: overrides.createdAt ?? null,
    updatedAt: overrides.updatedAt ?? null,
  };
}

describe('reminder engine eligibility', () => {
  it('keeps every P0 rule on push visibility in every nurture mode', () => {
    const p0Rule: ReminderRule = {
      ...baseRule,
      ruleId: 'PO-REM-TEST-100',
      priority: 'P0',
      nurtureMode: { relaxed: 'push', balanced: 'push', advanced: 'push' },
      actionType: 'go_hospital',
    };

    for (const mode of ['relaxed', 'balanced', 'advanced'] as const) {
      const reminders = computeEligibleReminders([p0Rule], {
        birthDate: '2025-04-01',
        gender: 'male',
        ageMonths: 12,
        localToday: '2026-04-08',
        nurtureMode: mode,
        domainOverrides: null,
      }, []);
      expect(reminders).toHaveLength(1);
      expect(reminders[0]?.visibility).toBe('push');
    }
  });

  it('expands repeat rules and keeps only nearby instances', () => {
    const repeatRule: ReminderRule = {
      ...baseRule,
      ruleId: 'PO-REM-TEST-200',
      actionType: 'record_data',
      repeatRule: { intervalMonths: 1, maxRepeats: 3 },
      triggerAge: { startMonths: 12, endMonths: 15 },
    };

    const reminders = computeEligibleReminders([repeatRule], {
      birthDate: '2025-04-01',
      gender: 'male',
      ageMonths: 13,
      localToday: '2026-05-08',
      nurtureMode: 'balanced',
      domainOverrides: null,
    }, []);

    expect(reminders.map((item) => item.repeatIndex)).toEqual([2]);
  });

  it('derives reminder kind only from actionType', () => {
    expect(toReminderKind({ actionType: 'read_guide' })).toBe('guidance');
    expect(toReminderKind({ actionType: 'go_hospital' })).toBe('task');
  });
});

describe('reminder engine orchestration', () => {
  it('lets all concurrent P0 tasks into today focus', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-301', priority: 'P0', actionType: 'go_hospital', domain: 'vaccine' },
      { ...baseRule, ruleId: 'PO-REM-TEST-302', priority: 'P0', actionType: 'go_hospital', domain: 'vaccine', title: 'Second' },
      { ...baseRule, ruleId: 'PO-REM-TEST-303', priority: 'P0', actionType: 'go_hospital', domain: 'vaccine', title: 'Third' },
    ];

    const agenda = buildReminderAgenda(rules, {
      birthDate: '2025-04-01',
      gender: 'male',
      ageMonths: 12,
      localToday: '2026-04-08',
      nurtureMode: 'relaxed',
      domainOverrides: null,
    }, []);

    expect(agenda.todayFocus).toHaveLength(3);
  });

  it('limits non-P0 today items and keeps overflow in thisWeek', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-401', domain: 'growth', actionType: 'record_data' },
      { ...baseRule, ruleId: 'PO-REM-TEST-402', domain: 'vision', actionType: 'record_data', title: 'Vision task' },
      { ...baseRule, ruleId: 'PO-REM-TEST-403', domain: 'dental', actionType: 'record_data', title: 'Dental task' },
    ];

    const agenda = buildReminderAgenda(rules, {
      birthDate: '2025-04-01',
      gender: 'male',
      ageMonths: 12,
      localToday: '2026-04-08',
      nurtureMode: 'relaxed',
      domainOverrides: null,
    }, []);

    expect(agenda.todayFocus).toHaveLength(2);
    expect(agenda.thisWeek).toHaveLength(1);
  });

  it('keeps same-day planned items stable and inserts new P0 items', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-501', domain: 'growth', actionType: 'record_data' },
      { ...baseRule, ruleId: 'PO-REM-TEST-502', domain: 'vision', actionType: 'record_data', title: 'Vision task' },
      { ...baseRule, ruleId: 'PO-REM-TEST-503', domain: 'vaccine', priority: 'P0', actionType: 'go_hospital', title: 'Urgent vaccine' },
    ];
    const states = [
      makeState({ ruleId: 'PO-REM-TEST-501', plannedForDate: '2026-04-08', surfaceRank: 2, lastSurfacedAt: '2026-04-08T08:00:00.000Z', surfaceCount: 1 }),
      makeState({ ruleId: 'PO-REM-TEST-502', stateId: 'state-2', plannedForDate: '2026-04-08', surfaceRank: 1, lastSurfacedAt: '2026-04-08T08:00:00.000Z', surfaceCount: 1 }),
    ];

    const agenda = buildReminderAgenda(rules, {
      birthDate: '2025-04-01',
      gender: 'male',
      ageMonths: 12,
      localToday: '2026-04-08',
      nurtureMode: 'balanced',
      domainOverrides: null,
    }, states);

    expect(agenda.todayFocus.map((item) => item.rule.ruleId)).toContain('PO-REM-TEST-503');
    expect(agenda.todayFocus.map((item) => item.rule.ruleId)).toContain('PO-REM-TEST-501');
    expect(agenda.todayFocus.map((item) => item.rule.ruleId)).toContain('PO-REM-TEST-502');
  });

  it('filters snoozed items and moves expired schedules into overdue summary', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-601', domain: 'growth', actionType: 'record_data' },
      { ...baseRule, ruleId: 'PO-REM-TEST-602', domain: 'vision', actionType: 'go_hospital', title: 'Scheduled task' },
    ];
    const states = [
      makeState({ ruleId: 'PO-REM-TEST-601', snoozedUntil: '2026-04-12' }),
      makeState({ ruleId: 'PO-REM-TEST-602', stateId: 'state-2', scheduledDate: '2026-03-01' }),
    ];

    const agenda = buildReminderAgenda(rules, {
      birthDate: '2024-01-01',
      gender: 'male',
      ageMonths: 27,
      localToday: '2026-04-08',
      nurtureMode: 'balanced',
      domainOverrides: null,
    }, states);

    expect(agenda.todayFocus.map((item) => item.rule.ruleId)).not.toContain('PO-REM-TEST-601');
    expect(agenda.overdueSummary.count).toBeGreaterThanOrEqual(1);
  });

  it('applies frequency overrides to agenda generation', () => {
    const rules: ReminderRule[] = [
      {
        ...baseRule,
        ruleId: 'PO-REM-TEST-603',
        domain: 'growth',
        actionType: 'record_data',
        repeatRule: { intervalMonths: 12, maxRepeats: 4 },
        triggerAge: { startMonths: 12, endMonths: 60 },
      },
    ];

    const agenda = buildReminderAgenda(rules, {
      birthDate: '2025-04-01',
      gender: 'male',
      ageMonths: 18,
      localToday: '2026-10-01',
      nurtureMode: 'balanced',
      domainOverrides: null,
    }, [], new Map([
      ['PO-REM-TEST-603', { intervalMonths: 6, disabled: false, modifiedAt: '2026-09-01T00:00:00.000Z' }],
    ]));

    expect([
      ...agenda.todayFocus.map((item) => item.repeatIndex),
      ...agenda.thisWeek.map((item) => item.repeatIndex),
    ]).toContain(1);
  });
});

describe('reminder engine presentation', () => {
  it('groups completed, scheduled, snoozed, and not-applicable rows into history', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-701', actionType: 'observe' },
      { ...baseRule, ruleId: 'PO-REM-TEST-702', actionType: 'record_data' },
      { ...baseRule, ruleId: 'PO-REM-TEST-703', actionType: 'record_data' },
      { ...baseRule, ruleId: 'PO-REM-TEST-704', actionType: 'observe' },
    ];
    const states = [
      makeState({ ruleId: 'PO-REM-TEST-701', completedAt: '2026-04-08T10:00:00.000Z', status: 'completed' }),
      makeState({ ruleId: 'PO-REM-TEST-702', stateId: 'state-2', scheduledDate: '2026-04-12' }),
      makeState({ ruleId: 'PO-REM-TEST-703', stateId: 'state-3', snoozedUntil: '2026-04-12' }),
      makeState({ ruleId: 'PO-REM-TEST-704', stateId: 'state-4', notApplicable: 1 }),
    ];

    const agenda = buildReminderAgenda(rules, {
      birthDate: '2025-04-01',
      gender: 'male',
      ageMonths: 12,
      localToday: '2026-04-08',
      nurtureMode: 'balanced',
      domainOverrides: null,
    }, states);

    expect(agenda.history.map((item) => item.historyType).sort()).toEqual([
      'completed',
      'not_applicable',
      'scheduled',
      'snoozed',
    ]);
  });
});
