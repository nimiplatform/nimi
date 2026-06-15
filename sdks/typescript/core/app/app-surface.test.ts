import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createNimiAIScopeRef,
  previewNimiAIProfileApply,
  type NimiAICapabilityRequirementDeclaration,
} from '../ai/index';
import {
  NimiAppClient,
  PermissionClient,
  NimiAppRegistryTransportError,
  createAppScopeRef,
  createNimiAppClient,
  createNimiAppRegistryTransport,
  createPermissionClient,
  createScopeCatalogModule,
  isAdmittedNimiFirstRunLocalBaseline,
  loadNimiAppAIProfileFactoryCatalog,
  loadNimiAppRegistryRows,
  loadNimiAppReleaseDescriptorRows,
  parseNimiAppAccountInventoryRecord,
  parseNimiAppBridgeProjection,
  parseOptionalNimiAppAccountInventoryRecord,
  selectNimiAppFactoryAIProfileForFirstRun,
  type GrantSpec,
  type GrantStatus,
  type NimiAppInventoryEntry,
  type NimiAppRow,
  type NimiAppRegistrySourceRow,
  type NimiAppReleaseDescriptorRow,
  type NimiAppScopeRef,
  type NimiAppStatus,
  type NimiAppTransport,
  type NimiAppPackageReadinessRow,
  type NimiAppLocalAdoptionRow,
  type PermissionGrantEvent,
  type PermissionStatusSnapshot,
  type PermissionTransport,
  type NimiAppAIProfileFactoryRow,
  type NimiAppAccountInventoryRecord,
} from './index';

const appRow: NimiAppRow = {
  appId: 'nimi.example-app',
  appKind: 'nimi-app',
  displayName: 'Example App',
  trustTier: 'nimi-first-party',
  publisher: 'Nimi',
  aiProfileSelectionRef: 'local-standard',
  capabilitySet: ['text.generate'],
  releaseDescriptorRef: 'nimi.example-app.bundled',
  installStoragePolicyRef: 'nimi-data-app-roots',
  sourceRule: 'P-NAPP-004',
};

const readyPackage: NimiAppPackageReadinessRow = {
  appId: 'nimi.example-app',
  releaseDescriptorRef: 'nimi.example-app.bundled-with-nimi',
  storagePolicyRef: 'nimi-data-app-roots',
  expectedVersion: 'bundled-with-current-nimi-release',
  activeVersion: 'bundled-with-current-nimi-release',
  installedVersion: 'bundled-with-current-nimi-release',
  verificationState: 'bundled-source',
  state: 'ready',
};

function inventoryEntry(row: NimiAppRow = appRow): NimiAppInventoryEntry {
  return {
    appId: row.appId,
    displayName: row.displayName,
    appKind: row.appKind,
    publisher: row.publisher,
    aiProfileSelectionRef: row.aiProfileSelectionRef,
    releaseDescriptorRef: row.releaseDescriptorRef,
    installStoragePolicyRef: row.installStoragePolicyRef,
    trustTier: row.trustTier,
    capabilitySet: [...row.capabilitySet],
    sources: {
      catalog: { status: 'present', value: row },
      account: { status: 'absent' },
      local: { status: 'absent' },
      packageReadiness: { status: 'absent' },
    },
    installState: 'not-installed',
    openReadiness: 'install-required',
    activeJobs: [],
    nextActions: [],
  };
}

function registryRow(overrides: Partial<NimiAppRegistrySourceRow> = {}): NimiAppRegistrySourceRow {
  const appId = overrides.appId ?? 'nimi.example-app';
  const releaseDescriptorRef = overrides.releaseDescriptorRef ?? `${appId}.bundled-with-nimi`;
  return {
    appId,
    appKind: 'nimi-app',
    displayName: 'Example App',
    publisher: 'Nimi',
    trustTier: 'nimi-first-party',
    ordinaryVisibility: 'ordinary-visible',
    aiProfileSelectionRef: 'local-standard',
    capabilitySet: ['text.generate'],
    releaseDescriptorRef,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
    admissionStatus: 'admitted',
    installedVersion: '1.0.0',
    availableVersion: '1.0.1',
    ...overrides,
  };
}

function releaseDescriptor(overrides: Partial<NimiAppReleaseDescriptorRow> = {}): NimiAppReleaseDescriptorRow {
  const appId = overrides.appId ?? 'nimi.example-app';
  return {
    descriptorId: overrides.descriptorId ?? `${appId}.bundled-with-nimi`,
    appId,
    version: '1.0.0',
    descriptorClass: 'bundled-with-nimi',
    sourceKind: 'nimi-bundle',
    sourceRef: 'nimi-release',
    artifactLocator: `bundle:${appId}`,
    digestAlgorithm: 'sha256',
    sha256: 'abc',
    size: '42',
    provenanceRef: 'provenance:nimi',
    packageKind: 'nimi-app',
    entryRef: 'index.html',
    sandboxRef: `sandbox:${appId}`,
    permissionsRef: `permissions:${appId}`,
    storagePolicyRef: 'nimi-data-app-roots',
    admissionPath: '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml',
    mutableSourceAllowed: false,
    installDigestVerificationRequired: 'required',
    sourceRule: 'P-NAPP-004',
    ...overrides,
  };
}

