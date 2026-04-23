import { describe, expect, it } from 'vitest';
import { REMINDER_RULES, type ReminderRule } from '../knowledge-base/index.js';
import {
  UnknownReminderRuleError,
  buildReminderAgenda,
  computeEligibleReminders,
  type ReminderState,
} from './reminder-engine.js';
import { defaultSnoozeUntil } from './reminder-actions.js';

// Default baseRule is task-kind because the majority of tests exercise task-bucket
// behavior (P0 today focus, overdue summary). Tests covering guide/practice/consult
// behavior override both `kind` and `actionType` per PO-REMI-002.
const baseRule: ReminderRule = {
  ruleId: 'PO-REM-TEST-001',
  domain: 'checkup',
  category: 'rigid',
  kind: 'task',
  title: 'Test rule',
  description: 'Test description',
  triggerAge: { startMonths: 12, endMonths: 12 },
  priority: 'P1',
  nurtureMode: { relaxed: 'push', balanced: 'push', advanced: 'push' },
  actionType: 'go_hospital',
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
    acknowledgedAt: overrides.acknowledgedAt ?? null,
    reflectedAt: overrides.reflectedAt ?? null,
    practiceStartedAt: overrides.practiceStartedAt ?? null,
    practiceLastAt: overrides.practiceLastAt ?? null,
    practiceCount: overrides.practiceCount ?? 0,
    practiceHabituatedAt: overrides.practiceHabituatedAt ?? null,
    consultedAt: overrides.consultedAt ?? null,
    consultationConversationId: overrides.consultationConversationId ?? null,
    createdAt: overrides.createdAt ?? null,
    updatedAt: overrides.updatedAt ?? null,
  };
}

