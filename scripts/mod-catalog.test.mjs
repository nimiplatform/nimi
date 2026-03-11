import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateModCatalog,
  updateModCatalog,
  validateSignerRegistryFile,
  validateStaticModCatalog,
} from './lib/mod-catalog.mjs';

test('generateModCatalog builds static index files from release sidecars', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-catalog-'));
  const sourceDir = path.join(root, 'mods');
  const outDir = path.join(root, 'catalog');
  fs.mkdirSync(path.join(sourceDir, 'demo', 'dist', 'packages'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'demo', 'mod.manifest.yaml'), [
    'id: world.nimi.demo',
    'name: Demo Mod',
    'version: 1.2.0',
    'description: Demo release',
    'entry: ./dist/mods/demo/index.js',
    'capabilities:',
    '  - ui.register.ui-extension.app.sidebar.mods',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(sourceDir, 'demo', 'dist', 'packages', 'release.manifest.json'), JSON.stringify({
    packageType: 'desktop-mod',
    packageId: 'world.nimi.demo',
    version: '1.2.0',
    channel: 'stable',
    artifactUrl: 'https://example.com/world.nimi.demo.zip',
    sha256: 'a'.repeat(64),
    signature: 'sig',
    signerId: 'nimi.release',
    minDesktopVersion: '0.1.0',
    minHookApiVersion: 'v1',
    capabilities: ['ui.register.ui-extension.app.sidebar.mods'],
    requiresReconsentOnCapabilityIncrease: false,
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    source: {
      repoUrl: 'https://github.com/nimiplatform/nimi-mods',
      releaseTag: 'v1.2.0',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
  }, null, 2));
  const signersFile = path.join(root, 'signers.json');
  fs.writeFileSync(signersFile, JSON.stringify({
    signers: {
      'nimi.release': {
        algorithm: 'ed25519',
        publicKey: 'MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      },
    },
  }, null, 2));

  const result = generateModCatalog({
    sourceDir,
    outDir,
    signersFile,
  });

  assert.equal(result.packageCount, 1);
  const packages = JSON.parse(fs.readFileSync(path.join(outDir, 'index/v1/packages.json'), 'utf8'));
  assert.equal(packages[0]?.packageId, 'world.nimi.demo');
  const packageRecord = JSON.parse(fs.readFileSync(path.join(outDir, 'index/v1/packages/world.nimi.demo.json'), 'utf8'));
  assert.equal(packageRecord.signers[0]?.signerId, 'nimi.release');
  const releaseRecord = JSON.parse(fs.readFileSync(path.join(outDir, 'index/v1/releases/world.nimi.demo/1.2.0.json'), 'utf8'));
  assert.equal(releaseRecord.channel, 'stable');
  assert.equal(validateStaticModCatalog({ catalogDir: outDir }).packageCount, 1);
});

test('validateSignerRegistryFile rejects unsupported signer algorithms', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-signers-'));
  const signersFile = path.join(root, 'signers.json');
  fs.writeFileSync(signersFile, JSON.stringify({
    signers: {
      'nimi.release': {
        algorithm: 'rsa',
        publicKey: 'abc',
      },
    },
  }, null, 2));

  assert.throws(
    () => validateSignerRegistryFile({ signersFile }),
    /algorithm must be ed25519/i,
  );
});

test('updateModCatalog appends a new release and updates channel pointers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-catalog-update-'));
  const catalogDir = path.join(root, 'catalog');
  const sourceDir = path.join(root, 'mods');
  const signersFile = path.join(root, 'signers.json');
  fs.mkdirSync(path.join(sourceDir, 'demo', 'dist', 'packages'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'demo', 'mod.manifest.yaml'), [
    'id: world.nimi.demo',
    'name: Demo Mod',
    'version: 1.2.0',
    'description: Demo release',
    'keywords:',
    '  - demo',
    'tags:',
    '  - official',
    '',
  ].join('\n'));
  fs.writeFileSync(signersFile, JSON.stringify({
    signers: {
      'nimi.release': {
        algorithm: 'ed25519',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      },
    },
  }, null, 2));
  fs.writeFileSync(path.join(sourceDir, 'demo', 'dist', 'packages', 'release.manifest.json'), JSON.stringify({
    packageType: 'desktop-mod',
    packageId: 'world.nimi.demo',
    version: '1.2.0',
    channel: 'stable',
    artifactUrl: 'https://example.com/world.nimi.demo-1.2.0.zip',
    sha256: 'a'.repeat(64),
    signature: 'sig',
    signerId: 'nimi.release',
    minDesktopVersion: '0.1.0',
    minHookApiVersion: 'v1',
    capabilities: [],
    requiresReconsentOnCapabilityIncrease: false,
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    source: {
      repoUrl: 'https://github.com/nimiplatform/nimi-mods',
      releaseTag: 'v1.2.0',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
  }, null, 2));
  generateModCatalog({ sourceDir, outDir: catalogDir, signersFile });

  const releasePath = path.join(root, 'release-next.json');
  fs.writeFileSync(releasePath, JSON.stringify({
    packageType: 'desktop-mod',
    packageId: 'world.nimi.demo',
    version: '1.3.0',
    channel: 'stable',
    artifactUrl: 'https://example.com/world.nimi.demo-1.3.0.zip',
    sha256: 'b'.repeat(64),
    signature: 'sig',
    signerId: 'nimi.release',
    minDesktopVersion: '0.1.0',
    minHookApiVersion: 'v1',
    capabilities: [],
    requiresReconsentOnCapabilityIncrease: false,
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    source: {
      repoUrl: 'https://github.com/nimiplatform/nimi-mods',
      releaseTag: 'v1.3.0',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
  }, null, 2));

  updateModCatalog({
    catalogDir,
    releaseManifestPaths: [releasePath],
    manifestFile: path.join(sourceDir, 'demo', 'mod.manifest.yaml'),
    signersFile,
    expectedPackageId: 'world.nimi.demo',
    expectedChannel: 'stable',
  });

  const packageRecord = JSON.parse(fs.readFileSync(path.join(catalogDir, 'index/v1/packages/world.nimi.demo.json'), 'utf8'));
  assert.equal(packageRecord.channels.stable, '1.3.0');
  assert.equal(packageRecord.releases.length, 2);
  assert.equal(packageRecord.releases[0]?.version, '1.3.0');
});

