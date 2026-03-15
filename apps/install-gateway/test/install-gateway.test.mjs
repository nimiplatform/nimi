import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopLatestManifest,
  buildRuntimeManifest,
  collectDesktopUpdaterArtifacts,
  githubReleaseApiUrl,
  matchesReleaseTrack,
  selectLatestRelease,
} from '../src/release-feed.mjs';

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

const desktopRelease = {
  tag_name: 'desktop/v2.0.0',
  name: 'desktop/v2.0.0',
  body: 'Desktop release notes',
  published_at: '2026-03-16T10:00:00Z',
  assets: [
    {
      name: 'Nimi_2.0.0_aarch64.dmg.app.tar.gz',
      browser_download_url: 'https://example.com/Nimi_2.0.0_aarch64.dmg.app.tar.gz',
    },
    {
      name: 'Nimi_2.0.0_aarch64.dmg.app.tar.gz.sig',
      browser_download_url: 'https://example.com/Nimi_2.0.0_aarch64.dmg.app.tar.gz.sig',
    },
    {
      name: 'Nimi_2.0.0_x64.AppImage.tar.gz',
      browser_download_url: 'https://example.com/Nimi_2.0.0_x64.AppImage.tar.gz',
    },
    {
      name: 'Nimi_2.0.0_x64.AppImage.tar.gz.sig',
      browser_download_url: 'https://example.com/Nimi_2.0.0_x64.AppImage.tar.gz.sig',
    },
    {
      name: 'Nimi_2.0.0_x64-setup.nsis.zip',
      browser_download_url: 'https://example.com/Nimi_2.0.0_x64-setup.nsis.zip',
    },
    {
      name: 'Nimi_2.0.0_x64-setup.nsis.zip.sig',
      browser_download_url: 'https://example.com/Nimi_2.0.0_x64-setup.nsis.zip.sig',
    },
  ],
};

test('matchesReleaseTrack checks tag and name prefixes', () => {
  assert.equal(matchesReleaseTrack({ tag_name: 'runtime/v1.0.0' }, 'runtime'), true);
  assert.equal(matchesReleaseTrack({ name: 'desktop/v1.0.0' }, 'desktop'), true);
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

test('githubReleaseApiUrl uses repo defaults and optional overrides', () => {
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
    'https://api.example.com/repos/example/custom/releases?per_page=50',
  );
});

test('buildRuntimeManifest returns manifest fields for all runtime archives', () => {
  assert.deepEqual(buildRuntimeManifest(runtimeRelease), {
    tag: 'runtime/v1.2.3',
    version: '1.2.3',
    checksumsUrl: 'https://example.com/checksums.txt',
    archives: {
      'darwin-amd64': {
        name: 'nimi-runtime_1.2.3_macos_amd64.tar.gz',
        url: 'https://example.com/macos-amd64.tar.gz',
      },
      'darwin-arm64': {
        name: 'nimi-runtime_1.2.3_macos_arm64.tar.gz',
        url: 'https://example.com/macos-arm64.tar.gz',
      },
      'linux-amd64': {
        name: 'nimi-runtime_1.2.3_linux_amd64.tar.gz',
        url: 'https://example.com/linux-amd64.tar.gz',
      },
      'linux-arm64': {
        name: 'nimi-runtime_1.2.3_linux_arm64.tar.gz',
        url: 'https://example.com/linux-arm64.tar.gz',
      },
      'windows-amd64': {
        name: 'nimi-runtime_1.2.3_windows_amd64.zip',
        url: 'https://example.com/windows-amd64.zip',
      },
      'windows-arm64': {
        name: 'nimi-runtime_1.2.3_windows_arm64.zip',
        url: 'https://example.com/windows-arm64.zip',
      },
    },
  });
});

test('buildRuntimeManifest rejects incomplete runtime asset sets', () => {
  assert.throws(
    () => buildRuntimeManifest({
      ...runtimeRelease,
      assets: runtimeRelease.assets.filter((asset) => asset.name !== 'nimi-runtime_1.2.3_windows_arm64.zip'),
    }),
    /archive missing for windows-arm64/u,
  );
});

test('collectDesktopUpdaterArtifacts finds updater bundles and signatures', () => {
  assert.deepEqual(collectDesktopUpdaterArtifacts(desktopRelease), [
    {
      platform: 'darwin-aarch64',
      bundleUrl: 'https://example.com/Nimi_2.0.0_aarch64.dmg.app.tar.gz',
      signatureUrl: 'https://example.com/Nimi_2.0.0_aarch64.dmg.app.tar.gz.sig',
    },
    {
      platform: 'linux-x86_64',
      bundleUrl: 'https://example.com/Nimi_2.0.0_x64.AppImage.tar.gz',
      signatureUrl: 'https://example.com/Nimi_2.0.0_x64.AppImage.tar.gz.sig',
    },
    {
      platform: 'windows-x86_64',
      bundleUrl: 'https://example.com/Nimi_2.0.0_x64-setup.nsis.zip',
      signatureUrl: 'https://example.com/Nimi_2.0.0_x64-setup.nsis.zip.sig',
    },
  ]);
});

test('buildDesktopLatestManifest synthesizes multi-platform updater json', async () => {
  const manifest = await buildDesktopLatestManifest(desktopRelease, async (url) => new Response(`sig:${url}`));
  assert.deepEqual(manifest, {
    version: '2.0.0',
    notes: 'Desktop release notes',
    pub_date: '2026-03-16T10:00:00Z',
    platforms: {
      'darwin-aarch64': {
        signature: 'sig:https://example.com/Nimi_2.0.0_aarch64.dmg.app.tar.gz.sig',
        url: 'https://example.com/Nimi_2.0.0_aarch64.dmg.app.tar.gz',
      },
      'linux-x86_64': {
        signature: 'sig:https://example.com/Nimi_2.0.0_x64.AppImage.tar.gz.sig',
        url: 'https://example.com/Nimi_2.0.0_x64.AppImage.tar.gz',
      },
      'windows-x86_64': {
        signature: 'sig:https://example.com/Nimi_2.0.0_x64-setup.nsis.zip.sig',
        url: 'https://example.com/Nimi_2.0.0_x64-setup.nsis.zip',
      },
    },
  });
});

test('buildDesktopLatestManifest rejects releases without updater signatures', async () => {
  await assert.rejects(
    buildDesktopLatestManifest(
      {
        ...desktopRelease,
        assets: desktopRelease.assets.filter((asset) => !asset.name.endsWith('.sig')),
      },
      async () => new Response('sig'),
    ),
    /signature missing/u,
  );
});
