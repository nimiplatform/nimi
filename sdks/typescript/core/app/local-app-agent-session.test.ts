import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppAgentSessionClient } from './local-app-agent-session.js';

for (const phase of ['open', 'next'] as const) {
  test('aborting a protected stream releases a pending ' + phase + ' and closes exactly once', { timeout: 3000 }, async () => {
    const ctl = new AbortController();
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { entered = resolve; });
    let resume!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    let closes = 0;
    const client = createNimiLocalAppAgentSessionClient({
      async agentSessionUnary() { throw Error('unexpected unary'); },
      async agentSessionStreamOpen() {
        if (phase === 'open') { entered(); await held; }
        return { streamId: 'owned' };
      },
      async agentSessionStreamNext() { entered(); await held; return { completed: true }; },
      async agentSessionStreamClose({ streamId }) { assert.equal(streamId, 'owned'); closes++; return { closed: true }; },
    });
    const response = client.subscribeBodyOutbox({ capabilityNamespace: 'app.sample.executor', deviceId: 'd', leaseEpoch: '1' }, { signal: ctl.signal });
    const next = response[Symbol.asyncIterator]().next();
    await pending;
    ctl.abort();
    try { assert.equal((await next).done, true); } finally { resume(); }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closes, 1);
  });
}
