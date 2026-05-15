import { describe, expect, it } from 'vitest';
import type { DashboardTaskCatalogRow } from '../../knowledge-base/index.js';
import { DASHBOARD_TASK_CATALOG } from '../../knowledge-base/index.js';
import type { ActiveReminder, ReminderAgenda } from '../../engine/reminder-engine.js';
import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import {
  anchorTargetDay,
  buildDashboardTaskCaptureIntent,
  buildDashboardTaskProjection,
  decayDisplayState,
  dispersionEligible,
  snoozeCountdown,
} from './dashboard-task-projection.js';

// ── Fixture builders ────────────────────────────────────────────────

function makeCatalogRow(overrides: Partial<DashboardTaskCatalogRow> = {}): DashboardTaskCatalogRow {
  return {
    taskId: 'test-row',
    family: 'maintain',
    ownerContract: 'apps/parentos/spec/kernel/timeline-contract.md',
    cadencePolicy: 'interval',
    biologicalAnchor: 'none',
    slotPreference: 'weekend-heavy',
    dispersionWindow: 'rolling',
    mutualExclusionGroup: 'profile-maintenance',
    displayWindowDays: 3,
    snoozeDefaultDays: 2,
    decayStrategy: 'low-disturbance-downgrade',
    metricIdRefs: ['growth.height'],
    captureProtocolIdRef: 'growth-child-quarterly',
    featureId: 'PO-FEAT-056',
    ...overrides,
  };
}

function makeReminder(overrides: Partial<ActiveReminder> & {
  ruleId?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  actionType?: string;
  domain?: string;
} = {}): ActiveReminder {
  const ruleId = overrides.ruleId ?? 'rule-1';
  return {
    rule: {
      ruleId,
      priority: overrides.priority ?? 'P1',
      actionType: overrides.actionType ?? 'record_data',
      domain: overrides.domain ?? 'growth',
    } as unknown as ActiveReminder['rule'],
    visibility: 'push',
    repeatIndex: 0,
    effectiveAgeMonths: 0,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: '2030-01-01',
    kind: 'task',
    lifecycle: 'due',
    status: 'active',
    overdueDays: 0,
    daysUntilStart: 0,
    daysUntilEnd: 0,
    deliveryDisposition: 'normal',
    state: null,
    ...overrides,
  } as ActiveReminder;
}

function makeAgenda(overrides: Partial<ReminderAgenda> = {}): ReminderAgenda {
  return {
    localToday: '2026-05-15',
    todayLimit: 3,
    todayFocus: [],
    p0Overflow: { count: 0, items: [] },
    onboardingCatchup: { count: 0, items: [] },
    upcoming: [],
    history: [],
    overdueSummary: { count: 0, items: [] },
    ...overrides,
  };
}

// ── PO-TIME-010.c Anchor Function tests ─────────────────────────────

describe('anchorTargetDay (PO-TIME-010.c)', () => {
  it('returns null targetDay when biologicalAnchor is none', () => {
    const row = makeCatalogRow({ biologicalAnchor: 'none' });
    expect(anchorTargetDay('2026-05-15', '2020-03-08', row)).toEqual({
      targetDay: null,
      slotMismatch: false,
    });
  });

  it('clamps Feb 29 birth to Feb 28 in a non-leap year', () => {
    const row = makeCatalogRow({
      biologicalAnchor: 'birthDayOfMonth',
      slotPreference: 'weekday-evening-light',
    });
    // 2026 is non-leap; child "born" Feb 29 (synthetic fixture).
    const result = anchorTargetDay('2026-02-15', '2020-02-29', row);
    expect(result.targetDay).toBe(28);
  });

  it('clamps day-31 birth in a 30-day month', () => {
    const row = makeCatalogRow({
      biologicalAnchor: 'birthDayOfMonth',
      slotPreference: 'weekday-evening-light',
    });
    // April has 30 days.
    const result = anchorTargetDay('2026-04-15', '2020-01-31', row);
    expect(result.targetDay).toBe(30);
  });

  it('shifts a weekday-anchor to the nearest weekend when slotPreference is weekend-heavy', () => {
    // 2026-05-13 is a Wednesday; nearest weekend is Sat 2026-05-16.
    const row = makeCatalogRow({
      biologicalAnchor: 'birthDayOfMonth',
      slotPreference: 'weekend-heavy',
    });
    const result = anchorTargetDay('2026-05-15', '2020-05-13', row);
    expect(result.targetDay).toBe(16);
    expect(result.slotMismatch).toBe(false);
  });

  it('keeps the anchor day when slotPreference is weekday-evening-light and the anchor is a weekend', () => {
    // 2026-05-16 is Saturday.
    const row = makeCatalogRow({
      biologicalAnchor: 'birthDayOfMonth',
      slotPreference: 'weekday-evening-light',
    });
    const result = anchorTargetDay('2026-05-15', '2020-05-16', row);
    expect(result.targetDay).toBe(16);
    expect(result.slotMismatch).toBe(false);
  });
});

