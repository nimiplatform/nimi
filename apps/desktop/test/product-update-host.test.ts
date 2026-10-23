import assert from 'node:assert/strict';
import test from 'node:test';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProductUpdateTestHost } from './helpers/product-update-test-cache.js';
import { DesktopProductUpdateHost } from '../src-electron/product-update-host.js';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { ProductUpdateError } from '../../../config/product-update-contract.mjs';
import { signedProductFixture } from '../../install-gateway/test/product-release-fixture.mjs';
const fixtureResponse = (bytes: Uint8Array) => new Response(Uint8Array.from(bytes).buffer);

test('Windows download refuses missing or failed private cache preparation before writing candidate bytes', {
  skip: process.platform !== 'win32',
}, async () => {
  for (const prepareCache of [undefined, async () => { throw new ProductUpdateError('UPDATE_CACHE_UNSAFE'); }]) {
    const fixture = signedProductFixture(), root = await mkdtemp(path.join(os.tmpdir(), 'nimi-cache-refusal-'));
    const cacheRoot = path.join(root, 'cache');
    let downloads = 0;
    const host = new DesktopProductUpdateHost({
      currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '15.0', cacheRoot,
      prepareCache, policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fixture.key },
      fetchImpl: async (url) => String(url).endsWith('latest.json')
        ? fixtureResponse(fixture.manifestBytes) : (downloads++, fixtureResponse(fixture.bytes)),
      verifyInstaller: async () => { assert.fail('cache refusal must precede installer verification'); },
    });
    try {
      await host.check();
      assert.equal(host.status().phase, 'failed');
      assert.equal(host.status().reason, 'UPDATE_CACHE_UNSAFE');
      assert.equal(downloads, 0);
      await assert.rejects(lstat(cacheRoot), { code: 'ENOENT' });
    } finally { await host.stop(); await rm(root, { recursive: true, force: true }); }
  }
});

test('actual streamed fixture bytes are verified, concurrent checks merge, recheck revalidates cache, no installation authority', async () => {
  const f = signedProductFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-product-test-'));
  await mkdir(path.join(root, 'cache', 'download-AbC123'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, 'cache', 'download-AbC123', 'candidate.part'), 'interrupted prior download');
  let downloads = 0, nativeChecks = 0;
  const host = createProductUpdateTestHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '15.0', cacheRoot: path.join(root, 'cache'),
    policy: { ...PRODUCT_UPDATE_POLICY, publicKey: f.key },
    fetchImpl: async (url) => String(url).endsWith('latest.json') ? fixtureResponse(f.manifestBytes) : (downloads++, fixtureResponse(f.bytes)),
    verifyInstaller: async (file) => { nativeChecks++; assert.deepEqual(await readFile(file), f.bytes); },
  });
  try {
    const first = host.check(); assert.equal(first, host.check()); await first;
    assert.equal(host.status().phase, 'prepared'); assert.equal(host.status().installationAvailable, false);
    assert.equal(host.status().downloadedBytes, f.bytes.length); assert.equal(downloads, 1);
    assert.equal((await readdir(path.join(root, 'cache'))).includes('download-AbC123'), false);
    await host.check(); assert.equal(downloads, 1); assert.equal(nativeChecks, 2);
    const directory = (await readdir(path.join(root, 'cache')))[0]!;
    await writeFile(path.join(root, 'cache', directory, f.candidate.asset.name), Buffer.alloc(f.bytes.length));
    await host.check(); assert.equal(host.status().phase, 'failed'); assert.equal(host.status().reason, 'UPDATE_ASSET_DIGEST_MISMATCH');
    assert.deepEqual(await readdir(path.join(root, 'cache')), []);
  } finally { await host.stop(); await rm(root, { recursive: true, force: true }); }
});

