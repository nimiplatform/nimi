import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeManifest,
  githubReleaseApiUrl,
  hasCompleteRuntimeAssetSet,
  matchesGlobalRelease,
  parseRuntimeChecksums,
  selectLatestRelease,
} from '../src/release-feed.mjs';
import { handleInstallGatewayRequest } from '../src/index.mjs';

const runtimeRelease = {
  tag_name: 'v1.2.3',
  name: 'Nimi v1.2.3',
  published_at: '2026-03-16T10:00:00Z',
  assets: [
    { name: 'checksums.txt', browser_download_url: 'https://example.com/checksums.txt' },
    { name: 'nimi-runtime_1.2.3_macos_amd64.tar.gz', browser_download_url: 'https://example.com/macos-amd64.tar.gz' },
    { name: 'nimi-runtime_1.2.3_macos_arm64.tar.gz', browser_download_url: 'https://example.com/macos-arm64.tar.gz' },
    { name: 'nimi-runtime_1.2.3_linux_amd64.tar.gz', browser_download_url: 'https://example.com/linux-amd64.tar.gz' },
    { name: 'nimi-runtime_1.2.3_linux_arm64.tar.gz', browser_download_url: 'https://example.com/linux-arm64.tar.gz' },
    { name: 'nimi-runtime_1.2.3_windows_amd64.zip', browser_download_url: 'https://example.com/windows-amd64.zip' },
    { name: 'nimi-runtime_1.2.3_windows_arm64.zip', browser_download_url: 'https://example.com/windows-arm64.zip' },
  ],
};

const runtimeChecksums = [
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  nimi-runtime_1.2.3_macos_amd64.tar.gz',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  nimi-runtime_1.2.3_macos_arm64.tar.gz',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  nimi-runtime_1.2.3_linux_amd64.tar.gz',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd  nimi-runtime_1.2.3_linux_arm64.tar.gz',
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee  nimi-runtime_1.2.3_windows_amd64.zip',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff  nimi-runtime_1.2.3_windows_arm64.zip',
].join('\n');

async function fetchRuntimeChecksumsFixture(url) {
  assert.equal(url, 'https://example.com/checksums.txt');
  return new Response(runtimeChecksums);
}

test('matchesGlobalRelease accepts only exact global stable and RC tags', () => {
  assert.equal(matchesGlobalRelease({ tag_name: 'v1.0.0' }), true);
  assert.equal(matchesGlobalRelease({ tag_name: 'v1.0.0-rc.2' }), true);
  assert.equal(matchesGlobalRelease({ tag_name: 'v1.0.0-preview.1' }), false);
  assert.equal(matchesGlobalRelease({ tag_name: 'runtime/v1.0.0' }), false);
  assert.equal(matchesGlobalRelease({ name: 'v1.0.0' }), false);
});

test('selectLatestRelease admits only stable releases', () => {
  const releases = [
    runtimeReleaseFixture('2.1.0', { tag_name: 'v2.1.0-rc.1', prerelease: false, published_at: '2026-03-19T00:00:00Z' }),
    runtimeReleaseFixture('2.0.0', { tag_name: 'v2.0.0-rc.1', prerelease: true, published_at: '2026-03-18T00:00:00Z' }),
    runtimeReleaseFixture('1.9.0', { prerelease: false, published_at: '2026-03-17T00:00:00Z' }),
  ];
  assert.equal(selectLatestRelease(releases)?.tag_name, 'v1.9.0');
  assert.equal(selectLatestRelease([
    runtimeReleaseFixture('2.0.0', { tag_name: 'v2.0.0-rc.1', prerelease: true }),
  ]), null);
  assert.equal(selectLatestRelease([
    runtimeReleaseFixture('2.0.0', { tag_name: 'v2.0.0-rc.1', prerelease: false }),
  ]), null);
});

test('selectLatestRelease skips global releases without the complete Runtime payload', () => {
  const valid = runtimeReleaseFixture('1.9.0', { published_at: '2026-03-17T00:00:00Z' });
  const incomplete = runtimeReleaseFixture('2.0.0', {
    published_at: '2026-03-18T00:00:00Z',
    assets: runtimeAssets('2.0.0').filter((asset) => !asset.name.includes('windows_arm64')),
  });
  assert.equal(hasCompleteRuntimeAssetSet(valid), true);
  assert.equal(hasCompleteRuntimeAssetSet(incomplete), false);
  assert.equal(selectLatestRelease([incomplete, valid])?.tag_name, 'v1.9.0');
});

test('githubReleaseApiUrl uses the admitted release source and ignores deployment overrides', () => {
  assert.equal(
    githubReleaseApiUrl(),
    'https://api.github.com/repos/nimiplatform/nimi/releases?per_page=50',
  );
  assert.equal(
    githubReleaseApiUrl({
      GITHUB_API_ORIGIN: 'https://api.example.com/',
      GITHUB_REPO_OWNER: 'example',
      GITHUB_REPO_NAME: 'custom',
    }),
    'https://api.github.com/repos/nimiplatform/nimi/releases?per_page=50',
  );
});

