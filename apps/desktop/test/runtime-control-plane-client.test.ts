import assert from 'node:assert/strict';
import test from 'node:test';

import { RuntimeControlPlaneClient } from '../src/runtime/control-plane/client.js';

function createClient(fetchImpl: typeof fetch): RuntimeControlPlaneClient {
  return new RuntimeControlPlaneClient({
    controlPlaneBaseUrl: 'http://control-plane.local',
    accessToken: 'test-token',
    fetchImpl,
  });
}

test('control-plane signature verification fails close on upstream HTTP error', async () => {
  const client = createClient(async () => new Response(JSON.stringify({
    message: 'service unavailable',
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  }));

  await assert.rejects(
    () => client.verifySignature({
      modId: 'mod.example',
      version: '1.0.0',
      signerId: 'signer-1',
      signature: 'signed',
      digest: 'digest',
      mode: 'sideload',
    }),
    /CONTROL_PLANE_HTTP_503/,
  );
});

test('control-plane manifest verification fails close on invalid JSON payload', async () => {
  const client = createClient(async () => new Response('not-json', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  await assert.rejects(
    () => client.verifyManifest({
      modId: 'mod.example',
      version: '1.0.0',
      manifest: {},
      mode: 'local-dev',
    }),
    /CONTROL_PLANE_CONTRACT_ERROR: expected JSON object/,
  );
});

test('control-plane audit sync fails close on invalid response shape', async () => {
  const client = createClient(async () => new Response(JSON.stringify({
    accepted: 'not-a-number',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  await assert.rejects(
    () => client.syncAudit({
      source: 'runtime-kernel',
      records: [{
        eventType: 'AUDIT_EVENT',
        occurredAt: '2026-03-20T00:00:00.000Z',
      }],
    }),
    /CONTROL_PLANE_CONTRACT_ERROR: invalid response shape/,
  );
});

test('control-plane revocation fetch fails close on transport failure', async () => {
  const client = createClient(async () => {
    throw new Error('ECONNREFUSED');
  });

  await assert.rejects(
    () => client.fetchRevocations(),
    /ECONNREFUSED/,
  );
});
