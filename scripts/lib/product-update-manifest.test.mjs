import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildProductUpdateManifest } from './product-update-manifest.mjs';
import { verifyProductEnvelope } from '../../config/product-update-contract.mjs';
import { signedProductFixture } from '../../apps/install-gateway/test/product-release-fixture.mjs';

test('publisher signs final bytes with only the admitted key and clean build identity', async () => {
  const f = signedProductFixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-update-producer-'));
  const assetPath = path.join(directory, f.candidate.asset.name);
  await writeFile(assetPath, f.bytes);
  const identity = { schema: 'nimi-product-build/v1', version: f.candidate.version, target: f.candidate.target, minimumOsVersion: '13.0',
    sourceRevision: f.candidate.sourceRevision, realmOrigin: 'https://realm.nimi.ai', components: f.candidate.components, dirtyInput: [], asset: f.candidate.asset };
  const admission = { channel: f.candidate.channel, publishedAt: f.candidate.publishedAt, expiresAt: f.candidate.expiresAt, compatibility: f.candidate.compatibility };
  const privateKey = f.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const input = { identity, admission, assetPath, privateKey, publicKey: f.key };
  try {
    const envelope = await buildProductUpdateManifest(input);
    assert.deepEqual(await verifyProductEnvelope(envelope, f.key), f.candidate);
    await assert.rejects(buildProductUpdateManifest({ ...input, publicKey: signedProductFixture().key }), /UPDATE_SIGNATURE_INVALID/);
    await assert.rejects(buildProductUpdateManifest({ ...input, publicKey: null }), /UPDATE_TRUST_NOT_CONFIGURED/);
    await assert.rejects(buildProductUpdateManifest({ ...input, identity: { ...identity, dirtyInput: ['modified source'] } }), /UPDATE_SOURCE_NOT_RELEASEABLE/);
    await assert.rejects(buildProductUpdateManifest({ ...input, admission: { ...admission, compatibility: { ...admission.compatibility, minimumOsVersion: '12.0' } } }), /UPDATE_COMPATIBILITY_INVALID/);
    await writeFile(assetPath, Buffer.alloc(f.bytes.length));
    await assert.rejects(buildProductUpdateManifest(input), /UPDATE_ASSET_DIGEST_MISMATCH/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
