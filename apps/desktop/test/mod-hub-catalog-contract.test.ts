import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAvailableModUpdate,
  parseCatalogInstallResult,
  parseCatalogPackageSummaries,
  parseCatalogReleaseRecord,
  parseRuntimeModInstallResult,
} from '../src/shell/renderer/bridge/runtime-bridge/runtime-parsers';
import { toCatalogModRow } from '../src/shell/renderer/features/mod-hub/mod-hub-model';

test('parseRuntimeModInstallResult keeps rollbackPath and releaseManifest metadata', () => {
  const parsed = parseRuntimeModInstallResult({
    installSessionId: 'install-1',
    operation: 'update',
    modId: 'world.nimi.example',
    installedPath: '/mods/world.nimi.example',
    rollbackPath: '/mods-backups/world.nimi.example-1',
    manifest: {
      path: '/mods/world.nimi.example/mod.manifest.yaml',
      id: 'world.nimi.example',
      version: '1.2.0',
      releaseManifest: {
        packageId: 'world.nimi.example',
        channel: 'stable',
      },
    },
  });

  assert.equal(parsed.rollbackPath, '/mods-backups/world.nimi.example-1');
  assert.equal(parsed.manifest.releaseManifest?.packageId, 'world.nimi.example');
});

test('parseCatalogPackageSummaries parses trust tier and package type', () => {
  const parsed = parseCatalogPackageSummaries([{
    packageId: 'world.nimi.catalog',
    packageType: 'desktop-mod',
    name: 'Catalog Mod',
    description: 'Listed from catalog',
    latestVersion: '1.3.0',
    latestChannel: 'stable',
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
    keywords: ['chat'],
    tags: ['official'],
  }]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.publisher.trustTier, 'official');
  assert.equal(parsed[0]?.packageType, 'desktop-mod');
});

test('parseCatalogInstallResult normalizes nested release and policy payload', () => {
  const parsed = parseCatalogInstallResult({
    install: {
      installSessionId: 'session-1',
      operation: 'install',
      modId: 'world.nimi.catalog',
      installedPath: '/mods/world.nimi.catalog',
      manifest: {
        path: '/mods/world.nimi.catalog/mod.manifest.yaml',
        id: 'world.nimi.catalog',
      },
    },
    package: {
      packageId: 'world.nimi.catalog',
      packageType: 'desktop-mod',
      name: 'Catalog Mod',
      description: 'desc',
      publisher: {
        publisherId: 'nimi',
        displayName: 'Nimi',
        trustTier: 'official',
      },
      state: {
        listed: true,
        yanked: false,
        quarantined: false,
      },
      channels: {
        stable: '1.3.0',
      },
      keywords: [],
      tags: [],
      signers: [{
        signerId: 'nimi.release',
        algorithm: 'ed25519',
        publicKey: 'abc',
      }],
      releases: [],
    },
    release: {
      packageId: 'world.nimi.catalog',
      packageType: 'desktop-mod',
      version: '1.3.0',
      channel: 'stable',
      artifactUrl: 'https://example.com/mod.zip',
      sha256: 'abc',
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
        releaseTag: 'v1.3.0',
      },
      state: {
        listed: true,
        yanked: false,
        quarantined: false,
      },
    },
    policy: {
      channel: 'stable',
      autoUpdate: true,
    },
    requiresUserConsent: true,
    consentReasons: ['capability-increase', 'advisory-review'],
    addedCapabilities: ['runtime.execute'],
    advisoryIds: ['ADV-1'],
  });

  assert.equal(parsed.release.version, '1.3.0');
  assert.equal(parsed.policy.autoUpdate, true);
  assert.deepEqual(parsed.consentReasons, ['capability-increase', 'advisory-review']);
  assert.deepEqual(parsed.addedCapabilities, ['runtime.execute']);
  assert.deepEqual(parsed.advisoryIds, ['ADV-1']);
});

