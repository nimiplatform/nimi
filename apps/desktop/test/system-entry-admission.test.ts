import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystemEntryAdmission } from '../src-electron/system-entry-admission.js';
import { createSystemEntryActionRelay } from '../src-electron/system-entry-action-relay.js';
import type { SystemEntryActionDispatch } from '../src/shell/shared/system-entry-types.js';

const ready = { state: 'ready_for_use', record: { dataRoot: { status: 'ready', rootActivationId: 'activation' } }, rootHandoff: { disposition: 'active_current_process', rootActivationId: 'activation' } };
const account = { state: 'authenticated', accountProjection: { accountId: 'a', realmEnvironmentId: 'realm' } };
test('system entry requires account and actual Product Control activation, not profile alone', async () => {
  let observed = ready;
  let observedAccount = account;
  const previousStates: string[] = [];
  const gate = createSystemEntryAdmission({ readProduct: async () => observed, readAccount: async () => observedAccount, normalWorkAllowed: () => true, onInvalidated() {}, onScopeChanged(previous) { previousStates.push(previous.state); } });
  const admitted = await gate.read();
  assert.equal(admitted.state, 'ready');
  observed = { ...ready, rootHandoff: { ...ready.rootHandoff, rootActivationId: 'other' } };
  assert.equal((await gate.read()).state, 'recovery-required');
  assert.deepEqual(previousStates, ['unknown', 'ready'], 'the host distinguishes initial admission from leaving a previously admitted scope');
  observedAccount = { ...account, state: 'anonymous' };
  assert.equal((await gate.read()).state, 'login-required');
  gate.setLocked(true);
  assert.equal((await gate.read()).state, 'locked');
});

test('owner invalidation fences a late gate read and rotates the display generation', async () => {
  let complete!: (value: typeof ready) => void;
  const gate = createSystemEntryAdmission({ readProduct: () => new Promise(resolve => { complete = resolve; }), readAccount: async () => account, normalWorkAllowed: () => true, onInvalidated() {} });
  const old = gate.snapshot().generation;
  const pending = gate.read();
  gate.observeAccount(null);
  complete(ready);
  const result = await pending;
  assert.notEqual(result.generation, old);
  assert.equal(result.state, 'unknown');
});

test('focus admission rechecks the formal owner and its final synchronous fence rejects later invalidation', async () => {
  let allowed = true;
  const gate = createSystemEntryAdmission({ readProduct: async () => ready, readAccount: async () => account, normalWorkAllowed: () => allowed, onInvalidated() {} });
  const first = await gate.read();
  const assertCurrent = await gate.authorizeFocus(first.generation);
  assert.doesNotThrow(assertCurrent);
  allowed = false;
  assert.throws(assertCurrent, /system-entry-view-stale/);
  allowed = true;
  gate.invalidate();
  assert.throws(assertCurrent, /system-entry-view-stale/);
  await assert.rejects(gate.authorizeFocus(first.generation), /system-entry-view-stale/);
  const next = await gate.read();
  const nextCurrent = await gate.authorizeFocus(next.generation);
  gate.setLocked(true);
  assert.throws(nextCurrent, /system-entry-view-stale/);
  await assert.rejects(gate.authorizeFocus(next.generation), /system-entry-view-stale/);
});

test('navigation is acknowledged only by the current request and generation', async () => {
  let sent!: SystemEntryActionDispatch;
  const relay = createSystemEntryActionRelay({ send: value => { sent = value; } });
  const action = relay.dispatch({ kind: 'downloads' }, { generation: 'a', revision: 1 });
  assert.throws(() => relay.settle({ requestId: sent.requestId, generation: 'b', error: null }));
  relay.settle({ requestId: sent.requestId, generation: 'a', error: null });
  await action;
  const next = relay.dispatch({ kind: 'chat' }, { generation: 'a', revision: 2 });
  relay.invalidate();
  await assert.rejects(next, /stale/);
  assert.throws(() => relay.settle({ requestId: sent.requestId, generation: 'a', error: null }));
});
