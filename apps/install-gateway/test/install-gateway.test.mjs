import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeManifest,
  githubReleaseApiUrl,
  matchesReleaseTrack,
  parseRuntimeChecksums,
  selectLatestRelease,
} from '../src/release-feed.mjs';
import { handleInstallGatewayRequest } from '../src/index.mjs';

const runtimeRelease = {
  tag_name: 'runtime/v1.2.3',
  name: 'runtime/v1.2.3',
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

test('matchesReleaseTrack checks tag and name prefixes', () => {
  assert.equal(matchesReleaseTrack({ tag_name: 'runtime/v1.0.0' }, 'runtime'), true);
  assert.equal(matchesReleaseTrack({ name: 'runtime/v1.0.0' }, 'runtime'), true);
  assert.equal(matchesReleaseTrack({ tag_name: 'sdk/v1.0.0' }, 'runtime'), false);
});

test('selectLatestRelease prefers stable releases and falls back to prereleases', () => {
  const releases = [
    { tag_name: 'runtime/v2.0.0-rc.1', prerelease: true, published_at: '2026-03-18T00:00:00Z' },
    { tag_name: 'runtime/v1.9.0', prerelease: false, published_at: '2026-03-17T00:00:00Z' },
  ];
  assert.equal(selectLatestRelease(releases, 'runtime')?.tag_name, 'runtime/v1.9.0');
  assert.equal(
    selectLatestRelease([{ tag_name: 'runtime/v2.0.0-rc.1', prerelease: true, published_at: '2026-03-18T00:00:00Z' }], 'runtime')?.tag_name,
    'runtime/v2.0.0-rc.1',
  );
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
    tag: 'runtime/v1.2.3',
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
