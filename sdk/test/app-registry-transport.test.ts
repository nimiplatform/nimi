import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NimiAppRegistryTransportError,
  createNimiAppRegistryTransport,
} from '../src/app/index.js';
import type { NimiAppRegistrySourceRow } from '../src/app/index.js';
import type { NimiAppInstallEvidenceRow, NimiAppReleaseDescriptorRow } from '../src/app/index.js';

const rows: readonly NimiAppRegistrySourceRow[] = [
  {
    appId: 'nimi.avatar',
    appKind: 'nimi-app',
    displayName: 'Avatar',
    publisher: 'nimi-first-party',
    trustTier: 'nimi-first-party',
    ordinaryVisibility: 'hidden-internal',
    releaseDescriptorRef: 'nimi.avatar.bundled-with-nimi',
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-011',
    admissionStatus: 'gated_by_avatar_master_gate',
    detail: 'Avatar master gate remains open',
  },
  {
    appId: 'nimi.example-app',
    appKind: 'nimi-app',
    displayName: 'Example App',
    publisher: 'nimi-first-party',
    trustTier: 'nimi-first-party',
    ordinaryVisibility: 'ordinary-visible',
    releaseDescriptorRef: 'nimi.example-app.bundled-with-nimi',
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-011',
    admissionStatus: 'admitted',
  },
  {
    appId: 'nimi.dev-tool',
    appKind: 'nimi-app',
    displayName: 'Developer Tool',
    publisher: 'nimi-first-party',
    trustTier: 'nimi-first-party',
    ordinaryVisibility: 'developer-only',
    releaseDescriptorRef: 'nimi.dev-tool.bundled-with-nimi',
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-011',
    admissionStatus: 'admitted',
  },
];

const descriptors: readonly NimiAppReleaseDescriptorRow[] = [
  {
    descriptorId: 'nimi.avatar.bundled-with-nimi',
    appId: 'nimi.avatar',
    version: 'bundled-with-current-nimi-release',
    descriptorClass: 'bundled-with-nimi',
    sourceKind: 'nimi-bundle',
    sourceRef: 'current-atomic-nimi-release',
    artifactLocator: 'current-nimi-release-bundle',
    digestAlgorithm: 'sha256',
    sha256: 'avatar-sha',
    size: '100',
    provenanceRef: 'nimi-first-party-signature-policy',
    packageKind: 'nimi-app',
    entryRef: 'avatar-runtime-registration',
    sandboxRef: 'first-party-bundled-app',
    permissionsRef: 'nimi.avatar.permission_scope_ref',
    storagePolicyRef: 'nimi-data-app-roots',
    admissionPath: 'first-party-bundled-release',
    mutableSourceAllowed: false,
    installDigestVerificationRequired: 'inherited_from_atomic_bundle',
    sourceRule: 'P-NAPP-014',
  },
  {
    descriptorId: 'nimi.example-app.bundled-with-nimi',
    appId: 'nimi.example-app',
    version: 'bundled-with-current-nimi-release',
    descriptorClass: 'bundled-with-nimi',
    sourceKind: 'nimi-bundle',
    sourceRef: 'current-atomic-nimi-release',
    artifactLocator: 'current-nimi-release-bundle',
    digestAlgorithm: 'sha256',
    sha256: 'example-app-sha',
    size: '200',
    provenanceRef: 'nimi-first-party-signature-policy',
    packageKind: 'nimi-app',
    entryRef: 'example-app-runtime-registration',
    sandboxRef: 'first-party-bundled-app',
    permissionsRef: 'nimi.example-app.permission_scope_ref',
    storagePolicyRef: 'nimi-data-app-roots',
    admissionPath: 'first-party-bundled-release',
    mutableSourceAllowed: false,
    installDigestVerificationRequired: 'inherited_from_atomic_bundle',
    sourceRule: 'P-NAPP-014',
  },
  {
    descriptorId: 'nimi.dev-tool.bundled-with-nimi',
    appId: 'nimi.dev-tool',
    version: 'bundled-with-current-nimi-release',
    descriptorClass: 'bundled-with-nimi',
    sourceKind: 'nimi-bundle',
    sourceRef: 'current-atomic-nimi-release',
    artifactLocator: 'current-nimi-release-bundle',
    digestAlgorithm: 'sha256',
    sha256: 'dev-tool-sha',
    size: '300',
    provenanceRef: 'nimi-first-party-signature-policy',
    packageKind: 'nimi-app',
    entryRef: 'dev-tool-runtime-registration',
    sandboxRef: 'first-party-bundled-app',
    permissionsRef: 'nimi.dev-tool.permission_scope_ref',
    storagePolicyRef: 'nimi-data-app-roots',
    admissionPath: 'first-party-bundled-release',
    mutableSourceAllowed: false,
    installDigestVerificationRequired: 'inherited_from_atomic_bundle',
    sourceRule: 'P-NAPP-011',
  },
];

