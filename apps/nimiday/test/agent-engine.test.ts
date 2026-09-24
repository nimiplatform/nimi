import { afterEach, describe, expect, it } from 'vitest';
import { createCircle } from '../src/nimiday/domain/defaults.js';
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

  it('applies events after the snapshot and projects streaming, app messages and outcomes', async () => {
    const fake = createFakeAgentClient({ references: [aya] });
    fake.addMessage({ messageId: 'm0', turnId: 't0', role: 'user', parts: [{ kind: 'text', text: '早' }] });
    const desk = createAgentDesk(fake.client);
    await desk.start(null);
    await desk.appoint(aya.agentHandle as never);
    await settle();
    expect(desk.getState().messages.map((message) => message.text)).toEqual(['早']);

    fake.push({ type: 'turn-accepted', turnId: 't1' });
    fake.push({ type: 'text-delta', turnId: 't1', delta: '早上' });
    fake.push({ type: 'text-delta', turnId: 't1', delta: '好' });
    await settle();
    expect(desk.getState()).toMatchObject({ activeTurnId: 't1', streaming: { turnId: 't1', text: '早上好' } });

    fake.push({ type: 'message-committed', turnId: 't2', message: { messageId: 'm_app', turnId: 't2', role: 'app', parts: [{ kind: 'text', text: 'NimiDay · 例行：晨间照看' }] } });
    fake.push({ type: 'message-committed', turnId: 't1', message: { messageId: 'm1', turnId: 't1', role: 'assistant', parts: [{ kind: 'text', text: '早上好！' }] } });
    fake.push({ type: 'turn-completed', turnId: 't1', terminalReason: 'stop' });
    await settle();
    const state = desk.getState();
    expect(state.activeTurnId).toBeNull();
    expect(state.streaming).toBeNull();
    expect(state.messages.map((message) => message.role)).toEqual(['user', 'app', 'assistant']);
    expect(state.lastOutcome).toEqual({ turnId: 't1', kind: 'completed', detail: 'stop' });
    await desk.dispose();
  });

  it('reconnects to whoever was appointed last, never to the one before', async () => {
    const fake = createFakeAgentClient({ references: [aya, bea] });
    const desk = createAgentDesk(fake.client);
    await desk.start({ displayName: 'Aya', avatarUrl: null, binding: aya.agentBinding, appointedAt: '2026-09-24T00:00:00.000Z' });
    await settle();
    await desk.appoint(bea.agentHandle as never);
    await settle();
    expect(desk.getState().agent?.displayName).toBe('Bea');
    // The technical session is rebuilt: old handles stop working and everyone is looked up again.
    fake.renewSession('renewed');
    fake.endStream();
    await settle(10);
    await desk.reconnect();
    await settle(10);
    expect(desk.getState()).toMatchObject({ phase: 'ready', agent: { displayName: 'Bea', binding: bea.agentBinding } });
    await desk.dispose();
  });

  it('keeps a first appointment through a reconnect', async () => {
    const fake = createFakeAgentClient({ references: [aya, bea] });
    const desk = createAgentDesk(fake.client);
    await desk.start(null);
    await settle();
    expect(desk.getState().phase).toBe('choose');
    await desk.appoint(aya.agentHandle as never);
    await settle();
    fake.renewSession('renewed');
    fake.endStream();
    await settle(10);
    await desk.reconnect();
    await settle(10);
    expect(desk.getState()).toMatchObject({ phase: 'ready', agent: { displayName: 'Aya', binding: aya.agentBinding } });
    await desk.dispose();
  });

  it('comes back on its own after the session is renewed and old handles stop working', async () => {
    const fake = createFakeAgentClient({ references: [aya] });
    const desk = createAgentDesk(fake.client);
    await desk.start({ displayName: 'Aya', avatarUrl: null, binding: aya.agentBinding, appointedAt: '2026-09-24T00:00:00.000Z' });
    await settle();
    expect(desk.getState()).toMatchObject({ phase: 'ready', connection: 'live' });
    fake.renewSession('renewed');
    fake.endStream();
    await settle(10);
    expect(desk.getState().connection).toBe('lost');
    // "Reconnect": the old handle cannot be resumed, so the appointment is reopened through its binding.
    await desk.reconnect();
    await settle(10);
    expect(desk.getState()).toMatchObject({ phase: 'ready', connection: 'live', agent: { displayName: 'Aya', binding: aya.agentBinding } });
    expect(desk.getState().agent!.agentHandle).not.toBe(aya.agentHandle);
    await desk.dispose();
  });

  it('reports busy instead of sending over an active turn', async () => {
    let busy = false;
    const fake = createFakeAgentClient({ references: [aya], busy: () => busy });
    const desk = createAgentDesk(fake.client);
    await desk.start(null);
    await desk.appoint(aya.agentHandle as never);
    await settle();
    busy = true;
    expect(await desk.send('在吗', 'r1')).toMatchObject({ ok: false, reason: 'busy' });
    busy = false;
    expect(await desk.send('在吗', 'r2')).toMatchObject({ ok: true });
    expect(await desk.send('还在吗', 'r3')).toMatchObject({ ok: false, reason: 'busy' });
    await desk.dispose();
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
    const store = createDayStore(memoryDocuments(), { language: () => 'zh' });
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
    return { fake, store, desk, child };
  }

  it('is honest when the platform does not offer App skills', async () => {
    await setup(false);
    expect(await engine!.startSkill({ skillId: 'morning-care', trigger: 'user' })).toMatchObject({ ok: false, reason: 'work-unavailable' });
  });

  it('sends work, executes the agent’s skill calls and records the result', async () => {
    const { fake, store, child } = await setup(true);
    const started = await engine!.startSkill({ skillId: 'morning-care', trigger: 'user' });
    expect(started.ok).toBe(true);
    await settle();
    const sent = fake.sent[0] as { parts: { text: string }[]; work: { workId: string; tools: { name: string }[]; sources: { sourceId: string }[]; instructions: string } };
    expect(sent.parts[0]!.text).toBe('帮我看看今天有什么需要照看的。');
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
    const { fake, store } = await setup(true);
    fake.push({ type: 'turn-accepted', turnId: 'other_turn' });
    await settle();
    const started = await engine!.startSkill({ skillId: 'evening-wrap', trigger: 'user' });
    expect(started.ok).toBe(true);
    await settle();
    expect(fake.sent).toHaveLength(0);
    expect(engine!.getState().waitingForAgent).toBe(true);
    fake.push({ type: 'turn-completed', turnId: 'other_turn', terminalReason: 'stop' });
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
    const sent = fake.sent[0] as { parts: { text: string }[]; work: { routineName?: string } };
    expect(sent.work.routineName).toBe(morning.name);
    expect(sent.parts[0]!.text).toContain('例行');
    expect(sent.parts[0]!.text).not.toBe('帮我看看今天有什么需要照看的。');
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

  it('lets the user ask for things in conversation and keeps a record only when something changed', async () => {
    const { fake, store, child } = await setup(true);
    expect(await engine!.chat('明天早上8点提醒我带小米的疫苗本')).toMatchObject({ ok: true, turnId: 'turn_1' });
    const sent = fake.sent[0] as { parts: { text: string }[]; work: { tools: { name: string }[]; routineName?: string; sources: { sourceId: string }[] } };
    expect(sent.parts[0]!.text).toBe('明天早上8点提醒我带小米的疫苗本');
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
    expect(run).toMatchObject({ trigger: 'chat', state: 'done', replyMessageId: 'm_reply', changes: [expect.objectContaining({ kind: 'item-created' })] });

    // A plain chat leaves no run behind.
    expect(await engine!.chat('谢谢')).toMatchObject({ ok: true, turnId: 'turn_2' });
    fake.push({ type: 'turn-accepted', turnId: 'turn_2' });
    fake.push({ type: 'message-committed', turnId: 'turn_2', message: { messageId: 'm_2', turnId: 'turn_2', role: 'assistant', parts: [{ kind: 'text', text: '不客气。' }] } });
    fake.push({ type: 'turn-completed', turnId: 'turn_2', terminalReason: 'stop' });
    await settle(20);
    expect(store.getSnapshot().state.runs.map((entry) => entry.id)).toEqual([run!.id]);
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
    expect(engine!.getState().unconfirmed).toEqual({ messageId: 'm_promise', request: '明天早上8点提醒我带疫苗本' });
    await engine!.chat('好的');
    expect(engine!.getState().unconfirmed).toBeNull();
  });

  it('closes a run whose ending never arrived once Runtime shows its turn is over', async () => {
    const { fake, store } = await setup(true);
    await engine!.startSkill({ skillId: 'catch-up', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    fake.push({ type: 'text-delta', turnId: 'turn_1', delta: '我把新变化看了一遍。' });
    await settle(20);
    expect(store.getSnapshot().state.runs[0]).toMatchObject({ state: 'running' });
    // The terminal event is lost; Runtime (open → activeTurnId null) says nothing is running.
    await engine!.checkActiveRun();
    await settle(10);
    expect(store.getSnapshot().state.runs[0]).toMatchObject({
      state: 'interrupted',
      replyText: '我把新变化看了一遍。',
      error: { code: 'outcome-unknown' },
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
    expect(store.getSnapshot().state.runs[0]).toMatchObject({ state: 'interrupted', error: { code: 'outcome-unknown' } });
    expect(fake.interrupts).toHaveLength(1);
  });

  it('asks about the whole household when a person-focused skill has no one chosen', async () => {
    const { fake } = await setup(true);
    await engine!.startSkill({ skillId: 'care-review', trigger: 'user' });
    await settle(10);
    expect((fake.sent[0] as { parts: { text: string }[] }).parts[0]!.text).toBe('帮我看看「全家」最近怎么样。');
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
    expect(store.getSnapshot().state.runs[0]).toMatchObject({ state: 'interrupted', error: { code: 'agent-changed' } });
    expect(engine!.getState().activeRunId).toBeNull();
    // Nothing in flight: nothing to stop.
    await engine!.handOver(async () => null, { stopCurrent: true });
    expect(fake.interrupts).toHaveLength(1);
  });

  it('hands queued work to the new agent, never to the one leaving', async () => {
    const fake = createFakeAgentClient({ references: [aya, bea], withWork: true });
    // Stopping the departing turn ends it right away, as Runtime reports it.
    const conversation = (fake.client as unknown as { conversation: { interruptTurn: (input: { expectedTurnId?: string }) => Promise<unknown> } }).conversation;
    const interrupt = conversation.interruptTurn;
    conversation.interruptTurn = async (input: { expectedTurnId?: string }) => {
      const result = await interrupt(input);
      fake.push({ type: 'turn-interrupted', turnId: input.expectedTurnId, reason: 'user_cancel' });
      return result;
    };
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
    expect((fake.sent[0] as { parts: { text: string }[] }).parts[0]!.text).toBe('帮我看看「小米」最近怎么样。');
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
    const retry = fake.sent[1] as { parts: { text: string }[]; work: { sources: { sourceId: string; content: string }[] } };
    expect(retry.parts[0]!.text).toBe('帮我看看「小米」最近怎么样。');
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
    expect(fake.sent.map((input) => (input as { parts: { text: string }[] }).parts[0]!.text)).toEqual(['今天还有什么要做的？', '今天还有什么要做的？']);
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
