import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiLocalAppActivityClient,
  runNimiLocalAppActivityOpen,
  type NimiAppActivityRecord,
  type NimiLocalAppActivityShell,
} from './local-app-runtime-platform-activity.js';
import { AppActivityOpenOutcome, AppActivityOpenReason } from '../../core-generated/runtime-protobuf/runtime/v1/app_activity.js';
import {
  createNimiAppActivityView,
  NimiAppActivityMergeState,
  type NimiAppActivityViewSnapshot,
} from './local-app-runtime-platform-activity-view.js';

const ID = (n: number) => `act_${String(n).padStart(26, '0')}`;

function recordJson(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activityId: ID(n),
    source: { kind: 'app', sourceRef: 'src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', appId: 'nimi.app-a', displayName: 'App A', available: true },
    key: `k${n}`,
    revision: 1,
    kind: 'todo',
    todoState: 'open',
    attention: true,
    title: `Review ${n}`,
    summary: null,
    objectRef: `draft:${n}`,
    type: 'com.example.studio.review-requested.v1',
    dataJson: '{"subject":"not authority","chapter":"review"}',
    agent: null,
    occurredAt: { seconds: String(1_790_000_000 + n), nanos: 0 },
    publishedAt: { seconds: '1790000000', nanos: 0 },
    updatedAt: { seconds: '1790000000', nanos: 0 },
    changeSeq: String(n),
    userView: { readThroughRevision: 0, unread: true, needsAttention: true },
    ...overrides,
  };
}

type Pushable = {
  shell: NimiLocalAppActivityShell;
  push: (event: unknown) => void;
  fail: (error: unknown) => void;
  end: () => void;
  listCalls: unknown[];
  subscribeCalls: unknown[];
};