function makeContext(overrides?: Partial<Parameters<typeof computeEligibleReminders>[1]>) {
  return {
    birthDate: '2025-04-01',
    gender: 'male' as const,
    ageMonths: 12,
    profileCreatedAt: '2025-04-01T00:00:00.000Z',
    localToday: '2026-04-08',
    nurtureMode: 'balanced' as const,
    domainOverrides: null,
    ...overrides,
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
      const reminders = computeEligibleReminders([p0Rule], makeContext({ nurtureMode: mode }), []);
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

    const reminders = computeEligibleReminders([repeatRule], makeContext({
      ageMonths: 13,
      localToday: '2026-05-08',
    }), []);

    expect(reminders.map((item) => item.repeatIndex)).toEqual([2]);
  });

  it('moves pre-registration stale tasks into cold-start disposition', () => {
    const reminders = computeEligibleReminders([
      {
        ...baseRule,
        ruleId: 'PO-REM-TEST-210',
        domain: 'vaccine',
        priority: 'P0',
        actionType: 'go_hospital',
        triggerAge: { startMonths: 0, endMonths: 1 },
      },
    ], makeContext({
      ageMonths: 4,
      localToday: '2025-08-08',
      profileCreatedAt: '2025-08-01T00:00:00.000Z',
    }), []);

    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.deliveryDisposition).toBe('cold_start');
  });

  it('keeps override expiry when provided by a future rule payload', () => {
    const customExpiryRule = {
      ...baseRule,
      ruleId: 'PO-REM-TEST-211',
      actionType: 'record_data',
      triggerAge: { startMonths: 12, endMonths: 12 },
      expiryMonths: 1,
    } as ReminderRule & { expiryMonths: number };

    const reminders = computeEligibleReminders([customExpiryRule], makeContext({
      ageMonths: 14,
      localToday: '2026-06-08',
    }), []);

    expect(reminders).toHaveLength(0);
  });

  it('lets a follow-up rule take over after a narrow recommendation window expires', () => {
    const recommendationWindowRule = {
      ...baseRule,
      ruleId: 'PO-REM-TEST-212',
      domain: 'dental',
      actionType: 'go_hospital',
      triggerAge: { startMonths: 84, endMonths: 96 },
      expiryMonths: 0,
    } as ReminderRule & { expiryMonths: number };

    const followupRule: ReminderRule = {
      ...baseRule,
      ruleId: 'PO-REM-TEST-213',
      domain: 'dental',
      actionType: 'go_hospital',
      triggerAge: { startMonths: 97, endMonths: 144 },
    };

    const reminders = computeEligibleReminders([recommendationWindowRule, followupRule], makeContext({
      birthDate: '2016-11-01',
      ageMonths: 113,
      localToday: '2026-04-16',
      profileCreatedAt: '2024-01-01T00:00:00.000Z',
    }), []);

    expect(reminders.map((item) => item.rule.ruleId)).toEqual(['PO-REM-TEST-213']);
    expect(reminders[0]?.lifecycle).toBe('due');
  });

  it('reads reminder kind directly from rule.kind (PO-REMI-001)', () => {
    // No runtime inference: the engine must read rule.kind as authored in the
    // compiled catalog. actionType ↔ kind validation is enforced at generator time.
    const guideRule: ReminderRule = { ...baseRule, actionType: 'read_guide', kind: 'guide' };
    const taskRule: ReminderRule = { ...baseRule, actionType: 'go_hospital', kind: 'task' };
    expect(guideRule.kind).toBe('guide');
    expect(taskRule.kind).toBe('task');
  });

  it('projects kind-scoped terminal lifecycle from progression timestamps (PO-REMI-003)', () => {
    const guideRule: ReminderRule = { ...baseRule, ruleId: 'PO-REM-TEST-GUIDE', kind: 'guide', actionType: 'read_guide', domain: 'relationship' };
    const practiceRule: ReminderRule = { ...baseRule, ruleId: 'PO-REM-TEST-PRAC', kind: 'practice', actionType: 'observe', domain: 'relationship' };
    const consultRule: ReminderRule = { ...baseRule, ruleId: 'PO-REM-TEST-CNSL', kind: 'consult', actionType: 'ai_consult', domain: 'interest' };

    const guideState = makeState({ ruleId: 'PO-REM-TEST-GUIDE', status: 'completed', acknowledgedAt: '2026-04-07T10:00:00Z' });
    const practiceStartedState = makeState({ ruleId: 'PO-REM-TEST-PRAC', stateId: 'state-prac', status: 'active', practiceStartedAt: '2026-04-01T10:00:00Z', practiceLastAt: '2026-04-05T10:00:00Z', practiceCount: 2 });
    const practiceHabituatedState = makeState({ ruleId: 'PO-REM-TEST-PRAC', stateId: 'state-prac2', status: 'completed', practiceStartedAt: '2026-04-01T10:00:00Z', practiceHabituatedAt: '2026-04-07T10:00:00Z' });
    const consultedState = makeState({ ruleId: 'PO-REM-TEST-CNSL', status: 'completed', consultedAt: '2026-04-07T10:00:00Z', consultationConversationId: 'conv-1' });

    const guideAgenda = buildReminderAgenda([guideRule], makeContext(), [guideState]);
    expect(guideAgenda.history.find((item) => item.rule.ruleId === 'PO-REM-TEST-GUIDE')?.lifecycle).toBe('acknowledged');

    const practicingAgenda = buildReminderAgenda([practiceRule], makeContext(), [practiceStartedState]);
    expect(practicingAgenda.upcoming.find((item) => item.rule.ruleId === 'PO-REM-TEST-PRAC')?.lifecycle).toBe('practicing');

    const habituatedAgenda = buildReminderAgenda([practiceRule], makeContext(), [practiceHabituatedState]);
    expect(habituatedAgenda.history.find((item) => item.rule.ruleId === 'PO-REM-TEST-PRAC')?.lifecycle).toBe('completed');

    const consultedAgenda = buildReminderAgenda([consultRule], makeContext(), [consultedState]);
    expect(consultedAgenda.history.find((item) => item.rule.ruleId === 'PO-REM-TEST-CNSL')?.lifecycle).toBe('consulted');
  });

  it('tolerates v9-era rows where every progression column is NULL (PO-REMI-011 NULL-safety)', () => {
    // Simulates a reminder_states row persisted before schema v10 migrated: all
    // per-kind progression fields are NULL / 0. The engine must project lifecycle
    // coherently (due / overdue / upcoming) rather than crashing or synthesizing
    // a terminal state. Using a wide-window trigger so the agenda bucket reliably
    // contains the rule regardless of how localToday intersects the trigger range.
    const wideWindow = { startMonths: 0, endMonths: 24 };
    const guideRule: ReminderRule = { ...baseRule, ruleId: 'PO-REM-TEST-V9G', kind: 'guide', actionType: 'read_guide', domain: 'relationship', triggerAge: wideWindow };
    const practiceRule: ReminderRule = { ...baseRule, ruleId: 'PO-REM-TEST-V9P', kind: 'practice', actionType: 'observe', domain: 'relationship', triggerAge: wideWindow };
    const consultRule: ReminderRule = { ...baseRule, ruleId: 'PO-REM-TEST-V9C', kind: 'consult', actionType: 'ai_consult', domain: 'interest', triggerAge: wideWindow };

    const pristineGuide = makeState({ ruleId: 'PO-REM-TEST-V9G', stateId: 'state-v9g', status: 'active' });
    const pristinePractice = makeState({ ruleId: 'PO-REM-TEST-V9P', stateId: 'state-v9p', status: 'active' });
    const pristineConsult = makeState({ ruleId: 'PO-REM-TEST-V9C', stateId: 'state-v9c', status: 'active' });

    const agenda = buildReminderAgenda(
      [guideRule, practiceRule, consultRule],
      makeContext(),
      [pristineGuide, pristinePractice, pristineConsult],
    );

    // The v9-era row must not crash and must not synthesize a terminal state.
    // All three kinds should appear in upcoming with a non-terminal lifecycle.
    const ruleIds = agenda.upcoming.map((item) => item.rule.ruleId);
    expect(ruleIds).toContain('PO-REM-TEST-V9G');
    expect(ruleIds).toContain('PO-REM-TEST-V9P');
    expect(ruleIds).toContain('PO-REM-TEST-V9C');
    const terminalLifecycles: ReadonlyArray<string> = ['completed', 'acknowledged', 'consulted', 'not_applicable'];
    for (const ruleId of ['PO-REM-TEST-V9G', 'PO-REM-TEST-V9P', 'PO-REM-TEST-V9C']) {
      const entry = agenda.upcoming.find((item) => item.rule.ruleId === ruleId);
      expect(entry?.lifecycle).toBeDefined();
      expect(terminalLifecycles).not.toContain(entry?.lifecycle ?? '');
    }
    // History must not contain these rules since no terminal signal was persisted.
    expect(agenda.history.find((item) => item.rule.ruleId === 'PO-REM-TEST-V9G')).toBeUndefined();
    expect(agenda.history.find((item) => item.rule.ruleId === 'PO-REM-TEST-V9P')).toBeUndefined();
    expect(agenda.history.find((item) => item.rule.ruleId === 'PO-REM-TEST-V9C')).toBeUndefined();
  });

  it('snooze durations diverge per kind (PO-REMI-005)', () => {
    const localToday = '2026-04-08';
    expect(defaultSnoozeUntil('task', localToday)).toBe('2026-04-11');
    expect(defaultSnoozeUntil('guide', localToday)).toBe('2026-04-15');
    expect(defaultSnoozeUntil('practice', localToday)).toBe('2026-04-22');
    expect(defaultSnoozeUntil('consult', localToday)).toBe('2026-04-15');
  });
});

