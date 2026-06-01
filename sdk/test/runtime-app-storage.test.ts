import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiAppRegistryTransport, NimiAppClient } from '../src/app/index.js';
import type {
  NimiAppRegistrySourceRow,
  NimiAppReleaseDescriptorRow,
} from '../src/app/index.js';
import {
  attachRuntimeAppDataStorageRoot,
  attachRuntimeAppStorageRoots,
  resolveRuntimeAppActiveStorageRoots,
  resolveRuntimeAppStorageRoots,
  type RuntimeAppStorageProjection,
} from '../src/runtime/index.js';

const appId = 'nimi.example-app';

function storageProjection(
  overrides: Partial<RuntimeAppStorageProjection> = {},
): RuntimeAppStorageProjection {
  return {
    appId,
    state: 'ready',
    appRoot: '/data/apps/nimi.example-app',
    activeReleaseRoot: '/data/apps/nimi.example-app/releases/1.0.0',
    durableDataRoot: '/data/apps/nimi.example-app/data',
    cacheRoot: '/data/apps/nimi.example-app/cache',
    tempRoot: '/data/apps/nimi.example-app/tmp',
    activeVersion: '1.0.0',
    storagePolicyRef: 'nimi-data-app-roots',
    ...overrides,
  };
}

const appLifecycle = {
  async storage(): Promise<RuntimeAppStorageProjection> {
    return storageProjection();
  },
};

test('resolveRuntimeAppStorageRoots returns Runtime GetAppStorage data/cache/tmp roots', async () => {
  assert.deepEqual(await resolveRuntimeAppStorageRoots({ appLifecycle, appId }), {
    dataRoot: '/data/apps/nimi.example-app/data',
    cacheRoot: '/data/apps/nimi.example-app/cache',
    tempRoot: '/data/apps/nimi.example-app/tmp',
  });
});

test('resolveRuntimeAppActiveStorageRoots returns active release roots only when Runtime projects one', async () => {
  assert.deepEqual(await resolveRuntimeAppActiveStorageRoots({ appLifecycle, appId }), {
    releaseRoot: '/data/apps/nimi.example-app/releases/1.0.0',
    dataRoot: '/data/apps/nimi.example-app/data',
    cacheRoot: '/data/apps/nimi.example-app/cache',
    tempRoot: '/data/apps/nimi.example-app/tmp',
  });

  const installRequiredLifecycle = {
    async storage(): Promise<RuntimeAppStorageProjection> {
      return storageProjection({
        state: 'install_required',
        activeReleaseRoot: undefined,
        activeVersion: undefined,
      });
    },
  };
  assert.equal(
    await resolveRuntimeAppActiveStorageRoots({ appLifecycle: installRequiredLifecycle, appId }),
    undefined,
  );
});

test('attachRuntimeAppDataStorageRoot adds only the Runtime durable data root', async () => {
  assert.deepEqual(await attachRuntimeAppDataStorageRoot({
    appLifecycle,
    appId,
    payload: { threadId: 'thread-1' },
  }), {
    threadId: 'thread-1',
    storageRoot: '/data/apps/nimi.example-app/data',
  });
});

test('attachRuntimeAppStorageRoots adds Runtime data/cache/tmp roots to payloads', async () => {
  assert.deepEqual(await attachRuntimeAppStorageRoots({
    appLifecycle,
    appId,
    payload: { manifestPath: '/tmp/world-tour.json' },
  }), {
    manifestPath: '/tmp/world-tour.json',
    dataRoot: '/data/apps/nimi.example-app/data',
    cacheRoot: '/data/apps/nimi.example-app/cache',
    tempRoot: '/data/apps/nimi.example-app/tmp',
  });
});

test('NimiApp registry status does not project storage roots from install evidence', async () => {
  const client = new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: () => [registryRow()],
    loadReleaseDescriptors: () => [releaseDescriptor()],
    loadInstallEvidence: () => [{
      appId,
      releaseDescriptorRef: `${appId}.descriptor`,
      storagePolicyRef: 'nimi-data-app-roots',
      installedVersion: '1.0.0',
      sha256: 'a'.repeat(64),
      verificationState: 'digest-verified',
    }],
  }));

  const status = await client.status(appId);
  assert.equal(status.launchReadiness, 'ready');
  assert.equal(status.storageRoots, undefined);
});

function registryRow(): NimiAppRegistrySourceRow {
  return {
    appId,
    appKind: 'nimi-app',
    displayName: 'Example App',
    publisher: 'Nimi',
    trustTier: 'nimi-first-party',
    ordinaryVisibility: 'ordinary-visible',
    releaseDescriptorRef: `${appId}.descriptor`,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
    admissionStatus: 'admitted',
  };
}

function releaseDescriptor(): NimiAppReleaseDescriptorRow {
  return {
    descriptorId: `${appId}.descriptor`,
    appId,
    version: '1.0.0',
    descriptorClass: 'bundled-with-nimi',
    sourceKind: 'nimi-bundle',
    sourceRef: 'current-atomic-nimi-release',
    artifactLocator: 'current-nimi-release-bundle',
    digestAlgorithm: 'sha256',
    sha256: 'a'.repeat(64),
    size: '1024',
    provenanceRef: 'nimi-first-party-signature-policy',
    packageKind: 'nimi-app',
    entryRef: `${appId}-runtime-registration`,
    sandboxRef: 'first-party-bundled-app',
    permissionsRef: `${appId}.permission_scope_ref`,
    storagePolicyRef: 'nimi-data-app-roots',
    admissionPath: 'P-NAPP-004',
    mutableSourceAllowed: false,
    installDigestVerificationRequired: 'required',
    sourceRule: 'P-NAPP-004',
  };
}
