import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopExecutionNoticesHost } from '../src-electron/execution-notices-host.js';

test('one technical outage is reported once and reconnect retains its notice without resuming anything', () => {
  let notifications = 0;
  const host = createDesktopExecutionNoticesHost({ supported: () => true, now: () => 1_790_000_000_000,
    notify: (_title, _body, outcome) => { notifications++; outcome('shown'); } });
  host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'en' } } });
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

test('disabled or unsupported notifications leave honest in-app technical facts', () => {
  let notifications = 0;
  const host = createDesktopExecutionNoticesHost({ supported: () => false, notify: () => { notifications++; } });
  host.observe({ key: 'a', displayName: 'App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  host.observe({ key: 'a', displayName: 'App', state: 'stopped' });
  assert.equal(host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices[0]?.notification, 'disabled');
  host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'zh' } } });
  host.observe({ key: 'a', displayName: 'App', state: 'running', executionScopeRef: `execution_scope_${'A'.repeat(43)}` });
  host.observe({ key: 'a', displayName: 'App', state: 'stopped' });
  assert.equal(host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices[0]?.notification, 'unsupported');
  assert.equal(notifications, 0);
  assert.throws(() => host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'en', session: 'forged' } } }));
});

test('a confirmed stop refreshes an unknown existing notice without reporting the outage twice', () => {
  let notifications = 0;
  const host = createDesktopExecutionNoticesHost({ supported: () => true,
    notify: (_title, _body, outcome) => { notifications++; outcome('shown'); } });
  host.commandHandlers.desktop_execution_notices_preferences({ payload: { payload: { enabled: true, language: 'en' } } });
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
  const host = createDesktopExecutionNoticesHost({ supported: () => false, notify: () => undefined });
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
  const host = createDesktopExecutionNoticesHost({ supported: () => false, notify: () => undefined });
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