test('parseAvailableModUpdate keeps consent reasons and capability diff', () => {
  const parsed = parseAvailableModUpdate({
    packageId: 'world.nimi.catalog',
    installedVersion: '1.2.0',
    targetVersion: '1.3.0',
    policy: {
      channel: 'stable',
      autoUpdate: true,
    },
    trustTier: 'verified',
    requiresUserConsent: true,
    consentReasons: ['trust-tier-downgrade', 'capability-increase'],
    addedCapabilities: ['runtime.execute'],
    advisoryIds: [],
  });

  assert.deepEqual(parsed.consentReasons, ['trust-tier-downgrade', 'capability-increase']);
  assert.deepEqual(parsed.addedCapabilities, ['runtime.execute']);
});

test('toCatalogModRow marks nimi-app packages as unsupported in desktop v1', () => {
  const row = toCatalogModRow({
    packageId: 'world.nimi.future-app',
    packageType: 'nimi-app',
    name: 'Future App',
    description: 'Will be supported later',
    latestVersion: '0.9.0',
    latestChannel: 'beta',
    publisher: {
      publisherId: 'third-party',
      displayName: 'Third Party',
      trustTier: 'community',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
    keywords: [],
    tags: [],
  }, {
    isInstalled: false,
    isEnabled: false,
    requiresUserConsent: true,
    consentReasons: ['community-package'],
    addedCapabilities: ['runtime.execute'],
  });

  assert.equal(row.supportedByDesktop, false);
  assert.match(String(row.installDisabledReason), /does not install nimi-app/i);
  assert.equal(row.badge, 'community');
  assert.deepEqual(row.consentReasons, ['community-package']);
  assert.deepEqual(row.addedCapabilities, ['runtime.execute']);
  assert.equal(row.primaryAction, null);
});

test('toCatalogModRow exposes install action for supported remote desktop mods', () => {
  const row = toCatalogModRow({
    packageId: 'world.nimi.remote-catalog',
    packageType: 'desktop-mod',
    name: 'Remote Catalog Mod',
    description: 'Installable from governed catalog',
    latestVersion: '1.0.0',
    latestChannel: 'stable',
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
    keywords: [],
    tags: [],
  }, {
    isInstalled: false,
    isEnabled: false,
  });

  assert.equal(row.visualState, 'available');
  assert.equal(row.primaryAction?.kind, 'install');
});

test('toCatalogModRow prioritizes retry for failed installed mods', () => {
  const row = toCatalogModRow({
    packageId: 'world.nimi.failed',
    packageType: 'desktop-mod',
    name: 'Failed Mod',
    description: 'Broken at startup',
    latestVersion: '1.1.0',
    latestChannel: 'stable',
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
    keywords: [],
    tags: [],
  }, {
    isInstalled: true,
    isEnabled: false,
    runtimeStatus: 'failed',
    runtimeError: 'boom',
    runtimeSourceDir: '/mods/world.nimi.failed',
  });

  assert.equal(row.visualState, 'failed');
  assert.equal(row.primaryAction?.kind, 'retry');
  assert.deepEqual(row.menuActions.map((item) => item.kind), ['uninstall', 'settings', 'open-folder']);
});

test('parseCatalogReleaseRecord keeps reserved nimi-app metadata fields', () => {
  const parsed = parseCatalogReleaseRecord({
    packageId: 'world.nimi.future-app',
    packageType: 'nimi-app',
    version: '0.1.0-beta.1',
    channel: 'beta',
    artifactUrl: 'https://example.com/future-app.zip',
    sha256: 'abc',
    signature: 'sig',
    signerId: 'future.release',
    minDesktopVersion: '0.1.0',
    minHookApiVersion: 'v1',
    capabilities: [],
    requiresReconsentOnCapabilityIncrease: false,
    appMode: 'render-app',
    scopeCatalogVersion: 'v1',
    minRuntimeVersion: '0.1.0',
    publisher: {
      publisherId: 'future',
      displayName: 'Future',
      trustTier: 'community',
    },
    source: {
      repoUrl: 'https://example.com/future',
      releaseTag: 'v0.1.0-beta.1',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
  });

  assert.equal(parsed.appMode, 'render-app');
  assert.equal(parsed.scopeCatalogVersion, 'v1');
  assert.equal(parsed.minRuntimeVersion, '0.1.0');
});
