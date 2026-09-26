import assert from 'node:assert/strict';
import test from 'node:test';
import * as host from '@nimiplatform/sdk/runtime/host';
import * as runtime from '@nimiplatform/sdk/runtime';

test('only the Host entrypoint exposes the exact generated dynamic request decoders', () => {
  for (const name of ['GetAppAIConfigRequest', 'OverwriteAppAIConfigRequest', 'ListAppAIConfigOptionsRequest', 'InvokeRealmUnaryRequest'] as const) {
    const codec = host[name];
    assert.equal(typeof codec.fromBinary, 'function');
    assert.equal(Object.hasOwn(runtime, name), false, `${name} must not become an ordinary Runtime value export`);
    const message = codec.create();
    assert.deepEqual(codec.fromBinary(codec.toBinary(message as never)), message);
  }
  const request = host.InvokeRealmUnaryRequest.create({ methodId: 'fixture.world.get', requestJson: '{"worldId":"example"}' });
  assert.deepEqual(host.InvokeRealmUnaryRequest.fromBinary(host.InvokeRealmUnaryRequest.toBinary(request)), request);
});
