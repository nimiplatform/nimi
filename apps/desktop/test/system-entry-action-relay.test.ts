import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystemEntryActionRelay } from '../src-electron/system-entry-action-relay.js';
import type { SystemEntryActionDispatch } from '../src/shell/shared/system-entry-types.js';

test('system entry acknowledges a real completion once and rejects a stale scope', async () => {
  const sent: SystemEntryActionDispatch[] = [];
  const relay = createSystemEntryActionRelay({ send: (request) => { sent.push(request); } });
  const first = relay.dispatch({ kind: 'usage' }, { generation: 'g1', revision: 1 });
  const request = sent[0]!;
  assert.throws(() => relay.settle({ requestId: request.requestId, generation: 'g2', error: null }), /stale/);
  relay.settle({ requestId: request.requestId, generation: 'g1', error: null });
  await first;
  assert.throws(() => relay.settle({ requestId: request.requestId, generation: 'g1', error: null }), /stale/);
  const next = relay.dispatch({ kind: 'activity' }, { generation: 'g1', revision: 2 });
  const rejected = assert.rejects(next, /view-stale/);
  relay.invalidate();
  await rejected;
});

test('system entry preserves action failure and bounds unresolved work', async () => {
  const sent: SystemEntryActionDispatch[] = [];
  const relay = createSystemEntryActionRelay({ send: (request) => { sent.push(request); } });
  const first = relay.dispatch({ kind: 'apps' }, { generation: 'g1', revision: 1 });
  const failed = assert.rejects(first, /system-entry-app-focus-failed/);
  relay.settle({ requestId: sent[0]!.requestId, generation: 'g1', error: 'system-entry-app-focus-failed' });
  await failed;
  const pending = Array.from({ length: 8 }, () => assert.rejects(relay.dispatch({ kind: 'home' }, { generation: 'g1', revision: 1 }), /view-stale/));
  await assert.rejects(relay.dispatch({ kind: 'home' }, { generation: 'g1', revision: 1 }), /action-busy/);
  relay.invalidate();
  await Promise.all(pending);
});

test('focus requires the pending exact request and source, expires before dispatch, and is consumed once', async () => {
  let sent!: SystemEntryActionDispatch;
  const relay = createSystemEntryActionRelay({ send: value => { sent = value; }, timeoutMs: 15 });
  const source = { kind: 'installed' as const, launchSelector: [17, 23] };
  const expired = assert.rejects(relay.dispatch({ kind: 'focus-app', entryKey: 'verified:example', source }, { generation: 'g1', revision: 1 }), /action-unconfirmed/);
  assert.throws(() => relay.prepareFocus('wrong-request', 'g1', source), /action-stale/);
  assert.throws(() => relay.prepareFocus(sent.requestId, 'g2', source), /action-stale/);
  assert.throws(() => relay.prepareFocus(sent.requestId, 'g1', { ...source, launchSelector: [17, 24] }), /action-stale/);
  const staleClaim = relay.prepareFocus(sent.requestId, 'g1', source);
  await new Promise(resolve => setTimeout(resolve, 25));
  await expired;
  assert.throws(staleClaim, /action-stale/);
  const active = relay.dispatch({ kind: 'focus-app', entryKey: 'verified:example', source }, { generation: 'g1', revision: 2 });
  const claim = relay.prepareFocus(sent.requestId, 'g1', source);
  const duplicate = relay.prepareFocus(sent.requestId, 'g1', source);
  claim();
  assert.throws(duplicate, /action-stale/);
  assert.throws(() => relay.prepareFocus(sent.requestId, 'g1', source), /action-stale/);
  relay.settle({ requestId: sent.requestId, generation: 'g1', error: null });
  await active;
  assert.throws(claim, /action-stale/);
});