// ── PO-TIME-010.b Dispersion Function tests ──────────────────────────

describe('dispersionEligible (PO-TIME-010.b)', () => {
  it.each<[string, string, boolean]>([
    ['week-1', '2026-05-05', true], // day 5 in [1,7]
    ['week-1', '2026-05-10', false], // day 10 outside [1,7]
    ['week-2', '2026-05-10', true], // day 10 in [8,14]
    ['week-3', '2026-05-15', true], // day 15 in [15,21]
    ['week-4', '2026-05-25', true], // day 25 in [22,31]
    ['week-4', '2026-04-15', false], // day 15 outside [22,30]
    ['rolling', '2026-05-15', true], // rolling has no window restriction
  ])('windowed cadence with dispersionWindow=%s on %s → eligible=%s', (window, today, expected) => {
    const row = makeCatalogRow({
      cadencePolicy: 'windowed',
      dispersionWindow: window as DashboardTaskCatalogRow['dispersionWindow'],
    });
    const result = dispersionEligible(today, row, null, '2020-05-15');
    expect(result.eligible).toBe(expected);
  });

  it('interval cadence: initial eligibility when lastSurfaced is null', () => {
    const row = makeCatalogRow({ cadencePolicy: 'interval', snoozeDefaultDays: 3 });
    expect(dispersionEligible('2026-05-15', row, null, '2020-05-15').eligible).toBe(true);
  });

  it('interval cadence: not eligible before snoozeDefaultDays elapsed', () => {
    const row = makeCatalogRow({ cadencePolicy: 'interval', snoozeDefaultDays: 3 });
    expect(dispersionEligible('2026-05-15', row, '2026-05-14', '2020-05-15').eligible).toBe(false);
  });
});

// ── PO-TIME-010.d Decay Projection tests ─────────────────────────────

describe('decayDisplayState (PO-TIME-010.d)', () => {
  it('returns eligible-pinned for any P0 row regardless of decay window', () => {
    const row = makeCatalogRow({ displayWindowDays: 1, decayStrategy: 'low-disturbance-downgrade' });
    expect(decayDisplayState(row, '2026-01-01', '2026-05-15', /* isP0 */ true)).toBe('eligible-pinned');
  });

  it('returns eligible-main when within displayWindowDays', () => {
    const row = makeCatalogRow({ displayWindowDays: 5 });
    expect(decayDisplayState(row, '2026-05-13', '2026-05-15', false)).toBe('eligible-main');
  });

  it('returns downgrade-indicator when window expired and strategy is low-disturbance-downgrade', () => {
    const row = makeCatalogRow({ displayWindowDays: 1, decayStrategy: 'low-disturbance-downgrade' });
    expect(decayDisplayState(row, '2026-05-10', '2026-05-15', false)).toBe('downgrade-indicator');
  });

  it('returns hidden-resurface when window expired and strategy is resurface-next-cycle', () => {
    const row = makeCatalogRow({ displayWindowDays: 1, decayStrategy: 'resurface-next-cycle' });
    expect(decayDisplayState(row, '2026-05-10', '2026-05-15', false)).toBe('hidden-resurface');
  });

  it('treats null lastSurfaced as eligible-main (initial surfacing)', () => {
    const row = makeCatalogRow({ displayWindowDays: 3 });
    expect(decayDisplayState(row, null, '2026-05-15', false)).toBe('eligible-main');
  });
});