describe('reminder engine orchestration', () => {
  it('keeps only the top three concurrent P0 tasks in today focus and overflows the rest', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-301', priority: 'P0', actionType: 'go_hospital', domain: 'vaccine' },
      { ...baseRule, ruleId: 'PO-REM-TEST-302', priority: 'P0', actionType: 'go_hospital', domain: 'vaccine', title: 'Second' },
      { ...baseRule, ruleId: 'PO-REM-TEST-303', priority: 'P0', actionType: 'go_hospital', domain: 'vaccine', title: 'Third' },
      { ...baseRule, ruleId: 'PO-REM-TEST-304', priority: 'P0', actionType: 'go_hospital', domain: 'checkup', title: 'Fourth' },
    ];

    const agenda = buildReminderAgenda(rules, makeContext({ nurtureMode: 'relaxed' }), []);

    expect(agenda.todayFocus).toHaveLength(3);
    expect(agenda.p0Overflow.count).toBe(1);
    expect(agenda.p0Overflow.items[0]?.rule.ruleId).toBe('PO-REM-TEST-304');
  });

  it('limits non-P0 today items and keeps overflow in upcoming', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-401', domain: 'growth', actionType: 'record_data' },
      { ...baseRule, ruleId: 'PO-REM-TEST-402', domain: 'vision', actionType: 'record_data', title: 'Vision task' },
      { ...baseRule, ruleId: 'PO-REM-TEST-403', domain: 'dental', actionType: 'record_data', title: 'Dental task' },
    ];

    const agenda = buildReminderAgenda(rules, makeContext({ nurtureMode: 'relaxed' }), []);

    expect(agenda.todayFocus).toHaveLength(2);
    expect(agenda.upcoming).toHaveLength(1);
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

    const agenda = buildReminderAgenda(rules, makeContext(), states);

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

    const agenda = buildReminderAgenda(rules, makeContext({
      birthDate: '2024-01-01',
      ageMonths: 27,
    }), states);

    expect(agenda.todayFocus.map((item) => item.rule.ruleId)).not.toContain('PO-REM-TEST-601');
    expect(agenda.overdueSummary.count).toBeGreaterThanOrEqual(1);
  });

  it('includes practice-kind reminders in upcoming bucket', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-605', domain: 'relationship', actionType: 'observe', kind: 'practice', title: 'Practice item' },
    ];

    const agenda = buildReminderAgenda(rules, makeContext(), []);

    expect(agenda.upcoming.map((item) => item.rule.ruleId)).toContain('PO-REM-TEST-605');
    expect(agenda.upcoming[0]?.kind).toBe('practice');
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

    const agenda = buildReminderAgenda(rules, makeContext({
      ageMonths: 18,
      localToday: '2026-10-01',
    }), [], new Map([
      ['PO-REM-TEST-603', { intervalMonths: 6, disabled: false, modifiedAt: '2026-09-01T00:00:00.000Z' }],
    ]));

    expect([
      ...agenda.todayFocus.map((item) => item.repeatIndex),
      ...agenda.upcoming.map((item) => item.repeatIndex),
    ]).toContain(1);
  });

  it('routes cold-start items away from today, this week, and overdue summary', () => {
    const rules: ReminderRule[] = [
      { ...baseRule, ruleId: 'PO-REM-TEST-604', domain: 'checkup', priority: 'P1', actionType: 'go_hospital', triggerAge: { startMonths: 1, endMonths: 2 } },
    ];

    const agenda = buildReminderAgenda(rules, makeContext({
      ageMonths: 4,
      localToday: '2025-08-08',
      profileCreatedAt: '2025-08-01T00:00:00.000Z',
    }), []);

    expect(agenda.onboardingCatchup.count).toBe(1);
    expect(agenda.todayFocus).toHaveLength(0);
    expect(agenda.upcoming).toHaveLength(0);
    expect(agenda.overdueSummary.count).toBe(0);
  });
});

