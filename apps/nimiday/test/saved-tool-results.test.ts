import { afterEach, describe, expect, it } from 'vitest';
import { createCircle } from '../src/nimiday/domain/defaults.js';
import type { CareCircle } from '../src/nimiday/domain/types.js';
import { createAgentDesk } from '../src/nimiday/platform/agent-desk.js';
import type { ActivityBridge, ActivityState } from '../src/nimiday/platform/activity-bridge.js';
import { createDayEngine, type DayEngine } from '../src/nimiday/platform/engine.js';
import { copyFor } from '../src/nimiday/i18n/index.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import { createDayStore } from '../src/nimiday/store/day-store.js';
import { readCollection, type JsonDocumentStore } from '../src/nimiday/store/persistence.js';
import { createFakeAgentClient, handle, settle } from './fake-agent.js';

/** Storage whose writes can be refused or held open, like a storage service that is down or slow. */
function controllableDocuments() {
  const data = new Map<string, unknown>();
  let refuse = false;
  let gate: Promise<void> | null = null;
  const store: JsonDocumentStore = {
    read: async (path) => (data.has(path) ? structuredClone(data.get(path)) : undefined),
    write: async (path, value) => {
      if (gate) await gate;
      if (refuse) throw new Error('storage unavailable');
      data.set(path, structuredClone(value));
    },
    remove: async (path) => { data.delete(path); },
  };
  return {
    store,
    refuse: (value: boolean) => { refuse = value; },
    hold: () => {
      let release: () => void = () => undefined;
      gate = new Promise((resolve) => { release = resolve; });
      return () => { gate = null; release(); };
    },
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

describe('skill results and saving', () => {
  let engine: DayEngine | null = null;

  afterEach(async () => {
    await engine?.stop();
    engine = null;
  });

  async function setup() {
    const docs = controllableDocuments();
    const fake = createFakeAgentClient({ references: [aya], withWork: true });
    const store = createDayStore(docs.store, { language: () => 'zh' });
    await store.load();
    const child = createCircle({ kind: 'child', name: '小米' }, new Date());
    store.update((state) => ({ ...state, circles: [child] }), ['circles']);
    await store.flush();
    const desk = createAgentDesk(fake.client);
    await desk.start(null);
    await desk.appoint(aya.agentHandle as never);
    await settle();
    engine = createDayEngine({
      store,
      actions: dayActions(store),
      desk,
      activity: idleActivity(),
      language: () => 'zh',
      copy: () => copyFor('zh'),
      navigate: () => undefined,
    });
    engine.start();
    await engine.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    await settle();
    return { docs, fake, store, child };
  }

  const askToCreate = (fake: ReturnType<typeof createFakeAgentClient>, child: CareCircle, callId: string) => fake.requestCall({
    callId,
    turnId: 'turn_1',
    name: 'day_create_item',
    argumentsJson: JSON.stringify({ title: '准备小米的疫苗本', circleId: child.id, date: '2026-09-25', time: '08:00' }),
  });

  const storedTitles = async (docs: ReturnType<typeof controllableDocuments>) => (
    ((await readCollection(docs.store, 'items')) ?? []) as { title: string }[]
  ).map((item) => item.title);

  it('tells the assistant a change is done only once it is saved', async () => {
    const { docs, fake, store, child } = await setup();
    const release = docs.hold();
    askToCreate(fake, child, 'call_1');
    await settle(20);
    // Shown right away, but nothing is promised while the save is still running.
    expect(store.getSnapshot().state.items.map((item) => item.title)).toEqual(['准备小米的疫苗本']);
    expect(fake.submitted).toHaveLength(0);

    release();
    await settle(40);
    expect(fake.submitted).toHaveLength(1);
    expect(fake.submitted[0]!.isError).toBe(false);
    expect(JSON.parse(fake.submitted[0]!.resultJson)).toMatchObject({ created: { title: '准备小米的疫苗本' } });
    expect(await storedTitles(docs)).toEqual(['准备小米的疫苗本']);
  });

  it('reports a refused save as not saved, never as done', async () => {
    const { docs, fake, store, child } = await setup();
    docs.refuse(true);
    askToCreate(fake, child, 'call_1');
    await settle(40);
    expect(fake.submitted).toHaveLength(1);
    expect(fake.submitted[0]!.isError).toBe(true);
    expect(JSON.parse(fake.submitted[0]!.resultJson)).toMatchObject({ error: 'not-saved', saved: false });
    expect(await storedTitles(docs)).toEqual([]);
    expect(store.getSnapshot()).toMatchObject({ saving: 'error', unsaved: true });
    expect(store.getSnapshot().state.runs[0]!.toolCalls).toEqual([expect.objectContaining({ ok: false, unsaved: true })]);
  });

  it('never passes off a second request as saved while storage is still down', async () => {
    const { docs, fake, store, child } = await setup();
    docs.refuse(true);
    askToCreate(fake, child, 'call_1');
    await settle(40);
    // Asked again before storage recovers: the same entry, still not saved, and said so.
    askToCreate(fake, child, 'call_2');
    await settle(40);
    expect(fake.submitted.map((entry) => entry.isError)).toEqual([true, true]);
    const second = JSON.parse(fake.submitted[1]!.resultJson) as { error: string; saved: boolean; attempted: { alreadyListed: { id: string } } };
    expect(second).toMatchObject({ error: 'not-saved', saved: false });
    const original = store.getSnapshot().state.items;
    expect(original).toHaveLength(1);
    expect(second.attempted.alreadyListed.id).toBe(original[0]!.id);
    expect(await storedTitles(docs)).toEqual([]);
    expect(store.getSnapshot().state.runs[0]!.toolCalls.map((call) => call.unsaved)).toEqual([true, true]);

    // Storage comes back: the original entry is saved, still just one.
    docs.refuse(false);
    expect(await store.persist()).toEqual({ ok: true });
    expect(store.getSnapshot().state.items.map((item) => item.id)).toEqual([original[0]!.id]);
    expect(await storedTitles(docs)).toEqual(['准备小米的疫苗本']);
  });

  it('saves once storage is back, and asking again does not add a second copy', async () => {
    const { docs, fake, store, child } = await setup();
    docs.refuse(true);
    askToCreate(fake, child, 'call_1');
    await settle(40);

    docs.refuse(false);
    expect(await store.persist()).toEqual({ ok: true });
    expect(store.getSnapshot()).toMatchObject({ saving: 'idle', unsaved: false });
    expect(await storedTitles(docs)).toEqual(['准备小米的疫苗本']);

    // Having heard it was not saved, the assistant asks for it again.
    askToCreate(fake, child, 'call_2');
    await settle(40);
    expect(fake.submitted[1]!.isError).toBe(false);
    expect(JSON.parse(fake.submitted[1]!.resultJson)).toMatchObject({ alreadyListed: { title: '准备小米的疫苗本' } });
    expect(store.getSnapshot().state.items).toHaveLength(1);
    expect(await storedTitles(docs)).toEqual(['准备小米的疫苗本']);
  });
});
