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

test('Desktop Realm fixture implements current grant CAS and Packet v3 lifecycle', async () => {
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

    const localScopeResponse = await fetch(`${server.origin}/api/human/me/permission-grants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        appId: 'nimi.avatar',
        scopeFamily: 'agent',
        scopeName: 'agent.identity.project',
        reason: 'must remain Runtime-local',
      }),
    });
    assert.equal(localScopeResponse.status, 400);

    const pendingResponse = await fetch(`${server.origin}/api/human/me/permission-grants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        appId: 'nimi.avatar',
        scopeFamily: 'realm_source',
        scopeName: 'realm_source.snapshot.consume',
        reason: 'Nimi Runtime Realm source materialization',
      }),
    });
    assert.equal(pendingResponse.status, 200);
    const pending = await pendingResponse.json() as {
      grantId: string;
      appId: string;
      scopeFamily: string;
      scopeName: string;
      qualifier: null;
      state: string;
      version: number;
    };
    assert.equal(pending.state, 'PENDING');
    assert.ok(pending.grantId);
    assert.deepEqual({
      appId: pending.appId,
      scopeFamily: pending.scopeFamily,
      scopeName: pending.scopeName,
      qualifier: pending.qualifier,
    }, {
      appId: 'nimi.avatar',
      scopeFamily: 'realm_source',
      scopeName: 'realm_source.snapshot.consume',
      qualifier: null,
    });

    const grantedResponse = await fetch(
      `${server.origin}/api/human/me/permission-grants/by-id/${encodeURIComponent(pending.grantId)}/grant`,
      { method: 'POST', headers, body: JSON.stringify({ expectedVersion: pending.version }) },
    );
    assert.equal(grantedResponse.status, 200);
    const granted = await grantedResponse.json() as { grantId: string; state: string; version: number };
    assert.equal(granted.grantId, pending.grantId);
    assert.equal(granted.state, 'GRANTED');
    assert.equal(granted.version, pending.version + 1);

    const challengeExpiresAt = new Date(Date.now() + 4 * 60_000).toISOString();
    const packetRequest = {
      sourceRef: VALID_SOURCE_REF,
      materializerAccountId: OWNER_USER_ID,
      accessGrantId: pending.grantId,
      challengeId: 'desktop-fixture-current-grant-lifecycle',
      challengeDigest: 'a'.repeat(64),
      intendedRuntimeAudience: 'runtime-instance:desktop-fixture:acceptance',
      challengeExpiresAt,
      publishedLimits,
    };
    const packetResponse = await fetch(`${server.origin}/api/realm/core/source-materialization-packets`, {
      method: 'POST', headers, body: JSON.stringify(packetRequest),
    });
    assert.equal(packetResponse.status, 201);
    const packet = await packetResponse.json() as Record<string, any>;
    assert.equal(packet.packetSchemaVersion, 'realm.source-materialization-packet/v3');
    assert.deepEqual(packet.sourceRef, packetRequest.sourceRef);
    assert.deepEqual(packet.publishedLimits, publishedLimits);
    assert.equal(packet.challengeId, packetRequest.challengeId);
    assert.equal(packet.challengeDigest, packetRequest.challengeDigest);
    assert.equal(packet.materializerAccountId, OWNER_USER_ID);
    assert.equal(packet.accessPolicyVersionDigest, '34f338ae76cbd85de58054cd6fc4d0ee18500030a0bc12f091e88d46f2fc572f');
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

    const replayWithoutGrant = await fetch(`${server.origin}/api/realm/core/source-materialization-packets`, {
      method: 'POST', headers, body: JSON.stringify({ ...packetRequest, accessGrantId: 'unknown-grant' }),
    });
    assert.equal(replayWithoutGrant.status, 403);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
