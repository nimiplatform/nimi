import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProductManifest } from '../src/product-release-feed.mjs';
import { handleInstallGatewayRequest } from '../src/index.mjs';
import { compareProductVersions, verifyProductEnvelope } from '../../../config/product-update-contract.mjs';
import { signedProductFixture } from './product-release-fixture.mjs';

test('signed final-asset binding projects only immutable product target and channel', async () => {
  const fixture = signedProductFixture();
  const result = await resolveProductManifest([fixture.release], 'beta', 'macos-arm64', async () => new Response(fixture.manifestBytes), fixture.key);
  assert.deepEqual(await verifyProductEnvelope(result, fixture.key), fixture.candidate);
  await assert.rejects(resolveProductManifest([{ ...fixture.release, immutable: false }], 'beta', 'macos-arm64', fetch, fixture.key), /UPDATE_RELEASE_NOT_FOUND/);
  await assert.rejects(resolveProductManifest([fixture.release], 'stable', 'macos-arm64', fetch, fixture.key), /UPDATE_RELEASE_NOT_FOUND/);
  assert.equal(compareProductVersions('0.3.0', '0.3.0-rc.2'), 1);
  assert.equal(compareProductVersions('0.3.0-rc.1', '0.3.0-beta.9'), 1);
});
test('tampered payload, wrong signing key, final asset digest and identity fail closed', async () => {
  const f = signedProductFixture(), other = signedProductFixture();
  await assert.rejects(verifyProductEnvelope({ ...f.envelope, payload: Buffer.from('{}').toString('base64') }, f.key), /UPDATE_SIGNATURE_INVALID/);
  await assert.rejects(verifyProductEnvelope(f.envelope, other.key), /UPDATE_SIGNATURE_INVALID/);
  await assert.rejects(resolveProductManifest([{ ...f.release, assets: f.release.assets.map((asset) => asset.name.endsWith('.pkg') ? { ...asset, digest: `sha256:${'b'.repeat(64)}` } : asset) }], 'beta', 'macos-arm64', async () => new Response(f.manifestBytes), f.key), /UPDATE_ASSET_INVALID/);
  const expired = signedProductFixture({ expiresAt: new Date(Date.now() - 30_000).toISOString() });
  await assert.rejects(verifyProductEnvelope(expired.envelope, expired.key), /UPDATE_METADATA_EXPIRED/);
  const arbitrary = signedProductFixture({ asset: { ...f.candidate.asset, url: 'http://127.0.0.1:1/x' } });
  await assert.rejects(verifyProductEnvelope(arbitrary.envelope, arbitrary.key), /UPDATE_ASSET_INVALID/);
});
test('gateway separates empty product source, unconfigured trust and upstream failure; retired endpoint stays retired', async () => {
  const request = (url, fetchImpl) => handleInstallGatewayRequest(new Request(`https://install.nimi.ai${url}`), {}, { waitUntil() {} }, { fetchImpl });
  const route = '/nimi/beta/macos-arm64/latest.json';
  const empty = await request(route, async () => new Response('[]'));
  assert.equal(empty.status, 404); assert.deepEqual(await empty.json(), { error: 'UPDATE_RELEASE_NOT_FOUND' });
  const missingKey = await request(route, async () => new Response(JSON.stringify([signedProductFixture().release])));
  assert.equal(missingKey.status, 503); assert.deepEqual(await missingKey.json(), { error: 'UPDATE_TRUST_NOT_CONFIGURED' });
  const upstream = await request(route, async () => new Response('', { status: 503 }));
  assert.equal(upstream.status, 502);
  assert.equal((await request('/desktop/latest.json', async () => { throw new Error('must not fetch'); })).status, 404);
  assert.equal((await request('/nimi/other/macos-arm64/latest.json', async () => { throw new Error('must not fetch'); })).status, 404);
});

