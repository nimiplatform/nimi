import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  RuntimeReleaseInvalidError,
  buildRuntimeManifest,
  githubReleaseApiUrl,
  hasCompleteRuntimeAssetSet,
  matchesRuntimeRelease,
  parseRuntimeChecksums,
  resolveLatestRuntimeManifest,
  runtimeReleaseCandidates,
} from '../src/release-feed.mjs';
import { handleInstallGatewayRequest } from '../src/index.mjs';

const RELEASES_URL = 'https://api.github.com/repos/nimiplatform/nimi/releases?per_page=50';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function archiveNames(version) {
  return {
    'darwin-amd64': `nimi-runtime_${version}_macos_amd64.tar.gz`,
    'darwin-arm64': `nimi-runtime_${version}_macos_arm64.tar.gz`,
    'linux-amd64': `nimi-runtime_${version}_linux_amd64.tar.gz`,
    'linux-arm64': `nimi-runtime_${version}_linux_arm64.tar.gz`,
    'windows-amd64': `nimi-runtime_${version}_windows_amd64.zip`,
    'windows-arm64': `nimi-runtime_${version}_windows_arm64.zip`,
  };
}

// Stands in for GitHub's digest of each uploaded archive.
function archiveDigest(name) {
  return sha256(`archive bytes of ${name}`);
}

function checksumsText(version) {
  return `${Object.values(archiveNames(version)).map((name) => `${archiveDigest(name)}  ${name}`).join('\n')}\n`;
}

function releaseFixture(version, { tag = `runtime/v${version}`, checksums = checksumsText(version), ...overrides } = {}) {
  const base = `https://github.com/nimiplatform/nimi/releases/download/${tag}`;
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-10-01T00:00:00Z',
    assets: [
      { name: 'checksums.txt', state: 'uploaded', digest: `sha256:${sha256(checksums)}`, browser_download_url: `${base}/checksums.txt` },
      ...Object.values(archiveNames(version)).map((name) => ({
        name,
        state: 'uploaded',
        digest: `sha256:${archiveDigest(name)}`,
        browser_download_url: `${base}/${name}`,
      })),
    ],
    ...overrides,
  };
}

function withAsset(release, name, patch) {
  return {
    ...release,
    assets: release.assets.flatMap((asset) => (asset.name === name ? (patch ? [{ ...asset, ...patch }] : []) : [asset])),
  };
}

// Serves the release list and each release's checksum file, keyed by URL.
function githubFixture(releases, checksumsByUrl = {}) {
  const files = new Map(Object.entries(checksumsByUrl));
  for (const release of releases) {
    const asset = release.assets.find((item) => item.name === 'checksums.txt');
    const version = /v(\d+\.\d+\.\d+)/u.exec(release.tag_name)?.[1];
    if (asset && version && !files.has(asset.browser_download_url)) files.set(asset.browser_download_url, checksumsText(version));
  }
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url) === RELEASES_URL) return new Response(JSON.stringify(releases));
    if (files.has(String(url))) return new Response(files.get(String(url)));
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, requested };
}

function latest(fetchImpl) {
  return handleInstallGatewayRequest(
    new Request('https://install.nimi.ai/runtime/latest.json'),
    {},
    { waitUntil: () => undefined },
    { fetchImpl },
  );
}

test('only the Runtime owner namespace identifies a Runtime release', () => {
  assert.equal(matchesRuntimeRelease({ tag_name: 'runtime/v1.0.0' }), true);
  assert.equal(matchesRuntimeRelease({ tag_name: 'runtime/v1.0.0-rc.2' }), true);
  for (const tag of [
    'v1.0.0',
    'v1.0.0-rc.2',
    'nimi/v1.0.0',
    'desktop/v1.0.0',
    'sdk/v1.0.0',
    'kit/v1.0.0',
    'runtime/v1.0.0-preview.1',
    'runtime/v01.0.0',
    'runtime/1.0.0',
    ' runtime/v1.0.0-rc.0',
  ]) {
    assert.equal(matchesRuntimeRelease({ tag_name: tag }), false, tag);
  }
  assert.equal(matchesRuntimeRelease({ name: 'runtime/v1.0.0' }), false);
});