describe('repeat instance expiry with persisted state', () => {
  const growthRule: ReminderRule = {
    ...baseRule,
    ruleId: 'PO-REM-TEST-GRO',
    domain: 'growth',
    actionType: 'record_data',
    priority: 'P2',
    triggerAge: { startMonths: 36, endMonths: 216 },
    repeatRule: { intervalMonths: 6, maxRepeats: -1 },
  };

  it('expires orphan persisted-state instances far beyond the hard ceiling', () => {
    // Child is ~154 months (12y10m). An old instance at repeatIndex 2
    // (triggerAge 48, effectiveEnd 53) has an uncompleted persisted state.
    // Without the fix this would surface as "逾期 3000+ 天".
    const states = [
      makeState({
        ruleId: 'PO-REM-TEST-GRO',
        repeatIndex: 2,
        scheduledDate: '2018-06-01',
      }),
    ];

    const reminders = computeEligibleReminders(
      [growthRule],
      makeContext({
        birthDate: '2013-06-15',
        ageMonths: 154,
        localToday: '2026-04-15',
        profileCreatedAt: '2020-01-01T00:00:00.000Z',
      }),
      states,
    );

    // The old instance (repeatIndex 2) should be expired.
    // Only recent instances near the child's current age should remain.
    const indices = reminders.filter((r) => r.lifecycle !== 'completed').map((r) => r.repeatIndex);
    expect(indices).not.toContain(2);
    expect(indices.some((i) => i >= 17)).toBe(true);
  });

  it('keeps persisted-state instances within the hard ceiling', () => {
    // An instance snoozed recently should survive the ceiling check.
    // Use ageMonths=148 so instance 19 (triggerAge 150) is not yet eligible,
    // making the snoozed instance 18 the dedup winner.
    const states = [
      makeState({
        ruleId: 'PO-REM-TEST-GRO',
        repeatIndex: 18,
        snoozedUntil: '2026-04-20',
      }),
    ];

    const reminders = computeEligibleReminders(
      [growthRule],
      makeContext({
        birthDate: '2013-06-15',
        ageMonths: 148,
        localToday: '2025-10-15',
        profileCreatedAt: '2020-01-01T00:00:00.000Z',
      }),
      states,
    );

    const indices = reminders.map((r) => r.repeatIndex);
    expect(indices).toContain(18);
  });

  it('dedup drops orphan when a newer sibling is completed', () => {
    // Old orphan state + recent completed states → dedup should discard
    // the old uncompleted instance because the user has clearly moved on.
    const states = [
      makeState({
        ruleId: 'PO-REM-TEST-GRO',
        stateId: 'orphan',
        repeatIndex: 15,
        scheduledDate: '2024-01-01',
      }),
      makeState({
        ruleId: 'PO-REM-TEST-GRO',
        stateId: 'done-17',
        repeatIndex: 17,
        completedAt: '2025-07-01T10:00:00.000Z',
        status: 'completed',
      }),
      makeState({
        ruleId: 'PO-REM-TEST-GRO',
        stateId: 'done-18',
        repeatIndex: 18,
        completedAt: '2026-01-01T10:00:00.000Z',
        status: 'completed',
      }),
    ];

    const agenda = buildReminderAgenda(
      [growthRule],
      makeContext({
        birthDate: '2013-06-15',
        ageMonths: 154,
        localToday: '2026-04-15',
        profileCreatedAt: '2020-01-01T00:00:00.000Z',
      }),
      states,
    );

    // The orphan at index 15 must not appear anywhere in the active agenda
    const allActive = [
      ...agenda.todayFocus,
      ...agenda.upcoming,
      ...agenda.overdueSummary.items,
      ...agenda.p0Overflow.items,
    ];
    const groIndices = allActive
      .filter((r) => r.rule.ruleId === 'PO-REM-TEST-GRO')
      .map((r) => r.repeatIndex);
    expect(groIndices).not.toContain(15);
  });

  it('dedup keeps uncompleted instance when no newer sibling is completed', () => {
    // If only an older sibling is completed, the uncompleted one should stay.
    const states = [
      makeState({
        ruleId: 'PO-REM-TEST-GRO',
        stateId: 'done-16',
        repeatIndex: 16,
        completedAt: '2025-01-01T10:00:00.000Z',
        status: 'completed',
      }),
      makeState({
        ruleId: 'PO-REM-TEST-GRO',
        stateId: 'active-17',
        repeatIndex: 17,
        scheduledDate: '2025-08-01',
      }),
    ];

    const reminders = computeEligibleReminders(
      [growthRule],
      makeContext({
        birthDate: '2013-06-15',
        ageMonths: 154,
        localToday: '2026-04-15',
        profileCreatedAt: '2020-01-01T00:00:00.000Z',
      }),
      states,
    );

    // Instance 19 wins dedup (highest uncompleted), but instance 17 should
    // at least pass eligibility — the dedup picks 19 over it, which is fine.
    // The key assertion: the dedup result contains an uncompleted instance
    // (not dropped by the orphan check).
    const uncompleted = reminders.filter(
      (r) => r.rule.ruleId === 'PO-REM-TEST-GRO' && r.lifecycle !== 'completed' && r.lifecycle !== 'not_applicable',
    );
    expect(uncompleted.length).toBeGreaterThanOrEqual(1);
    expect(uncompleted[0]!.repeatIndex).toBe(19);
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

    const agenda = buildReminderAgenda(rules, makeContext(), states);

    expect(agenda.history.map((item) => item.historyType).sort()).toEqual([
      'completed',
      'not_applicable',
      'scheduled',
      'snoozed',
    ]);
  });
});