const verifiedExampleAppEvidence: readonly NimiAppInstallEvidenceRow[] = [
  {
    appId: 'nimi.example-app',
    releaseDescriptorRef: 'nimi.example-app.bundled-with-nimi',
    storagePolicyRef: 'nimi-data-app-roots',
    installedVersion: 'bundled-with-current-nimi-release',
    sha256: 'example-app-sha',
    verificationState: 'digest-verified',
    storageRoots: {
      releaseRoot: '/tmp/nimi/apps/nimi.example-app/releases/bundled-with-current-nimi-release',
      dataRoot: '/tmp/nimi/apps/nimi.example-app/data',
      cacheRoot: '/tmp/nimi/apps/nimi.example-app/cache',
      tempRoot: '/tmp/nimi/apps/nimi.example-app/tmp',
    },
  },
];

describe('Nimi App registry transport', () => {
  it('projects only ordinary-visible resolved source rows into canonical SDK rows', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows, loadReleaseDescriptors: () => descriptors });
    const registryRows = await transport.list();
    assert.equal(registryRows.length, 1);
    assert.equal(registryRows[0]!.appKind, 'nimi-app');
    assert.equal(registryRows[0]!.displayName, 'Example App');
    assert.equal(registryRows[0]!.releaseDescriptorRef, 'nimi.example-app.bundled-with-nimi');
  });

  it('blocks Avatar status from the ordinary app surface', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows, loadReleaseDescriptors: () => descriptors });
    await assert.rejects(transport.status('nimi.avatar'), NimiAppRegistryTransportError);
  });

  it('maps admitted app to install-required by default without claiming readiness', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows, loadReleaseDescriptors: () => descriptors });
    const status = await transport.status('nimi.example-app');
    assert.equal(status.launchReadiness, 'install-required');
  });

  it('maps digest-verified install evidence to ready status', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => descriptors,
      loadInstallEvidence: () => verifiedExampleAppEvidence,
    });
    const status = await transport.status('nimi.example-app');
    assert.equal(status.launchReadiness, 'ready');
    assert.equal(status.verificationState, 'digest-verified');
    assert.equal(status.storageRoots, undefined);
  });

  it('is a pure read-projection transport — no lifecycle mutation methods', () => {
    // T4 Fork B: install / update / uninstall / launch / healthRepair /
    // subscribe are retired from the registry transport. Lifecycle mutation
    // is owned by the runtime-mediated `runtime.appLifecycle` surface.
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => descriptors,
    }) as unknown as Record<string, unknown>;
    for (const retired of ['install', 'update', 'uninstall', 'launch', 'healthRepair', 'subscribe']) {
      assert.equal(
        typeof transport[retired],
        'undefined',
        `registry transport must not expose the retired "${retired}" stub`,
      );
    }
  });

  it('blocks hidden rows from ordinary get projection', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows, loadReleaseDescriptors: () => descriptors });
    await assert.rejects(transport.get('nimi.avatar'), NimiAppRegistryTransportError);
  });

  it('blocks developer-only apps from ordinary app projection', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows, loadReleaseDescriptors: () => descriptors });
    assert.deepEqual((await transport.list()).map((row) => row.appId), ['nimi.example-app']);
    await assert.rejects(transport.get('nimi.dev-tool'), NimiAppRegistryTransportError);
    await assert.rejects(transport.status('nimi.dev-tool'), NimiAppRegistryTransportError);
  });

  it('does not let host install evidence mark ready without matching descriptor digest', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => descriptors,
      loadInstallEvidence: () => [{
        ...verifiedExampleAppEvidence[0]!,
        sha256: 'wrong-sha',
      }],
    });
    const status = await transport.status('nimi.example-app');
    assert.equal(status.launchReadiness, 'install-required');
  });

  it('does not require host install evidence storage roots for readiness', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => descriptors,
      loadInstallEvidence: () => [{
        ...verifiedExampleAppEvidence[0]!,
        storageRoots: undefined,
      }],
    });
    const status = await transport.status('nimi.example-app');
    assert.equal(status.launchReadiness, 'ready');
    assert.equal(status.storageRoots, undefined);
  });

  it('does not let host install evidence mark ready without installed version', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => descriptors,
      loadInstallEvidence: () => [{
        ...verifiedExampleAppEvidence[0]!,
        installedVersion: undefined,
      }],
    });
    const status = await transport.status('nimi.example-app');
    assert.equal(status.launchReadiness, 'install-required');
  });

  it('maps digest-verified stale version evidence to update-required, not ready', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => descriptors,
      loadInstallEvidence: () => [{
        ...verifiedExampleAppEvidence[0]!,
        installedVersion: 'older-version',
      }],
    });
    const status = await transport.status('nimi.example-app');
    assert.equal(status.launchReadiness, 'update-required');
  });

  it('excludes external descriptors with mutable source refs from ordinary projection', async () => {
    for (const descriptor of [
      { sourceKind: 'github-release' as const, sourceRef: 'git+https://github.com/org/repo#main' },
      { sourceKind: 'github-release' as const, sourceRef: 'v1.2.3' },
      { sourceKind: 'github-release' as const, sourceRef: 'github.com/org/repo/releases/download/latest/app.tgz' },
      { sourceKind: 'github-release' as const, sourceRef: 'github.com/org/repo/releases/download/main/app.tgz' },
      { sourceKind: 'npm-package' as const, sourceRef: 'pkg@beta' },
      { sourceKind: 'npm-package' as const, sourceRef: 'pkg@1.2' },
    ]) {
      const transport = createNimiAppRegistryTransport({
        loadRows: () => [{
          ...rows[1]!,
          appId: 'community.clock',
          releaseDescriptorRef: 'community.clock.v1',
        }],
        loadReleaseDescriptors: () => [{
          ...descriptors[1]!,
          descriptorId: 'community.clock.v1',
          appId: 'community.clock',
          descriptorClass: 'external-immutable-artifact',
          sourceKind: descriptor.sourceKind,
          sourceRef: descriptor.sourceRef,
        }],
      });
      assert.deepEqual(await transport.list(), []);
      await assert.rejects(transport.get('community.clock'), NimiAppRegistryTransportError);
      await assert.rejects(transport.status('community.clock'), NimiAppRegistryTransportError);
    }
  });

  it('fails closed when app row is absent', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows, loadReleaseDescriptors: () => descriptors });
    await assert.rejects(transport.status('missing.app'), NimiAppRegistryTransportError);
  });

  it('fails closed when registry source is not an array', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => 'not-an-array' as unknown as readonly NimiAppRegistrySourceRow[],
      loadReleaseDescriptors: () => descriptors,
    });
    await assert.rejects(transport.list(), NimiAppRegistryTransportError);
  });
});