test('candidates are stable Runtime releases with every uploaded archive, highest version first', () => {
  const candidates = runtimeReleaseCandidates([
    releaseFixture('1.9.0', { published_at: '2026-10-05T00:00:00Z' }),
    releaseFixture('1.10.0', { published_at: '2026-10-01T00:00:00Z' }),
    releaseFixture('2.0.0', { tag: 'runtime/v2.0.0-rc.1' }),
    releaseFixture('2.0.1', { prerelease: true }),
    releaseFixture('2.0.2', { draft: true }),
    // A complete Nimi bundle and bare global tags never fall into the Runtime feed.
    releaseFixture('3.0.0', { tag: 'nimi/v3.0.0' }),
    releaseFixture('3.0.1', { tag: 'v3.0.1' }),
    releaseFixture('3.0.2', { tag: 'sdk/v3.0.2' }),
  ]);
  assert.deepEqual(candidates.map((release) => release.tag_name), ['runtime/v1.10.0', 'runtime/v1.9.0']);
  assert.deepEqual(runtimeReleaseCandidates(undefined), []);
});

test('an asset set is complete only with each exact archive uploaded and digested', () => {
  const release = releaseFixture('1.2.3');
  const names = archiveNames('1.2.3');
  assert.equal(hasCompleteRuntimeAssetSet(release), true);
  assert.equal(hasCompleteRuntimeAssetSet(withAsset(release, names['windows-arm64'])), false);
  assert.equal(hasCompleteRuntimeAssetSet(withAsset(release, 'checksums.txt')), false);
  assert.equal(hasCompleteRuntimeAssetSet(withAsset(release, names['linux-amd64'], { state: 'open' })), false);
  assert.equal(hasCompleteRuntimeAssetSet(withAsset(release, names['linux-amd64'], { digest: null })), false);
  assert.equal(hasCompleteRuntimeAssetSet(withAsset(release, names['linux-amd64'], { digest: 'sha1:abc' })), false);
  assert.equal(hasCompleteRuntimeAssetSet(withAsset(release, names['linux-amd64'], { name: 'nimi-runtime_1.2.3_linux_amd64.zip' })), false);
  assert.equal(hasCompleteRuntimeAssetSet(releaseFixture('1.2.3', { tag: 'runtime/v1.2.4' })), false);
});

test('checksum evidence must be unambiguous sha256sum text', () => {
  const [first, second] = Object.values(archiveNames('1.2.3'));
  assert.deepEqual(
    [...parseRuntimeChecksums(`${'a'.repeat(64)}  ${first}\n\n${'b'.repeat(64)}  ${second}\n`).entries()],
    [[first, 'a'.repeat(64)], [second, 'b'.repeat(64)]],
  );
  for (const text of [
    `SHA256 (${first}) = ${'a'.repeat(64)}`,
    `${'a'.repeat(64)} *${first}`,
    `${'A'.repeat(64)}  ${first}`,
    `${'a'.repeat(64)}  ${first}\n${'a'.repeat(64)}  ${first}`,
    `# comment\n${'a'.repeat(64)}  ${first}`,
    '',
  ]) {
    assert.throws(() => parseRuntimeChecksums(text), RuntimeReleaseInvalidError, JSON.stringify(text));
  }
});

test('the manifest carries the Runtime tag, final version and GitHub-verified archive digests', async () => {
  const release = releaseFixture('1.2.3');
  const { fetchImpl } = githubFixture([release]);
  const manifest = await buildRuntimeManifest(release, fetchImpl);
  const names = archiveNames('1.2.3');
  assert.equal(manifest.tag, 'runtime/v1.2.3');
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.checksumsUrl, 'https://github.com/nimiplatform/nimi/releases/download/runtime/v1.2.3/checksums.txt');
  assert.deepEqual(Object.keys(manifest.archives).sort(), Object.keys(names).sort());
  for (const [platform, name] of Object.entries(names)) {
    assert.deepEqual(manifest.archives[platform], {
      name,
      url: `https://github.com/nimiplatform/nimi/releases/download/runtime/v1.2.3/${name}`,
      sha256: archiveDigest(name),
    });
  }
  const candidate = releaseFixture('1.2.3', { tag: 'runtime/v1.2.3-rc.4', prerelease: true });
  const rc = await buildRuntimeManifest(candidate, githubFixture([candidate]).fetchImpl);
  assert.equal(rc.tag, 'runtime/v1.2.3-rc.4');
  assert.equal(rc.version, '1.2.3');
});