test('latest target candidate wins in any source order without reading expired or invalid older history', async () => {
  const latest = signedProductFixture({ version: '0.4.0' });
  const expired = signedProductFixture({ version: '0.3.0', expiresAt: new Date(Date.now() - 30_000).toISOString() }, undefined, latest.privateKey);
  const older = signedProductFixture({ version: '0.2.0', components: {} }, undefined, latest.privateKey);
  for (const history of [[latest, expired, older], [older, expired, latest], [expired, latest, older]]) {
    const requested = [];
    const envelope = await resolveProductManifest(history.map((f) => f.release), 'beta', 'macos-arm64', async (url) => {
      requested.push(url);
      const item = history.find((f) => f.release.assets[0].browser_download_url === url);
      return new Response(item.manifestBytes);
    }, latest.key);
    assert.equal((await verifyProductEnvelope(envelope, latest.key)).version, '0.4.0');
    assert.deepEqual(requested, [latest.release.assets[0].browser_download_url]);
  }
});

test('authenticated other channels and other targets do not select or invalidate this feed', async () => {
  const latest = signedProductFixture({ version: '0.4.0' });
  const stable = signedProductFixture({ version: '0.5.0', channel: 'stable', expiresAt: new Date(Date.now() - 30_000).toISOString() }, undefined, latest.privateKey);
  stable.release.prerelease = false;
  const windows = signedProductFixture({ version: '0.6.0', target: 'windows-amd64', expiresAt: new Date(Date.now() - 30_000).toISOString() }, undefined, latest.privateKey);
  const history = [windows, stable, latest];
  const requested = [];
  const envelope = await resolveProductManifest(history.map((f) => f.release), 'beta', 'macos-arm64', async (url) => {
    requested.push(url);
    return new Response(history.find((f) => f.release.assets[0].browser_download_url === url).manifestBytes);
  }, latest.key);
  assert.equal((await verifyProductEnvelope(envelope, latest.key)).version, '0.4.0');
  assert.deepEqual(requested, [stable.release.assets[0].browser_download_url, latest.release.assets[0].browser_download_url]);
});

test('selected latest failure stays failure and never falls back to an older valid version', async () => {
  for (const fault of ['expired', 'signature', 'asset', 'target', 'metadata-digest', 'source']) {
    const latest = signedProductFixture({ version: '0.4.0', ...(fault === 'expired' ? { expiresAt: new Date(Date.now() - 30_000).toISOString() } : {}) });
    const older = signedProductFixture({ version: '0.3.0' }, undefined, latest.privateKey);
    if (fault === 'asset') latest.release.assets[1].digest = `sha256:${'b'.repeat(64)}`;
    if (fault === 'metadata-digest') latest.release.assets[0].digest = `sha256:${'b'.repeat(64)}`;
    let bytes = latest.manifestBytes;
    if (fault === 'signature') {
      const other = signedProductFixture({ version: '0.4.0' });
      bytes = other.manifestBytes;
      latest.release.assets[0].digest = other.release.assets[0].digest;
    }
    if (fault === 'target') {
      const wrong = signedProductFixture({ version: '0.4.0', target: 'windows-amd64' }, undefined, latest.privateKey);
      bytes = wrong.manifestBytes;
      latest.release.assets[0].digest = wrong.release.assets[0].digest;
    }
    const requested = [];
    await assert.rejects(resolveProductManifest([older.release, latest.release], 'beta', 'macos-arm64', async (url) => {
      requested.push(url);
      assert.equal(url, latest.release.assets[0].browser_download_url, 'must not fetch the older candidate');
      return fault === 'source' ? new Response('', { status: 503 }) : new Response(bytes);
    }, latest.key), new RegExp({ expired: 'UPDATE_METADATA_EXPIRED', signature: 'UPDATE_SIGNATURE_INVALID', asset: 'UPDATE_ASSET_INVALID', target: 'UPDATE_TARGET_MISMATCH', 'metadata-digest': 'UPDATE_SIGNATURE_INVALID', source: 'UPDATE_UPSTREAM_UNAVAILABLE' }[fault]));
    assert.deepEqual(requested, [latest.release.assets[0].browser_download_url]);
  }
});
