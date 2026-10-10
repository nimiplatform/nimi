import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { DesktopProductUpdateHost } from '../src-electron/product-update-host.js';
import { verifyProductInstaller } from '../src-electron/product-update-installer-verification.js';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { productAssetUrl } from '../../../config/product-update-contract.mjs';
import { signedProductFixture } from '../../install-gateway/test/product-release-fixture.mjs';

// Explicit local real-asset input; no key or test path enters product policy.
// CI without this artifact must report the native path as skipped/unverified.
const notarizedPkg = process.env.NIMI_UPDATE_TEST_NOTARIZED_PKG;
test('real notarized PKG crosses the downloader staging path using the production native verifier', {
  skip: process.platform !== 'darwin' || !notarizedPkg,
}, async () => {
  const file = notarizedPkg!;
  const info = await stat(file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const name = 'Nimi-0.2.0-macos-arm64.pkg';
  // This signed test admission exercises staging/native verification only.
  // It is not a published release, an installed N→N+1 or cohort acceptance.
  const fixture = signedProductFixture({ version: '0.2.0',
    compatibility: { minimumProductVersion: '0.1.0', minimumOsVersion: '13.0', dataPolicy: 'owner-approved-forward' },
    asset: { name, url: productAssetUrl('nimi/v0.2.0', name), size: info.size, sha256: hash.digest('hex'), installer: 'macos-pkg' },
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-native-update-'));
  const observed: string[] = [];
  const host = new DesktopProductUpdateHost({ currentVersion: '0.1.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: path.join(directory, 'cache'),
    policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fixture.key },
    fetchImpl: async (url) => String(url).endsWith('latest.json') ? new Response(fixture.manifestBytes.toString('utf8'))
      : new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>),
    verifyInstaller: async (staged, release) => {
      observed.push(path.basename(staged));
      await verifyProductInstaller(staged, release);
    },
  });
  try {
    await host.check();
    assert.equal(host.status().phase, 'prepared', host.status().reason ?? 'unknown failure');
    assert.equal(host.status().installationAvailable, false);
    assert.equal(host.status().downloadedBytes, info.size);
    assert.deepEqual(observed, ['candidate.part']);
    await host.check();
    assert.equal(host.status().phase, 'prepared', host.status().reason ?? 'unknown failure');
    assert.deepEqual(observed, ['candidate.part', name]);
    const invalid = path.join(directory, 'invalid.part');
    await writeFile(invalid, 'not a signed installer');
    await assert.rejects(verifyProductInstaller(invalid, fixture.candidate), /UPDATE_INSTALLER_TRUST_FAILED/);
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});
