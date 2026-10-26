import assert from 'node:assert/strict';
import test from 'node:test';
import { SYSTEM_ENTRY_HEARTBEAT_MS, SYSTEM_ENTRY_LIVENESS_MS, type SystemEntryContext, type SystemEntryProjection } from '../src/shell/shared/system-entry-types.js';
import { createSystemEntryPublisher, type SystemEntryProjectionDraft } from '../src/shell/renderer/features/system-entry/system-entry-publisher.js';

function draft(generation: string, label = 'first'): SystemEntryProjectionDraft {
  const section = { status: 'available' as const, observedAt: null, total: 0, items: [] };
  return { generation, locale: 'en', colorScheme: 'light', observedAt: '2026-10-23T03:00:00.000Z', service: 'running',
    attention: section, work: section, recent: section, apps: section, downloads: section,
    usage: { status: 'available', observedAt: null, periodLabel: label, attempts: '0', localAttempts: '0', cloudAttempts: '0', costs: [], partial: false, note: '' },
    notificationsEnabled: true, notificationsPausedUntil: 0 };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

test('publication is serialized and coalesces changes received while an IPC is pending', async () => {
  let current = draft('a');
  let release!: () => void;
  let inFlight = 0, maximum = 0;
  const calls: SystemEntryProjection[] = [];
  const publisher = createSystemEntryPublisher({
    readContext: async () => ({ generation: 'a', state: 'ready', homeVisible: true }), heartbeat: async () => {},
    publish: async (value) => {
      calls.push(value); inFlight += 1; maximum = Math.max(maximum, inFlight);
      if (calls.length === 1) await new Promise<void>((resolve) => { release = resolve; });
      inFlight -= 1;
    }, draft: () => current, onContext: () => {}, onPublished: () => {}, refreshSources: async () => {},
  });
  try {
    publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
    current = draft('a', 'middle'); publisher.update(); current = draft('a', 'latest'); publisher.update();
    release(); await flush();
    assert.equal(maximum, 1); assert.equal(calls.length, 2);
    assert.equal(calls[1]!.usage.periodLabel, 'latest'); assert.deepEqual(calls.map(value => value.revision), [1, 2]);
  } finally { publisher.stop(); }
});

test('late old-account publication acknowledgement cannot become the current projection', async () => {
  let current = draft('a');
  let context: SystemEntryContext = { generation: 'a', state: 'ready', homeVisible: true };
  let release!: () => void;
  const committed: SystemEntryProjection[] = [];
  const publisher = createSystemEntryPublisher({
    readContext: async () => context, heartbeat: async () => {},
    publish: async (value) => { if (value.generation === 'a') await new Promise<void>((resolve) => { release = resolve; }); },
    draft: () => current, onContext: () => {}, onPublished: (value) => { if (value) committed.push(value); }, refreshSources: async () => {},
  });
  try {
    publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
    context = { generation: 'b', state: 'ready', homeVisible: false }; await publisher.refreshContext();
    current = draft('b'); publisher.update(); release(); await flush();
    assert.deepEqual(committed.map(value => value.generation), ['b']);
    assert.equal(publisher.published()?.generation, 'b');
  } finally { publisher.stop(); }
});

test('temporary context read failure does not reset the revision in an unchanged host generation', async () => {
  let fail = false;
  const calls: number[] = [];
  const publisher = createSystemEntryPublisher({
    readContext: async () => { if (fail) throw new Error('offline'); return { generation: 'a', state: 'ready', homeVisible: true }; },
    heartbeat: async () => {}, publish: async (value) => { calls.push(value.revision); }, draft: () => draft('a'),
    onContext: () => {}, onPublished: () => {}, refreshSources: async () => {},
  });
  try {
    publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
    fail = true; await publisher.refreshContext(); fail = false; await publisher.refreshContext(); publisher.update(); await flush();
    assert.deepEqual(calls, [1, 2]);
  } finally { publisher.stop(); }
});

test('a Home color scheme change republishes even when business observations are unchanged', async () => {
  let current = draft('a');
  const calls: SystemEntryProjection[] = [];
  const publisher = createSystemEntryPublisher({
    readContext: async () => ({ generation: 'a', state: 'ready', homeVisible: true }),
    heartbeat: async () => {}, publish: async value => { calls.push(value); }, draft: () => current,
    onContext: () => {}, onPublished: () => {}, refreshSources: async () => {},
  });
  try {
    publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
    current = { ...current, colorScheme: 'dark' }; publisher.update(); await flush();
    current = { ...current, colorScheme: 'light' }; publisher.update(); await flush();
    assert.deepEqual(calls.map(value => value.colorScheme), ['light', 'dark', 'light']);
    assert.deepEqual(calls.map(value => value.revision), [1, 2, 3]);
    assert.equal(calls[0]!.observedAt, calls[2]!.observedAt);
  } finally { publisher.stop(); }
});

for (const outcome of ['success', 'failure'] as const) {
  for (const restart of [false, true]) {
    test(`late heartbeat ${outcome} is ignored after ${restart ? 'restart' : 'stop'}`, async (t) => {
      t.mock.timers.enable({ apis: ['setInterval'] });
      const pending = deferred<void>();
      let current = draft('a');
      let context: SystemEntryContext = { generation: 'a', state: 'ready', homeVisible: true };
      let time = 1, reads = 0, refreshes = 0;
      const heartbeats: string[] = [];
      const calls: SystemEntryProjection[] = [];
      const publisher = createSystemEntryPublisher({
        readContext: async () => { reads += 1; return context; },
        heartbeat: async value => { heartbeats.push(value); if (heartbeats.length === 1) await pending.promise; },
        publish: async value => { calls.push(value); }, draft: () => current,
        onContext: () => {}, onPublished: () => {},
        refreshSources: async () => { refreshes += 1; }, now: () => time,
      });
      try {
        publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
        time += SYSTEM_ENTRY_LIVENESS_MS;
        t.mock.timers.tick(SYSTEM_ENTRY_HEARTBEAT_MS); await flush();
        assert.deepEqual(heartbeats, ['a']);
        publisher.stop();
        if (restart) {
          context = { generation: 'b', state: 'ready', homeVisible: false };
          current = draft('b');
          publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
          t.mock.timers.tick(SYSTEM_ENTRY_HEARTBEAT_MS); await flush();
          assert.deepEqual(heartbeats, ['a'], 'a pending heartbeat remains single flight across restart');
        }
        if (outcome === 'success') pending.resolve();
        else pending.reject(new Error('retired heartbeat'));
        await flush();
        assert.equal(refreshes, 0);
        assert.equal(reads, restart ? 2 : 1, 'a retired rejection does not read the current owner');
        assert.deepEqual(calls.map(value => value.generation), restart ? ['a', 'b'] : ['a']);
        assert.equal(publisher.published()?.generation ?? null, restart ? 'b' : null);
        if (restart) {
          t.mock.timers.tick(SYSTEM_ENTRY_HEARTBEAT_MS); await flush();
          assert.deepEqual(heartbeats, ['a', 'b'], 'the current lifecycle can heartbeat after the old call settles');
        }
      } finally { pending.resolve(); publisher.stop(); }
    });
  }
}

for (const outcome of ['success', 'failure'] as const) {
  test(`old-generation heartbeat ${outcome} cannot renew current liveness or refresh its sources`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const pending = deferred<void>();
    let current = draft('a');
    let context: SystemEntryContext = { generation: 'a', state: 'ready', homeVisible: true };
    let time = 1, reads = 0, refreshes = 0;
    const heartbeats: string[] = [];
    const publisher = createSystemEntryPublisher({
      readContext: async () => { reads += 1; return context; },
      heartbeat: async value => { heartbeats.push(value); if (heartbeats.length === 1) await pending.promise; },
      publish: async () => {}, draft: () => current, onContext: () => {}, onPublished: () => {},
      refreshSources: async () => { refreshes += 1; }, now: () => time,
    });
    try {
      publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
      t.mock.timers.tick(SYSTEM_ENTRY_HEARTBEAT_MS); await flush();
      context = { generation: 'b', state: 'ready', homeVisible: true };
      current = draft('b'); await publisher.refreshContext(); publisher.update(); await flush();
      time += SYSTEM_ENTRY_LIVENESS_MS;
      if (outcome === 'success') pending.resolve();
      else pending.reject(new Error('old generation'));
      await flush();
      assert.equal(reads, 2); assert.equal(refreshes, 0);
      assert.equal(publisher.published()?.generation, 'b');
      t.mock.timers.tick(SYSTEM_ENTRY_HEARTBEAT_MS); await flush();
      assert.deepEqual(heartbeats, ['a', 'b']);
      assert.equal(refreshes, 1, 'only the current heartbeat observes and repairs its elapsed liveness gap');
    } finally { pending.resolve(); publisher.stop(); }
  });
}

