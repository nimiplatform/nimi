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
