import { describe, expect, it } from 'vitest';
import { createCircle, emptyState } from '../src/nimiday/domain/defaults.js';
import { planReminders } from '../src/nimiday/domain/deliveries.js';
import { HOME_TYPES, planHomeSync, reminderKey, type HomeCopy, type OwnRecord } from '../src/nimiday/domain/home-sync.js';
import { completeItem, createItem, markReminder } from '../src/nimiday/domain/items.js';
import { executeDayTool } from '../src/nimiday/domain/tools.js';
import type { DayState, SkillRun } from '../src/nimiday/domain/types.js';
import { undoRunChanges } from '../src/nimiday/domain/undo.js';

const fullCoverage = { openTodos: 'complete', recent: 'complete', recentCount: 0 } as const;

const settings = { allDayRemindTime: '08:30', quiet: { enabled: true, start: '22:00', end: '07:30' } };
const at = (value: string) => new Date(value);

describe('reminder delivery planning', () => {
  const created = at('2026-09-24T06:00:00+08:00');
  const breakfast = createItem({ title: '带水杯', date: '2026-09-24', time: '07:50' }, { by: 'user' }, created);
  const medicine = createItem({ title: '给妈妈送药', date: '2026-09-24', time: '23:00', importance: 'important' }, { by: 'user' }, created);
  const plants = createItem({ title: '浇花', date: '2026-09-24', time: '23:00' }, { by: 'user' }, created);
  const gentle = createItem({ title: '看看天气', date: '2026-09-24', time: '12:00', importance: 'gentle' }, { by: 'user' }, created);

  it('records reminders that came due before NimiDay started as missed', () => {
    const plan = planReminders([breakfast], at('2026-09-24T09:00:00+08:00'), at('2026-09-24T08:55:00+08:00'), settings);
    expect(plan.deliver).toEqual([]);
    expect(plan.missed.map((entry) => entry.item.title)).toEqual(['带水杯']);
  });

  it('delivers on time while running', () => {
    const plan = planReminders([breakfast], at('2026-09-24T07:50:10+08:00'), at('2026-09-24T07:00:00+08:00'), settings);
    expect(plan.deliver).toEqual([expect.objectContaining({ interrupt: true, quiet: false })]);
    expect(plan.missed).toEqual([]);
  });

  it('holds normal reminders in quiet hours but lets important ones interrupt', () => {
    const plan = planReminders([medicine, plants], at('2026-09-24T23:00:05+08:00'), at('2026-09-24T20:00:00+08:00'), settings);
    const byTitle = Object.fromEntries(plan.deliver.map((entry) => [entry.item.title, entry]));
    expect(byTitle['给妈妈送药']).toMatchObject({ interrupt: true, quiet: false });
    expect(byTitle['浇花']).toMatchObject({ interrupt: false, quiet: true });
  });

  it('never interrupts for gentle reminders', () => {
    const plan = planReminders([gentle], at('2026-09-24T12:00:05+08:00'), at('2026-09-24T08:00:00+08:00'), settings);
    expect(plan.deliver).toEqual([expect.objectContaining({ interrupt: false, quiet: false })]);
  });
});

const copy: HomeCopy = {
  reminderSummary: (item) => `summary ${item.title}`,
  decisionSummary: (item) => `options ${item.decision?.options.join('/')}`,
  resultTitle: (run) => `${run.agentName} finished ${run.skillName}`,
  resultSummary: (run) => `${run.changes.length} changes`,
};