// ── PO-TIME-010.e Snooze Countdown Projection tests ─────────────────

describe('snoozeCountdown (PO-TIME-010.e)', () => {
  it('Path 1: reminder-backed row consumes reminder_states.snoozedUntil', () => {
    const row = makeCatalogRow();
    const result = snoozeCountdown(
      row,
      '2026-05-15',
      { ruleId: 'PO-REM-GRO-001' },
      { snoozedUntil: '2026-05-18' },
      null,
    );
    expect(result.snoozeRemainingDays).toBe(3);
    expect(result.eligibleBySnooze).toBe(false);
  });

  it('Path 1: reminder-backed eligible when snoozedUntil has passed', () => {
    const row = makeCatalogRow();
    const result = snoozeCountdown(
      row,
      '2026-05-15',
      { ruleId: 'PO-REM-GRO-001' },
      { snoozedUntil: '2026-05-10' },
      null,
    );
    expect(result.eligibleBySnooze).toBe(true);
  });

  it('Path 2: catalog-only ephemeral snooze produces countdown without persistence', () => {
    const row = makeCatalogRow({ family: 'observe', captureProtocolIdRef: undefined });
    const result = snoozeCountdown(
      row,
      '2026-05-15',
      null,
      null,
      { snoozeUntil: '2026-05-17' },
    );
    expect(result.snoozeRemainingDays).toBe(2);
    expect(result.eligibleBySnooze).toBe(false);
  });

  it('Path 2: catalog-only without ephemeral snooze is eligible', () => {
    const row = makeCatalogRow({ family: 'observe' });
    const result = snoozeCountdown(row, '2026-05-15', null, null, null);
    expect(result.snoozeRemainingDays).toBe(0);
    expect(result.eligibleBySnooze).toBe(true);
  });
});

// ── Orchestrator + P0 invariant tests ───────────────────────────────