function fakeShell(pages: Array<() => unknown>): Pushable {
  const listCalls: unknown[] = [];
  const subscribeCalls: unknown[] = [];
  const queue: unknown[] = [];
  let waiter: ((value: IteratorResult<unknown>) => void) | undefined;
  let failer: ((error: unknown) => void) | undefined;
  let pageIndex = 0;
  const iterable: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() });
          return new Promise((resolve, reject) => {
            waiter = resolve;
            failer = reject;
          });
        },
      };
    },
  };
  const shell: NimiLocalAppActivityShell = {
    put: async () => ({ record: recordJson(1), changed: true }),
    list: async (input) => {
      listCalls.push(input);
      const page = pages[Math.min(pageIndex, pages.length - 1)]!;
      pageIndex += 1;
      return page();
    },
    subscribe: async (input) => {
      subscribeCalls.push(input);
      return { events: iterable, cancel: async () => undefined };
    },
    markRead: async () => recordJson(1),
    open: async () => ({ outcome: 'opened', reason: 'opened' }),
    openRequests: {
      subscribe: async () => ({ events: iterable, cancel: async () => undefined }),
      complete: async () => ({ accepted: true }),
    },
  };
  return {
    shell, listCalls, subscribeCalls,
    push: (event) => {
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve({ done: false, value: event });
      } else {
        queue.push(event);
      }
    },
    fail: (error) => failer?.(error),
    end: () => {
      const resolve = waiter;
      waiter = undefined;
      resolve?.({ done: true, value: undefined });
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('activity client validates publication input and keeps publisher data as product content', async () => {
  const calls: unknown[] = [];
  const { shell } = fakeShell([() => ({ records: [], nextPageToken: null, baselineChangeSeq: '0' })]);
  const client = createNimiLocalAppActivityClient({
    ...shell,
    put: async (input) => {
      calls.push(input);
      return { record: recordJson(1), changed: true };
    },
  });
  const result = await client.put({
    key: 'k1', revision: 1, kind: 'todo', todoState: 'open', attention: true, title: 'Review 1',
    objectRef: 'draft:1', type: 'com.example.studio.review-requested.v1',
    data: { subject: 'kept as content', words: 3 }, occurredAt: '2026-09-20T09:00:00.000Z',
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.record.data, { subject: 'not authority', chapter: 'review' });
  assert.equal(result.record.occurredAt, new Date((1_790_000_001) * 1000).toISOString());
  assert.deepEqual(calls[0], {
    key: 'k1', revision: 1, kind: 'todo', todoState: 'open', attention: true, title: 'Review 1', summary: null,
    objectRef: 'draft:1', type: 'com.example.studio.review-requested.v1',
    dataJson: '{"subject":"kept as content","words":3}', occurredAt: '2026-09-20T09:00:00.000Z', agentHandle: null,
  });
  await assert.rejects(() => client.put({ key: 'k', revision: 1, kind: 'todo', todoState: 'open', attention: true, title: 't', type: 'com.example.a.v1', occurredAt: new Date() }), /objectRef/u);
  await assert.rejects(() => client.put({ key: 'k', revision: 1, kind: 'activity', attention: true, title: 't', type: 'nimi.runtime.fake.v1', occurredAt: new Date() }), /type/u);
  await assert.rejects(() => client.put({ key: 'k', revision: 1, kind: 'activity', attention: true, title: 't', type: 'com.example.a.v1', objectRef: '/Users/me/file', occurredAt: new Date() }), /objectRef/u);
  await assert.rejects(() => client.put({ key: 'k', revision: 0, kind: 'activity', attention: true, title: 't', type: 'com.example.a.v1', occurredAt: new Date() }), /revision/u);
  await assert.rejects(() => client.put({
    key: 'k', revision: 1, kind: 'activity', attention: true, title: 't', type: 'com.example.a.v1', occurredAt: new Date(),
    accountId: 'x',
  } as never), /unsupported fields/u);
});

test('activity client rejects carrier projections that leak authority outside publisher data', async () => {
  const { shell } = fakeShell([() => ({ records: [recordJson(1, { source: { kind: 'app', sourceRef: 'src_a', appId: 'nimi.a', displayName: 'A', available: true, registeredAppSubject: 'x' } })], nextPageToken: null, baselineChangeSeq: '1' })]);
  const client = createNimiLocalAppActivityClient(shell);
  await assert.rejects(() => client.list(), /projection/u);
});

test('onOpenRequest confirms only what the App handler reports and never on handler failure', async () => {
  const completions: unknown[] = [];
  const pushable = fakeShell([() => ({ records: [], nextPageToken: null, baselineChangeSeq: '0' })]);
  const client = createNimiLocalAppActivityClient({
    ...pushable.shell,
    openRequests: {
      subscribe: pushable.shell.openRequests.subscribe,
      complete: async (input) => {
        completions.push(input);
        return { accepted: true };
      },
    },
  });
  const seen: unknown[] = [];
  const registration = client.onOpenRequest(async (request) => {
    seen.push(request);
    if (request.objectRef === 'draft:gone') return 'object-unavailable';
    if (request.objectRef === 'draft:boom') throw new Error('navigation failed');
    return 'opened';
  });
  await tick();
  pushable.push({ deliveryId: 'aod_1', activityId: ID(1), objectRef: 'draft:1', type: 'com.example.studio.review-requested.v1' });
  pushable.push({ deliveryId: 'aod_2', activityId: ID(2), objectRef: 'draft:boom', type: 'com.example.studio.review-requested.v1' });
  pushable.push({ deliveryId: 'aod_3', activityId: ID(3), objectRef: 'draft:gone', type: 'com.example.studio.review-requested.v1' });
  await tick();
  await registration.stop();
  assert.equal(seen.length, 3);
  assert.deepEqual(completions, [
    { deliveryId: 'aod_1', completion: 'opened' },
    { deliveryId: 'aod_3', completion: 'object-unavailable' },
  ]);
});

async function projected(n: number, overrides: Record<string, unknown> = {}): Promise<NimiAppActivityRecord> {
  const { shell } = fakeShell([() => ({ records: [recordJson(n, overrides)], nextPageToken: null, baselineChangeSeq: String(n) })]);
  return (await createNimiLocalAppActivityClient(shell).list()).records[0]!;
}

test('merge state keeps the highest change sequence and never resurrects from stale pages', async () => {
  const state = new NimiAppActivityMergeState({ kind: 'todo', todoStates: ['open'] });
  const open = await projected(5, { changeSeq: '5' });
  const completed = await projected(5, { changeSeq: '9', revision: 2, todoState: 'completed', userView: { readThroughRevision: 0, unread: true, needsAttention: false } });
  assert.equal(state.mergeRecord(open), true);
  assert.equal(state.mergeRecord(completed), true);
  assert.equal(state.list().length, 0, 'completed todo leaves the open view');
  assert.equal(state.mergeRecord(open), false, 'an older page cannot resurrect a filtered-out record');
  assert.equal(state.mergeRemove(ID(5), '8'), false, 'an older remove is ignored');
  const reopened = await projected(5, { changeSeq: '12', revision: 3 });
  assert.equal(state.mergeRecord(reopened), true);
  assert.equal(state.list().length, 1);
  assert.equal(state.mergeRemove(ID(5), '13'), true);
  assert.equal(state.mergeRecord(reopened), false, 'a removed record stays removed for this baseline');
  const readLater = await projected(6, { changeSeq: '20', userView: { readThroughRevision: 1, unread: false, needsAttention: false } });
  const readEarlier = await projected(6, { changeSeq: '18' });
  state.mergeRecord(readLater);
  assert.equal(state.mergeRecord(readEarlier), false, 'read state cannot regress through an older projection');
  assert.equal(state.list()[0]!.userView.readThroughRevision, 1);
});

test('view merges 101 records across pages with the baseline subscription and relists on expired cursors', async () => {
  const first = Array.from({ length: 100 }, (_, index) => recordJson(101 - index));
  const second = [recordJson(1)];
  const pushable = fakeShell([
    () => ({ records: first, nextPageToken: 'page-2', baselineChangeSeq: '101' }),
    () => ({ records: second, nextPageToken: null, baselineChangeSeq: '101' }),
    () => ({ records: [], nextPageToken: null, baselineChangeSeq: '130' }),
  ]);
  const snapshots: NimiAppActivityViewSnapshot[] = [];
  const view = createNimiAppActivityView({
    activity: createNimiLocalAppActivityClient(pushable.shell),
    filter: { kind: 'todo', todoStates: ['open'] },
    onUpdate: (snapshot) => snapshots.push(snapshot),
  });
  view.start();
  await tick();
  await tick();
  const complete = snapshots.at(-1)!;
  assert.equal(complete.complete, true);
  assert.equal(complete.records.length, 101, 'the 101st record is not missed');
  assert.deepEqual(pushable.subscribeCalls[0], { afterChangeSeq: '101' });
  // Post-baseline change: record 100 completes and leaves the open view.
  pushable.push({
    changeSeq: '102', kind: 'upsert', activityId: ID(100),
    record: recordJson(100, { changeSeq: '102', revision: 2, todoState: 'completed', userView: { readThroughRevision: 0, unread: true, needsAttention: false } }),
  });
  await tick();
  assert.equal(snapshots.at(-1)!.records.some((record) => record.activityId === ID(100)), false);
  // A stale listing projection of record 100 cannot resurrect it.
  pushable.push({ changeSeq: '103', kind: 'remove', activityId: ID(99) });
  await tick();
  assert.equal(snapshots.at(-1)!.records.length, 99);
  // An expired cursor forces a fresh listing instead of claiming a replay.
  pushable.fail(Object.assign(new Error('cursor expired'), { code: 'invalid-cursor' }));
  await tick();
  await tick();
  assert.ok(pushable.listCalls.length >= 3, 'expired cursor relists');
  await view.stop();
});

test('a listing that reaches its record bound reports more instead of complete and continues on request', async () => {
  // 501 open todos: five full pages reach the default bound of 500.
  const pageOf = (start: number, count: number) => Array.from({ length: count }, (_, index) => recordJson(start - index));
  const pushable = fakeShell([
    () => ({ records: pageOf(501, 100), nextPageToken: 'p2', baselineChangeSeq: '501' }),
    () => ({ records: pageOf(401, 100), nextPageToken: 'p3', baselineChangeSeq: '501' }),
    () => ({ records: pageOf(301, 100), nextPageToken: 'p4', baselineChangeSeq: '501' }),
    () => ({ records: pageOf(201, 100), nextPageToken: 'p5', baselineChangeSeq: '501' }),
    () => ({ records: pageOf(101, 100), nextPageToken: 'p6', baselineChangeSeq: '501' }),
    () => ({ records: pageOf(1, 1), nextPageToken: null, baselineChangeSeq: '501' }),
  ]);
  const snapshots: NimiAppActivityViewSnapshot[] = [];
  const view = createNimiAppActivityView({
    activity: createNimiLocalAppActivityClient(pushable.shell),
    filter: { kind: 'todo', todoStates: ['open'] },
    onUpdate: (snapshot) => snapshots.push(snapshot),
  });
  view.start();
  await tick();
  await tick();
  const paused = snapshots.at(-1)!;
  assert.equal(paused.records.length, 500);
  assert.equal(paused.complete, false, 'a truncated listing is never reported complete');
  assert.equal(paused.hasMore, true);
  assert.equal(pushable.listCalls.length, 5);
  view.loadMore();
  view.loadMore();
  await tick();
  const complete = snapshots.at(-1)!;
  assert.equal(complete.records.length, 501, 'the remaining record is reachable');
  assert.equal(complete.complete, true);
  assert.equal(complete.hasMore, false);
  assert.equal(pushable.listCalls.length, 6, 'a second request while paging is ignored');
  assert.equal((pushable.listCalls.at(-1) as { pageToken?: string }).pageToken, 'p6', 'the continuation resumes the same baseline');
  // Nothing remains to continue.
  view.loadMore();
  await tick();
  assert.equal(pushable.listCalls.length, 6);
  await view.stop();
});

test('an ended subscription recovers through a fresh baseline instead of replaying its cursor', async () => {
  const pushable = fakeShell([
    () => ({ records: [recordJson(1)], nextPageToken: null, baselineChangeSeq: '7' }),
    () => ({ records: [recordJson(2, { changeSeq: '3' })], nextPageToken: null, baselineChangeSeq: '3' }),
  ]);
  const snapshots: NimiAppActivityViewSnapshot[] = [];
  const view = createNimiAppActivityView({
    activity: createNimiLocalAppActivityClient(pushable.shell),
    onUpdate: (snapshot) => snapshots.push(snapshot),
  });
  view.start();
  await tick();
  pushable.push({ changeSeq: '8', kind: 'upsert', activityId: ID(1), record: recordJson(1, { changeSeq: '8', revision: 2 }) });
  await tick();
  // The session ends, e.g. because the account changed; the next session's
  // listing replaces the projection rather than merging into it.
  pushable.end();
  await tick();
  assert.deepEqual(snapshots.at(-1)!.records, [], 'old-account records are cleared before retry backoff');
  assert.equal(snapshots.at(-1)!.complete, false);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await tick();
  assert.equal(pushable.listCalls.length, 2);
  assert.deepEqual(pushable.subscribeCalls, [{ afterChangeSeq: '7' }, { afterChangeSeq: '3' }]);
  assert.deepEqual(snapshots.at(-1)!.records.map((record) => record.activityId), [ID(2)]);
  await view.stop();
});

test('an ended subscription invalidates a continuation still in flight', async () => {
  let releasePage!: (page: unknown) => void;
  const pushable = fakeShell([
    () => ({ records: [recordJson(2)], nextPageToken: 'old-page', baselineChangeSeq: '2' }),
    () => new Promise((resolve) => { releasePage = resolve; }),
  ]);
  const view = createNimiAppActivityView({ activity: createNimiLocalAppActivityClient(pushable.shell), onUpdate: () => undefined });
  view.start();
  await tick();
  assert.equal(pushable.listCalls.length, 2);
  pushable.end();
  await tick();
  releasePage({ records: [recordJson(1)], nextPageToken: null, baselineChangeSeq: '2' });
  await tick();
  assert.deepEqual(view.snapshot().records, [], 'an old page cannot restore the previous account view');
  await view.stop();
});

function openRuntime(events: unknown[], waitAfter = true) {
  let aborted = false;
  return {
    get aborted() { return aborted; },
    runtime: {
      openAppActivity: (_request: unknown, options?: { signal?: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          options?.signal?.addEventListener('abort', () => { aborted = true; });
          for (const event of events) yield event;
          if (waitAfter) await new Promise(() => undefined);
        },
      }),
    } as never,
  };
}

const OPEN_REQUEST = { event: { oneofKind: 'openRequestId', openRequestId: `aor_${'a'.repeat(32)}` } };
const OPENED = { event: { oneofKind: 'result', result: { outcome: AppActivityOpenOutcome.OPENED, reason: AppActivityOpenReason.OPENED } } };

test('a failed launch still reports the running source confirmation', async () => {
  const { runtime } = openRuntime([OPEN_REQUEST, OPENED]);
  const result = await runNimiLocalAppActivityOpen(runtime, async () => ({ status: 'failed', reason: 'launch-failed' }), ID(1), 1_000);
  assert.deepEqual(result, { outcome: 'opened', reason: 'opened' });
});

test('a failed launch without a confirmation ends after the grace and releases the request', async () => {
  const stream = openRuntime([OPEN_REQUEST]);
  const started = Date.now();
  const result = await runNimiLocalAppActivityOpen(stream.runtime, async () => ({ status: 'unavailable', reason: 'host-unavailable' }), ID(1), 30);
  assert.deepEqual(result, { outcome: 'unavailable', reason: 'host-unavailable' });
  assert.ok(Date.now() - started >= 25);
  assert.equal(stream.aborted, true);
});


test('Runtime confirmation and deadline remain observable while Desktop launch is pending', { timeout: 1000 }, async () => {
  for (const result of [OPENED, { event: { oneofKind: 'result', result: { outcome: AppActivityOpenOutcome.FAILED, reason: AppActivityOpenReason.SOURCE_NOT_READY } } }]) {
    const stream = openRuntime([OPEN_REQUEST, result]);
    const output = await runNimiLocalAppActivityOpen(stream.runtime, () => new Promise(() => undefined), ID(1));
    assert.equal(output.outcome, result === OPENED ? 'opened' : 'failed');
    assert.equal(stream.aborted, true);
  }
});