describe('Home sync', () => {
  const now = at('2026-09-24T08:00:00+08:00');
  const reminded = markReminder(
    createItem({ title: '带小米打疫苗', date: '2026-09-24', time: '09:00', kind: 'appointment' }, { by: 'user' }, now),
    at('2026-09-24T08:00:00+08:00').toISOString(),
    'reminded',
    now,
  );

  it('publishes a delivered reminder as an open todo once', () => {
    const puts = planHomeSync({ items: [reminded], runs: [], own: [], now, copy });
    expect(puts).toEqual([expect.objectContaining({
      key: reminderKey(reminded),
      kind: 'todo',
      todoState: 'open',
      attention: true,
      objectRef: `item:${reminded.id}`,
      type: HOME_TYPES.reminder,
    })]);
    const own: OwnRecord[] = [{ activityId: 'act_1', key: reminderKey(reminded), revision: puts[0]!.revision, kind: 'todo', todoState: 'open' }];
    expect(planHomeSync({ items: [reminded], runs: [], own, now, copy })).toEqual([]);
  });

  it('closes the todo when the item is handled', () => {
    const done = completeItem(reminded, 'user', now);
    const own: OwnRecord[] = [{ activityId: 'act_1', key: reminderKey(reminded), revision: 5, kind: 'todo', todoState: 'open' }];
    const puts = planHomeSync({ items: [done], runs: [], own, now, copy });
    expect(puts).toEqual([expect.objectContaining({ key: reminderKey(reminded), todoState: 'completed', attention: false })]);
    expect(puts[0]!.revision).toBeGreaterThan(5);
  });

  it('cancels the todo when the item disappears', () => {
    const own: OwnRecord[] = [{ activityId: 'act_1', key: 'reminder:item_gone:2026-09-24', revision: 1, kind: 'todo', todoState: 'open' }];
    expect(planHomeSync({ items: [], runs: [], own, now, copy })).toEqual([expect.objectContaining({ todoState: 'cancelled' })]);
  });

  it('publishes decisions and finished runs', () => {
    const decision = createItem({ title: '体检时间', decision: { question: '体检改到哪天？', options: ['周六', '周日'], choice: null } }, { by: 'agent', agentName: 'Aya', runId: 'run_1' }, now);
    const run: SkillRun = {
      id: 'run_1', skillId: 'morning-care', skillName: '晨间照看', trigger: 'user', rhythmId: null, scheduledFor: null, state: 'done',
      agentName: 'Aya', requestText: '看看今天', turnId: 'turn_1', createdAt: now.toISOString(), startedAt: now.toISOString(),
      finishedAt: now.toISOString(), toolCalls: [], changes: [{ kind: 'decision-asked', itemId: decision.id, title: '体检改到哪天？' }],
      undone: false, replyMessageId: 'msg_1', replyText: '今天…', error: null,
    };
    const puts = planHomeSync({ items: [decision], runs: [run], own: [], now, copy });
    expect(puts.map((put) => put.type).sort()).toEqual([HOME_TYPES.decision, HOME_TYPES.result].sort());
    expect(puts.find((put) => put.type === HOME_TYPES.decision)).toMatchObject({ title: '体检改到哪天？', agentAttributed: true, attention: true });
    expect(puts.find((put) => put.type === HOME_TYPES.result)).toMatchObject({ kind: 'activity', objectRef: 'run:run_1', summary: '1 changes' });
  });
});

describe('undo', () => {
  it('reverts what the agent created and changed, leaving later user edits alone', () => {
    const now = at('2026-09-24T08:00:00+08:00');
    const base = emptyState('zh', now);
    const circle = createCircle({ kind: 'child', name: '小米' }, now);
    const existing = createItem({ title: '体检', circleId: circle.id, date: '2026-09-26' }, { by: 'user' }, now);
    const other = createItem({ title: '交物业费', date: '2026-09-25' }, { by: 'user' }, now);
    let state: DayState = { ...base, circles: [circle], items: [existing, other] };
    const context = (current: DayState) => ({ state: current, changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, now, runId: 'run_1', agentName: 'Aya' });

    const created = executeDayTool('day_create_item', { title: '准备疫苗本', date: '2026-09-25' }, context(state));
    state = { ...state, items: created.items! };
    const moved = executeDayTool('day_update_item', { itemId: existing.id, date: '2026-09-27' }, context(state));
    state = { ...state, items: moved.items! };
    const paid = executeDayTool('day_update_item', { itemId: other.id, notes: '已经转账' }, context(state));
    state = { ...state, items: paid.items! };
    // The user edits the second item afterwards; undo must respect that.
    state = { ...state, items: state.items.map((item) => (item.id === other.id ? { ...item, notes: '我自己付了', history: [...item.history, { at: now.toISOString(), kind: 'edited' as const, by: 'user' as const }] } : item)) };

    const run: SkillRun = {
      id: 'run_1', skillId: 'week-plan', skillName: '一周家庭安排', trigger: 'user', rhythmId: null, scheduledFor: null, state: 'done',
      agentName: 'Aya', requestText: '', turnId: 't', createdAt: now.toISOString(), startedAt: now.toISOString(), finishedAt: now.toISOString(),
      toolCalls: [], changes: [created.change!, moved.change!, paid.change!], undone: false, replyMessageId: null, replyText: null, error: null,
    };
    const result = undoRunChanges({ ...state, runs: [run] }, run, now);
    expect(result.reverted).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.kept).toBe(1);
    // Only the change the user made their own is marked as kept; the other two read as undone.
    expect(result.state.runs[0]?.changes.map((change) => change.keptOnUndo ?? false)).toEqual([false, false, true]);
    const byTitle = Object.fromEntries(result.state.items.map((item) => [item.title, item]));
    expect(byTitle['准备疫苗本']?.state).toBe('dropped');
    expect(byTitle['体检']?.date).toBe('2026-09-26');
    expect(byTitle['交物业费']?.notes).toBe('我自己付了');
    expect(result.state.runs[0]?.undone).toBe(true);
  });
});
