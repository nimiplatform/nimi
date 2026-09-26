import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCircle } from '../src/nimiday/domain/defaults.js';
import { historicalReplyAuthor } from '../src/nimiday/domain/agent-labels.js';
import { createAgentDesk } from '../src/nimiday/platform/agent-desk.js';
import type { ActivityBridge, ActivityState } from '../src/nimiday/platform/activity-bridge.js';
import { createDayEngine, type DayEngine } from '../src/nimiday/platform/engine.js';
import { copyFor } from '../src/nimiday/i18n/index.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import { createDayStore } from '../src/nimiday/store/day-store.js';
import type { JsonDocumentStore } from '../src/nimiday/store/persistence.js';
import { createFakeAgentClient, handle, settle } from './fake-agent.js';

function memoryDocuments(): JsonDocumentStore {
  const data = new Map<string, unknown>();
  return {
    read: async (path) => (data.has(path) ? structuredClone(data.get(path)) : undefined),
    write: async (path, value) => { data.set(path, structuredClone(value)); },
    remove: async (path) => { data.delete(path); },
  };
}

function idleActivity(): ActivityBridge {
  const state: ActivityState = { status: 'no-access', records: [], hasMore: false, coverage: { openTodos: 'loading', recent: 'loading', recentCount: 0 }, error: null };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    start: () => undefined,
    stop: async () => undefined,
    retry: () => undefined,
    loadMore: () => undefined,
    markRead: async () => undefined,
    open: async () => ({ outcome: 'unavailable', reason: 'host-unavailable' }),
    put: async () => null,
    onOpenRequest: async () => async () => undefined,
  };
}

const aya = { agentHandle: handle('aya'), displayName: 'Aya', avatarUrl: null, agentBinding: `agent_binding_${'a'.repeat(43)}` };
const jarvis = { agentHandle: handle('jarvis'), displayName: 'Jarvis', avatarUrl: null };
const bea = { agentHandle: handle('bea'), displayName: 'Bea', avatarUrl: null, agentBinding: `agent_binding_${'b'.repeat(43)}` };

