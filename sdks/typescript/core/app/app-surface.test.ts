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
  createPermissionClient,
  isAdmittedNimiFirstRunLocalBaseline,
  loadNimiAppAIProfileFactoryCatalog,
  selectNimiAppFactoryAIProfileForFirstRun,
  type NimiAppAIProfileFactoryRow,
  type NimiAppInventoryEntry,
  type NimiLocalAppAgentHandle,
  type NimiAppLocalRecordRow,
  type NimiAppScopeRef,
  type NimiAppStatus,
  type NimiAppTransport,
  type PermissionPostureEvent,
  type PermissionID,
  type PermissionStatus,
  type PermissionTransport,
} from './index';

const localAppId = 'nimi.example-app';

function localRecord(overrides: Partial<NimiAppLocalRecordRow> = {}): NimiAppLocalRecordRow {
  return {
    appId: localAppId,
    displayName: 'Example Development App',
    trustClass: 'local_development',
    recordState: 'active',
    sessionState: 'session-bound',
    ...overrides,
  };
}

function inventoryEntry(row: NimiAppLocalRecordRow = localRecord()): NimiAppInventoryEntry {
  return {
    appId: row.appId,
    displayName: row.displayName,
    trustClass: row.trustClass,
    source: { status: 'present', value: row },
    localRecordState: row.recordState,
    openReadiness: row.recordState === 'active' && row.sessionState === 'session-bound'
      ? 'ready'
      : row.recordState === 'dormant'
        ? 'local-record-dormant'
        : 'unsupported',
    nextActions: row.recordState === 'active' && row.sessionState === 'session-bound' ? ['open'] : [],
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
    return this.behavior.get ?? inventoryEntry(localRecord({ appId }));
  }
  async status(appId: string): Promise<NimiAppStatus> {
    if (this.behavior.status instanceof Error) throw this.behavior.status;
    if (this.behavior.status === null) return null as unknown as NimiAppStatus;
    return this.behavior.status ?? {
      appId,
      launchReadiness: 'ready',
    };
  }
}

const scopeRef: NimiAppScopeRef = { kind: 'app', ownerId: 'tester.app', surfaceId: 'settings' };
function permissionStatus(overrides: Partial<PermissionStatus> = {}): PermissionStatus {
  return {
    permissionId: 'agents.interact',
    posture: 'unavailable',
    canRequest: false,
    agents: [],
    ...overrides,
  };
}

class StubPermissionTransport implements PermissionTransport {
  constructor(private readonly behavior: {
    readonly status?: PermissionStatus;
    readonly request?: PermissionStatus;
    readonly subscribe?: PermissionPostureEvent;
  } = {}) {}
  async status(): Promise<PermissionStatus> { return this.behavior.status ?? permissionStatus(); }
  async request(): Promise<PermissionStatus> {
    return this.behavior.request ?? permissionStatus({ posture: 'pending' });
  }
  subscribe(_permissionId: PermissionID, callback: (event: PermissionPostureEvent) => void): () => void {
    callback(this.behavior.subscribe ?? { status: permissionStatus() });
    return () => undefined;
  }
}

describe('vNext app surface', () => {
  it('exports agents.interact as the first admitted request permission', () => {
    assert.equal(KNOWN_PERMISSION_IDS.includes('agents.interact'), true);
    assert.deepEqual(ADMITTED_PERMISSION_IDS, ['agents.interact']);
    assert.equal(KNOWN_PERMISSION_IDS.includes('realm_source.snapshot.consume' as never), false);
  });

  it('exposes read projections without package lifecycle methods', async () => {
    const client = createNimiAppClient(new StubAppTransport());
    assert.equal(client instanceof NimiAppClient, true);
    assert.equal((await client.list())[0]?.openReadiness, 'ready');
    assert.equal((await client.get(localAppId)).appId, localAppId);
    assert.equal((await client.status(localAppId)).launchReadiness, 'ready');
    for (const retired of ['install', 'update', 'uninstall', 'launch', 'healthRepair', 'subscribe']) {
      assert.equal(retired in client, false);
    }
  });

  it('keeps future Platform catalog metadata out of current local-development entries', async () => {
    const [entry] = await createNimiAppClient(new StubAppTransport()).list();
    assert.equal('catalog' in (entry ?? {}), false);
    assert.equal('account' in (entry ?? {}), false);
    assert.equal('packageReadiness' in (entry ?? {}), false);
    assert.equal('activeJobs' in (entry ?? {}), false);
    assert.equal('releaseDescriptorRef' in (entry ?? {}), false);
  });

  it('fails closed on malformed app transport projections', async () => {
    await assert.rejects(
      createNimiAppClient(new StubAppTransport({
        list: [{ ...inventoryEntry(), source: { status: 'present' } }],
      })).list(),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_APP_RESPONSE_INVALID',
    );
    await assert.rejects(
      createNimiAppClient(new StubAppTransport({
        status: { appId: localAppId, launchReadiness: 'install-required' as 'ready' },
      })).status(localAppId),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_APP_RESPONSE_INVALID',
    );
  });

  it('uses explicit permission transport for admitted posture and requests', async () => {
    const client = createPermissionClient(new StubPermissionTransport());
    assert.equal(client instanceof PermissionClient, true);
    assert.deepEqual(createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' }), scopeRef);
    assert.equal((await client.status('agents.interact')).posture, 'unavailable');
    const events: PermissionPostureEvent[] = [];
    client.subscribe('agents.interact', (event) => events.push(event))();
    assert.equal(events[0]?.status.posture, 'unavailable');
    assert.equal((await client.request({
      permissionId: 'agents.interact',
      reason: 'Talk with an Agent selected by me',
    })).posture, 'pending');
  });

  it('accepts a granted account permission with no current Agents', async () => {
    const status = await createPermissionClient(new StubPermissionTransport({
      status: permissionStatus({ posture: 'granted' }),
    })).status('agents.interact');
    assert.equal(status.posture, 'granted');
    assert.deepEqual(status.agents, []);
  });

  it('fails closed on duplicate Agent handles and Agents attached to non-granted posture', async () => {
    const handle = 'lash_runtime_materialized' as NimiLocalAppAgentHandle;
    for (const status of [
      permissionStatus({
        posture: 'granted',
        agents: [
          { agentHandle: handle, displayName: 'One' },
          { agentHandle: handle, displayName: 'Two' },
        ],
      }),
      permissionStatus({
        posture: 'denied',
        agents: [{ agentHandle: handle, displayName: 'One' }],
      }),
    ]) {
      await assert.rejects(
        createPermissionClient(new StubPermissionTransport({ status })).status('agents.interact'),
        (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_PERMISSION_RESPONSE_INVALID',
      );
    }
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