function readinessRow(
  appId: string,
  state: NimiAppPackageReadinessRow['state'],
  overrides: Partial<NimiAppPackageReadinessRow> = {},
): NimiAppPackageReadinessRow {
  return {
    appId,
    releaseDescriptorRef: `${appId}.bundled-with-nimi`,
    storagePolicyRef: 'nimi-data-app-roots',
    expectedVersion: '1.0.0',
    activeVersion: state === 'install_required' ? undefined : '1.0.0',
    installedVersion: state === 'install_required' ? undefined : '1.0.0',
    verificationState: state === 'ready' ? 'digest-verified' : undefined,
    state,
    ...overrides,
  };
}

function accountInventoryRecord(
  rows: NimiAppAccountInventoryRecord['apps'],
): NimiAppAccountInventoryRecord {
  return {
    schemaVersion: 2,
    accountId: 'account-1',
    updatedAt: '2026-06-05T00:00:00.000Z',
    apps: rows,
  };
}

function accountInventoryRow(
  overrides: Partial<NimiAppAccountInventoryRecord['apps'][number]> = {},
): NimiAppAccountInventoryRecord['apps'][number] {
  return {
    appId: 'nimi.example-app',
    accountState: 'verified',
    installState: 'not-installed',
    dataPolicy: 'keep_on_uninstall',
    source: 'account',
    ...overrides,
  };
}

function localAdoptionRow(overrides: Partial<NimiAppLocalAdoptionRow> = {}): NimiAppLocalAdoptionRow {
  const appId = overrides.appId ?? 'nimi.example-app';
  return {
    appId,
    rootPath: `/apps/${appId}`,
    manifestPath: `/apps/${appId}/nimi.app.yaml`,
    displayName: 'Example Local App',
    version: '1.0.0',
    entryRef: `app://${appId}/main`,
    permissionScopeRef: 'account:account.session.read',
    storagePolicyRef: 'nimi-data-app-roots',
    state: 'adopted',
    trust: 'explicit-local',
    ...overrides,
  };
}

class StubAppTransport implements NimiAppTransport {
  constructor(private readonly behavior: {
    readonly list?: readonly NimiAppInventoryEntry[] | Error | null;
    readonly get?: NimiAppInventoryEntry | Error | null;
    readonly status?: NimiAppStatus | Error | null;
  } = {}) {}

  async list(): Promise<readonly NimiAppInventoryEntry[]> {
    if (this.behavior.list instanceof Error) throw this.behavior.list;
    if (this.behavior.list === null) return null as unknown as readonly NimiAppInventoryEntry[];
    return this.behavior.list ?? [inventoryEntry()];
  }

  async get(appId: string): Promise<NimiAppInventoryEntry> {
    if (this.behavior.get instanceof Error) throw this.behavior.get;
    if (this.behavior.get === null) return null as unknown as NimiAppInventoryEntry;
    return this.behavior.get ?? inventoryEntry({ ...appRow, appId });
  }

  async status(appId: string): Promise<NimiAppStatus> {
    if (this.behavior.status instanceof Error) throw this.behavior.status;
    if (this.behavior.status === null) return null as unknown as NimiAppStatus;
    return this.behavior.status ?? { appId, launchReadiness: 'install-required' };
  }
}

const scopeRef: NimiAppScopeRef = { kind: 'app', ownerId: 'tester.app', surfaceId: 'settings' };
const permissionScope = {
  appId: 'tester.app',
  scopeFamily: 'account' as const,
  scopeName: 'account.read' as const,
};

function grantStatus(state: GrantStatus['state'] = 'granted', grantId = 'grant-1'): GrantStatus {
  return {
    scopeRef,
    grant: { grantId, permissionScope, subjectUserId: 'user-1' },
    state,
  };
}

class StubPermissionTransport implements PermissionTransport {
  readonly calls: string[] = [];

  constructor(private readonly behavior: {
    readonly list?: readonly GrantStatus[] | Error | null;
    readonly get?: GrantStatus | Error | null;
    readonly request?: GrantStatus | Error | null;
    readonly revoke?: GrantStatus | Error | null;
    readonly status?: PermissionStatusSnapshot | Error | null;
    readonly subscribe?: PermissionGrantEvent | Error | null;
  } = {}) {}

  async list(inputScopeRef: NimiAppScopeRef): Promise<readonly GrantStatus[]> {
    this.calls.push(`list:${inputScopeRef.ownerId}`);
    if (this.behavior.list instanceof Error) throw this.behavior.list;
    if (this.behavior.list === null) return null as unknown as readonly GrantStatus[];
    return this.behavior.list ?? [grantStatus()];
  }

  async get(inputScopeRef: NimiAppScopeRef, grantId: string): Promise<GrantStatus> {
    this.calls.push(`get:${inputScopeRef.ownerId}:${grantId}`);
    if (this.behavior.get instanceof Error) throw this.behavior.get;
    if (this.behavior.get === null) return null as unknown as GrantStatus;
    return this.behavior.get ?? grantStatus('granted', grantId);
  }

  async request(inputScopeRef: NimiAppScopeRef): Promise<GrantStatus> {
    this.calls.push(`request:${inputScopeRef.ownerId}`);
    if (this.behavior.request instanceof Error) throw this.behavior.request;
    if (this.behavior.request === null) return null as unknown as GrantStatus;
    return this.behavior.request ?? { ...grantStatus('pending'), scopeRef: inputScopeRef };
  }

