import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../src/nimiday/domain/defaults.js';
import type { Rhythm } from '../src/nimiday/domain/types.js';
import { createAgentDesk } from '../src/nimiday/platform/agent-desk.js';
import type { ActivityBridge, ActivityState } from '../src/nimiday/platform/activity-bridge.js';
import { createDayEngine, type DayEngine } from '../src/nimiday/platform/engine.js';
import { copyFor } from '../src/nimiday/i18n/index.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import { createDayStore } from '../src/nimiday/store/day-store.js';
import type { JsonDocumentStore } from '../src/nimiday/store/persistence.js';
import { createFakeAgentClient, handle, settle } from './fake-agent.js';

// What the user would be told, captured instead of shown.
const delivered: { title: string; body: string }[] = [];
vi.mock('../src/nimiday/platform/notifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/nimiday/platform/notifier.js')>();
  return {
    ...actual,
    deliver: (delivery: { title: string; body: string }) => {
      delivered.push({ title: delivery.title, body: delivery.body });
      return { system: false };
    },
  };
});

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
const appointment = { displayName: 'Aya', avatarUrl: null, binding: aya.agentBinding, appointedAt: '2026-09-23T00:00:00.000Z' };
const at = (value: string) => new Date(value);

/** "午后照看" every day at `time`, starting on its own; yesterday's run already handled. */
function routine(time: string): Rhythm {
  return {
    id: 'rhythm_afternoon',
    skillId: 'morning-care',
    name: '午后照看',
    enabled: true,
    schedule: { days: 'daily', weekdays: [], time },
    start: 'auto',
    notify: true,
    handledFor: at(`2026-09-23T${time}:00+08:00`).toISOString(),
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
}

describe('routines around startup', () => {
  let engine: DayEngine | null = null;

  beforeEach(() => { delivered.length = 0; });
  afterEach(async () => {
    await engine?.stop();
    engine = null;
  });

  /** Opens NimiDay at `openedAt` the way the App does: restoring the appointment is not awaited first. */
  async function open(input: { openedAt: string; rhythm: Rhythm; appointed?: boolean; unreachable?: boolean; restoreGate?: Promise<void> }) {
    const clock = { now: at(input.openedAt) };
    const docs = memoryDocuments();
    const profile = { ...emptyState('zh', clock.now).profile, onboarded: true, appointment: input.appointed === false ? null : appointment };
    await docs.write('nimiday/v1/profile.json', profile);
    await docs.write('nimiday/v1/rhythms.json', [input.rhythm]);
    const store = createDayStore(docs, { language: () => 'zh', now: () => clock.now });
    await store.load();
    const fake = createFakeAgentClient({
      references: [aya],
      withWork: true,
      ...(input.unreachable ? { openFails: () => true } : {}),
      ...(input.restoreGate ? { openGate: input.restoreGate } : {}),
    });
    const desk = createAgentDesk(fake.client);
    engine = createDayEngine({
      store,
      actions: dayActions(store),
      desk,
      activity: idleActivity(),
      language: () => 'zh',
      copy: () => copyFor('zh'),
      navigate: () => undefined,
      now: () => clock.now,
    });
    const restoring = desk.start(store.getSnapshot().state.profile.appointment);
    engine.start();
    return { clock, store, fake, desk, restoring };
  }

  const rhythmOf = (store: Awaited<ReturnType<typeof open>>['store']) => store.getSnapshot().state.rhythms[0]!;
  const routineNotices = () => delivered.filter((notice) => notice.title.includes('午后照看'));

  it('opened before the time, assistant restored after it: runs once, never as "no assistant"', async () => {
    let finishRestore: () => void = () => undefined;
    const slowRestore = new Promise<void>((resolve) => { finishRestore = resolve; });
    const { clock, store, fake, desk, restoring } = await open({ openedAt: '2026-09-24T13:59:50+08:00', rhythm: routine('14:00'), restoreGate: slowRestore });

    // The time comes while Aya is still being restored: the routine waits, nothing is decided.
    clock.now = at('2026-09-24T14:00:05+08:00');
    engine!.tick();
    await settle(10);
    expect(desk.getState().restoring).toBe(true);
    expect(store.getSnapshot().state.runs).toEqual([]);
    expect(rhythmOf(store).handledFor).toBe(at('2026-09-23T14:00:00+08:00').toISOString());

    clock.now = at('2026-09-24T14:00:20+08:00');
    finishRestore();
    await restoring;
    await settle(30);
    expect(desk.getState().phase).toBe('ready');
    expect(fake.sent).toHaveLength(1);
    expect((fake.sent[0] as { work: { routineName?: string } }).work.routineName).toBe('午后照看');
    expect(store.getSnapshot().state.runs).toEqual([expect.objectContaining({ trigger: 'rhythm', agentName: 'Aya', state: 'running' })]);
    expect(rhythmOf(store).handledFor).toBe(at('2026-09-24T14:00:00+08:00').toISOString());

    clock.now = at('2026-09-24T14:01:00+08:00');
    engine!.tick();
    await settle(20);
    expect(fake.sent).toHaveLength(1);
    expect(delivered.some((notice) => notice.body.includes('任命'))).toBe(false);
  });

  it('opened twelve seconds after the time: recorded as missed, not started, even once the assistant is back', async () => {
    const { store, fake, desk, restoring } = await open({ openedAt: '2026-09-24T14:00:12+08:00', rhythm: routine('14:00') });
    await restoring;
    await settle(30);
    expect(desk.getState().phase).toBe('ready');
    expect(fake.sent).toHaveLength(0);
    expect(store.getSnapshot().state.runs).toEqual([expect.objectContaining({ state: 'missed', error: expect.objectContaining({ code: 'not-running' }) })]);
    expect(routineNotices()).toEqual([]);
  });

  it('starts a routine once when its time comes while NimiDay is running', async () => {
    const { clock, fake, restoring } = await open({ openedAt: '2026-09-24T13:58:00+08:00', rhythm: routine('14:00') });
    await restoring;
    await settle(30);
    engine!.tick();
    expect(fake.sent).toHaveLength(0);

    clock.now = at('2026-09-24T14:00:30+08:00');
    engine!.tick();
    await settle(30);
    expect(fake.sent).toHaveLength(1);

    clock.now = at('2026-09-24T14:05:00+08:00');
    engine!.tick();
    await settle(30);
    expect(fake.sent).toHaveLength(1);
  });

  it('never starts a routine that came due while NimiDay was closed', async () => {
    const { store, fake, restoring } = await open({ openedAt: '2026-09-24T14:06:00+08:00', rhythm: routine('14:00') });
    await restoring;
    await settle(30);
    expect(fake.sent).toHaveLength(0);
    expect(store.getSnapshot().state.runs).toEqual([expect.objectContaining({ state: 'missed', error: expect.objectContaining({ code: 'not-running' }) })]);
    expect(routineNotices()).toEqual([]);
  });

  it('says an appointed assistant cannot be reached rather than asking for an appointment', async () => {
    const { clock, store, fake, desk, restoring } = await open({ openedAt: '2026-09-24T13:59:50+08:00', rhythm: routine('14:00'), unreachable: true });
    await restoring;
    await settle(30);
    expect(desk.getState().phase).toBe('unavailable');
    clock.now = at('2026-09-24T14:00:05+08:00');
    engine!.tick();
    await settle(20);
    expect(fake.sent).toHaveLength(0);
    expect(store.getSnapshot().state.runs).toEqual([expect.objectContaining({ state: 'waiting-start' })]);
    const notice = routineNotices()[0];
    expect(notice?.body).toContain('暂时连不上');
    expect(notice?.body).not.toContain('任命');
  });

  it('asks for an appointment only when no one is appointed', async () => {
    const { clock, store, fake, restoring } = await open({ openedAt: '2026-09-24T13:59:50+08:00', rhythm: routine('14:00'), appointed: false });
    await restoring;
    await settle(30);
    clock.now = at('2026-09-24T14:00:05+08:00');
    engine!.tick();
    await settle(20);
    expect(fake.sent).toHaveLength(0);
    expect(store.getSnapshot().state.runs).toEqual([expect.objectContaining({ state: 'waiting-start' })]);
    expect(routineNotices()[0]?.body).toContain('任命');
  });
});
