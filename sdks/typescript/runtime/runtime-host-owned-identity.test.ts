import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime, type CoreTransport } from './index';

test('Runtime hostOwnedIdentity omits default app/caller/participant metadata', async () => {
  let capturedMetadata: Record<string, unknown> | undefined;
  const transport: CoreTransport = {
    async unary(request) {
      capturedMetadata = request.metadata as Record<string, unknown>;
      return {};
    },
    async *serverStream() {
      yield {};
    },
  };
  const runtime = new Runtime({
    appId: 'nimi.parentos',
    hostOwnedIdentity: true,
    metadata: { surfaceId: 'parentos.runtime' },
    transport,
  });

  await runtime.health();

  assert.equal(capturedMetadata?.protocolVersion, '1.0.0');
  assert.equal(capturedMetadata?.participantProtocolVersion, '1.0.0');
  assert.equal(capturedMetadata?.domain, 'runtime.rpc');
  assert.equal(capturedMetadata?.surfaceId, 'parentos.runtime');
  assert.equal(capturedMetadata?.appId, undefined);
  assert.equal(capturedMetadata?.participantId, undefined);
  assert.equal(capturedMetadata?.callerId, undefined);
  assert.equal(capturedMetadata?.callerKind, undefined);
});