test('updateModCatalog accepts reserved nimi-app fields and rejects them for desktop-mod', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-catalog-app-fields-'));
  const catalogDir = path.join(root, 'catalog');
  const signersFile = path.join(root, 'signers.json');
  fs.mkdirSync(path.join(catalogDir, 'index', 'v1'), { recursive: true });
  fs.writeFileSync(path.join(catalogDir, 'index', 'v1', 'packages.json'), '[]\n');
  fs.writeFileSync(path.join(catalogDir, 'index', 'v1', 'revocations.json'), JSON.stringify({ items: [] }, null, 2));
  fs.writeFileSync(path.join(catalogDir, 'index', 'v1', 'advisories.json'), JSON.stringify({ items: [] }, null, 2));
  fs.writeFileSync(signersFile, JSON.stringify({
    signers: {
      'nimi.release': {
        algorithm: 'ed25519',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      },
    },
  }, null, 2));

  const appManifest = path.join(root, 'app.manifest.yaml');
  fs.writeFileSync(appManifest, [
    'id: world.nimi.future-app',
    'name: Future App',
    'description: Future app',
    '',
  ].join('\n'));
  const appRelease = path.join(root, 'future-app-release.json');
  fs.writeFileSync(appRelease, JSON.stringify({
    packageType: 'nimi-app',
    packageId: 'world.nimi.future-app',
    version: '0.1.0-beta.1',
    channel: 'beta',
    artifactUrl: 'https://example.com/future-app.zip',
    sha256: 'c'.repeat(64),
    signature: 'sig',
    signerId: 'nimi.release',
    minDesktopVersion: '0.1.0',
    minHookApiVersion: 'v1',
    capabilities: [],
    requiresReconsentOnCapabilityIncrease: false,
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    source: {
      repoUrl: 'https://github.com/nimiplatform/nimi-apps',
      releaseTag: 'v0.1.0-beta.1',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
    appMode: 'render-app',
    scopeCatalogVersion: 'v1',
    minRuntimeVersion: '0.1.0',
  }, null, 2));

  updateModCatalog({
    catalogDir,
    releaseManifestPaths: [appRelease],
    manifestFile: appManifest,
    signersFile,
  });
  const storedAppRelease = JSON.parse(fs.readFileSync(path.join(catalogDir, 'index/v1/releases/world.nimi.future-app/0.1.0-beta.1.json'), 'utf8'));
  assert.equal(storedAppRelease.appMode, 'render-app');
  assert.equal(storedAppRelease.scopeCatalogVersion, 'v1');
  assert.equal(storedAppRelease.minRuntimeVersion, '0.1.0');

  const desktopRelease = path.join(root, 'bad-desktop-release.json');
  fs.writeFileSync(desktopRelease, JSON.stringify({
    packageType: 'desktop-mod',
    packageId: 'world.nimi.bad-desktop',
    version: '1.0.0',
    channel: 'stable',
    artifactUrl: 'https://example.com/bad-desktop.zip',
    sha256: 'd'.repeat(64),
    signature: 'sig',
    signerId: 'nimi.release',
    minDesktopVersion: '0.1.0',
    minHookApiVersion: 'v1',
    capabilities: [],
    requiresReconsentOnCapabilityIncrease: false,
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    source: {
      repoUrl: 'https://github.com/nimiplatform/nimi-mods',
      releaseTag: 'v1.0.0',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
    appMode: 'render-app',
  }, null, 2));

  assert.throws(
    () => updateModCatalog({
      catalogDir,
      releaseManifestPaths: [desktopRelease],
      manifestFile: appManifest,
      signersFile,
    }),
    /only allowed for packageType=nimi-app/i,
  );
});

test('update-mod-catalog CLI updates catalog from a release manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-catalog-cli-'));
  const catalogDir = path.join(root, 'catalog');
  const signersFile = path.join(root, 'signers.json');
  const manifestFile = path.join(root, 'mod.manifest.yaml');
  const releasePath = path.join(root, 'release.manifest.json');

  fs.mkdirSync(path.join(catalogDir, 'index', 'v1'), { recursive: true });
  fs.writeFileSync(path.join(catalogDir, 'index', 'v1', 'packages.json'), '[]\n');
  fs.writeFileSync(path.join(catalogDir, 'index', 'v1', 'revocations.json'), JSON.stringify({ items: [] }, null, 2));
  fs.writeFileSync(path.join(catalogDir, 'index', 'v1', 'advisories.json'), JSON.stringify({ items: [] }, null, 2));
  fs.writeFileSync(signersFile, JSON.stringify({
    signers: {
      'nimi.release': {
        algorithm: 'ed25519',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      },
    },
  }, null, 2));
  fs.writeFileSync(manifestFile, [
    'id: world.nimi.cli-demo',
    'name: CLI Demo',
    'description: CLI updated catalog package',
    '',
  ].join('\n'));
  fs.writeFileSync(releasePath, JSON.stringify({
    packageType: 'desktop-mod',
    packageId: 'world.nimi.cli-demo',
    version: '1.0.0',
    channel: 'stable',
    artifactUrl: 'https://example.com/world.nimi.cli-demo.zip',
    sha256: 'e'.repeat(64),
    signature: 'sig',
    signerId: 'nimi.release',
    minDesktopVersion: '0.1.0',
    minHookApiVersion: 'v1',
    capabilities: [],
    requiresReconsentOnCapabilityIncrease: false,
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    source: {
      repoUrl: 'https://github.com/nimiplatform/nimi-mods',
      releaseTag: 'v1.0.0',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
  }, null, 2));

  execFileSync('node', [
    'scripts/update-mod-catalog.mjs',
    '--catalog-dir', catalogDir,
    '--release-manifest', releasePath,
    '--manifest-file', manifestFile,
    '--signers-file', signersFile,
    '--package-id', 'world.nimi.cli-demo',
    '--channel', 'stable',
  ], {
    cwd: '/Users/snwozy/nimi-realm/nimi',
    stdio: 'pipe',
  });

  const packageRecord = JSON.parse(fs.readFileSync(path.join(catalogDir, 'index/v1/packages/world.nimi.cli-demo.json'), 'utf8'));
  assert.equal(packageRecord.packageId, 'world.nimi.cli-demo');
  assert.equal(packageRecord.channels.stable, '1.0.0');
});
