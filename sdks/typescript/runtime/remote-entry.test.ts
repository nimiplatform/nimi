import assert from 'node:assert/strict';
import test from 'node:test';
import { connectRemoteRuntime, createBrowserRuntimePeer } from '@nimiplatform/sdk/runtime/remote';
import type { RuntimeClientSession } from '@nimiplatform/sdk/realm/runtime-client';

test('public remote entry refuses an inactive context before discovery or platform effects', async () => {
  let effects = 0;
  await assert.rejects(connectRemoteRuntime({ active: false } as RuntimeClientSession, {
    peerFactory: () => { effects++; throw new Error('must not create a peer'); },
  }), { reasonCode: 'SDK_RUNTIME_REMOTE_UNAVAILABLE' });
  assert.equal(effects, 0);
});

test('public browser adapter remains explicitly unavailable without browser WebRTC', () => {
  assert.equal(typeof globalThis.RTCPeerConnection, 'undefined');
  assert.throws(() => createBrowserRuntimePeer([]), { reasonCode: 'SDK_RUNTIME_REMOTE_ADAPTER_REQUIRED' });
});

test('offline and unknown primary presence fail before creating an offer', async () => {
  for (const [presence, reasonCode] of [
    ['offline', 'PRIMARY_RUNTIME_OFFLINE'],
    ['unknown', 'RUNTIME_COORDINATION_UNAVAILABLE'],
  ]) {
    const session = { active: true, read: async () => ({ primary: { presence } }) } as RuntimeClientSession;
    await assert.rejects(connectRemoteRuntime(session, {
      peerFactory: () => { throw new Error('must not create a peer'); },
    }), { reasonCode });
  }
});