test('checksum evidence that disagrees with the uploaded assets rejects the release', async () => {
  const release = releaseFixture('1.2.3');
  const names = archiveNames('1.2.3');
  const checksumsUrl = release.assets[0].browser_download_url;
  const tampered = checksumsText('1.2.3').replace(archiveDigest(names['linux-arm64']), 'f'.repeat(64));
  await assert.rejects(
    buildRuntimeManifest(release, githubFixture([release], { [checksumsUrl]: tampered }).fetchImpl),
    /checksums\.txt does not match its GitHub asset digest/u,
  );
  const signedTampered = releaseFixture('1.2.3', { checksums: tampered });
  await assert.rejects(
    buildRuntimeManifest(signedTampered, githubFixture([signedTampered], { [checksumsUrl]: tampered }).fetchImpl),
    /checksum for nimi-runtime_1\.2\.3_linux_arm64\.tar\.gz does not match its GitHub asset digest/u,
  );
  const partial = checksumsText('1.2.3').split('\n').filter((line) => !line.endsWith(names['windows-arm64'])).join('\n');
  const signedPartial = releaseFixture('1.2.3', { checksums: partial });
  await assert.rejects(
    buildRuntimeManifest(signedPartial, githubFixture([signedPartial], { [checksumsUrl]: partial }).fetchImpl),
    /checksum missing for nimi-runtime_1\.2\.3_windows_arm64\.zip/u,
  );
  await assert.rejects(buildRuntimeManifest(releaseFixture('1.2.3', { tag: 'nimi/v1.2.3' })), /not runtime\/v<SemVer>/u);
});

test('runtime latest route serves the newest verified Runtime release and ignores other owners', async () => {
  const { fetchImpl } = githubFixture([
    releaseFixture('9.0.0', { tag: 'nimi/v9.0.0' }),
    releaseFixture('8.0.0', { tag: 'v8.0.0' }),
    releaseFixture('7.0.0', { tag: 'desktop/v7.0.0' }),
    releaseFixture('1.2.3'),
    releaseFixture('1.2.2'),
  ]);
  const response = await latest(fetchImpl);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.tag, 'runtime/v1.2.3');
  assert.equal(manifest.version, '1.2.3');
});

test('a Runtime release failing verification is skipped for the newest release that passes', async () => {
  const broken = releaseFixture('1.3.0');
  const checksumsUrl = broken.assets[0].browser_download_url;
  const { fetchImpl } = githubFixture([broken, releaseFixture('1.2.3')], {
    [checksumsUrl]: checksumsText('1.3.0').replace(/^[a-f0-9]{64}/u, '0'.repeat(64)),
  });
  const manifest = await resolveLatestRuntimeManifest(await (await fetchImpl(RELEASES_URL)).json(), fetchImpl);
  assert.equal(manifest.tag, 'runtime/v1.2.3');
});

test('no qualifying Runtime release is an honest unavailable result', async () => {
  for (const releases of [
    [],
    [releaseFixture('1.2.3', { tag: 'v1.2.3' }), releaseFixture('1.2.3', { tag: 'nimi/v1.2.3' })],
    [withAsset(releaseFixture('1.2.3'), 'nimi-runtime_1.2.3_windows_arm64.zip')],
  ]) {
    const response = await latest(githubFixture(releases).fetchImpl);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'RUNTIME_RELEASE_NOT_FOUND' });
  }
});

test('upstream failures are reported rather than replaced by an older release', async () => {
  const unavailable = await latest(async () => new Response('rate limited', { status: 403 }));
  assert.equal(unavailable.status, 502);
  assert.deepEqual(await unavailable.json(), { error: 'GITHUB_RELEASE_FETCH_FAILED: status=403' });

  const newest = releaseFixture('1.3.0');
  const { fetchImpl, requested } = githubFixture([newest, releaseFixture('1.2.3')]);
  const response = await latest(async (url) => (
    String(url) === newest.assets[0].browser_download_url ? new Response('busy', { status: 503 }) : fetchImpl(url)
  ));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'RUNTIME_CHECKSUM_FETCH_FAILED: status=503' });
  assert.equal(requested.some((url) => url.includes('runtime/v1.2.3')), false);
});

test('githubReleaseApiUrl uses the admitted release source and ignores deployment overrides', () => {
  assert.equal(githubReleaseApiUrl(), RELEASES_URL);
  assert.equal(
    githubReleaseApiUrl({
      GITHUB_API_ORIGIN: 'https://api.example.com/',
      GITHUB_REPO_OWNER: 'example',
      GITHUB_REPO_NAME: 'custom',
    }),
    RELEASES_URL,
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
