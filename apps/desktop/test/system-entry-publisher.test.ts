import assert from 'node:assert/strict';
import test from 'node:test';
import type { SystemEntryContext, SystemEntryProjection } from '../src/shell/shared/system-entry-types.js';
import { createSystemEntryPublisher, type SystemEntryProjectionDraft } from '../src/shell/renderer/features/system-entry/system-entry-publisher.js';

function draft(generation: string, label = 'first'): SystemEntryProjectionDraft {
  const section = { status: 'available' as const, observedAt: null, total: 0, items: [] };
  return { generation, locale: 'en', observedAt: '2026-10-23T03:00:00.000Z', service: 'running',
    attention: section, work: section, recent: section, apps: section, downloads: section,
    usage: { status: 'available', observedAt: null, periodLabel: label, attempts: '0', localAttempts: '0', cloudAttempts: '0', costs: [], partial: false, note: '' },
    notificationsEnabled: true, notificationsPausedUntil: 0 };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

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