test('parseRuntimeChecksums accepts sha256sum and tagged checksum formats', () => {
  assert.deepEqual(
    [...parseRuntimeChecksums([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  nimi-runtime_1.2.3_macos_amd64.tar.gz',
      'SHA256 (nimi-runtime_1.2.3_macos_arm64.tar.gz) = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ].join('\n')).entries()],
    [
      ['nimi-runtime_1.2.3_macos_amd64.tar.gz', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      ['nimi-runtime_1.2.3_macos_arm64.tar.gz', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ],
  );
});

test('buildRuntimeManifest returns manifest fields for all runtime archives', async () => {
  assert.deepEqual(await buildRuntimeManifest(runtimeRelease, fetchRuntimeChecksumsFixture), {
    tag: 'v1.2.3',
    version: '1.2.3',
    checksumsUrl: 'https://example.com/checksums.txt',
    archives: {
      'darwin-amd64': {
        name: 'nimi-runtime_1.2.3_macos_amd64.tar.gz',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        url: 'https://example.com/macos-amd64.tar.gz',
      },
      'darwin-arm64': {
        name: 'nimi-runtime_1.2.3_macos_arm64.tar.gz',
        sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        url: 'https://example.com/macos-arm64.tar.gz',
      },
      'linux-amd64': {
        name: 'nimi-runtime_1.2.3_linux_amd64.tar.gz',
        sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        url: 'https://example.com/linux-amd64.tar.gz',
      },
      'linux-arm64': {
        name: 'nimi-runtime_1.2.3_linux_arm64.tar.gz',
        sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        url: 'https://example.com/linux-arm64.tar.gz',
      },
      'windows-amd64': {
        name: 'nimi-runtime_1.2.3_windows_amd64.zip',
        sha256: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        url: 'https://example.com/windows-amd64.zip',
      },
      'windows-arm64': {
        name: 'nimi-runtime_1.2.3_windows_arm64.zip',
        sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        url: 'https://example.com/windows-arm64.zip',
      },
    },
  });
});

test('buildRuntimeManifest keeps final artifact version under a global RC tag', async () => {
  const manifest = await buildRuntimeManifest({
    ...runtimeRelease,
    tag_name: 'v1.2.3-rc.4',
    prerelease: true,
  }, fetchRuntimeChecksumsFixture);
  assert.equal(manifest.tag, 'v1.2.3-rc.4');
  assert.equal(manifest.version, '1.2.3');
});

test('buildRuntimeManifest rejects incomplete runtime asset sets', async () => {
  await assert.rejects(
    buildRuntimeManifest({
      ...runtimeRelease,
      assets: runtimeRelease.assets.filter((asset) => asset.name !== 'nimi-runtime_1.2.3_windows_arm64.zip'),
    }, fetchRuntimeChecksumsFixture),
    /archive missing for windows-arm64/u,
  );
});

test('buildRuntimeManifest rejects runtime archives without checksum evidence', async () => {
  await assert.rejects(
    buildRuntimeManifest(runtimeRelease, async () => new Response(
      runtimeChecksums.replace(/^f{64}  nimi-runtime_1\.2\.3_windows_arm64\.zip$/mu, ''),
    )),
    /checksum missing for nimi-runtime_1\.2\.3_windows_arm64\.zip/u,
  );
});

test('runtime latest route selects a complete global release', async () => {
  const response = await handleInstallGatewayRequest(
    new Request('https://install.nimi.ai/runtime/latest.json'),
    {},
    { waitUntil: () => undefined },
    {
      fetchImpl: async (url) => {
        if (String(url).includes('/releases?')) {
          return new Response(JSON.stringify([runtimeRelease]));
        }
        return fetchRuntimeChecksumsFixture(url);
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tag, 'v1.2.3');
});

test('runtime latest route does not accept retired component release tags', async () => {
  const response = await handleInstallGatewayRequest(
    new Request('https://install.nimi.ai/runtime/latest.json'),
    {},
    { waitUntil: () => undefined },
    {
      fetchImpl: async () => new Response(JSON.stringify([{
        ...runtimeRelease,
        tag_name: 'runtime/v1.2.3',
      }])),
    },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'RUNTIME_RELEASE_NOT_FOUND' });
});

test('retired Desktop updater feed is not routable', async () => {
  const response = await handleInstallGatewayRequest(
    new Request('https://install.nimi.ai/desktop/latest.json'),
    {},
    { waitUntil: () => undefined },
    { fetchImpl: async () => { throw new Error('unexpected GitHub fetch'); } },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'NOT_FOUND' });
});

function runtimeReleaseFixture(version, overrides = {}) {
  return {
    tag_name: `v${version}`,
    name: `Nimi v${version}`,
    prerelease: false,
    published_at: '2026-03-16T10:00:00Z',
    assets: runtimeAssets(version),
    ...overrides,
  };
}

function runtimeAssets(version) {
  return [
    { name: 'checksums.txt', browser_download_url: 'https://example.com/checksums.txt' },
    { name: `nimi-runtime_${version}_macos_amd64.tar.gz`, browser_download_url: 'https://example.com/macos-amd64.tar.gz' },
    { name: `nimi-runtime_${version}_macos_arm64.tar.gz`, browser_download_url: 'https://example.com/macos-arm64.tar.gz' },
    { name: `nimi-runtime_${version}_linux_amd64.tar.gz`, browser_download_url: 'https://example.com/linux-amd64.tar.gz' },
    { name: `nimi-runtime_${version}_linux_arm64.tar.gz`, browser_download_url: 'https://example.com/linux-arm64.tar.gz' },
    { name: `nimi-runtime_${version}_windows_amd64.zip`, browser_download_url: 'https://example.com/windows-amd64.zip' },
    { name: `nimi-runtime_${version}_windows_arm64.zip`, browser_download_url: 'https://example.com/windows-arm64.zip' },
  ];
}
