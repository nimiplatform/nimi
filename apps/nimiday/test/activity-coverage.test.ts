import { describe, expect, it } from 'vitest';
import { matchesNimiAppActivityFilter, type NimiAppActivityFilter, type NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import { createActivityBridge } from '../src/nimiday/platform/activity-bridge.js';
import { settle } from './fake-agent.js';

function record(index: number, overrides: Partial<NimiAppActivityRecord> = {}): NimiAppActivityRecord {
  const at = new Date(Date.UTC(2026, 8, 24) - index * 60_000).toISOString();
  return {
    activityId: `activity_${index}`,
    source: { kind: 'app', appId: 'nimi.shijing', displayName: '时镜', sourceRef: 'src_shijing', available: true },
    key: `key_${index}`,
    revision: 1,
    kind: 'record',
    todoState: null,
    attention: false,
    title: `日镜 ${index}`,
    summary: null,
    objectRef: null,
    type: 'nimi.shijing.daily-reading.v1',
    data: null,
    agent: null,
    occurredAt: at,
    publishedAt: at,
    updatedAt: at,
    changeSeq: String(10_000 - index),
    userView: { unread: false },
    ...overrides,
  } as NimiAppActivityRecord;
}

/**
 * Lists records newest first the way Runtime pages them, filtered on the
 * server side, and never pushes changes. `failFiltered` makes the open-to-do
 * listing fail.
 */
function fakeActivity(records: readonly NimiAppActivityRecord[], options: { failFiltered?: boolean } = {}) {
  const calls: { filter?: NimiAppActivityFilter; pageToken?: string }[] = [];
  const client = {
    list: async (input: { filter?: NimiAppActivityFilter; pageSize?: number; pageToken?: string }) => {
      calls.push({ ...(input.filter ? { filter: input.filter } : {}), ...(input.pageToken ? { pageToken: input.pageToken } : {}) });
      if (options.failFiltered && input.filter?.todoStates) throw Object.assign(new Error('listing failed'), { reasonCode: 'runtime-unavailable' });
      const matching = records.filter((entry) => matchesNimiAppActivityFilter(entry, input.filter ?? {}));
      const start = input.pageToken ? Number(input.pageToken) : 0;
      const size = input.pageSize ?? 100;
      const page = matching.slice(start, start + size);
      return { records: page, nextPageToken: start + size < matching.length ? String(start + size) : null, baselineChangeSeq: '10000' };
    },
    subscribe: async () => ({
      cancel: async () => undefined,
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<IteratorResult<never>>(() => undefined) };
      },
    }),
  };
  return { client, calls };
}

async function until(check: () => boolean) {
  for (let round = 0; round < 200 && !check(); round += 1) await settle(1);
}

describe('shared activity coverage', () => {
  // 450 newer records sit in front of a ParentOS reminder that is old but still open.
  const oldOpenReminder = record(900, {
    activityId: 'activity_old_open',
    source: { kind: 'app', appId: 'nimi.parentos', displayName: 'ParentOS', sourceRef: 'src_parentos', available: true },
    kind: 'todo',
    todoState: 'open',
    title: '18 月龄体检',
    type: 'nimi.parentos.care-reminder.v1',
  });
  const history = [...Array.from({ length: 450 }, (_, index) => record(index)), oldOpenReminder];

  it('keeps an old open reminder in view when recent activity stops at the newest records', async () => {
    const { client, calls } = fakeActivity(history);
    const bridge = createActivityBridge(client as never);
    bridge.start();
    await until(() => bridge.getState().coverage.recent !== 'loading' && bridge.getState().coverage.openTodos !== 'loading');

    const state = bridge.getState();
    expect(state.status).toBe('ready');
    expect(state.coverage).toEqual({ openTodos: 'complete', recent: 'partial', recentCount: 400 });
    expect(state.hasMore).toBe(true);
    expect(state.records.some((entry) => entry.activityId === 'activity_old_open')).toBe(true);
    expect(state.records).toHaveLength(401);

    // Loading earlier activity continues only the paused listing; nothing rescans on its own.
    const openListings = calls.filter((call) => call.filter?.todoStates).length;
    bridge.loadMore();
    await until(() => bridge.getState().coverage.recent === 'complete');
    expect(bridge.getState().records).toHaveLength(451);
    expect(bridge.getState().hasMore).toBe(false);
    expect(calls.filter((call) => call.filter?.todoStates)).toHaveLength(openListings);
    await bridge.stop();
  });

  it('says open reminders may be missing when their listing fails', async () => {
    const { client } = fakeActivity(history, { failFiltered: true });
    const bridge = createActivityBridge(client as never);
    bridge.start();
    await until(() => bridge.getState().coverage.openTodos === 'partial' && bridge.getState().coverage.recent !== 'loading');

    const state = bridge.getState();
    expect(state.status).toBe('ready');
    expect(state.coverage.openTodos).toBe('partial');
    expect(state.error).toBe('listing failed');
    expect(state.records.some((entry) => entry.activityId === 'activity_old_open')).toBe(false);
    await bridge.stop();
  });
});
