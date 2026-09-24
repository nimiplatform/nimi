import { describe, expect, it } from 'vitest';
import { createCircle, emptyState } from '../src/nimiday/domain/defaults.js';
import { createItem, dropItem, editItem, reopenItem } from '../src/nimiday/domain/items.js';
import { keptChanges, undoRunChanges } from '../src/nimiday/domain/undo.js';
import { buildToday } from '../src/nimiday/domain/today.js';
import { planReminders } from '../src/nimiday/domain/deliveries.js';
import { chatSkill, resolveSkills } from '../src/nimiday/domain/skills.js';
import { linkedSource, type SourceChange } from '../src/nimiday/domain/sources.js';
import { DAY_TOOLS, executeDayTool, type ToolContext } from '../src/nimiday/domain/tools.js';
import type { DayState } from '../src/nimiday/domain/types.js';
import { buildDayWork, byteLength, methodOverflow, MethodTooLongError, WORK_LIMITS, workByteLength } from '../src/nimiday/domain/work.js';
import { copyFor, describeUndone } from '../src/nimiday/i18n/index.js';

const fullCoverage = { openTodos: 'complete', recent: 'complete', recentCount: 0 } as const;

const now = new Date('2026-09-24T07:45:00+08:00');

function sampleState(): DayState {
  const base = emptyState('zh', now);
  const child = createCircle({ kind: 'child', name: '小米', watch: '疫苗、睡眠和体检', focus: ['疫苗', '睡眠'] }, now);
  const home = createCircle({ kind: 'home', name: '家', watch: '水电物业和日常补货' }, now);
  const items = [
    createItem({ title: '带小米打流感疫苗', kind: 'appointment', circleId: child.id, date: '2026-09-24', time: '09:30', place: '社区医院' }, { by: 'user' }, now),
    createItem({ title: '交物业费', circleId: home.id, date: '2026-09-23' }, { by: 'user' }, now),
    createItem({ title: '倒垃圾', circleId: home.id, date: '2026-09-25', time: '20:00', repeat: { freq: 'weekly', weekdays: [2, 5] } }, { by: 'user' }, now),
  ];
  return {
    ...base,
    circles: [child, home],
    items,
    notes: [{
      id: 'note_1',
      circleId: child.id,
      title: '过敏',
      body: '小米对花生过敏，吃药前要看成分。',
      pinned: true,
      origin: { by: 'user' },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }],
  };
}

function context(state: DayState, changes: readonly SourceChange[] = []): ToolContext {
  return { state, changes, sourcesAvailable: true, sourceCoverage: fullCoverage, now, runId: 'run_1', agentName: 'Aya' };
}