  async revoke(inputScopeRef: NimiAppScopeRef, grantId: string): Promise<GrantStatus> {
    this.calls.push(`revoke:${inputScopeRef.ownerId}:${grantId}`);
    if (this.behavior.revoke instanceof Error) throw this.behavior.revoke;
    if (this.behavior.revoke === null) return null as unknown as GrantStatus;
    return this.behavior.revoke ?? grantStatus('revoked', grantId);
  }

  async status(inputScopeRef: NimiAppScopeRef): Promise<PermissionStatusSnapshot> {
    this.calls.push(`status:${inputScopeRef.ownerId}`);
    if (this.behavior.status instanceof Error) throw this.behavior.status;
    if (this.behavior.status === null) return null as unknown as PermissionStatusSnapshot;
    return this.behavior.status ?? { scopeRef: inputScopeRef, grants: [grantStatus()] };
  }

  subscribe(inputScopeRef: NimiAppScopeRef, callback: (event: PermissionGrantEvent) => void): () => void {
    this.calls.push(`subscribe:${inputScopeRef.ownerId}`);
    if (this.behavior.subscribe instanceof Error) throw this.behavior.subscribe;
    callback(this.behavior.subscribe ?? { scopeRef: inputScopeRef, grant: grantStatus() });
    return () => {
      this.calls.push(`unsubscribe:${inputScopeRef.ownerId}`);
    };
  }
}

const grantSpec: GrantSpec = {
  permissionScope,
  subjectUserId: 'user-1',
  reason: 'settings permission diagnostics',
};