for (const heartbeatFails of [false, true]) {
  test(`late ${heartbeatFails ? 'recovery' : 'liveness-gap'} source refresh cannot publish into a restarted lifecycle`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const pending = deferred<void>();
    let current = draft('a');
    let context: SystemEntryContext = { generation: 'a', state: 'ready', homeVisible: true };
    let time = 1, refreshes = 0;
    const calls: SystemEntryProjection[] = [];
    const publisher = createSystemEntryPublisher({
      readContext: async () => context,
      heartbeat: async () => { if (heartbeatFails) throw new Error('owner needs refresh'); },
      publish: async value => { calls.push(value); }, draft: () => current,
      onContext: () => {}, onPublished: () => {},
      refreshSources: async () => { refreshes += 1; await pending.promise; }, now: () => time,
    });
    try {
      publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
      time += SYSTEM_ENTRY_LIVENESS_MS;
      t.mock.timers.tick(SYSTEM_ENTRY_HEARTBEAT_MS); await flush();
      assert.equal(refreshes, 1);
      publisher.stop();
      context = { generation: 'b', state: 'ready', homeVisible: true };
      current = draft('b');
      publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
      current = draft('b', 'not yet observed');
      pending.resolve(); await flush();
      assert.deepEqual(calls.map(value => [value.generation, value.usage.periodLabel]), [['a', 'first'], ['b', 'first']]);
      publisher.update(); await flush();
      assert.equal(calls.at(-1)?.usage.periodLabel, 'not yet observed', 'the current source update still publishes normally');
    } finally { pending.resolve(); publisher.stop(); }
  });
}