test('wrong bytes, native trust failure, target/channel/cohort mismatch and no key cannot become prepared', async () => {
  for (const fault of ['digest', 'short', 'native', 'target', 'channel', 'cohort', 'key']) {
    const f = signedProductFixture(fault === 'target' ? { target: 'windows-amd64' } : fault === 'channel' ? { channel: 'stable' } : fault === 'cohort' ? { components: {} } : {});
    const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-product-negative-'));
    const host = createProductUpdateTestHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '15.0', cacheRoot: path.join(root, 'cache'),
      policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fault === 'key' ? null : f.key },
      fetchImpl: async (url) => String(url).endsWith('latest.json') ? fixtureResponse(f.manifestBytes) : fixtureResponse(fault === 'digest' ? Buffer.alloc(f.bytes.length) : fault === 'short' ? f.bytes.subarray(1) : f.bytes),
      verifyInstaller: async () => { if (fault === 'native') throw new ProductUpdateError('UPDATE_INSTALLER_TRUST_FAILED'); },
    });
    try { await host.check(); assert.equal(host.status().phase, 'failed', fault); assert.equal(host.status().installationAvailable, false); }
    finally { await host.stop(); await rm(root, { recursive: true, force: true }); }
  }
});

test('cancel interrupts network work, removes partial bytes, and retry is supported', async () => {
  const f = signedProductFixture(), root = await mkdtemp(path.join(os.tmpdir(), 'nimi-product-cancel-'));
  let unblock: () => void = () => undefined, first = true;
  const downloading = new Promise<void>((resolve) => { unblock = resolve; });
  const host = createProductUpdateTestHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '15.0', cacheRoot: path.join(root, 'cache'),
    policy: { ...PRODUCT_UPDATE_POLICY, publicKey: f.key },
    fetchImpl: async (url, options) => {
      if (String(url).endsWith('latest.json')) return fixtureResponse(f.manifestBytes);
      if (!first) return fixtureResponse(f.bytes);
      first = false; unblock();
      return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true }));
    }, verifyInstaller: async () => undefined,
  });
  try {
    const pending = host.check();
    await Promise.race([downloading, pending.then(() => assert.fail('check ended before the download started'))]);
    host.cancel(); await pending;
    assert.equal(host.status().phase, 'canceled'); assert.deepEqual(await readdir(path.join(root, 'cache')), []);
    await host.check(); assert.equal(host.status().phase, 'prepared', host.status().reason ?? '');
  } finally { await host.stop(); await rm(root, { recursive: true, force: true }); }
});

test('automatic and explicit checks use same source; no release differs from same version and source failure', async () => {
  const f = signedProductFixture({ version: '0.2.0' });
  const host = createProductUpdateTestHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '15.0', cacheRoot: '/unused',
    policy: { ...PRODUCT_UPDATE_POLICY, publicKey: f.key }, fetchImpl: async () => fixtureResponse(f.manifestBytes),
    verifyInstaller: async () => { throw new Error('must not install'); },
  });
  host.start(); await host.check(); assert.equal(host.status().phase, 'current'); await host.stop();
  for (const code of [404, 502, 503]) {
    const failure = createProductUpdateTestHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '15.0', cacheRoot: '/unused',
      fetchImpl: async () => new Response(JSON.stringify({ error: code === 404 ? 'UPDATE_RELEASE_NOT_FOUND' : code === 503 ? 'UPDATE_TRUST_NOT_CONFIGURED' : 'GITHUB_RELEASE_FETCH_FAILED' }), { status: code }), verifyInstaller: async () => undefined });
    await failure.check(); assert.equal(failure.status().phase, code === 404 ? 'unavailable' : 'failed'); await failure.stop();
  }
  const missingRoute = createProductUpdateTestHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '15.0', cacheRoot: '/unused',
    fetchImpl: async () => new Response('{"error":"NOT_FOUND"}', { status: 404 }), verifyInstaller: async () => undefined });
  await missingRoute.check(); assert.equal(missingRoute.status().phase, 'failed'); assert.equal(missingRoute.status().reason, 'UPDATE_UPSTREAM_UNAVAILABLE'); await missingRoute.stop();
});