describe('vNext app surface', () => {
  it('reads canonical Nimi app rows and status without lifecycle mutations', async () => {
    const client = createNimiAppClient(new StubAppTransport());
    assert.equal(client instanceof NimiAppClient, true);
    assert.equal((await client.list())[0]?.appKind, 'nimi-app');
    assert.equal((await client.get('nimi.example-app')).appId, 'nimi.example-app');
    assert.equal((await client.status('nimi.example-app')).launchReadiness, 'install-required');
    for (const retired of ['install', 'update', 'uninstall', 'launch', 'healthRepair', 'subscribe']) {
      assert.equal(typeof (client as unknown as Record<string, unknown>)[retired], 'undefined');
    }
  });

  it('parses Runtime account app-inventory projections with canonical SDK app names', () => {
    const parsed: NimiAppAccountInventoryRecord = parseNimiAppAccountInventoryRecord({
      schemaVersion: 2,
      accountId: 'account-1',
      updatedAt: '2026-06-05T00:00:00.000Z',
      apps: [{
        appId: 'nimi.example-app',
        accountState: 'verified',
        installState: 'not-installed',
        lastOpenedAt: '2026-06-05T00:01:00.000Z',
        dataPolicy: 'keep_on_uninstall',
        verifiedAt: '2026-06-04T00:00:00.000Z',
        source: 'account',
      }],
    });

    assert.equal(parsed.accountId, 'account-1');
    assert.equal(parsed.apps[0]?.appId, 'nimi.example-app');
    assert.equal(parsed.apps[0]?.accountState, 'verified');
    assert.equal(parsed.apps[0]?.installState, 'not-installed');
    assert.equal(parseOptionalNimiAppAccountInventoryRecord(null), null);
    assert.throws(
      () => parseNimiAppAccountInventoryRecord({
        schemaVersion: 2,
        accountId: 'account-1',
        updatedAt: '2026-06-05T00:00:00.000Z',
        apps: [{
          appId: 'nimi.example-app',
          accountState: 'unknown',
          installState: 'not-installed',
          dataPolicy: 'keep_on_uninstall',
        }],
      }),
      (error: unknown) => (error as { code?: string }).code === 'SDK_APP_ACCOUNT_INVENTORY_CONTRACT_INVALID',
    );
    assert.throws(
      () => parseNimiAppAccountInventoryRecord({
        schemaVersion: 2,
        accountId: 'account-1',
        updatedAt: '2026-06-05T00:00:00.000Z',
        apps: [
          accountInventoryRow(),
          accountInventoryRow({ installState: 'installed' }),
        ],
      }),
      (error: unknown) => (error as { code?: string }).code === 'SDK_APP_ACCOUNT_INVENTORY_CONTRACT_INVALID',
    );
  });

  it('projects generated App registry rows through ordinary-visible read transport', async () => {
    const generated = createNimiAppRegistryTransport({
      loadRows: loadNimiAppRegistryRows,
      loadReleaseDescriptors: loadNimiAppReleaseDescriptorRows,
    });
    assert.deepEqual(await generated.list(), []);
    assert.equal((await generated.status('nimi.avatar')).launchReadiness, 'blocked-by-master-gate');

    const admitted = createNimiAppRegistryTransport({
      loadRows: () => [{
        ...loadNimiAppRegistryRows()[0]!,
        appId: 'nimi.example-app',
        displayName: 'Example App',
        ordinaryVisibility: 'ordinary-visible',
        admissionStatus: 'admitted',
        releaseDescriptorRef: 'nimi.example-app.bundled-with-nimi',
      }],
      loadReleaseDescriptors: () => [{
        ...loadNimiAppReleaseDescriptorRows()[0]!,
        descriptorId: 'nimi.example-app.bundled-with-nimi',
        appId: 'nimi.example-app',
      }],
      loadPackageReadiness: () => readyPackage,
    });
    assert.equal((await admitted.list())[0]?.appId, 'nimi.example-app');
    assert.equal((await admitted.status('nimi.example-app')).launchReadiness, 'ready');
  });

  it('fails closed on registry source and package readiness boundary errors', async () => {
    assert.throws(
      () => createNimiAppRegistryTransport({
        loadRows: undefined as never,
        loadReleaseDescriptors: () => [],
      }),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError && error.code === 'invalid-dependency',
    );
    assert.throws(
      () => createNimiAppRegistryTransport({
        loadRows: () => [],
        loadReleaseDescriptors: undefined as never,
      }),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError && error.code === 'invalid-dependency',
    );

    await assert.rejects(
      createNimiAppRegistryTransport({
        loadRows: () => ({ appId: 'not-an-array' }) as never,
        loadReleaseDescriptors: () => [],
      }).list(),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError && error.code === 'source-error',
    );
    await assert.rejects(
      createNimiAppRegistryTransport({
        loadRows: () => {
          throw new Error('registry disk read failed');
        },
        loadReleaseDescriptors: () => [],
      }).list(),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError
        && error.code === 'source-error'
        && error.cause instanceof Error,
    );
    await assert.rejects(
      createNimiAppRegistryTransport({
        loadRows: () => [registryRow()],
        loadReleaseDescriptors: () => null as never,
      }).get('nimi.example-app'),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError && error.code === 'source-error',
    );
    await assert.rejects(
      createNimiAppRegistryTransport({
        loadRows: () => [registryRow()],
        loadReleaseDescriptors: () => {
          throw new Error('descriptor projection failed');
        },
      }).status('nimi.example-app'),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError
        && error.code === 'source-error'
        && error.cause instanceof Error,
    );
    await assert.rejects(
      createNimiAppRegistryTransport({
        loadRows: () => [registryRow()],
        loadReleaseDescriptors: () => [releaseDescriptor()],
        loadPackageReadiness: () => readinessRow('other.app', 'ready'),
      }).status('nimi.example-app'),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError && error.code === 'source-error',
    );
    await assert.rejects(
      createNimiAppRegistryTransport({
        loadRows: () => [registryRow()],
        loadReleaseDescriptors: () => [releaseDescriptor()],
        loadPackageReadiness: () => {
          throw new Error('readiness unavailable');
        },
      }).status('nimi.example-app'),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError
        && error.code === 'source-error'
        && error.cause instanceof Error,
    );
  });

  it('projects registry status for readiness and non-launchable admitted rows', async () => {
    const rows = [
      registryRow({ appId: 'nimi.ready', releaseDescriptorRef: 'nimi.ready.desc' }),
      registryRow({ appId: 'nimi.install', releaseDescriptorRef: 'nimi.install.desc' }),
      registryRow({ appId: 'nimi.update', releaseDescriptorRef: 'nimi.update.desc' }),
      registryRow({ appId: 'nimi.repair', releaseDescriptorRef: 'nimi.repair.desc' }),
      registryRow({ appId: 'nimi.blocked', releaseDescriptorRef: 'nimi.blocked.desc' }),
      registryRow({
        appId: 'nimi.master-gated',
        releaseDescriptorRef: 'nimi.master-gated.desc',
        admissionStatus: 'gated_by_avatar_master_gate',
      }),
      registryRow({
        appId: 'nimi.deferred',
        releaseDescriptorRef: 'nimi.deferred.desc',
        admissionStatus: 'deferred',
      }),
      registryRow({
        appId: 'nimi.hidden',
        releaseDescriptorRef: 'nimi.hidden.desc',
        ordinaryVisibility: 'developer-only',
      }),
      registryRow({
        appId: 'nimi.mutable',
        releaseDescriptorRef: 'nimi.mutable.desc',
      }),
    ];
    const descriptors = [
      releaseDescriptor({ appId: 'nimi.ready', descriptorId: 'nimi.ready.desc' }),
      releaseDescriptor({ appId: 'nimi.install', descriptorId: 'nimi.install.desc' }),
      releaseDescriptor({ appId: 'nimi.update', descriptorId: 'nimi.update.desc' }),
      releaseDescriptor({ appId: 'nimi.repair', descriptorId: 'nimi.repair.desc' }),
      releaseDescriptor({ appId: 'nimi.blocked', descriptorId: 'nimi.blocked.desc' }),
      releaseDescriptor({ appId: 'nimi.master-gated', descriptorId: 'nimi.master-gated.desc' }),
      releaseDescriptor({ appId: 'nimi.deferred', descriptorId: 'nimi.deferred.desc' }),
      releaseDescriptor({ appId: 'nimi.hidden', descriptorId: 'nimi.hidden.desc' }),
      releaseDescriptor({
        appId: 'nimi.mutable',
        descriptorId: 'nimi.mutable.desc',
        descriptorClass: 'external-immutable-artifact',
        sourceKind: 'npm-package',
        sourceRef: '@nimi/mutable-app@latest',
        artifactLocator: 'npm:@nimi/mutable-app',
      }),
    ];
    const readiness = new Map<string, NimiAppPackageReadinessRow | undefined>([
      ['nimi.ready', readinessRow('nimi.ready', 'ready')],
      ['nimi.update', readinessRow('nimi.update', 'update_required')],
      ['nimi.repair', readinessRow('nimi.repair', 'repair_required', { detail: 'storage digest mismatch' })],
      ['nimi.blocked', readinessRow('nimi.blocked', 'blocked')],
    ]);
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => descriptors,
      loadPackageReadiness: (appId) => readiness.get(appId),
    });

    assert.deepEqual((await transport.list()).map((row) => row.appId), [
      'nimi.blocked',
      'nimi.install',
      'nimi.ready',
      'nimi.repair',
      'nimi.update',
    ]);
    await assert.rejects(
      transport.get('nimi.mutable'),
      (error: unknown) =>
        error instanceof NimiAppRegistryTransportError && error.code === 'missing-registry-row',
    );

    const ready = await transport.status('nimi.ready');
    assert.equal(ready.appId, 'nimi.ready');
    assert.equal(ready.launchReadiness, 'ready');
    assert.equal(ready.releaseDescriptorRef, 'nimi.ready.desc');
    assert.equal(ready.installStoragePolicyRef, 'nimi-data-app-roots');
    assert.equal(ready.verificationState, 'digest-verified');
    assert.equal(ready.installedVersion, '1.0.0');
    assert.equal(ready.availableVersion, '1.0.1');
    assert.equal((await transport.status('nimi.install')).launchReadiness, 'install-required');
    assert.equal((await transport.status('nimi.install')).verificationState, 'not-installed');
    assert.equal(
      (await transport.status('nimi.install')).detail,
      'descriptor resolved, but no Runtime package readiness projection exists',
    );
    assert.equal((await transport.status('nimi.update')).launchReadiness, 'update-required');
    assert.equal((await transport.status('nimi.update')).verificationState, 'blocked');
    assert.equal((await transport.status('nimi.repair')).detail, 'storage digest mismatch');
    assert.equal((await transport.status('nimi.blocked')).launchReadiness, 'repair-required');
    assert.equal((await transport.status('nimi.blocked')).detail, 'Runtime package readiness requires repair');
    assert.equal((await transport.status('nimi.master-gated')).launchReadiness, 'blocked-by-master-gate');
    assert.equal((await transport.status('nimi.master-gated')).detail, 'app is blocked by master product gate');
    assert.equal((await transport.status('nimi.deferred')).launchReadiness, 'unsupported');
    assert.equal(
      (await transport.status('nimi.deferred')).detail,
      'registry row is not installable: app-not-admitted',
    );
    assert.equal((await transport.status('nimi.hidden')).launchReadiness, 'unsupported');
    assert.equal(
      (await transport.status('nimi.hidden')).detail,
      'registry row is not installable: app-not-ordinary-visible',
    );
    assert.equal((await transport.status('nimi.mutable')).launchReadiness, 'unsupported');
    assert.equal(
      (await transport.status('nimi.mutable')).detail,
      'registry row is not installable: release-descriptor-invalid-for-registry-row',
    );
  });

  it('does not project open from package readiness without launchable account inventory', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => [registryRow()],
      loadReleaseDescriptors: () => [releaseDescriptor()],
      loadPackageReadiness: () => readyPackage,
    });

    const [entry] = await transport.list();
    assert.equal(entry?.openReadiness, 'sign-in-required');
    assert.equal(entry?.installState, 'unknown');
    assert.deepEqual(entry?.nextActions, ['sign-in']);
  });

  it('requires account materialization as well as package readiness before exposing open', async () => {
    const notInstalled = createNimiAppRegistryTransport({
      loadRows: () => [registryRow()],
      loadReleaseDescriptors: () => [releaseDescriptor()],
      loadAccountInventory: () => accountInventoryRecord([accountInventoryRow()]),
      loadPackageReadiness: () => readyPackage,
    });
    const [notInstalledEntry] = await notInstalled.list();
    assert.equal(notInstalledEntry?.openReadiness, 'install-required');
    assert.equal(notInstalledEntry?.installState, 'not-installed');
    assert.deepEqual(notInstalledEntry?.nextActions, ['install']);

    const installedButNoPackage = createNimiAppRegistryTransport({
      loadRows: () => [registryRow()],
      loadReleaseDescriptors: () => [releaseDescriptor()],
      loadAccountInventory: () => accountInventoryRecord([accountInventoryRow({ installState: 'installed' })]),
    });
    const [installedButNoPackageEntry] = await installedButNoPackage.list();
    assert.equal(installedButNoPackageEntry?.openReadiness, 'install-required');
    assert.equal(installedButNoPackageEntry?.installState, 'installed');
    assert.equal(installedButNoPackageEntry?.nextActions.includes('open'), false);

    const ready = createNimiAppRegistryTransport({
      loadRows: () => [registryRow()],
      loadReleaseDescriptors: () => [releaseDescriptor()],
      loadAccountInventory: () => accountInventoryRecord([accountInventoryRow({ installState: 'installed' })]),
      loadPackageReadiness: () => readyPackage,
    });
    const [readyEntry] = await ready.list();
    assert.equal(readyEntry?.openReadiness, 'ready');
    assert.equal(readyEntry?.installState, 'installed');
    assert.equal(readyEntry?.nextActions.includes('open'), true);
    assert.equal(readyEntry?.nextActions.includes('uninstall'), true);
  });

  it('does not expose lifecycle actions for non-launchable account inventory rows', async () => {
    const disabledCatalog = createNimiAppRegistryTransport({
      loadRows: () => [registryRow()],
      loadReleaseDescriptors: () => [releaseDescriptor()],
      loadAccountInventory: () => accountInventoryRecord([
        accountInventoryRow({ accountState: 'disabled', installState: 'not-installed' }),
      ]),
      loadPackageReadiness: () => readyPackage,
    });
    const [disabledCatalogEntry] = await disabledCatalog.list();
    assert.equal(disabledCatalogEntry?.openReadiness, 'unsupported');
    assert.equal(disabledCatalogEntry?.nextActions.includes('install'), false);

    const disabledAccountOnly = createNimiAppRegistryTransport({
      loadRows: () => [],
      loadReleaseDescriptors: () => [],
      loadAccountInventory: () => accountInventoryRecord([
        accountInventoryRow({ accountState: 'revoked', installState: 'not-installed' }),
      ]),
    });
    const [disabledAccountOnlyEntry] = await disabledAccountOnly.list();
    assert.equal(disabledAccountOnlyEntry?.openReadiness, 'unsupported');
    assert.equal(disabledAccountOnlyEntry?.nextActions.includes('connect-local'), false);

    const disabledInstalled = createNimiAppRegistryTransport({
      loadRows: () => [registryRow()],
      loadReleaseDescriptors: () => [releaseDescriptor()],
      loadAccountInventory: () => accountInventoryRecord([
        accountInventoryRow({ accountState: 'disabled', installState: 'installed' }),
      ]),
      loadPackageReadiness: () => readyPackage,
    });
    const [disabledInstalledEntry] = await disabledInstalled.list();
    assert.equal(disabledInstalledEntry?.openReadiness, 'unsupported');
    assert.equal(disabledInstalledEntry?.nextActions.includes('uninstall'), false);
  });

  it('requires account adopted-local state before opening local adoption entries', async () => {
    const localWithoutAccount = createNimiAppRegistryTransport({
      loadRows: () => [],
      loadReleaseDescriptors: () => [],
      loadLocalAdoptions: () => [localAdoptionRow()],
    });
    const [signInRequired] = await localWithoutAccount.list();
    assert.equal(signInRequired?.openReadiness, 'sign-in-required');
    assert.equal(signInRequired?.installState, 'adopted-local');
    assert.deepEqual([...(signInRequired?.nextActions ?? [])].sort(), ['remove-local-adoption', 'sign-in'].sort());

    const localWithAccount = createNimiAppRegistryTransport({
      loadRows: () => [],
      loadReleaseDescriptors: () => [],
      loadLocalAdoptions: () => [localAdoptionRow()],
      loadAccountInventory: () => accountInventoryRecord([accountInventoryRow({ installState: 'adopted-local' })]),
    });
    const [readyLocal] = await localWithAccount.list();
    assert.equal(readyLocal?.openReadiness, 'ready');
    assert.equal(readyLocal?.nextActions.includes('open'), true);
    assert.equal(readyLocal?.nextActions.includes('remove-local-adoption'), true);
    assert.equal(readyLocal?.nextActions.includes('uninstall'), false);
  });

  it('admits only immutable external release descriptor source refs', async () => {
    const acceptedRefs = [
      ['nimi.npm-exact', 'npm-package', '@nimi/app@1.2.3'],
      ['nimi.github-commit-sha', 'github-commit', '0123456789abcdef0123456789abcdef01234567'], // pragma: allowlist secret
      ['nimi.github-commit-url', 'github-commit', 'https://github.com/nimi/app/commit/0123456789abcdef0123456789abcdef01234567'],
      ['nimi.github-release-asset', 'github-release', 'https://github.com/nimi/app/releases/download/v1.2.3/app.tgz'],
    ] as const;
    const rejectedRefs = [
      ['nimi.npm-latest', 'npm-package', '@nimi/app@latest'],
      ['nimi.github-branch', 'github-commit', 'refs/heads/main'],
      ['nimi.github-release-tag', 'github-release', 'v1.2.3'],
      ['nimi.github-release-latest', 'github-release', 'https://github.com/nimi/app/releases/download/latest/app.tgz'],
      ['nimi.bundle-with-external-class', 'nimi-bundle', 'nimi-release'],
    ] as const;
    const rows = [...acceptedRefs, ...rejectedRefs].map(([appId]) =>
      registryRow({ appId, releaseDescriptorRef: `${appId}.external` }));
    const descriptors = [...acceptedRefs, ...rejectedRefs].map(([appId, sourceKind, sourceRef]) =>
      releaseDescriptor({
        appId,
        descriptorId: `${appId}.external`,
        descriptorClass: 'external-immutable-artifact',
        sourceKind,
        sourceRef,
        artifactLocator: `${sourceKind}:${sourceRef}`,
      }));

    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => descriptors,
    });

    assert.deepEqual(
      (await transport.list()).map((row) => row.appId),
      acceptedRefs.map(([appId]) => appId).sort(),
    );
    for (const [appId] of rejectedRefs) {
      assert.equal((await transport.status(appId)).launchReadiness, 'unsupported');
      await assert.rejects(
        transport.get(appId),
        (error: unknown) =>
          error instanceof NimiAppRegistryTransportError && error.code === 'missing-registry-row',
      );
    }
  });

  it('decodes Desktop Apps bridge projections through the SDK app surface', () => {
    const projection = parseNimiAppBridgeProjection({
      registryPath: '/Users/test/.nimi/apps/registry.json',
      packagesPath: '/Users/test/.nimi/apps/packages',
      registryRows: [{
        appId: 'nimi.example-app',
        appKind: 'nimi-app',
        displayName: 'Example App',
        publisher: 'Nimi',
        trustTier: 'nimi-first-party',
        ordinaryVisibility: 'ordinary-visible',
        aiProfileSelectionRef: 'local-standard',
        capabilitySet: ['text.generate'],
        releaseDescriptorRef: 'nimi.example-app.bundled-with-nimi',
        installStoragePolicyRef: 'nimi-data-app-roots',
        sourceRule: 'P-NAPP-004',
        admissionStatus: 'admitted',
        availableVersion: '1.0.1',
      }, {
        appId: 'nimi.hidden-app',
        appKind: 'nimi-app',
        displayName: 'Hidden App',
        publisher: 'Nimi',
        trustTier: 'nimi-first-party',
        ordinaryVisibility: 'hidden-internal',
        aiProfileSelectionRef: 'local-standard',
        capabilitySet: ['text.generate'],
        releaseDescriptorRef: 'nimi.hidden-app.bundled-with-nimi',
        installStoragePolicyRef: 'nimi-data-app-roots',
        sourceRule: 'P-NAPP-004',
        admissionStatus: 'admitted',
      }, {
        appId: 'nimi.deferred-app',
        appKind: 'nimi-app',
        displayName: 'Deferred App',
        publisher: 'Nimi',
        trustTier: 'nimi-first-party',
        ordinaryVisibility: 'ordinary-visible',
        aiProfileSelectionRef: 'local-standard',
        capabilitySet: ['text.generate'],
        releaseDescriptorRef: 'nimi.deferred-app.bundled-with-nimi',
        installStoragePolicyRef: 'nimi-data-app-roots',
        sourceRule: 'P-NAPP-004',
        admissionStatus: 'deferred',
      }],
      releaseDescriptors: [{
        descriptorId: 'nimi.example-app.bundled-with-nimi',
        appId: 'nimi.example-app',
        version: '1.0.0',
        descriptorClass: 'bundled-with-nimi',
        sourceKind: 'nimi-bundle',
        sourceRef: 'nimi-release',
        artifactLocator: 'bundle:nimi.example-app',
        digestAlgorithm: 'sha256',
        sha256: 'abc',
        size: '42',
        provenanceRef: 'provenance:nimi',
        packageKind: 'nimi-app',
        entryRef: 'index.html',
        sandboxRef: 'sandbox:nimi.example-app',
        permissionsRef: 'permissions:nimi.example-app',
        storagePolicyRef: 'nimi-data-app-roots',
        admissionPath: '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml',
        mutableSourceAllowed: false,
        installDigestVerificationRequired: 'required',
        sourceRule: 'P-NAPP-004',
      }, {
        descriptorId: 'nimi.hidden-app.bundled-with-nimi',
        appId: 'nimi.hidden-app',
        version: '1.0.0',
        descriptorClass: 'bundled-with-nimi',
        sourceKind: 'nimi-bundle',
        sourceRef: 'nimi-release',
        artifactLocator: 'bundle:nimi.hidden-app',
        digestAlgorithm: 'sha256',
        sha256: 'def',
        size: '42',
        provenanceRef: 'provenance:nimi',
        packageKind: 'nimi-app',
        entryRef: 'index.html',
        sandboxRef: 'sandbox:nimi.hidden-app',
        permissionsRef: 'permissions:nimi.hidden-app',
        storagePolicyRef: 'nimi-data-app-roots',
        admissionPath: '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml',
        mutableSourceAllowed: false,
        installDigestVerificationRequired: 'required',
        sourceRule: 'P-NAPP-004',
      }],
    });

    assert.equal('registryPath' in projection, false);
    assert.equal('packagesPath' in projection, false);
    assert.deepEqual(projection.registryRows.map((row) => row.appId), ['nimi.example-app']);
    assert.equal(projection.registryRows[0]?.ordinaryVisibility, 'ordinary-visible');
    assert.equal(projection.registryRows[0]?.availableVersion, '1.0.1');
    assert.deepEqual(projection.releaseDescriptors.map((descriptor) => descriptor.appId), ['nimi.example-app']);
    assert.equal(projection.releaseDescriptors[0]?.descriptorClass, 'bundled-with-nimi');
    assert.throws(
      () => parseNimiAppBridgeProjection({
        registryPath: '/registry.json',
        packagesPath: '/packages',
        registryRows: [{
          appId: 'nimi.bad',
          appKind: 'nimi-app',
          displayName: 'Bad',
          publisher: 'Nimi',
          trustTier: 'nimi-first-party',
          ordinaryVisibility: 'visible',
          aiProfileSelectionRef: 'local-standard',
          capabilitySet: ['text.generate'],
          releaseDescriptorRef: 'bad',
          installStoragePolicyRef: 'nimi-data-app-roots',
          sourceRule: 'P-NAPP-004',
          admissionStatus: 'admitted',
        }],
        releaseDescriptors: [],
      }),
      /ordinaryVisibility is invalid/,
    );
  });

  it('fails closed on non-canonical app rows and status', async () => {
    await assert.rejects(
      createNimiAppClient(new StubAppTransport({
        list: [inventoryEntry({ ...appRow, appKind: 'external-app' as 'nimi-app' })],
      })).list(),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_APP_KIND_INVALID',
    );
    await assert.rejects(
      createNimiAppClient(new StubAppTransport({
        status: { appId: 'nimi.example-app', launchReadiness: 'best-effort-ready' as 'ready' },
      })).status('nimi.example-app'),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_APP_RESPONSE_INVALID',
    );
  });

  it('manages scope catalog drafts and namespace enforcement', () => {
    const catalog = createScopeCatalogModule({
      appId: 'tester.app',
      defaultRealmScopes: ['realm.chat.read'],
      defaultRuntimeScopes: ['runtime.ai.execute'],
    });
    const draft = catalog.registerAppScopes({
      manifest: {
        manifestVersion: '1.0.0',
        scopes: ['app.tester.app.settings.read', 'app.tester.app.settings.write'],
      },
    });
    assert.equal(draft.status, 'draft');
    assert.equal(catalog.publishCatalog().status, 'published');
    assert.equal(catalog.listCatalog().published.length, 1);
    assert.deepEqual(catalog.revokeAppScopes({ scopes: ['app.tester.app.settings.read'] }).revokedVersions, ['1.0.0']);
    assert.throws(
      () => catalog.registerAppScopes({ manifest: { manifestVersion: '1.0.1', scopes: ['app.other.read'] } }),
      /must use namespace/,
    );
  });

  it('uses explicit permission transport and validates grants', async () => {
    const client = createPermissionClient(new StubPermissionTransport());
    assert.equal(client instanceof PermissionClient, true);
    assert.deepEqual(createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' }), scopeRef);
    assert.equal((await client.list(scopeRef))[0]?.state, 'granted');
    assert.equal((await client.get(scopeRef, 'grant-1')).grant.grantId, 'grant-1');
    assert.equal((await client.request(scopeRef, grantSpec)).state, 'pending');
    assert.equal((await client.revoke(scopeRef, 'grant-1')).state, 'revoked');
    assert.equal((await client.status(scopeRef)).grants.length, 1);
    const events: PermissionGrantEvent[] = [];
    const unsubscribe = client.subscribe(scopeRef, (event) => events.push(event));
    unsubscribe();
    assert.equal(events[0]?.grant.state, 'granted');
  });

  it('fails closed on non-canonical permission scopes and mismatched scope refs', async () => {
    await assert.rejects(
      createPermissionClient(new StubPermissionTransport()).request(scopeRef, {
        ...grantSpec,
        permissionScope: { ...permissionScope, scopeName: 'account.open' as 'account.read' },
      }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_PERMISSION_SCOPE_INVALID',
    );
    await assert.rejects(
      createPermissionClient(new StubPermissionTransport({
        list: [{ ...grantStatus(), scopeRef: { kind: 'app', ownerId: 'other.app' } }],
      })).list(scopeRef),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_PERMISSION_RESPONSE_INVALID',
    );
  });

  it('selects admitted first-run local baselines only', () => {
    const local: NimiAppAIProfileFactoryRow = {
      alias: 'local-small',
      privacyPosture: 'local-preferred',
      applicableScopes: ['first-run'],
      firstRunInstallLevels: ['minimal'],
      computePosture: 'local-required',
      routingPolicy: 'local-first',
      capabilitySet: ['text.generate'],
      hostCapabilityProfileRefs: [],
      localComputePackRefs: ['qwen-small'],
      dependencyFamilyRefs: ['ollama'],
      materializationConfirmationRequired: true,
      sourceRule: 'test',
    };
    const cloudVideo: NimiAppAIProfileFactoryRow = {
      ...local,
      alias: 'cloud-video',
      computePosture: 'cloud-only',
      capabilitySet: ['video.generate'],
    };
    assert.equal(isAdmittedNimiFirstRunLocalBaseline(local), true);
    assert.equal(isAdmittedNimiFirstRunLocalBaseline(cloudVideo), false);
    assert.equal(selectNimiAppFactoryAIProfileForFirstRun([cloudVideo, local])?.alias, 'local-small');
  });

  it('projects generated factory AIProfiles as explicit setup-required selection hints', () => {
    const profiles = loadNimiAppAIProfileFactoryCatalog();
    const profile = profiles.find((candidate) => candidate.profileId === 'local-speech-ready');
    assert.ok(profile, 'expected generated local-speech-ready factory profile');
    assert.match(profile.description ?? '', /selection hint/);
    assert.equal(profile.tags?.includes('factory-ai-profile-selection-hint'), true);
    assert.equal(profile.projectionWarnings?.includes('runtime_prepare_required_before_live_config'), true);

    for (const [capability, intent] of Object.entries(profile.capabilities)) {
      assert.ok(intent, `expected non-empty capability intent for ${capability}`);
      assert.equal(intent.contractState, 'proposed');
      assert.equal(intent.readinessPolicy, 'required');
      assert.equal(intent.targetRef, undefined);
    }

    const scopeRef = createNimiAIScopeRef({ kind: 'app', ownerId: 'dev.nimi.factory-profile-audit' });
    const requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[] = [{
      requirementId: 'factory-profile-audit.requirements',
      scopeRef,
      requiredSlices: [{
        requirementSliceId: 'factory-profile-audit.text.generate',
        capability: 'text.generate',
        profileSliceRef: 'capabilities.text.generate',
        readinessPolicy: 'required',
      }],
      setupProjectionPolicy: 'setup-required',
    }];
    const preview = previewNimiAIProfileApply({
      before: null,
      scopeRef,
      profile,
      requirementDeclarations,
    });
    assert.equal(preview.outcome, 'setup_required_no_live_config');
    assert.deepEqual(preview.setupProjection?.reasonCodes, ['product_state_proposed']);
    assert.equal(preview.after, null);
  });
});