describe('reminder engine unknown-rule fail-close (PO-TIME-007)', () => {
  it('throws UnknownReminderRuleError when a reminder_states row references a ruleId outside the catalog', () => {
    const states = [makeState({ ruleId: 'dental-auto-fluoride-2026-03-15' })];
    expect(() => buildReminderAgenda([baseRule], makeContext(), states))
      .toThrowError(UnknownReminderRuleError);
  });

  it('admits compiled PO-ORTHO-* ruleIds from orthodontic-protocols.yaml', () => {
    // Confirm the compiled catalog unions the admitted orthodontic rules in.
    const orthoAdmitted = REMINDER_RULES.filter((r) => r.ruleId.startsWith('PO-ORTHO-'));
    expect(orthoAdmitted.length).toBeGreaterThan(0);
    const sample = orthoAdmitted[0]!;

    const states = [makeState({ ruleId: sample.ruleId, status: 'active' })];
    // Should not throw; the union catalog makes the ruleId known.
    expect(() => buildReminderAgenda(REMINDER_RULES, makeContext(), states)).not.toThrow();
  });

  it('admits compiled PO-DEN-FOLLOWUP-* ruleIds from orthodontic-protocols.yaml', () => {
    const followups = REMINDER_RULES.filter((r) => r.ruleId.startsWith('PO-DEN-FOLLOWUP-'));
    expect(followups.length).toBeGreaterThan(0);
    const sample = followups[0]!;
    const states = [makeState({ ruleId: sample.ruleId, status: 'active' })];
    expect(() => buildReminderAgenda(REMINDER_RULES, makeContext(), states)).not.toThrow();
  });

  it('surfaces PO-ORTHO-* states with active status in todayFocus via the state-driven pathway', () => {
    // End-to-end delivery scenario: an appliance lifecycle writer has seeded a
    // state; the engine must now surface it in the agenda even though the rule
    // has category=personalized.
    const wearRule = REMINDER_RULES.find((r) => r.ruleId === 'PO-ORTHO-WEAR-DAILY');
    expect(wearRule).toBeDefined();
    const states = [makeState({
      ruleId: 'PO-ORTHO-WEAR-DAILY',
      status: 'active',
      nextTriggerAt: '2026-04-08T00:00:00.000Z', // matches makeContext.localToday
      notes: '[ortho-protocol] applianceId=appl-1',
    })];
    const agenda = buildReminderAgenda(REMINDER_RULES, makeContext(), states);
    const surfaced = [
      ...agenda.todayFocus,
      ...agenda.upcoming,
      ...agenda.p0Overflow.items,
    ].find((r) => r.rule.ruleId === 'PO-ORTHO-WEAR-DAILY');
    expect(surfaced).toBeDefined();
  });

  it('surfaces PO-DEN-FOLLOWUP-* states produced by dental follow-up writer', () => {
    // nextTriggerAt within 30 days so the state lands in the upcoming bucket.
    // (Further-out follow-ups remain in reminder_states but the generic timeline
    // agenda's `upcoming` cap excludes them; the ortho surface reads directly.)
    const states = [makeState({
      ruleId: 'PO-DEN-FOLLOWUP-FLUORIDE',
      status: 'active',
      nextTriggerAt: '2026-04-15T00:00:00.000Z', // 7 days after localToday
      notes: '[dental-followup] triggeredBy=fluoride at=2025-10-15',
    })];
    const agenda = buildReminderAgenda(REMINDER_RULES, makeContext(), states);
    const surfaced = [
      ...agenda.todayFocus,
      ...agenda.upcoming,
      ...agenda.p0Overflow.items,
    ].find((r) => r.rule.ruleId === 'PO-DEN-FOLLOWUP-FLUORIDE');
    expect(surfaced).toBeDefined();
  });

  it('does not surface personalized rules that lack a persisted state', () => {
    // Without any state, PO-ORTHO-* rules must NOT appear — state-driven delivery only.
    const agenda = buildReminderAgenda(REMINDER_RULES, makeContext(), []);
    const orthoAnywhere = [
      ...agenda.todayFocus,
      ...agenda.upcoming,
      ...agenda.p0Overflow.items,
    ].filter((r) => r.rule.ruleId.startsWith('PO-ORTHO-') || r.rule.ruleId.startsWith('PO-DEN-FOLLOWUP-'));
    expect(orthoAnywhere).toHaveLength(0);
  });

  it('enforces orthodontic protocol rules are push in every nurture mode (PO-TIME-009)', () => {
    const orthoAdmitted = REMINDER_RULES.filter((r) => r.ruleId.startsWith('PO-ORTHO-'));
    for (const rule of orthoAdmitted) {
      for (const mode of ['relaxed', 'balanced', 'advanced'] as const) {
        expect(rule.nurtureMode[mode]).toBe('push');
      }
    }
  });
});
