import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiBundledAvatarRuntimeClient } from './bundled-avatar-runtime.js';

test('bundled Avatar exposes only canonical App Product Plane clients and typed host state', () => {
  const root = globalThis as typeof globalThis & {
    __NIMI_ELECTRON_TEST__?: { invoke(command: string, payload: unknown): Promise<unknown> };
  };
  const previous = root.__NIMI_ELECTRON_TEST__;
  root.__NIMI_ELECTRON_TEST__ = {
    async invoke() { throw new Error('unexpected transport call'); },
  };
  try {
    const client = createNimiBundledAvatarRuntimeClient();
    assert.deepEqual(Object.keys(client).sort(), [
      'agentConfigure',
      'conversation',
      'localAgentReferences',
      'ready',
      'realm',
      'session',
    ]);
    for (const retired of [
      'agents', 'ai', 'artifacts', 'appMessages', 'currentAgent', 'withAgentScopes',
      'account', 'accountCaller', 'audit',
    ]) {
      assert.equal(retired in client, false, `unexpected raw bundled Avatar surface: ${retired}`);
    }
    // @ts-expect-error raw generated Agent methods are not a renderer SDK surface.
    void client.agents;
  } finally {
    if (previous) root.__NIMI_ELECTRON_TEST__ = previous;
    else delete root.__NIMI_ELECTRON_TEST__;
  }
});
