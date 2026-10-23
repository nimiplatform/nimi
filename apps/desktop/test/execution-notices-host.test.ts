import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopExecutionNoticesHost } from '../src-electron/execution-notices-host.js';
import type { SystemEntryAdmission } from '../src/shell/shared/system-entry-types.js';

const readAdmission = async (): Promise<SystemEntryAdmission> => ({ state: 'ready', generation: 'current-generation' });

test('one technical outage is reported once and reconnect retains its notice without resuming anything', async () => {
  let notifications = 0;
  const host = createDesktopExecutionNoticesHost({ readAdmission, supported: () => true, now: () => 1_790_000_000_000,
    notify: (_title, _body, outcome) => { notifications++; outcome('shown'); } });
  await host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'en', generation: 'current-generation' } } });
  host.observe({ key: 'private-run-key', displayName: 'Research App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  host.observe({ key: 'private-run-key', displayName: 'Research App', state: 'connection-unavailable' });
  host.observe({ key: 'private-run-key', displayName: 'Research App', state: 'connection-unavailable' });
  host.observe({ key: 'private-run-key', displayName: 'Research App', state: 'stopped' });
  assert.equal(notifications, 1);
  host.observe({ key: 'private-run-key', displayName: 'Research App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  const snapshot = host.commandHandlers.desktop_execution_notices_list({ payload: {} });
  assert.equal(snapshot.notices.length, 1);
  assert.equal(snapshot.notices[0]?.kind, 'connection-unavailable');
  assert.equal(snapshot.notices[0]?.availableNow, true);
  assert.equal(snapshot.notices[0]?.notification, 'shown');
  assert.equal(JSON.stringify(snapshot).includes('private-run-key'), false);
  host.observe({ key: 'private-run-key', displayName: 'Research App', state: 'scope-unavailable' });
  assert.equal(notifications, 2);
});

test('disabled or unsupported notifications leave honest in-app technical facts', async () => {
  let notifications = 0;
  const host = createDesktopExecutionNoticesHost({ readAdmission, supported: () => false, notify: () => { notifications++; } });
  host.observe({ key: 'a', displayName: 'App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  host.observe({ key: 'a', displayName: 'App', state: 'stopped' });
  assert.equal(host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices[0]?.notification, 'disabled');
  await host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'zh', generation: 'current-generation' } } });
  host.observe({ key: 'a', displayName: 'App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  host.observe({ key: 'a', displayName: 'App', state: 'stopped' });
  assert.equal(host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices[0]?.notification, 'unsupported');
  assert.equal(notifications, 0);
  await assert.rejects(host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'en', generation: 'current-generation', session: 'forged' } } }));
});

test('a confirmed stop refreshes an unknown existing notice without reporting the outage twice', async () => {
  let notifications = 0;
  const host = createDesktopExecutionNoticesHost({ readAdmission, supported: () => true,
    notify: (_title, _body, outcome) => { notifications++; outcome('shown'); } });
  await host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'en', generation: 'current-generation' } } });
  const run = { key: 'run', displayName: 'App' };
  const list = () => host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices;
  host.observe({ ...run, state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  host.observe({ ...run, state: 'scope-unavailable' });
  const original = list()[0]!;
  host.observe({ ...run, state: 'scope-unknown' });
  assert.equal(list()[0]?.availableNow, null);
  host.observe({ ...run, state: 'stopped', intentional: true });
  host.observe({ ...run, state: 'stopped', intentional: true });
  assert.deepEqual(list(), [{ ...original, availableNow: false }]);
  assert.equal(notifications, 1);
});

test('scope observation ignores an initial empty baseline, detects A to B while available, and never exposes the reference', () => {
  const host = createDesktopExecutionNoticesHost({ readAdmission, supported: () => false, notify: () => undefined });
  const base = { key: 'run', displayName: 'App' };
  const a = `execution_scope_${'A'.repeat(43)}`;
  const b = `execution_scope_${'B'.repeat(43)}`;
  const list = () => host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices;
  host.observe({ ...base, state: 'running' });
  host.observe({ ...base, state: 'scope-unavailable' });
  assert.equal(list().length, 0);
  host.observe({ ...base, state: 'running', executionScopeRef: a });
  host.observe({ ...base, state: 'running', executionScopeRef: a });
  assert.equal(list().length, 0, 'routine renewal preserves the baseline');
  host.observe({ ...base, state: 'running', executionScopeRef: b });
  assert.equal(list().length, 1);
  assert.equal(list()[0]?.kind, 'scope-unavailable');
  assert.equal(list()[0]?.availableNow, true);
  host.observe({ ...base, state: 'running', executionScopeRef: b });
  assert.equal(list().length, 1);
  assert.equal(JSON.stringify(list()).includes('execution_scope_'), false);
  host.observe({ ...base, state: 'scope-unknown' });
  assert.equal(list().length, 1);
  assert.equal(list()[0]?.availableNow, null, 'unknown is not invalidation or restored availability');
});

