import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';
import { createRealmFixtureManifest } from '../scripts/explore-materialization-acceptance/acceptance-fixture.mjs';
import {
  OWNER_USER_ID,
  VALID_PERSONA_SOURCE_REF,
  VALID_SOURCE_REF,
} from '../scripts/explore-materialization-acceptance/acceptance-constants.mjs';

type FixtureMaterializationPacket = Record<string, unknown> & {
  readonly keyId: string;
  readonly orderedSegments: readonly unknown[];
  readonly packetHash: string;
  readonly packetProof: {
    readonly compactJws: string;
    readonly signedPayload: string;
  };
};

const publishedLimits = Object.freeze({
  maxSegmentBytes: 8 * 1024 * 1024,
  maxSegmentComponentCount: 256,
  maxChunkBytes: 256 * 1024,
  maxSegmentChunks: 4096,
  maxSetSegments: 64,
  maxSetBytes: 128 * 1024 * 1024,
  maxSetComponentCount: 16384,
  maxSetChunks: 65536,
});

test('Desktop Realm fixture implements authenticated first-party Packet v3 lifecycle', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'nimi-desktop-realm-v3-fixture-'));
  const manifestPath = resolve(tempDir, 'manifest.json');
  const server = await startRealmFixtureServer({ manifestPath });
  await writeFile(manifestPath, JSON.stringify(createRealmFixtureManifest(server.origin)), 'utf8');
  const headers = { authorization: 'Bearer fixture-account', 'content-type': 'application/json' };

  try {
    for (const sourceRef of [VALID_SOURCE_REF, VALID_PERSONA_SOURCE_REF]) {
      const collection = sourceRef.kind === 'personaCharacter' ? 'persona-characters' : 'world-characters';
      const currentDetail = await fetch(
        `${server.origin}/api/realm/core/${collection}/by-id/${encodeURIComponent(sourceRef.id)}`,
        { headers },
      );
      assert.equal(currentDetail.status, 200);
      assert.equal((await currentDetail.json() as { id: string }).id, sourceRef.id);

      const retiredDirectDetail = await fetch(
        `${server.origin}/api/realm/core/${collection}/${encodeURIComponent(sourceRef.id)}`,
        { headers },
      );
      assert.equal(retiredDirectDetail.status, 404);
    }

    const retiredGrantResponse = await fetch(`${server.origin}/api/human/me/permission-grants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ appId: 'nimi.avatar', permissionId: 'realm_source.snapshot.consume' }),
    });
    assert.equal(retiredGrantResponse.status, 404);

    const challengeExpiresAt = new Date(Date.now() + 4 * 60_000).toISOString();
    const packetRequest = {
      sourceRef: VALID_SOURCE_REF,
      materializerAccountId: OWNER_USER_ID,
      challengeId: 'desktop-fixture-first-party-lifecycle',
      challengeDigest: 'a'.repeat(64),
      intendedRuntimeAudience: 'runtime-instance:desktop-fixture:acceptance',
      challengeExpiresAt,
      publishedLimits,
    };
    const packetResponse = await fetch(`${server.origin}/api/realm/core/source-materialization-packets`, {
      method: 'POST', headers, body: JSON.stringify(packetRequest),
    });
    assert.equal(packetResponse.status, 201);
    const packet = await packetResponse.json() as FixtureMaterializationPacket;
    assert.equal(packet.packetSchemaVersion, 'realm.source-materialization-packet/v3');
    assert.deepEqual(packet.sourceRef, packetRequest.sourceRef);
    assert.deepEqual(packet.publishedLimits, publishedLimits);
    assert.equal(packet.challengeId, packetRequest.challengeId);
    assert.equal(packet.challengeDigest, packetRequest.challengeDigest);
    assert.equal(packet.materializerAccountId, OWNER_USER_ID);
    assert.equal(packet.accessPolicyVersionDigest, '7649e8c7aa85f6667b1af5134686fc653f33ed5094e5d11483a5e60f39765faa'); // pragma: allowlist secret -- public fixture policy digest
    assert.ok(Array.isArray(packet.orderedSegments) && packet.orderedSegments.length > 0);
    assert.equal(Object.hasOwn(packet, 'accessGrantId'), false);

    const jwksResponse = await fetch(`${server.origin}/api/auth/jwks/source-materialization`, {
      headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
    });
    assert.equal(jwksResponse.status, 200);
    assert.match(jwksResponse.headers.get('cache-control') || '', /no-store/u);
    const jwks = await jwksResponse.json() as { keys: Array<Record<string, string>> };
    const key = jwks.keys.find((candidate) => candidate.kid === packet.keyId);
    assert.ok(key);
    const [protectedHeader, detachedPayload, signature] = String(packet.packetProof?.compactJws || '').split('.');
    assert.ok(protectedHeader && detachedPayload === '' && signature);
    const signedPayload = `nimi.realm.source-materialization-proof/v3\0${packet.packetHash}`;
    assert.equal(packet.packetProof.signedPayload, signedPayload);
    const encodedPayload = Buffer.from(signedPayload, 'utf8').toString('base64url');
    assert.equal(verify(
      'RSA-SHA256',
      Buffer.from(`${protectedHeader}.${encodedPayload}`, 'ascii'),
      createPublicKey({ key: key as JsonWebKey, format: 'jwk' }),
      Buffer.from(signature, 'base64url'),
    ), true);

    const crossAccountRequest = await fetch(`${server.origin}/api/realm/core/source-materialization-packets`, {
      method: 'POST', headers, body: JSON.stringify({ ...packetRequest, materializerAccountId: 'other-account' }),
    });
    assert.equal(crossAccountRequest.status, 403);

    const retiredGrantField = await fetch(`${server.origin}/api/realm/core/source-materialization-packets`, {
      method: 'POST', headers, body: JSON.stringify({ ...packetRequest, accessGrantId: 'unknown-grant' }),
    });
    assert.equal(retiredGrantField.status, 400);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
