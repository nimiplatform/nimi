import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createNimiAIScopeRef,
  previewNimiAIProfileApply,
  type NimiAICapabilityRequirementDeclaration,
} from '../ai/index';
import {
  ADMITTED_PERMISSION_IDS,
  KNOWN_PERMISSION_IDS,
  NimiAppClient,
  PermissionClient,
  createAppScopeRef,
  createNimiAppClient,
  createNimiAppRegistryTransport,
  createPermissionClient,
  isAdmittedNimiFirstRunLocalBaseline,
  loadNimiAppAIProfileFactoryCatalog,
  loadNimiAppRegistryRows,
  loadNimiAppReleaseDescriptorRows,
  parseNimiAppAccountInventoryRecord,
  parseNimiAppBridgeProjection,
  selectNimiAppFactoryAIProfileForFirstRun,
  type NimiAppAIProfileFactoryRow,
  type NimiAppAccountInventoryRecord,
  type NimiAppInventoryEntry,
  type NimiAppLocalRecordRow,
  type NimiAppPackageReadinessUnavailable,
  type NimiAppRegistrySourceRow,
  type NimiAppReleaseDescriptorRow,
  type NimiAppRow,
  type NimiAppScopeRef,
  type NimiAppStatus,
  type NimiAppTransport,
  type PermissionPostureEvent,
  type PermissionID,
  type PermissionStatus,
  type PermissionTransport,
} from './index';

const appRow: NimiAppRow = {
  appId: 'nimi.example-app',
  appKind: 'nimi-app',
  displayName: 'Example App',
  trustTier: 'nimi-community',
  publisher: 'Nimi',
  aiProfileSelectionRef: 'local-standard',
  capabilitySet: ['text.generate'],
  releaseDescriptorRef: 'nimi.example-app.release',
  installStoragePolicyRef: 'nimi-data-app-roots',
  sourceRule: 'P-NAPP-033',
};

const packageUnavailable: NimiAppPackageReadinessUnavailable = {
  state: 'unavailable',
  reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
  detail: 'immutable_profile_unavailable',
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
      localRecord: { status: 'absent' },
      packageReadiness: { status: 'present', value: packageUnavailable },
    },
    installState: 'not-present',
    openReadiness: 'package-unavailable',
    activeJobs: [],
    nextActions: [],
    reasonCode: packageUnavailable.reasonCode,
  };
}

function registryRow(overrides: Partial<NimiAppRegistrySourceRow> = {}): NimiAppRegistrySourceRow {
  const appId = overrides.appId ?? appRow.appId;
  return {
    ...appRow,
    appId,
    releaseDescriptorRef: overrides.releaseDescriptorRef ?? `${appId}.release`,
    ordinaryVisibility: 'ordinary-visible',
    admissionStatus: 'admitted',
    ...overrides,
  };
}

function releaseDescriptor(overrides: Partial<NimiAppReleaseDescriptorRow> = {}): NimiAppReleaseDescriptorRow {
  const appId = overrides.appId ?? appRow.appId;
  return {
    descriptorId: overrides.descriptorId ?? `${appId}.release`,
    appId,
    version: '1.0.0',
    descriptorClass: 'external-immutable-artifact',
    sourceKind: 'github-release',
    sourceRef: 'owner/repo/releases/download/v1.0.0/app.zip',
    artifactLocator: 'github-release:owner/repo#v1.0.0#app.zip',
    digestAlgorithm: 'sha256',
    sha256: 'abc',
    size: '42',
    provenanceRef: 'provenance:reviewed',
    packageKind: 'nimi-app',
    entryRef: 'index.html',
    sandboxRef: 'fixed-app-host',
    permissionsRef: 'permissions:nimi.example-app',
    storagePolicyRef: 'nimi-data-app-roots',
    admissionPath: 'ordinary-release-proof',
    mutableSourceAllowed: false,
    installDigestVerificationRequired: 'required',
    sourceRule: 'P-NAPP-033',
    ...overrides,
  };
}

function accountInventoryRecord(
  rows: NimiAppAccountInventoryRecord['apps'],
): NimiAppAccountInventoryRecord {
  return { schemaVersion: 2, accountId: 'account-1', updatedAt: '2026-07-13T00:00:00.000Z', apps: rows };
}

function localRecord(overrides: Partial<NimiAppLocalRecordRow> = {}): NimiAppLocalRecordRow {
  return {
    appId: appRow.appId,
    displayName: 'Example Development App',
    trustClass: 'local_development',
    recordState: 'active',
    sessionState: 'session-bound',
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
    return this.behavior.status ?? {
      appId,
      launchReadiness: 'package-unavailable',
      reasonCode: packageUnavailable.reasonCode,
    };
  }
}

