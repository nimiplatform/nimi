import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityBridge, ActivityState } from '../src/nimiday/platform/activity-bridge.js';
import { createAgentDesk } from '../src/nimiday/platform/agent-desk.js';
import { createDayEngine } from '../src/nimiday/platform/engine.js';
import { copyFor } from '../src/nimiday/i18n/index.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import { createDayStore } from '../src/nimiday/store/day-store.js';
import type { JsonDocumentStore } from '../src/nimiday/store/persistence.js';
import { createFakeAgentClient, handle, settle } from './fake-agent.js';

const at = '2026-09-24T00:00:00.000Z';
const circle = (id: string, name: string) => ({ id, name, kind: 'self', watch: '', focus: [], status: 'active', createdAt: at, updatedAt: at });

/**
 * One Host whose signed-in account can change, as the Local App carrier behaves:
 * the first call after the change is refused with `account-changed` (and the
 * Host rebinds); every later call goes to the new account's partition.
 */
function switchableAccount() {
  const partitions = {
    A: new Map<string, unknown>([['nimiday/v1/circles.json', [circle('circle-A', 'A private')]], ['nimiday/v1/rhythms.json', []]]),
    B: new Map<string, unknown>([['nimiday/v1/circles.json', [circle('circle-B', 'B private')]], ['nimiday/v1/rhythms.json', []]]),
  };
  let account: 'A' | 'B' = 'A';
  let session: 'A' | 'B' = 'A';
  const writes: { account: string; path: string }[] = [];
  const refuseOnce = () => {
    if (session === account) return;
    session = account;
    throw Object.assign(new Error('account changed'), { reasonCode: 'account-changed' });
  };
  const documents: JsonDocumentStore = {
    read: async (path) => { refuseOnce(); return structuredClone(partitions[account].get(path)); },
    write: async (path, value) => { refuseOnce(); partitions[account].set(path, structuredClone(value)); writes.push({ account, path }); },
    remove: async (path) => { refuseOnce(); partitions[account].delete(path); },
  };
  return { documents, partitions, writes, switchTo: (next: 'A' | 'B') => { account = next; } };
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

describe('when the signed-in account changes', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('never retries the old account\'s unsaved state into the new one', async () => {
    const host = switchableAccount();
    const store = createDayStore(host.documents, { language: () => 'zh' });
    await store.load();
    expect(store.getSnapshot().state.circles.map((entry) => entry.name)).toEqual(['A private']);

    store.update((state) => ({ ...state, circles: state.circles.map((entry) => ({ ...entry, watch: 'unsaved account A text' })) }), ['circles']);
    host.switchTo('B');
    vi.useFakeTimers();
    const saved = store.persist();
    await vi.runAllTimersAsync();
    expect((await saved).ok).toBe(false);
    // The store is over: its old snapshot is dropped, not queued for another try.
    expect(store.getSnapshot().status).toBe('closed');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(host.writes).toEqual([]);
    expect((host.partitions.B.get('nimiday/v1/circles.json') as { name: string }[]).map((entry) => entry.name)).toEqual(['B private']);

    // Nothing further is changed or saved through the old store.
    store.update((state) => ({ ...state, circles: [] }), ['circles']);
    expect(await store.persist()).toMatchObject({ ok: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(host.writes).toEqual([]);

    // A fresh store (the reloaded page) reads the new account's own data.
    vi.useRealTimers();
    const next = createDayStore(host.documents, { language: () => 'zh' });
    await next.load();
    expect(next.getSnapshot().state.circles.map((entry) => entry.name)).toEqual(['B private']);
  });

  it('neither flushes nor retries through a store whose session has ended', async () => {
    const attempts: string[] = [];
    const pending: { fail?: (error: Error) => void } = {};
    const documents: JsonDocumentStore = {
      read: async (path) => (path === 'nimiday/v1/rhythms.json' ? [] : undefined),
      write: (path) => {
        attempts.push(path);
        return new Promise<void>((_, reject) => { pending.fail = reject; });
      },
      remove: async () => undefined,
    };
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    vi.useFakeTimers();
    store.update((state) => ({ ...state, profile: { ...state.profile, onboarded: true } }), ['profile']);
    const flushing = store.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual(['nimiday/v1/profile.json']);

    // The session ends while that write is under way; an ordinary failure arrives afterwards.
    store.close();
    pending.fail?.(new Error('disk busy'));
    await flushing;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempts).toHaveLength(1);

    // Leaving the page afterwards (pagehide) writes nothing either.
    await store.flush();
    expect(attempts).toHaveLength(1);
    expect(store.getSnapshot().status).toBe('closed');
  });

  it('stops queued work and late tool calls of the old session', async () => {
    const aya = { agentHandle: handle('aya'), displayName: 'Aya', avatarUrl: null, agentBinding: `agent_binding_${'a'.repeat(43)}` };
    const fake = createFakeAgentClient({ references: [aya], withWork: true });
    const host = switchableAccount();
    const store = createDayStore(host.documents, { language: () => 'zh' });
    await store.load();
    const desk = createAgentDesk(fake.client);
    await desk.start(null);
    await desk.appoint(aya.agentHandle as never);
    await settle();
    const engine = createDayEngine({ store, actions: dayActions(store), desk, activity: idleActivity(), language: () => 'zh', copy: () => copyFor('zh'), navigate: () => undefined });
    engine.start();
    await engine.startSkill({ skillId: 'week-plan', trigger: 'user' });
    await settle();
    fake.push({ type: 'turn-accepted', turnId: 'turn_1' });
    await settle();
    await engine.startSkill({ skillId: 'morning-care', trigger: 'user' });
    await settle();
    expect(fake.sent).toHaveLength(1);

    // The session ends: the store closes and the App stops its engine.
    store.close();
    await engine.stop();
    fake.requestCall({ callId: 'late', turnId: 'turn_1', name: 'day_create_item', argumentsJson: JSON.stringify({ title: '旧会话的事项' }) });
    fake.push({ type: 'turn-completed', turnId: 'turn_1', terminalReason: 'stop' });
    await settle(40);
    expect(fake.submitted).toEqual([]);
    expect(fake.sent).toHaveLength(1);
    expect(store.getSnapshot().state.items.some((item) => item.title === '旧会话的事项')).toBe(false);
    await desk.dispose();
  });
});