test('a known unavailable A followed by available B reports the interruption only once', () => {
  const host = createDesktopExecutionNoticesHost({ readAdmission, supported: () => false, notify: () => undefined });
  const base = { key: 'run', displayName: 'App' };
  host.observe({ ...base, state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  host.observe({ ...base, state: 'scope-unavailable' });
  host.observe({ ...base, state: 'running' }); // Only the process has been observed so far.
  assert.equal(host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices[0]?.availableNow, false);
  host.observe({ ...base, state: 'running', executionScopeRef: `execution_scope_${'B'.repeat(43)}` });
  const records = host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices;
  assert.equal(records.length, 1);
  assert.equal(records[0]?.availableNow, true);
});

test('notification enable requires the exact current ready native generation', async () => {
  let current: SystemEntryAdmission = { generation: 'expected', state: 'unknown' };
  let notifications = 0;
  const host = createDesktopExecutionNoticesHost({
    supported: () => true, readAdmission: async () => current,
    notify: () => { notifications += 1; },
  });
  const request = { payload: { payload: { enabled: true, language: 'en', generation: 'expected' } } };
  const interrupt = (key: string) => {
    host.observe({ key, displayName: 'App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
    host.observe({ key, displayName: 'App', state: 'stopped' });
  };
  for (const state of ['unknown', 'locked', 'login-required', 'recovery-required'] as const) {
    current = { generation: 'expected', state };
    await assert.rejects(host.commandHandlers.desktop_execution_notices_preferences(request), /scope-changed/);
    interrupt(state);
  }
  current = { generation: 'different-account-or-activation', state: 'ready' };
  await assert.rejects(host.commandHandlers.desktop_execution_notices_preferences(request), /scope-changed/);
  interrupt('stale-generation');
  assert.equal(notifications, 0);
  current = { generation: 'expected', state: 'ready' };
  assert.deepEqual(await host.commandHandlers.desktop_execution_notices_preferences(request), { applied: true });
  interrupt('current-generation');
  assert.equal(notifications, 1);
});

test('native invalidation or a safe disable fences an in-flight enable admission read', async () => {
  for (const invalidate of ['scope-loss', 'newer-disable'] as const) {
    let resolve!: (value: SystemEntryAdmission) => void;
    let reads = 0, notifications = 0;
    const host = createDesktopExecutionNoticesHost({
      supported: () => true,
      readAdmission: () => { reads += 1; return new Promise(accept => { resolve = accept; }); },
      notify: () => { notifications += 1; },
    });
    const pending = host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'en', generation: 'old-generation' } } });
    if (invalidate === 'scope-loss') host.disableNotifications();
    else assert.deepEqual(await host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: false, language: 'en', generation: 'irrelevant-for-disable' } } }), { applied: true });
    resolve({ generation: 'old-generation', state: 'ready' });
    await assert.rejects(pending, /scope-changed/);
    host.observe({ key: invalidate, displayName: 'App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
    host.observe({ key: invalidate, displayName: 'App', state: 'stopped' });
    assert.equal(reads, 1, 'safe disable must not wait for native admission');
    assert.equal(notifications, 0, 'an old admitted result cannot re-enable notifications');
  }
});

test('unavailable native admission never acknowledges an enabled preference', async () => {
  let notifications = 0;
  const host = createDesktopExecutionNoticesHost({
    supported: () => true, readAdmission: async () => { throw new Error('account-unavailable'); },
    notify: () => { notifications += 1; },
  });
  await assert.rejects(host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'en', generation: 'expected' } } }), /account-unavailable/);
  host.observe({ key: 'run', displayName: 'App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  host.observe({ key: 'run', displayName: 'App', state: 'stopped' });
  assert.equal(notifications, 0);
});

test('the preference hard cut rejects old and extra fields even when disabling', async () => {
  let reads = 0;
  const host = createDesktopExecutionNoticesHost({
    supported: () => true, readAdmission: async () => { reads += 1; return { generation: 'expected', state: 'ready' }; }, notify: () => undefined,
  });
  for (const selected of [
    { enabled: false, language: 'en' },
    { enabled: false, language: 'en', generation: '' },
    { enabled: false, language: 'en', generation: 'x'.repeat(129) },
    { enabled: false, language: 'en', generation: 1 },
    { enabled: false, language: 'en', generation: 'expected', account: 'forged' },
    { enabled: 'false', language: 'en', generation: 'expected' },
    { enabled: false, language: 'fr', generation: 'expected' },
  ]) {
    await assert.rejects(host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: selected } }), /input-invalid/);
  }
  assert.deepEqual(await host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: false, language: 'en', generation: 'stale-generation' } } }), { applied: true });
  assert.equal(reads, 0);
});