const scopeRef: NimiAppScopeRef = { kind: 'app', ownerId: 'tester.app', surfaceId: 'settings' };
function permissionStatus(overrides: Partial<PermissionStatus> = {}): PermissionStatus {
  return {
    permissionId: 'agents.interact',
    posture: 'unavailable',
    canRequest: false,
    ...overrides,
  };
}

class StubPermissionTransport implements PermissionTransport {
  constructor(private readonly behavior: {
    readonly status?: PermissionStatus;
    readonly subscribe?: PermissionPostureEvent;
  } = {}) {}
  async status(): Promise<PermissionStatus> { return this.behavior.status ?? permissionStatus(); }
  async request(): Promise<PermissionStatus> {
    throw new Error('no public permission is admitted');
  }
  subscribe(_permissionId: PermissionID, callback: (event: PermissionPostureEvent) => void): () => void {
    callback(this.behavior.subscribe ?? { status: permissionStatus() });
    return () => undefined;
  }
}

describe('vNext app surface', () => {
  it('exports product permission ids with an empty admitted request set', () => {
    assert.equal(KNOWN_PERMISSION_IDS.includes('agents.interact'), true);
    assert.equal(ADMITTED_PERMISSION_IDS.length, 0);
    assert.equal(KNOWN_PERMISSION_IDS.includes('realm_source.snapshot.consume' as never), false);
  });

  it('exposes read projections without package lifecycle methods', async () => {
    const client = createNimiAppClient(new StubAppTransport());
    assert.equal(client instanceof NimiAppClient, true);
    assert.equal((await client.list())[0]?.openReadiness, 'package-unavailable');
    assert.equal((await client.get(appRow.appId)).appId, appRow.appId);
    assert.equal((await client.status(appRow.appId)).launchReadiness, 'package-unavailable');
    for (const retired of ['install', 'update', 'uninstall', 'launch', 'healthRepair', 'subscribe']) {
      assert.equal(retired in client, false);
    }
  });

  it('parses account inventory only with local-record materialization states', () => {
    const record = parseNimiAppAccountInventoryRecord(accountInventoryRecord([{
      appId: appRow.appId,
      accountState: 'verified',
      installState: 'local-record-dormant',
      dataPolicy: 'principal-retained',
    }]));
    assert.equal(record.apps[0]?.installState, 'local-record-dormant');
    assert.throws(
      () => parseNimiAppAccountInventoryRecord(accountInventoryRecord([{
        appId: appRow.appId,
        accountState: 'verified',
        installState: 'installed' as 'local-record-active',
        dataPolicy: 'principal-retained',
      }])),
      /installState is invalid/,
    );
  });

  it('keeps generated bundled components out of ordinary Apps inventory', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: loadNimiAppRegistryRows,
      loadReleaseDescriptors: loadNimiAppReleaseDescriptorRows,
      loadPackageReadiness: () => packageUnavailable,
    });
    assert.deepEqual(await transport.list(), []);
    assert.equal((await transport.status('nimi.zhiyu')).launchReadiness, 'unsupported');
  });

  it('projects catalog package truth only as typed unavailable', async () => {
    let readinessArguments = -1;
    const transport = createNimiAppRegistryTransport({
      loadRows: () => [registryRow()],
      loadReleaseDescriptors: () => [releaseDescriptor()],
      loadPackageReadiness: (...args) => {
        readinessArguments = args.length;
        return packageUnavailable;
      },
    });
    const [entry] = await transport.list();
    assert.equal(entry?.openReadiness, 'package-unavailable');
    assert.equal(entry?.sources.packageReadiness.value?.state, 'unavailable');
    assert.deepEqual(entry?.activeJobs, []);
    assert.deepEqual(entry?.nextActions, []);
    assert.equal((await transport.status(appRow.appId)).launchReadiness, 'package-unavailable');
    assert.equal(readinessArguments, 0);
  });

  it('allows a zero-permission local record to open without adoption paths or package jobs', async () => {
    const zeroPermission = createNimiAppRegistryTransport({
      loadRows: () => [],
      loadReleaseDescriptors: () => [],
      loadAccountInventory: () => accountInventoryRecord([{
        appId: appRow.appId,
        accountState: 'verified',
        installState: 'local-record-active',
        dataPolicy: 'principal-retained',
      }]),
      loadLocalRecords: () => [localRecord()],
      loadPackageReadiness: () => packageUnavailable,
    });
    const [ready] = await zeroPermission.list();
    assert.equal(ready?.openReadiness, 'ready');
    assert.deepEqual(ready?.nextActions, ['open']);
    assert.equal('rootPath' in (ready?.sources.localRecord.value ?? {}), false);
  });

  it('fails closed when package readiness leaks positive fields', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => [registryRow()],
      loadReleaseDescriptors: () => [releaseDescriptor()],
      loadPackageReadiness: () => ({
        ...packageUnavailable,
        installedVersion: '1.0.0',
      } as NimiAppPackageReadinessUnavailable),
    });
    await assert.rejects(transport.status(appRow.appId), /leaked forbidden field installedVersion/);
    const [entry] = await transport.list();
    assert.equal(entry?.sources.packageReadiness.status, 'degraded');
    assert.equal(entry?.openReadiness, 'package-unavailable');
  });

  it('filters developer-only rows from the production bridge', () => {
    const projection = parseNimiAppBridgeProjection({
      registryRows: [registryRow(), registryRow({ appId: 'dev.hidden', ordinaryVisibility: 'developer-only' })],
      releaseDescriptors: [releaseDescriptor(), releaseDescriptor({
        descriptorId: 'dev.hidden.release',
        appId: 'dev.hidden',
      })],
    });
    assert.deepEqual(projection.registryRows.map((row) => row.appId), [appRow.appId]);
    assert.deepEqual(projection.releaseDescriptors.map((row) => row.appId), [appRow.appId]);
  });

  it('rejects mutable external catalog source refs', async () => {
    const rows = [
      registryRow({ appId: 'exact', releaseDescriptorRef: 'exact.release' }),
      registryRow({ appId: 'mutable', releaseDescriptorRef: 'mutable.release' }),
    ];
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      loadReleaseDescriptors: () => [
        releaseDescriptor({ descriptorId: 'exact.release', appId: 'exact' }),
        releaseDescriptor({
          descriptorId: 'mutable.release',
          appId: 'mutable',
          sourceKind: 'npm-package',
          sourceRef: '@nimi/app@latest',
        }),
      ],
    });
    assert.deepEqual((await transport.list()).map((row) => row.appId), ['exact']);
  });

  it('fails closed on malformed app transport projections', async () => {
    await assert.rejects(
      createNimiAppClient(new StubAppTransport({
        list: [{ ...inventoryEntry(), activeJobs: [{ jobId: 'forbidden' }] as never }],
      })).list(),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_APP_RESPONSE_INVALID',
    );
    await assert.rejects(
      createNimiAppClient(new StubAppTransport({
        status: { appId: appRow.appId, launchReadiness: 'install-required' as 'ready' },
      })).status(appRow.appId),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_APP_RESPONSE_INVALID',
    );
  });

  it('uses explicit permission transport and exposes reserved posture only', async () => {
    const client = createPermissionClient(new StubPermissionTransport());
    assert.equal(client instanceof PermissionClient, true);
    assert.deepEqual(createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' }), scopeRef);
    assert.equal((await client.status('agents.interact')).posture, 'unavailable');
    const events: PermissionPostureEvent[] = [];
    client.subscribe('agents.interact', (event) => events.push(event))();
    assert.equal(events[0]?.status.posture, 'unavailable');
    await assert.rejects(
      client.request({ permissionId: 'agents.interact', reason: 'Talk with an Agent selected by me' }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_PERMISSION_NOT_ADMITTED',
    );
  });

  it('fails closed when transport projects a reserved permission as granted', async () => {
    await assert.rejects(
      createPermissionClient(new StubPermissionTransport({
        status: permissionStatus({ posture: 'granted' }),
      })).status('agents.interact'),
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
    assert.equal(isAdmittedNimiFirstRunLocalBaseline(local), true);
    assert.equal(selectNimiAppFactoryAIProfileForFirstRun([local])?.alias, 'local-small');
  });

  it('projects generated factory AIProfiles as setup-required hints', () => {
    const profile = loadNimiAppAIProfileFactoryCatalog()
      .find((candidate) => candidate.profileId === 'local-speech-ready');
    assert.ok(profile);
    const scope = createNimiAIScopeRef({ kind: 'app', ownerId: 'dev.nimi.factory-profile-audit' });
    const requirements: readonly NimiAICapabilityRequirementDeclaration[] = [{
      requirementId: 'factory-profile-audit.requirements',
      scopeRef: scope,
      requiredSlices: [{
        requirementSliceId: 'factory-profile-audit.text.generate',
        capability: 'text.generate',
        profileSliceRef: 'capabilities.text.generate',
        readinessPolicy: 'required',
      }],
      setupProjectionPolicy: 'setup-required',
    }];
    const preview = previewNimiAIProfileApply({ before: null, scopeRef: scope, profile, requirementDeclarations: requirements });
    assert.equal(preview.outcome, 'setup_required_no_live_config');
    assert.equal(preview.after, null);
  });
});