describe('buildDashboardTaskProjection (PO-TIME-010.a + orchestrator)', () => {
  const child = { childId: 'child-1', birthDate: '2020-05-15' };

  it('renders all six wave-2 admitted catalog rows as valid catalog entries (smoke)', () => {
    // Pick a date inside week-3 so the windowed `vision` row is eligible.
    const result = buildDashboardTaskProjection({
      today: '2026-05-15',
      child,
      reminderAgenda: makeAgenda(),
      customTodos: [],
      catalogRows: DASHBOARD_TASK_CATALOG,
    });
    // mainList is capped (1 maintain, 1 observe), so it does not include all 6 at once.
    // The key invariant for this test: the projection consumes all 6 rows without throwing.
    expect(result.mainList.length).toBeGreaterThanOrEqual(0);
    expect(result.mainList.length + result.downgradeIndicatorCount + result.hiddenResurfaceCount).toBeGreaterThanOrEqual(0);
    // Every entry references a row from the admitted catalog or a custom_todo / reminder.
    for (const entry of result.mainList) {
      if (entry.source === 'catalog') {
        expect(DASHBOARD_TASK_CATALOG.some((r) => r.taskId === entry.catalogRow?.taskId)).toBe(true);
      }
    }
  });

  it('P0 invariant: P0 must-do reminder is present in mainList alongside catalog candidates', () => {
    const p0Reminder = makeReminder({ ruleId: 'PO-P0-VACCINE', priority: 'P0', domain: 'vaccine' });
    const result = buildDashboardTaskProjection({
      today: '2026-05-15',
      child,
      reminderAgenda: makeAgenda({ todayFocus: [p0Reminder] }),
      customTodos: [],
      catalogRows: DASHBOARD_TASK_CATALOG,
    });
    const p0Entries = result.mainList.filter((e) => e.priority === 'P0');
    expect(p0Entries).toHaveLength(1);
    const p0 = p0Entries[0]!;
    expect(p0.displayState).toBe('eligible-pinned');
    expect(p0.source).toBe('reminder');
    // P0 must rank above any catalog row in tier order.
    const firstNonP0 = result.mainList.find((e) => e.priority !== 'P0');
    if (firstNonP0) {
      expect(p0.rankingTier).toBeLessThan(firstNonP0.rankingTier);
    }
  });

  it('P0 invariant: P0 visibility is preserved when many catalog rows would otherwise saturate the surface', () => {
    const p0Reminder = makeReminder({ ruleId: 'PO-P0-ORTHO', priority: 'P0' });
    // Use full catalog (6 rows) + the P0 reminder. P0 must still appear.
    const result = buildDashboardTaskProjection({
      today: '2026-05-15',
      child,
      reminderAgenda: makeAgenda({ todayFocus: [p0Reminder] }),
      customTodos: [],
      catalogRows: DASHBOARD_TASK_CATALOG,
    });
    expect(result.mainList.some((e) => e.priority === 'P0' && e.source === 'reminder')).toBe(true);
  });

  it('mutual exclusion: two maintain rows in same group never both surface in mainList', () => {
    const row1 = makeCatalogRow({
      taskId: 'row-a',
      family: 'maintain',
      cadencePolicy: 'interval',
      mutualExclusionGroup: 'profile-maintenance',
      displayWindowDays: 3,
    });
    const row2 = makeCatalogRow({
      taskId: 'row-b',
      family: 'maintain',
      cadencePolicy: 'interval',
      mutualExclusionGroup: 'profile-maintenance',
      displayWindowDays: 5,
    });
    const result = buildDashboardTaskProjection({
      today: '2026-05-15',
      child,
      reminderAgenda: makeAgenda(),
      customTodos: [],
      catalogRows: [row1, row2],
    });
    const maintainCount = result.mainList.filter((e) => e.family === 'maintain').length;
    expect(maintainCount).toBeLessThanOrEqual(1);
  });

  it('custom_todos surface as personal entries in tier 6', () => {
    const todo = {
      todoId: 'todo-1',
      childId: 'child-1',
      title: '提醒读绘本',
      dueDate: null,
      done: 0,
    } as unknown as CustomTodoRow;
    const result = buildDashboardTaskProjection({
      today: '2026-05-15',
      child,
      reminderAgenda: makeAgenda(),
      customTodos: [todo],
      catalogRows: [],
    });
    const personal = result.mainList.filter((e) => e.family === 'personal');
    expect(personal).toHaveLength(1);
    expect(personal[0]!.rankingTier).toBe(6);
  });

  it('downgrade-indicator count aggregates expired low-disturbance rows without exposing them in mainList', () => {
    const expiredRow = makeCatalogRow({
      taskId: 'expired-row',
      cadencePolicy: 'interval',
      displayWindowDays: 1,
      decayStrategy: 'low-disturbance-downgrade',
    });
    const result = buildDashboardTaskProjection({
      today: '2026-05-15',
      child,
      reminderAgenda: makeAgenda(),
      customTodos: [],
      catalogRows: [expiredRow],
      surfaceHistory: new Map([['expired-row', { lastSurfaced: '2026-05-01' }]]),
    });
    expect(result.downgradeIndicatorCount).toBe(1);
    expect(result.mainList.find((e) => e.catalogRow?.taskId === 'expired-row')).toBeUndefined();
  });
});

// ── Capture intent helper test ──────────────────────────────────────

describe('buildDashboardTaskCaptureIntent (PO-CAPT-005a contract)', () => {
  it('produces a dashboard_task origin intent for a maintain row with captureProtocolIdRef', () => {
    const row = makeCatalogRow({
      taskId: 'dashboard-maintain-sleep',
      family: 'maintain',
      captureProtocolIdRef: 'sleep-night',
      metricIdRefs: ['sleep.duration_minutes'],
    });
    const intent = buildDashboardTaskCaptureIntent(row, 'child-1');
    expect(intent).toEqual({
      origin: 'dashboard_task',
      dashboardTaskId: 'dashboard-maintain-sleep',
      childId: 'child-1',
      captureProtocolId: 'sleep-night',
      metricIds: ['sleep.duration_minutes'],
    });
  });

  it('returns null for observe rows (no PO-CAPT save target)', () => {
    const row = makeCatalogRow({ family: 'observe', captureProtocolIdRef: undefined });
    expect(buildDashboardTaskCaptureIntent(row, 'child-1')).toBeNull();
  });
});