describe('agent desk', () => {
  it('restores an appointment only through its binding', async () => {
    const fake = createFakeAgentClient({ references: [aya, jarvis] });
    const desk = createAgentDesk(fake.client);
    await desk.start({ displayName: 'Aya', avatarUrl: null, binding: aya.agentBinding, appointedAt: '2026-09-24T00:00:00.000Z' });
    await settle();
    expect(desk.getState()).toMatchObject({ phase: 'ready', agent: { displayName: 'Aya', binding: aya.agentBinding } });

    // Same name without a binding is never taken as the same agent.
    const again = createAgentDesk(fake.client);
    await again.start({ displayName: 'Jarvis', avatarUrl: null, binding: null, appointedAt: '2026-09-24T00:00:00.000Z' });
    expect(again.getState()).toMatchObject({ phase: 'choose', awaitingConfirmation: { displayName: 'Jarvis' } });
    await desk.dispose();
    await again.dispose();
  });

  it('business work does not need a conversation client and keeps its own complete result', async () => {
    const fake = createFakeAgentClient({ references: [aya], withWork: true });
    const desk = createAgentDesk(fake.client);
    await desk.start(null); await desk.appoint(aya.agentHandle as never);
    const sent = await desk.sendWork({ text: '保存安排', requestId: 'r1', work: { workId: 'w1', instructions: '执行安排', sources: [], tools: [] } });
    expect(sent.ok).toBe(true);
    fake.push({ type: 'message-committed', turnId: 'turn_1', message: { role: 'assistant', parts: [{ kind: 'text', text: '真实结果' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_1' }); await settle();
    expect(desk.getState().messages.map(message => message.text)).toEqual(['保存安排', '真实结果']);
    expect(fake.sent[0]).not.toHaveProperty('conversationAnchorId');
    await desk.dispose();
  });

  it('does not cancel a foreign execution', async () => {
    const fake = createFakeAgentClient({ references: [aya], withWork: true }); const desk = createAgentDesk(fake.client);
    await desk.start(null); await desk.appoint(aya.agentHandle as never);
    expect(await desk.interrupt('foreign-execution')).toBe('not-active'); expect(fake.interrupts).toEqual([]); await desk.dispose();
  });

});

describe('skill runs through the on-duty agent', () => {
  let engine: DayEngine | null = null;
  afterEach(async () => {
    await engine?.stop();
    engine = null;
  });

  async function setup(withWork: boolean, now?: () => Date) {
    const fake = createFakeAgentClient({ references: [aya], withWork });
    const documents = memoryDocuments();
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    const actions = dayActions(store);
    const child = createCircle({ kind: 'child', name: '小米' }, new Date());
    store.update((state) => ({ ...state, circles: [child] }), ['circles']);
    const desk = createAgentDesk(fake.client);
    await desk.start(null);
    await desk.appoint(aya.agentHandle as never);
    await settle();
    engine = createDayEngine({
      store,
      actions,
      desk,
      activity: idleActivity(),
      language: () => 'zh',
      copy: () => copyFor('zh'),
      navigate: () => undefined,
      ...(now ? { now } : {}),
    });
    engine.start();
    return { fake, store, desk, child, documents };
  }

  it('is honest when the platform does not offer App skills', async () => {
    const { store, fake } = await setup(false);
    await engine!.startSkill({ skillId: 'morning-care', trigger: 'user' }); await settle();
    expect(store.getSnapshot().state.runs[0]?.state).toBe('failed'); expect(fake.sent).toEqual([]);
  });

  it('persists a terminal result received by the normal poll while subscription setup is pending', async () => {
    const { fake, store, desk, documents } = await setup(true);
    let release!: () => void; let lateSubscriptionCanceled = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const subscribe = desk.work().subscribe;
    const spy = vi.spyOn(desk.work(), 'subscribe').mockImplementation(async scope => {
      fake.setExecutionState(scope.executionId, { state: 'succeeded', outputText: '已完成的真实结果' });
      await gate;
      const source = await subscribe(scope);
      return { ...source, cancel: async () => { lateSubscriptionCanceled = true; await source.cancel(); } };
    });
    try {
      const sent = engine!.chat('只解释安排，不新增事项');
      // The existing one-second poll may finish before the subscription connects.
      await vi.waitFor(() => expect(store.getSnapshot().state.runs[0]?.state).toBe('done'), { timeout: 2000, interval: 10 });
      expect((await sent).ok).toBe(true);
      release(); await settle(20);
      expect(lateSubscriptionCanceled).toBe(true);
      expect(await store.persist()).toEqual({ ok: true });
      const reopened = createDayStore(documents, { language: () => 'zh' }); await reopened.load();
      expect(reopened.getSnapshot().state.runs[0]).toMatchObject({ state: 'done', replyText: '已完成的真实结果', error: null });
      expect(fake.sent).toHaveLength(1);
      reopened.close();
    } finally { release(); spy.mockRestore(); await desk.dispose(); }
  });

  it('keeps ended-care history locally without handing its old handbook answer back to the assistant', async () => {
    const { fake, store, child, desk, documents } = await setup(true);
    const marker = '小树对花生过敏，查看配料表';
    try {
      await engine!.chat('查一下我新添加的过敏说明');
      const added = dayActions(store).addCircle({ name: '小树', kind: 'child' });
      store.update(state => ({ ...state, notes: [{ id: 'allergy', circleId: added.id, title: '过敏说明', body: marker, pinned: true, origin: { by: 'user' }, createdAt: added.createdAt, updatedAt: added.updatedAt }] }), ['notes']);
      fake.requestCall({ callId: 'read-allergy', turnId: 'turn_1', name: 'day_read_handbook', argumentsJson: JSON.stringify({ circleId: added.id }) });
      await vi.waitFor(() => expect(fake.submitted.some(result => result.resultJson.includes(marker))).toBe(true), { timeout: 1500, interval: 10 });
      fake.push({ type: 'message-committed', turnId: 'turn_1', message: { parts: [{ kind: 'text', text: marker }] } });
      fake.push({ type: 'turn-completed', turnId: 'turn_1' }); await settle(30);
      const priorId = store.getSnapshot().state.runs[0]!.id;
      dayActions(store).setCircleStatus(added.id, 'ended');
      expect((await engine!.chat('帮我安排浇花')).ok).toBe(true);
      expect(JSON.stringify(fake.sent[1])).not.toContain(marker);
      expect(JSON.stringify(fake.sent[1])).not.toContain('查一下我新添加的过敏说明');
      expect(store.getSnapshot().state.runs.find(run => run.id === priorId)?.replyText).toBe(marker);
      expect(store.getSnapshot().state.notes[0]?.body).toBe(marker);
      expect(await store.persist()).toEqual({ ok: true });
      const reopened = createDayStore(documents, { language: () => 'zh' }); await reopened.load();
      expect(reopened.getSnapshot().state.runs.find(run => run.id === priorId)?.careCircleIds).toEqual([child.id, added.id]);
      reopened.close();
    } finally { await desk.dispose(); }
  });

  it('carries the Day goal and question into the same assistant’s clarification reply', async () => {
    const { fake, store } = await setup(true);
    expect((await engine!.chat('请帮我预约牙科复查')).ok).toBe(true);
    fake.push({ type: 'message-committed', turnId: 'turn_1', message: { messageId: 'dental-question', parts: [{ kind: 'text', text: '你想约哪一天几点？' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_1' }); await settle(30);
    expect((await engine!.chat('明天下午三点')).ok).toBe(true);
    const second = fake.sent[1] as { prompt: string; work: { sources: { sourceId: string; content: string }[] } };
    expect(second.prompt).toBe('明天下午三点');
    const prior = second.work.sources.find(source => source.sourceId === 'nimiday.continuation')!;
    expect(JSON.parse(prior.content).entries).toEqual([expect.objectContaining({ request: '请帮我预约牙科复查', reply: '你想约哪一天几点？', state: 'done' })]);
    expect(store.getSnapshot().state.runs[0]?.agentBinding).toBe(aya.agentBinding);
    expect(second).not.toHaveProperty('conversationAnchorId');
  });

  it('retains the assistant correlation through a real DayStore save and reopen before continuing', async () => {
    const { fake, store, desk, documents } = await setup(true);
    await engine!.chat('请帮我预约牙科复查');
    fake.push({ type: 'message-committed', turnId: 'turn_1', message: { messageId: 'saved-question', parts: [{ kind: 'text', text: '你想约哪一天几点？' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_1' }); await settle(30);
    const prior = store.getSnapshot().state.runs[0]!;
    store.update(state => ({ ...state, runs: [...state.runs, { ...prior, id: 'older-unassigned', agentBinding: undefined, requestText: '不能只按同名猜测的旧任务' }] }), ['runs']);
    expect(await store.persist()).toEqual({ ok: true });
    await engine!.stop(); await desk.dispose();
    const reopened = createDayStore(documents, { language: () => 'zh' }); await reopened.load();
    expect(reopened.getSnapshot().state.runs.find(run => run.id === prior.id)?.agentBinding).toBe(aya.agentBinding);
    expect(reopened.getSnapshot().state.runs.find(run => run.id === 'older-unassigned')?.agentBinding).toBeNull();
    const next = createFakeAgentClient({ references: [{ ...aya, agentHandle: handle('renewed-aya') }], withWork: true });
    const nextDesk = createAgentDesk(next.client, { history: () => reopened.getSnapshot().state.runs });
    await nextDesk.start({ displayName: aya.displayName, avatarUrl: null, binding: aya.agentBinding, appointedAt: prior.createdAt });
    engine = createDayEngine({ store: reopened, actions: dayActions(reopened), desk: nextDesk, activity: idleActivity(), language: () => 'zh', copy: () => copyFor('zh'), navigate: () => undefined });
    engine.start();
    try {
      expect((await engine.chat('明天下午三点')).ok).toBe(true);
      const request = JSON.stringify(next.sent[0]);
      expect(request).toContain('牙科复查'); expect(request).toContain('你想约哪一天几点？');
      expect(request).not.toContain('不能只按同名猜测的旧任务');
    } finally { await engine.stop(); await nextDesk.dispose(); engine = null; }
  });

  it('projects reopened business history oldest first while keeping each request beside its reply', async () => {
    const { fake, store, desk, documents } = await setup(true);
    await engine!.chat('新一轮请求');
    fake.push({ type: 'message-committed', turnId: 'turn_1', message: { messageId: 'new-reply', parts: [{ kind: 'text', text: '新一轮答复' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_1' }); await settle(30);
    const recent = store.getSnapshot().state.runs[0]!;
    dayActions(store).putRun({ ...recent, id: 'older-run', trigger: 'rhythm', agentName: '王昌龄', agentBinding: undefined, turnId: 'older-execution', createdAt: new Date(Date.parse(recent.createdAt) - 86400000).toISOString(), requestText: '旧一轮请求', replyText: '旧一轮答复', replyMessageId: 'old-reply' });
    dayActions(store).putRun({ ...recent, id: 'same-name-other-agent', agentName: aya.displayName, agentBinding: bea.agentBinding, turnId: 'other-execution', createdAt: new Date(Date.parse(recent.createdAt) - 43200000).toISOString(), requestText: '同名旧任请求', replyText: '同名旧任答复', replyMessageId: 'other-reply' });
    expect(await store.persist()).toEqual({ ok: true });
    await engine!.stop(); await desk.dispose(); engine = null;
    const reopened = createDayStore(documents, { language: () => 'zh' }); await reopened.load();
    const storedOrder = reopened.getSnapshot().state.runs.map(run => run.id);
    expect(storedOrder).toEqual([recent.id, 'same-name-other-agent', 'older-run']);
    const next = createFakeAgentClient({ references: [aya], withWork: true });
    const historyDesk = createAgentDesk(next.client, { history: () => reopened.getSnapshot().state.runs });
    try {
      await historyDesk.start({ displayName: aya.displayName, avatarUrl: null, binding: aya.agentBinding, appointedAt: recent.createdAt });
      expect(historyDesk.getState().messages.map(message => message.text)).toEqual(['旧一轮请求', '旧一轮答复', '同名旧任请求', '同名旧任答复', '新一轮请求', '新一轮答复']);
      expect(historyDesk.getState().messages.map(message => message.turnId)).toEqual(['older-execution', 'older-execution', 'other-execution', 'other-execution', 'turn_1', 'turn_1']);
      const byReply = new Map(reopened.getSnapshot().state.runs.filter(run => run.replyMessageId).map(run => [run.replyMessageId, run]));
      const projectedAuthors = historyDesk.getState().messages.filter(message => message.role === 'assistant').map(message => historicalReplyAuthor(byReply.get(message.id) || null, historyDesk.getState().agent!.binding));
      expect(projectedAuthors).toEqual([{ name: '王昌龄', linked: false }, { name: 'Aya', linked: true }, null]);
      expect(historicalReplyAuthor({ agentName: 'Aya', agentBinding: null }, aya.agentBinding)).toEqual({ name: 'Aya', linked: false });
      expect(historicalReplyAuthor(null, aya.agentBinding)).toEqual({ name: null, linked: false });
      expect(reopened.getSnapshot().state.runs.map(run => run.id)).toEqual(storedOrder);
    } finally { await historyDesk.dispose(); }
  });

  it('does not hand another assistant’s exchange or an independent skill to a continuation', async () => {
    const { fake, store } = await setup(true);
    await engine!.chat('当前助理的阅读安排');
    fake.push({ type: 'message-committed', turnId: 'turn_1', message: { messageId: 'own-question', parts: [{ kind: 'text', text: '几点开始？' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_1' }); await settle(30);
    const original = store.getSnapshot().state.runs[0]!;
    store.update(state => ({ ...state, runs: [...state.runs,
      { ...original, id: 'other-assistant', agentName: 'Aya', agentBinding: bea.agentBinding, requestText: '另一位同名助理的私有前文' },
      { ...original, id: 'separate-skill', trigger: 'user', requestText: '独立技能的前文' },
      { ...original, id: 'uncorrelated-history', agentBinding: undefined, requestText: '无法确认助理归属的旧记录' },
    ] }), ['runs']);
    await engine!.chat('明天三点');
    const request = JSON.stringify(fake.sent[1]);
    expect(request).toContain('当前助理的阅读安排');
    expect(request).not.toContain('另一位同名助理的私有前文');
    expect(request).not.toContain('独立技能的前文');
    expect(request).not.toContain('无法确认助理归属的旧记录');
  });

  it('bounds large prior exchanges and reports omitted and excerpted context', async () => {
    const { fake, store } = await setup(true);
    await engine!.chat('起始安排');
    fake.push({ type: 'turn-completed', turnId: 'turn_1' }); await settle(30);
    const original = store.getSnapshot().state.runs[0]!;
    store.update(state => ({ ...state, runs: [...state.runs, ...Array.from({ length: 20 }, (_, index) => ({
      ...original, id: `history-${index}`, turnId: `history-execution-${index}`,
      requestText: `第${index}轮补充：${'中文长要求'.repeat(600)}`, replyText: '很长的历史答复'.repeat(600),
    }))] }), ['runs']);
    await engine!.chat('保留我的最新补充');
    const sent = fake.sent[1] as { work: { sources: { sourceId: string; content: string }[] } };
    const source = sent.work.sources.find(source => source.sourceId === 'nimiday.continuation')!;
    const history = JSON.parse(source.content) as { omittedEarlier: number; entries: { request: string; excerpted: boolean }[] };
    expect(history.omittedEarlier).toBeGreaterThan(0);
    expect(history.entries.at(-1)?.request).toContain('第19轮补充');
    expect(history.entries.some(entry => entry.excerpted)).toBe(true);
    expect(new TextEncoder().encode(source.content).byteLength).toBeLessThanOrEqual(6 * 1024);
    expect(new TextEncoder().encode(JSON.stringify(sent.work)).byteLength).toBeLessThanOrEqual(65536);
  });

  it('sends work, executes the agent’s skill calls and records the result', async () => {
    const { fake, store, child } = await setup(true);
    const started = await engine!.startSkill({ skillId: 'morning-care', trigger: 'user' });
    expect(started.ok).toBe(true);
    await settle();
    const sent = fake.sent[0] as { prompt: string; work: { workId: string; tools: { name: string }[]; sources: { sourceId: string }[]; instructions: string } };
    expect(sent.prompt).toBe('帮我看看今天有什么需要照看的。');
    expect(sent.work.workId).toBe(started.ok ? started.runId : '');
    expect(sent.work.tools.map((tool) => tool.name)).toContain('day_create_item');
    expect(sent.work.instructions).toContain('Aya');

    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    fake.requestCall({
      callId: 'app_call_1',
      turnId: 'turn_1',
      name: 'day_create_item',
      argumentsJson: JSON.stringify({ title: '准备小米的疫苗本', circleId: child.id, date: '2026-09-25', time: '08:00' }),
    });
    await settle(20);
    expect(fake.submitted).toHaveLength(1);
    expect(JSON.parse(fake.submitted[0]!.resultJson)).toMatchObject({ created: { title: '准备小米的疫苗本', circle: '小米' } });
    expect(store.getSnapshot().state.items.map((item) => item.title)).toContain('准备小米的疫苗本');

    fake.push({ type: 'message-committed', turnId: 'turn_1', message: { messageId: 'm1', turnId: 'turn_1', role: 'assistant', parts: [{ kind: 'text', text: '已为你安排好了。' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_1', terminalReason: 'stop' });
    await settle(20);
    const run = store.getSnapshot().state.runs[0]!;
    expect(run).toMatchObject({ state: 'done', agentName: 'Aya', replyText: '已为你安排好了。', turnId: 'turn_1' });
    expect(run.changes).toEqual([expect.objectContaining({ kind: 'item-created', title: '准备小米的疫苗本' })]);
    expect(run.toolCalls).toEqual([expect.objectContaining({ callId: 'app_call_1', ok: true })]);

    const undone = engine!.undoRun(run.id);
    expect(undone).toEqual({ reverted: 1, skipped: 0, kept: 0 });
    expect(store.getSnapshot().state.items.find((item) => item.title === '准备小米的疫苗本')?.state).toBe('dropped');
  });

  it('waits for a busy agent and starts when the turn ends', async () => {
    const { fake, store, desk } = await setup(true);
    fake.setBusy(true); await desk.reconnect();
    const started = await engine!.startSkill({ skillId: 'evening-wrap', trigger: 'user' });
    expect(started.ok).toBe(true);
    await settle();
    expect(fake.sent).toHaveLength(0);
    expect(engine!.getState().waitingForAgent).toBe(true);
    fake.setBusy(false);
    await new Promise(resolve => setTimeout(resolve, 1100));
    await settle(30);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle(10);
    expect(fake.sent).toHaveLength(1);
    expect(store.getSnapshot().state.runs[0]).toMatchObject({ state: 'running' });
  });

  it('starts an automatic routine as an App-originated turn', async () => {
    // NimiDay is open when the routine's time comes.
    const clock = { now: new Date('2026-09-24T07:30:30+08:00') };
    const { fake, store } = await setup(true, () => clock.now);
    const morning = store.getSnapshot().state.rhythms.find((rhythm) => rhythm.skillId === 'morning-care')!;
    store.update((state) => ({
      ...state,
      rhythms: state.rhythms.map((rhythm) => (rhythm.id === morning.id
        ? { ...rhythm, enabled: true, start: 'auto' as const, schedule: { days: 'daily' as const, weekdays: [], time: '07:31' }, handledFor: new Date('2026-09-23T07:31:00+08:00').toISOString(), createdAt: new Date('2026-09-20T00:00:00+08:00').toISOString() }
        : rhythm)),
    }), ['rhythms']);
    clock.now = new Date('2026-09-24T07:31:10+08:00');
    engine!.tick();
    await settle(20);
    expect(fake.sent).toHaveLength(1);
    const sent = fake.sent[0] as { prompt: string; work: { routineName?: string } };
    expect(sent.work.routineName).toBe(morning.name);
    expect(sent.prompt).toContain('例行');
    expect(sent.prompt).not.toBe('帮我看看今天有什么需要照看的。');
    const run = store.getSnapshot().state.runs.find((entry) => entry.rhythmId === morning.id)!;
    expect(run).toMatchObject({ trigger: 'rhythm', state: 'running' });
    expect(store.getSnapshot().state.rhythms.find((rhythm) => rhythm.id === morning.id)?.handledFor).not.toBeNull();
  });

  it('marks an interrupted run and keeps its record', async () => {
    const { fake, store } = await setup(true);
    await engine!.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-interrupted', turnId: 'turn_1', reason: 'user_cancel' });
    await settle(20);
    expect(store.getSnapshot().state.runs[0]).toMatchObject({ state: 'interrupted', error: { code: 'user_cancel' } });
  });

  it('keeps business exchanges in App state whether or not a tool changed an item', async () => {
    const { fake, store, child } = await setup(true);
    expect(await engine!.chat('明天早上8点提醒我带小米的疫苗本')).toMatchObject({ ok: true, turnId: 'turn_1' });
    const sent = fake.sent[0] as { prompt: string; work: { tools: { name: string }[]; routineName?: string; sources: { sourceId: string }[] } };
    expect(sent.prompt).toBe('明天早上8点提醒我带小米的疫苗本');
    expect(sent.work.routineName).toBeUndefined();
    expect(sent.work.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['day_create_item', 'day_complete_item', 'day_save_note']));

    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    fake.requestCall({ callId: 'app_call_9', turnId: 'turn_1', name: 'day_create_item', argumentsJson: JSON.stringify({ title: '带小米的疫苗本', circleId: child.id, date: '2026-09-25', time: '08:00' }) });
    await settle(20);
    expect(fake.submitted).toHaveLength(1);
    fake.push({ type: 'message-committed', turnId: 'turn_1', message: { messageId: 'm_reply', turnId: 'turn_1', role: 'assistant', parts: [{ kind: 'text', text: '记下了，明早八点提醒你。' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_1', terminalReason: 'stop' });
    await settle(20);
    const [run] = store.getSnapshot().state.runs;
    expect(run).toMatchObject({ trigger: 'chat', state: 'done', replyMessageId: 'turn_1:result', changes: [expect.objectContaining({ kind: 'item-created' })] });

    // A plain business reply remains in the App's own exchange history.
    expect(await engine!.chat('谢谢')).toMatchObject({ ok: true, turnId: 'turn_2' });
    fake.push({ type: 'turn-accepted', turnId: 'turn_2' });
    fake.push({ type: 'message-committed', turnId: 'turn_2', message: { messageId: 'm_2', turnId: 'turn_2', role: 'assistant', parts: [{ kind: 'text', text: '不客气。' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_2', terminalReason: 'stop' });
    await settle(20);
    expect(store.getSnapshot().state.runs).toHaveLength(2);
    expect(store.getSnapshot().state.runs.some(entry => entry.id === run!.id)).toBe(true);
  });

  it('tells the user right away when the agent is busy with a skill', async () => {
    const { store } = await setup(true);
    await engine!.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle();
    expect(await engine!.chat('在吗')).toMatchObject({ ok: false, reason: 'busy' });
    expect(store.getSnapshot().state.runs).toHaveLength(1);
  });

  it('flags a promise that saved nothing instead of letting it pass as a reminder', async () => {
    const { fake, store } = await setup(true);
    await engine!.chat('明天早上8点提醒我带疫苗本');
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    fake.push({ type: 'message-committed', turnId: 'turn_1', message: { messageId: 'm_promise', turnId: 'turn_1', role: 'assistant', parts: [{ kind: 'text', text: '已经记下了，明早提醒你。' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_1', terminalReason: 'stop' });
    await settle(20);
    expect(store.getSnapshot().state.items.some((item) => item.title.includes('疫苗本'))).toBe(false);
    expect(engine!.getState().unconfirmed).toEqual({ messageId: 'turn_1:result', request: '明天早上8点提醒我带疫苗本' });
    await engine!.chat('好的');
    expect(engine!.getState().unconfirmed).toBeNull();
  });

  it('gets an own terminal result when the subscription missed its terminal event', async () => {
    const { fake, store } = await setup(true);
    await engine!.startSkill({ skillId: 'catch-up', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    fake.push({ type: 'text-delta', turnId: 'turn_1', delta: '我把新变化看了一遍。' });
    await settle(20);
    expect(store.getSnapshot().state.runs[0]).toMatchObject({ state: 'running' });
    // Only the exact business execution is read to recover a missed terminal event.
    fake.setExecutionState('turn_1', { state: 'succeeded', outputText: '完整工作结果' });
    await engine!.checkActiveRun();
    await settle(10);
    expect(store.getSnapshot().state.runs[0]).toMatchObject({
      state: 'done',
      replyText: '完整工作结果',
      error: null,
    });
    expect(engine!.getState().activeRunId).toBeNull();
  });

  it('stops only its own turn, and settles a run whose turn already ended', async () => {
    const { fake, store, desk } = await setup(true);
    await engine!.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    await settle(10);
    expect(desk.ownsTurn('turn_1')).toBe(true);
    expect(desk.ownsTurn('someone_elses_turn')).toBe(false);

    fake.setInterruptNotActive(true);
    await engine!.stopRun();
    await settle(10);
    expect(fake.interrupts).toEqual([{ expectedTurnId: 'turn_1' }]);
    // Runtime says the turn is over, so the run is settled instead of retrying an untargeted stop.
    expect(store.getSnapshot().state.runs[0]).toMatchObject({ state: 'interrupted', error: { code: 'cancelled' } });
    expect(fake.interrupts).toHaveLength(1);
  });

  it('asks about the whole household when a person-focused skill has no one chosen', async () => {
    const { fake } = await setup(true);
    await engine!.startSkill({ skillId: 'care-review', trigger: 'user' });
    await settle(10);
    expect((fake.sent[0] as { prompt: string }).prompt).toBe('帮我看看「全家」最近怎么样。');
  });

  it('stops its own request on the current agent before the post changes hands', async () => {
    const { fake, store } = await setup(true);
    await engine!.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    await settle(10);
    await engine!.handOver(async () => null, { stopCurrent: true });
    await settle(10);
    expect(fake.interrupts).toEqual([{ expectedTurnId: 'turn_1' }]);
    expect(store.getSnapshot().state.runs[0]).toMatchObject({ state: 'interrupted', error: { code: 'cancelled' } });
    expect(engine!.getState().activeRunId).toBeNull();
    // Nothing in flight: nothing to stop.
    await engine!.handOver(async () => null, { stopCurrent: true });
    expect(fake.interrupts).toHaveLength(1);
  });

  it('hands queued work to the new agent, never to the one leaving', async () => {
    const fake = createFakeAgentClient({ references: [aya, bea], withWork: true });
    const store = createDayStore(memoryDocuments(), { language: () => 'zh' });
    await store.load();
    const desk = createAgentDesk(fake.client);
    await desk.start({ displayName: 'Aya', avatarUrl: null, binding: aya.agentBinding, appointedAt: '2026-09-24T00:00:00.000Z' });
    await settle();
    engine = createDayEngine({ store, actions: dayActions(store), desk, activity: idleActivity(), language: () => 'zh', copy: () => copyFor('zh'), navigate: () => undefined });
    engine.start();
    await engine.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    await settle();
    const second = await engine.startSkill({ skillId: 'morning-care', trigger: 'user' });
    await settle();
    expect(fake.sent).toHaveLength(1);

    await engine.handOver(() => desk.appoint(bea.agentHandle as never), { stopCurrent: true });
    await settle(20);
    expect(desk.getState().agent?.displayName).toBe('Bea');
    expect(fake.sent).toHaveLength(2);
    expect((fake.sent[0] as { agentHandle: string }).agentHandle).toBe(aya.agentHandle);
    expect((fake.sent[1] as { agentHandle: string }).agentHandle).toBe(bea.agentHandle);
    expect(store.getSnapshot().state.runs.find((run) => run.id === (second.ok ? second.runId : ''))).toMatchObject({ state: 'running', agentName: 'Bea' });
    await desk.dispose();
  });

  it('keeps queued work waiting when the new appointment does not go through', async () => {
    const fake = createFakeAgentClient({ references: [aya, bea], withWork: true });
    const store = createDayStore(memoryDocuments(), { language: () => 'zh' });
    await store.load();
    const desk = createAgentDesk(fake.client);
    await desk.start({ displayName: 'Aya', avatarUrl: null, binding: aya.agentBinding, appointedAt: '2026-09-24T00:00:00.000Z' });
    await settle();
    engine = createDayEngine({ store, actions: dayActions(store), desk, activity: idleActivity(), language: () => 'zh', copy: () => copyFor('zh'), navigate: () => undefined });
    engine.start();
    await engine.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    await settle();
    const queued = await engine.startSkill({ skillId: 'morning-care', trigger: 'user' });
    await settle();
    await expect(engine.handOver(async () => { throw new Error('appointment failed'); }, { stopCurrent: true })).rejects.toThrow('appointment failed');
    await settle(20);
    // The departing turn was stopped; the queued request waits instead of being given to anyone by guess.
    expect(fake.sent).toHaveLength(1);
    expect(store.getSnapshot().state.runs.find((run) => run.id === (queued.ok ? queued.runId : ''))?.state).toBe('queued');
    await desk.dispose();
  });

  it('tries a request about one person again about that same person, also after reopening', async () => {
    const fake = createFakeAgentClient({ references: [aya], withWork: true });
    const documents = memoryDocuments();
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    const actions = dayActions(store);
    const child = actions.addCircle({ kind: 'child', name: '小米' });
    actions.addCircle({ kind: 'elder', name: '奶奶' });
    const desk = createAgentDesk(fake.client);
    await desk.start({ displayName: 'Aya', avatarUrl: null, binding: aya.agentBinding, appointedAt: '2026-09-24T00:00:00.000Z' });
    await settle();
    const first = createDayEngine({ store, actions, desk, activity: idleActivity(), language: () => 'zh', copy: () => copyFor('zh'), navigate: () => undefined });
    first.start();
    const started = await first.startSkill({ skillId: 'care-review', trigger: 'user', focusCircleId: child.id });
    await settle();
    expect((fake.sent[0] as { prompt: string }).prompt).toBe('帮我看看「小米」最近怎么样。');
    fake.push({ type: 'turn-failed', turnId: 'turn_1', reasonCode: 'AI_PROVIDER_TIMEOUT', message: 'timeout' });
    await settle(20);
    await first.stop();
    await store.flush();

    // NimiDay is opened again: the failed run still knows whom it was about.
    const reopened = createDayStore(documents, { language: () => 'zh' });
    await reopened.load();
    engine = createDayEngine({ store: reopened, actions: dayActions(reopened), desk, activity: idleActivity(), language: () => 'zh', copy: () => copyFor('zh'), navigate: () => undefined });
    engine.start();
    const failed = reopened.getSnapshot().state.runs.find((run) => run.id === (started.ok ? started.runId : ''))!;
    expect(failed).toMatchObject({ state: 'failed', focusCircleId: child.id });
    // What the Retry button does.
    expect(await engine.retry(failed.id)).toMatchObject({ ok: true });
    await settle();
    const retry = fake.sent[1] as { prompt: string; work: { sources: { sourceId: string; content: string }[] } };
    expect(retry.prompt).toBe('帮我看看「小米」最近怎么样。');
    expect(retry.work.sources.find((source) => source.sourceId === 'nimiday.circles')!.content).not.toContain('奶奶');
    await desk.dispose();
  });

  it('does not start a skill whose method and lessons cannot be handed over whole', async () => {
    const { fake, store } = await setup(true);
    const skill = dayActions(store).saveCustomSkill({
      icon: 'sparkles', name: '很长的做法', purpose: '', request: '按做法来', instructions: '请按以下要求逐条完成。'.repeat(240), tools: ['day_list_items'], materials: ['today'], enabled: true,
    });
    const result = await engine!.startSkill({ skillId: skill.id, trigger: 'user' });
    expect(result).toMatchObject({ ok: false, reason: 'method-too-long' });
    expect(fake.sent).toHaveLength(0);
    expect(store.getSnapshot().state.runs).toEqual([]);
  });

  it('enforces the accepted person selection when a tool asks to write another person', async () => {
    const { fake, store, child } = await setup(true);
    const other = dayActions(store).addCircle({ kind: 'elder', name: '另一位家人' });
    await engine!.startSkill({ skillId: 'morning-care', trigger: 'user', focusCircleId: child.id }); await settle();
    fake.requestCall({ callId: 'outside-person', turnId: 'turn_1', name: 'day_create_item', argumentsJson: JSON.stringify({ title: '不应新增', circleId: other.id }) }); await settle(20);
    expect(fake.submitted).toHaveLength(1); expect(fake.submitted[0]?.isError).toBe(true);
    expect(store.getSnapshot().state.items.some(item => item.title === '不应新增')).toBe(false);
  });

  it('does not widen a retry to everyone when that person is gone', async () => {
    const { fake, store } = await setup(true);
    const circle = store.getSnapshot().state.circles[0]!;
    store.update((state) => ({ ...state, circles: [] }), ['circles']);
    const result = await engine!.startSkill({ skillId: 'care-review', trigger: 'user', focusCircleId: circle.id });
    expect(result).toMatchObject({ ok: false, reason: 'unknown-circle' });
    expect(fake.sent).toHaveLength(0);
  });

  it('asks once more when a reply comes back in the wrong format and nothing has changed', async () => {
    const { fake, store } = await setup(true);
    await engine!.chat('今天还有什么要做的？');
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    fake.push({ type: 'turn-failed', turnId: 'turn_1', reasonCode: 'AI_OUTPUT_INVALID', message: 'unsupported APML top-level tag <activity>' });
    await settle(30);
    expect(fake.sent.map((input) => (input as { prompt: string }).prompt)).toEqual(['今天还有什么要做的？', '今天还有什么要做的？']);
    // The retry fails the same way: it is not retried again.
    fake.push({ type: 'turn-accepted', turnId: 'turn_2' });
    fake.push({ type: 'turn-failed', turnId: 'turn_2', reasonCode: 'AI_OUTPUT_INVALID', message: 'unsupported APML top-level tag <activity>' });
    await settle(30);
    expect(fake.sent).toHaveLength(2);

    await engine!.startSkill({ skillId: 'evening-wrap', trigger: 'user' });
    await settle(10);
    fake.push({ type: 'turn-accepted', turnId: 'turn_3' });
    fake.push({ type: 'turn-failed', turnId: 'turn_3', reasonCode: 'AI_OUTPUT_INVALID', message: 'unsupported APML top-level tag <activity>' });
    await settle(40);
    expect(fake.sent).toHaveLength(4);
    const runs = store.getSnapshot().state.runs.filter((run) => run.skillId === 'evening-wrap');
    expect(runs.map((run) => run.state).sort()).toEqual(['failed', 'running']);
  });

  it('never retries a failed run that already changed something', async () => {
    const { fake, child } = await setup(true);
    await engine!.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle(10);
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    fake.requestCall({ callId: 'app_call_x', turnId: 'turn_1', name: 'day_create_item', argumentsJson: JSON.stringify({ title: '周末大扫除', circleId: child.id, date: '2026-09-26' }) });
    await settle(20);
    fake.push({ type: 'turn-failed', turnId: 'turn_1', reasonCode: 'AI_OUTPUT_INVALID', message: 'unsupported APML top-level tag <activity>' });
    await settle(40);
    expect(fake.sent).toHaveLength(1);
  });
});