test('active heartbeat refresh and owner recovery retain their publication behavior', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let current = draft('a');
  let context: SystemEntryContext = { generation: 'a', state: 'ready', homeVisible: true };
  let time = 1, heartbeatFails = false, refreshes = 0;
  const calls: SystemEntryProjection[] = [];
  const publisher = createSystemEntryPublisher({
    readContext: async () => context,
    heartbeat: async () => { if (heartbeatFails) throw new Error('owner changed'); },
    publish: async value => { calls.push(value); }, draft: () => current,
    onContext: () => {}, onPublished: () => {},
    refreshSources: async () => { refreshes += 1; if (refreshes === 1) throw new Error('source temporarily unavailable'); },
    now: () => time,
  });
  try {
    publisher.start(); await publisher.refreshContext(); publisher.update(); await flush();
    time += SYSTEM_ENTRY_LIVENESS_MS;
    t.mock.timers.tick(SYSTEM_ENTRY_HEARTBEAT_MS); await flush();
    assert.equal(refreshes, 1);
    assert.deepEqual(calls.map(value => value.revision), [1, 2]);
    heartbeatFails = true;
    context = { generation: 'b', state: 'ready', homeVisible: true };
    current = draft('b');
    t.mock.timers.tick(SYSTEM_ENTRY_HEARTBEAT_MS); await flush();
    assert.equal(refreshes, 2);
    assert.equal(publisher.currentContext()?.generation, 'b');
    assert.equal(publisher.published()?.generation, 'b');
    assert.equal(calls.at(-1)?.revision, 1);
  } finally { publisher.stop(); }
});