describe('day tools', () => {
  it('declares valid object schemas with unique names', () => {
    const names = new Set<string>();
    for (const tool of DAY_TOOLS) {
      expect(tool.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u);
      expect(names.has(tool.name)).toBe(false);
      names.add(tool.name);
      expect(tool.inputSchema.type).toBe('object');
      expect(byteLength(JSON.stringify(tool.inputSchema))).toBeLessThan(8192);
    }
  });

  it('lists today, overdue and repeating items', () => {
    const state = sampleState();
    const today = executeDayTool('day_list_items', { scope: 'today' }, context(state));
    expect(today.isError).toBe(false);
    expect((today.result as { items: { title: string }[] }).items.map((item) => item.title)).toEqual(['带小米打流感疫苗']);
    const overdue = executeDayTool('day_list_items', { scope: 'overdue' }, context(state));
    expect((overdue.result as { items: { title: string; overdue: boolean }[] }).items).toEqual([
      expect.objectContaining({ title: '交物业费', overdue: true }),
    ]);
    const week = executeDayTool('day_list_items', { scope: 'next7' }, context(state));
    expect((week.result as { items: { repeat: string | null }[] }).items.some((item) => item.repeat === 'every week on Tue,Fri')).toBe(true);
  });

  it('creates agent items with provenance and a reversible change', () => {
    const state = sampleState();
    const outcome = executeDayTool('day_create_item', {
      title: '准备小米的疫苗本',
      circleId: state.circles[0]!.id,
      date: '2026-09-24',
      time: '08:40',
      remindMinutesBefore: 0,
      importance: 'important',
    }, context(state));
    expect(outcome.isError).toBe(false);
    const created = outcome.items!.at(-1)!;
    expect(created).toMatchObject({ title: '准备小米的疫苗本', time: '08:40', importance: 'important', origin: { by: 'agent', agentName: 'Aya', runId: 'run_1' } });
    expect(created.remind).toEqual({ kind: 'at-time' });
    expect(outcome.change).toEqual({ kind: 'item-created', itemId: created.id, title: '准备小米的疫苗本' });
  });

  it('rejects invalid input with a message the agent can act on', () => {
    const state = sampleState();
    expect(executeDayTool('day_create_item', { title: 'x', date: '24/09/2026' }, context(state))).toMatchObject({
      isError: true,
      result: { error: 'date must be YYYY-MM-DD.' },
    });
    expect(executeDayTool('day_update_item', { itemId: 'item_missing', title: 'y' }, context(state)).isError).toBe(true);
    expect(executeDayTool('day_create_item', { title: 'x', circleId: 'circle_nope' }, context(state)).isError).toBe(true);
    expect(executeDayTool('day_unknown', {}, context(state)).isError).toBe(true);
    expect(executeDayTool('day_list_items', 'not-an-object', context(state)).isError).toBe(true);
  });

  it('completes a repeating item by advancing it and records the previous state', () => {
    const state = sampleState();
    const trash = state.items[2]!;
    const outcome = executeDayTool('day_complete_item', { itemId: trash.id }, context(state));
    expect(outcome.isError).toBe(false);
    expect(outcome.items!.find((item) => item.id === trash.id)?.date).toBe('2026-09-29');
    expect(outcome.change).toMatchObject({ kind: 'item-completed', before: trash });
  });

  it('parks decisions for the user instead of guessing', () => {
    const state = sampleState();
    const outcome = executeDayTool('day_ask_user', { question: '体检改到周六还是周日？', options: ['周六上午', '周日上午'] }, context(state));
    const asked = outcome.items!.at(-1)!;
    expect(asked.state).toBe('waiting');
    expect(asked.decision).toEqual({ question: '体检改到周六还是周日？', options: ['周六上午', '周日上午'], choice: null });
  });

  it('reads and saves handbook notes', () => {
    const state = sampleState();
    const read = executeDayTool('day_read_handbook', { query: '花生' }, context(state));
    expect((read.result as { notes: unknown[] }).notes).toHaveLength(1);
    const saved = executeDayTool('day_save_note', { title: '体检医生', body: '王医生，周二上午出诊', circleId: state.circles[0]!.id }, context(state));
    expect(saved.notes).toHaveLength(2);
    expect(saved.change).toMatchObject({ kind: 'note-saved', before: null });
  });

  it('reads reminders still open in another app however old, and recent news', () => {
    const state = sampleState();
    const base = {
      appId: 'nimi.parentos', appName: 'ParentOS', type: 'nimi.parentos.care-reminder.v1', nature: 'reminder' as const,
      summary: null, unread: false, needsAttention: false, openable: true, sourceAvailable: true, revision: 1,
      circleId: state.circles[0]!.id, known: 'parentos-care-reminder' as const, groupKey: null,
    };
    const changes: SourceChange[] = [
      { ...base, id: 'a', title: '18 月龄体检', occurredAt: '2026-08-27T16:00:00.000Z', todoState: 'open' },
      { ...base, id: 'b', title: '旧的已完成', occurredAt: '2026-08-27T16:00:00.000Z', todoState: 'completed' },
      { ...base, id: 'c', title: '昨天完成的', occurredAt: '2026-09-23T10:00:00.000Z', todoState: 'completed' },
    ];
    const outcome = executeDayTool('day_recent_changes', {}, context(state, changes));
    expect((outcome.result as { changes: { title: string }[] }).changes.map((change) => change.title)).toEqual(['18 月龄体检', '昨天完成的']);
  });

  it("never lets the agent mistake the user's own circle for itself", () => {
    const state = sampleState();
    const self = createCircle({ kind: 'self', name: '我自己' }, now);
    const withSelf = { ...state, circles: [...state.circles, self] };
    const listed = executeDayTool('day_list_circles', {}, context(withSelf));
    expect((listed.result as { circles: { name: string }[] }).circles.map((circle) => circle.name)).toContain('我自己（用户本人）');
    const skill = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'morning-care')!;
    const work = buildDayWork({ runId: 'run_self', skill, state: withSelf, changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    expect(work.sources.find((source) => source.sourceId === 'nimiday.circles')!.content).toContain('我自己（用户本人）');
  });

  it('links an arrangement to the other app\'s reminder without touching that reminder', () => {
    const state = sampleState();
    const reminder: SourceChange = {
      id: 'activity_checkup', appId: 'nimi.parentos', appName: 'ParentOS', type: 'nimi.parentos.care-reminder.v1', nature: 'reminder',
      title: '18 月龄体检', summary: null, occurredAt: '2026-08-28T00:00:00.000Z', todoState: 'open', unread: false, needsAttention: true,
      openable: true, sourceAvailable: true, revision: 1, circleId: state.circles[0]!.id, known: 'parentos-care-reminder', groupKey: null,
      objectKey: 'nimi.parentos\u0000nimi.parentos.care-reminder.v1\u0000checkup-18m',
    };
    const created = executeDayTool('day_create_item', {
      title: '带小米做 18 月龄体检', kind: 'appointment', circleId: state.circles[0]!.id, date: '2026-09-26', time: '09:00', forReminderId: 'activity_checkup',
    }, context(state, [reminder]));
    expect(created.isError).toBe(false);
    const item = created.items!.find((entry) => entry.title === '带小米做 18 月龄体检')!;
    expect(item.source).toEqual({ appId: 'nimi.parentos', appName: 'ParentOS', activityId: 'activity_checkup', objectKey: reminder.objectKey, title: '18 月龄体检' });
    expect((created.result as { created: { arrangesReminderFrom: unknown } }).created.arrangesReminderFrom).toEqual({ app: 'ParentOS', reminder: '18 月龄体检' });
    // Its later revision is still the same reminder; its own state stays with ParentOS.
    expect(linkedSource(item.source!, [{ ...reminder, id: 'activity_checkup_v2', todoState: 'completed' }])?.todoState).toBe('completed');

    const unknown = executeDayTool('day_create_item', { title: '别的', forReminderId: 'activity_missing' }, context(state, [reminder]));
    expect(unknown.isError).toBe(true);
    expect(unknown.items).toBeUndefined();
  });

  it('states what is true now after an undo that had to leave the user\'s later edit alone', () => {
    const base = sampleState();
    const bill = base.items.find((item) => item.title === '交物业费')!;
    // The assistant marks the bill paid; the user then adds a note of their own.
    const completed = executeDayTool('day_complete_item', { itemId: bill.id }, context(base));
    const afterAgent = { ...base, items: completed.items! };
    const withUserNote = { ...afterAgent, items: afterAgent.items.map((item) => (item.id === bill.id ? editItem(item, { notes: '已在手机上付过' }, 'user', now) : item)) };
    const run = {
      id: 'run_paid', skillId: 'chat', skillName: '对话', trigger: 'chat' as const, rhythmId: null, scheduledFor: null, state: 'done' as const,
      agentName: 'Aya', requestText: '物业费付了', turnId: 't', createdAt: now.toISOString(), startedAt: now.toISOString(), finishedAt: now.toISOString(),
      toolCalls: [], undone: false, replyMessageId: null, replyText: null, error: null, changes: [completed.change!],
    };
    const undone = undoRunChanges({ ...withUserNote, runs: [run] }, run, now);
    expect(undone).toMatchObject({ reverted: 0, skipped: 1 });
    expect(undone.state.items.find((item) => item.id === bill.id)!.state).toBe('done');

    const skill = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'evening-wrap')!;
    const work = buildDayWork({ runId: 'run_next', skill, state: undone.state, changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    const corrections = work.sources.find((source) => source.sourceId === 'nimiday.corrections')!.content;
    expect(corrections).toContain('「交物业费」现在是已完成。');
    expect(corrections).not.toContain('仍未完成');
    expect(corrections).not.toContain('已被用户撤销');
  });

  it('keeps an item the assistant added once the user has changed it, and says so', () => {
    const base = sampleState();
    const created = executeDayTool('day_create_item', { title: '给绿萝换盆', date: '2026-09-26', time: '10:00' }, context(base));
    const added = created.items!.find((item) => item.title === '给绿萝换盆')!;
    // The user turns its reminder off afterwards: that choice is theirs to keep.
    const withUserEdit = { ...base, items: created.items!.map((item) => (item.id === added.id ? editItem(item, { remind: { kind: 'none' } }, 'user', now) : item)) };
    const run = {
      id: 'run_added', skillId: 'chat', skillName: '对话', trigger: 'chat' as const, rhythmId: null, scheduledFor: null, state: 'done' as const,
      agentName: 'Aya', requestText: '周六给绿萝换盆', turnId: 't', createdAt: now.toISOString(), startedAt: now.toISOString(), finishedAt: now.toISOString(),
      toolCalls: [], undone: false, replyMessageId: null, replyText: null, error: null, changes: [created.change!],
    };
    const undone = undoRunChanges({ ...withUserEdit, runs: [run] }, run, now);
    expect(undone).toMatchObject({ reverted: 0, skipped: 1 });
    const kept = undone.state.items.find((item) => item.id === added.id)!;
    expect(kept.state).toBe('open');
    expect(kept.remind).toEqual({ kind: 'none' });
    expect(copyFor('zh').run.undoResult(undone.reverted, undone.kept)).toBe('已撤销 0 项；1 项你后来改过，已保留');
    // What stays on screen afterwards says the same: the change is kept, not undone.
    const after = undone.state.runs[0]!;
    expect(after.undone).toBe(true);
    expect(after.changes[0]?.keptOnUndo).toBe(true);
    expect([...keptChanges(after, undone.state.items)]).toEqual([0]);
    expect(describeUndone(copyFor('zh'), after, undone.state.items)).toBe('没有撤销：这些改动你后来都改过，已保留');

    const skill = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'evening-wrap')!;
    const work = buildDayWork({ runId: 'run_next', skill, state: undone.state, changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    const corrections = work.sources.find((source) => source.sourceId === 'nimiday.corrections')!.content;
    expect(corrections).toContain('「给绿萝换盆」现在是：');
    expect(corrections).not.toContain('现在不在事项里');
  });

  it('reads runs undone before kept changes were marked from the items as they are now', () => {
    const base = sampleState();
    const later = new Date(now.getTime() + 60_000);
    const muchLater = new Date(now.getTime() + 120_000);
    const bill = base.items.find((item) => item.title === '交物业费')!;
    let state = base;
    const apply = (outcome: ReturnType<typeof executeDayTool>) => { state = { ...state, items: outcome.items! }; return outcome.change!; };
    const kept = apply(executeDayTool('day_create_item', { title: '给绿萝施肥', date: '2026-09-27', time: '15:00' }, context(state)));
    const removed = apply(executeDayTool('day_create_item', { title: '买降压药', date: '2026-09-25' }, context(state)));
    const reverted = apply(executeDayTool('day_update_item', { itemId: bill.id, date: '2026-09-30' }, context(state)));
    const restored = apply(executeDayTool('day_create_item', { title: '换灯泡', date: '2026-09-26' }, context(state)));
    const byId = (id: string) => state.items.find((item) => item.id === id)!;
    const itemId = (change: typeof kept) => ('itemId' in change ? change.itemId : '');
    // As an earlier undo left things: the user's edited item stayed, the other addition was dropped,
    // the update was put back to how it was, and one dropped item the user restored afterwards.
    state = {
      ...state,
      items: state.items.map((item) => {
        if (item.id === itemId(kept)) return editItem(item, { remind: { kind: 'none' } }, 'user', now);
        if (item.id === itemId(removed)) return dropItem(item, 'user', later);
        if (item.id === bill.id) return { ...bill, updatedAt: later.toISOString() };
        if (item.id === itemId(restored)) return reopenItem(dropItem(item, 'user', later), 'user', muchLater);
        return item;
      }),
    };
    expect(byId(itemId(restored)).state).toBe('open');
    const run = {
      id: 'run_old', skillId: 'chat', skillName: '对话', trigger: 'chat' as const, rhythmId: null, scheduledFor: null, state: 'done' as const,
      agentName: 'Aya', requestText: '', turnId: 't', createdAt: now.toISOString(), startedAt: now.toISOString(), finishedAt: now.toISOString(),
      toolCalls: [], undone: true, replyMessageId: null, replyText: null, error: null, changes: [kept, removed, reverted, restored],
    };
    // No change carries a mark; only the addition the undo never took back is still in place.
    expect(run.changes.some((change) => change.keptOnUndo)).toBe(false);
    expect([...keptChanges(run, state.items)]).toEqual([0]);
    expect(describeUndone(copyFor('zh'), run, state.items)).toBe('已撤销；其中 1 项你后来改过，已保留');
    expect(describeUndone(copyFor('zh'), { ...run, changes: [removed, reverted] }, state.items)).toBe('已撤销');
  });

  it('never passes off a different request for the same slot as already listed', () => {
    const base = sampleState();
    const once = executeDayTool('day_create_item', { title: '给家里打电话', date: '2026-09-25', time: '09:00', kind: 'reminder' }, context(base));
    const state = { ...base, items: once.items! };
    const existing = state.items.find((item) => item.title === '给家里打电话')!;

    // Same title, day and time, but weekly and an hour ahead: a different wish, said out loud.
    const weekly = executeDayTool('day_create_item', { title: '给家里打电话', date: '2026-09-25', time: '09:00', kind: 'reminder', repeat: { freq: 'weekly' }, remindMinutesBefore: 60 }, context(state));
    expect(weekly.isError).toBe(true);
    expect(weekly.items).toBeUndefined();
    const conflict = weekly.result as { error: string; existing: { id: string }; differences: { field: string }[] };
    expect(conflict.error).toBe('similar-item-exists');
    expect(conflict.existing.id).toBe(existing.id);
    expect(conflict.differences.map((entry) => entry.field)).toEqual(['repeat', 'remind']);

    // Keeping both is an explicit choice.
    const separate = executeDayTool('day_create_item', { title: '给家里打电话', date: '2026-09-25', time: '09:00', kind: 'reminder', repeat: { freq: 'weekly' }, separateFromExisting: true }, context(state));
    expect(separate.isError).toBe(false);
    expect(separate.items).toHaveLength(state.items.length + 1);

    // Exactly the same request: that entry, to be confirmed as saved by the caller.
    const same = executeDayTool('day_create_item', { title: '给家里打电话', date: '2026-09-25', time: '09:00', kind: 'reminder' }, context(state));
    expect(same).toMatchObject({ isError: false, confirms: existing.id, result: { alreadyListed: { id: existing.id } } });
    expect(same.items).toBeUndefined();
  });

  it('does not swallow a link to another app\'s reminder, and can add it to an existing entry', () => {
    const state = sampleState();
    const reminder: SourceChange = {
      id: 'activity_checkup', appId: 'nimi.parentos', appName: 'ParentOS', type: 'nimi.parentos.care-reminder.v1', nature: 'reminder',
      title: '18 月龄体检', summary: null, occurredAt: '2026-08-28T00:00:00.000Z', todoState: 'open', unread: false, needsAttention: true,
      openable: true, sourceAvailable: true, revision: 1, circleId: state.circles[0]!.id, known: 'parentos-care-reminder', groupKey: null, objectKey: null,
    };
    const plain = executeDayTool('day_create_item', { title: '带小米体检', kind: 'appointment', circleId: state.circles[0]!.id, date: '2026-09-26', time: '09:00' }, context(state, [reminder]));
    const withPlain = { ...state, items: plain.items! };
    const linked = executeDayTool('day_create_item', { title: '带小米体检', kind: 'appointment', circleId: state.circles[0]!.id, date: '2026-09-26', time: '09:00', forReminderId: 'activity_checkup' }, context(withPlain, [reminder]));
    expect(linked.isError).toBe(true);
    expect((linked.result as { differences: { field: string }[] }).differences.map((entry) => entry.field)).toEqual(['arrangesReminderFrom']);

    const itemId = withPlain.items.find((item) => item.title === '带小米体检')!.id;
    const updated = executeDayTool('day_update_item', { itemId, forReminderId: 'activity_checkup' }, context(withPlain, [reminder]));
    expect(updated.isError).toBe(false);
    expect(updated.items!.find((item) => item.id === itemId)!.source?.activityId).toBe('activity_checkup');
    expect(updated.change).toMatchObject({ kind: 'item-updated', before: expect.objectContaining({ id: itemId }) });
  });

  it('keeps an ended person out of Today and the assistant\'s material, but keeps their data and reminders', () => {
    const base = sampleState();
    const child = base.circles.find((circle) => circle.name === '小米')!;
    const state = { ...base, circles: base.circles.map((circle) => (circle.id === child.id ? { ...circle, status: 'ended' as const } : circle)) };
    const shot = state.items.find((item) => item.title === '带小米打流感疫苗')!;

    // Kept: the item and the note are still there.
    expect(state.items.some((item) => item.id === shot.id)).toBe(true);
    expect(state.notes.some((note) => note.title === '过敏')).toBe(true);

    // Today: not on the schedule or anywhere else on the page.
    const model = buildToday(state, [], new Date('2026-09-24T08:00:00+08:00'));
    expect(model.timeline.some((entry) => entry.kind === 'item' && entry.item.id === shot.id)).toBe(false);
    expect(model.attention.some((item) => item.id === shot.id)).toBe(false);

    // What the assistant is given, and what its tools list.
    const skill = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'week-plan')!;
    const work = buildDayWork({ runId: 'run_e', skill, state, changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    const material = work.sources.map((source) => source.content).join('\n');
    expect(material).not.toContain('带小米打流感疫苗');
    expect(material).not.toContain('花生过敏');
    expect(material).not.toContain('小米');
    const listed = executeDayTool('day_list_items', { scope: 'next7' }, context(state)).result as { items: { title: string }[] };
    expect(listed.items.map((item) => item.title)).not.toContain('带小米打流感疫苗');
    const handbook = executeDayTool('day_read_handbook', {}, context(state)).result as { notes: { title: string }[] };
    expect(handbook.notes.map((note) => note.title)).not.toContain('过敏');

    // Reminders the user set still go off.
    const plan = planReminders(state.items, new Date('2026-09-24T08:31:00+08:00'), new Date('2026-09-24T07:00:00+08:00'), { allDayRemindTime: '08:30', quiet: { enabled: false, start: '22:00', end: '07:30' } });
    expect(plan.deliver.map((delivery) => delivery.item.id)).toContain(shot.id);
  });

  it('names every part of the shared activity it leaves out', () => {
    const state = sampleState();
    const base = {
      appId: 'nimi.parentos', appName: 'ParentOS', type: 'nimi.parentos.care-reminder.v1', nature: 'reminder' as const,
      summary: null, unread: false, needsAttention: false, openable: true, sourceAvailable: true, revision: 1,
      circleId: state.circles[0]!.id, known: 'parentos-care-reminder' as const, groupKey: null,
    };
    const changes: SourceChange[] = Array.from({ length: 45 }, (_, index) => ({
      ...base, id: `r${index}`, title: `提醒 ${index}`, occurredAt: '2026-09-20T08:00:00.000Z', todoState: 'open' as const,
    }));
    const partial = { openTodos: 'complete', recent: 'partial', recentCount: 400 } as const;
    const outcome = executeDayTool('day_recent_changes', {}, { ...context(state, changes), sourceCoverage: partial });
    const result = outcome.result as { matched: number; listed: number; complete: boolean; gaps: string[]; changes: unknown[] };
    expect(result).toMatchObject({ matched: 45, listed: 40, complete: false });
    expect(result.changes).toHaveLength(40);
    expect(result.gaps).toEqual([
      'Only the newest 400 shared records were loaded; older ones are not included.',
      'Only the first 40 of 45 matching changes are listed, open reminders first.',
    ]);
    // Everything in hand and within the limit: said to be complete, with nothing to qualify.
    const whole = executeDayTool('day_recent_changes', {}, context(state, changes.slice(0, 3))).result as { complete: boolean; gaps?: string[] };
    expect(whole.complete).toBe(true);
    expect(whole.gaps).toBeUndefined();
  });

  it('is honest when other apps cannot be read', () => {
    const outcome = executeDayTool('day_recent_changes', {}, { ...context(sampleState()), sourcesAvailable: false });
    expect(outcome).toMatchObject({ isError: false, result: { available: false } });
  });
});

describe('work payload', () => {
  it('tells the assistant when the list of other apps\' changes is not the whole picture', () => {
    const skill = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'morning-care')!;
    const partial = buildDayWork({ runId: 'run_p', skill, state: sampleState(), changes: [], sourcesAvailable: true, sourceCoverage: { openTodos: 'partial', recent: 'complete', recentCount: 12 }, language: 'zh', now, focusCircleId: null }, 'Aya');
    const note = partial.sources.find((source) => source.sourceId === 'nimiday.changes')!.content;
    expect(note).toContain('其他 App 的未完成提醒没能全部载入，可能有遗漏。');
    expect(note).toContain('不要把这里当成完整清单');
    const whole = buildDayWork({ runId: 'run_w', skill, state: sampleState(), changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    expect(whole.sources.find((source) => source.sourceId === 'nimiday.changes')!.content).not.toContain('说明');
  });

  it('stays inside the public work bounds and carries ids the agent can use', () => {
    const state = sampleState();
    const skill = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'morning-care')!;
    const work = buildDayWork({ runId: 'run_1', skill, state, changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    expect(work.workId).toBe('run_1');
    expect(byteLength(work.instructions)).toBeLessThanOrEqual(WORK_LIMITS.instructions);
    expect(work.instructions).toContain('Aya');
    expect(work.instructions).toContain('晨间照看');
    expect(work.sources.length).toBeLessThanOrEqual(WORK_LIMITS.sources);
    expect(work.sources.map((source) => source.sourceId)).toEqual(['nimiday.today', 'nimiday.overdue', 'nimiday.changes', 'nimiday.circles']);
    expect(work.sources[0]!.content).toContain(state.items[0]!.id);
    expect(work.tools.map((tool) => tool.name).sort()).toEqual([...skill.tools].sort());
    for (const tool of work.tools) expect(JSON.parse(tool.inputSchemaJson).type).toBe('object');
    expect(workByteLength(work)).toBeLessThanOrEqual(WORK_LIMITS.total);
  });

  it('truncates very large households instead of exceeding the budget', () => {
    const state = sampleState();
    const many = Array.from({ length: 900 }, (_, index) => createItem({
      title: `事项 ${index} ${'很长的说明'.repeat(6)}`,
      date: '2026-09-24',
      notes: '备注'.repeat(80),
    }, { by: 'user' }, now));
    const skill = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'week-plan')!;
    const huge = { ...state, items: [...state.items, ...many], notes: Array.from({ length: 200 }, (_, index) => ({ ...state.notes[0]!, id: `note_${index}`, body: '内容'.repeat(300) })) };
    const work = buildDayWork({ runId: 'run_2', skill, state: huge, changes: [], sourcesAvailable: false, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    for (const source of work.sources) expect(byteLength(source.content)).toBeLessThanOrEqual(WORK_LIMITS.sourceContent);
    expect(workByteLength(work)).toBeLessThanOrEqual(WORK_LIMITS.total);
    expect(work.sources[0]!.content).toContain('未列出');
  });

  it('hands the household lessons to whoever is on duty', () => {
    const skill = resolveSkills('zh', [{ skillId: 'morning-care', lessons: [{ id: 'lesson_1', text: '先提醒我带医保卡', addedAt: now.toISOString() }], updatedAt: now.toISOString() }], [])
      .find((candidate) => candidate.id === 'morning-care')!;
    const work = buildDayWork({ runId: 'run_4', skill, state: sampleState(), changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Jarvis');
    expect(work.instructions).toContain('这个家的经验');
    expect(work.instructions).toContain('先提醒我带医保卡');
    expect(work.instructions).toContain('Jarvis');
  });

  it('gives conversation the week ahead so the assistant can adjust instead of duplicating', () => {
    const work = buildDayWork({ runId: 'run_chat', skill: chatSkill('zh'), state: sampleState(), changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    expect(work.sources.map((source) => source.sourceId)).toContain('nimiday.week');
    expect(work.instructions).toContain('不要重复新建');
    expect(work.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['day_update_item', 'day_ask_user', 'day_save_note']));
  });

  it('tells the assistant which of its changes were undone and which questions were answered', () => {
    const base = sampleState();
    const pickup = base.items[0]!;
    const asked = { ...createItem({ title: '体检定周六还是周日？', circleId: base.circles[0]!.id }, { by: 'agent', agentName: 'Aya', runId: 'run_q' }, now),
      state: 'done' as const, decision: { question: '体检定周六还是周日？', options: ['周六', '周日'], choice: '周六' },
      history: [{ at: now.toISOString(), kind: 'decided' as const, by: 'user' as const, note: '周六' }] };
    const undoneRun = {
      id: 'run_u', skillId: 'chat', skillName: '对话', trigger: 'chat' as const, rhythmId: null, scheduledFor: null, state: 'done' as const,
      agentName: 'Aya', requestText: '改到十点', turnId: 't', createdAt: now.toISOString(), startedAt: now.toISOString(), finishedAt: now.toISOString(),
      toolCalls: [], undone: true, replyMessageId: null, replyText: null, error: null,
      changes: [
        { kind: 'item-updated' as const, itemId: pickup.id, title: pickup.title, before: pickup },
        { kind: 'item-created' as const, itemId: 'item_gone', title: '明早带疫苗本' },
      ],
    };
    const state = { ...base, items: [...base.items, asked], runs: [undoneRun] };
    const skill = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'evening-wrap')!;
    const work = buildDayWork({ runId: 'run_5', skill, state, changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    const corrections = work.sources[0]!;
    expect(corrections.sourceId).toBe('nimiday.corrections');
    expect(corrections.content).toContain('「明早带疫苗本」现在不在事项里。');
    expect(corrections.content).toContain(`「${pickup.title}」现在是：`);
    expect(corrections.content).toContain('09:30');
    expect(corrections.content).toContain('用户已决定「体检定周六还是周日？」：周六');
    // Nothing to correct: no extra source.
    const clean = buildDayWork({ runId: 'run_6', skill, state: base, changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh', now, focusCircleId: null }, 'Aya');
    expect(clean.sources.some((source) => source.sourceId === 'nimiday.corrections')).toBe(false);
  });

  it('hands a method and its lessons over whole, or refuses: never a shortened copy', () => {
    const base = resolveSkills('zh', [], []).find((candidate) => candidate.id === 'evening-wrap')!;
    const lesson = { id: 'lesson_1', text: '收尾控制在三四句话以内', addedAt: now.toISOString() };
    const lastRequirement = '最后一条要求：说完之后问我明早几点叫醒。';
    const input = (skill: typeof base) => ({ runId: 'run_3', skill, state: sampleState(), changes: [], sourcesAvailable: true, sourceCoverage: fullCoverage, language: 'zh' as const, now, focusCircleId: null });

    // Accepted by the editor's character limit, but too long to go with its lesson.
    const long = { ...base, instructions: '请按以下要求逐条完成晚间收尾。'.repeat(160) + lastRequirement, lessons: [lesson] };
    expect(long.instructions.length).toBeLessThanOrEqual(4000);
    expect(methodOverflow(long, 'zh')).toBeGreaterThan(0);
    expect(() => buildDayWork(input(long), 'Aya')).toThrow(MethodTooLongError);

    // Within the budget: the last requirement and the lesson both arrive.
    const fitting = { ...base, instructions: '请按以下要求逐条完成晚间收尾。'.repeat(60) + lastRequirement, lessons: [lesson] };
    expect(methodOverflow(fitting, 'zh')).toBe(0);
    const work = buildDayWork(input(fitting), 'Aya');
    expect(work.instructions).toContain(lastRequirement);
    expect(work.instructions).toContain('- 收尾控制在三四句话以内');
    expect(byteLength(work.instructions)).toBeLessThanOrEqual(WORK_LIMITS.instructions);
  });
});
