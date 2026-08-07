import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as appSurface from './index.js';
import {
  NimiAppClient,
  createAppScopeRef,
  createNimiAppClient,
  isAdmittedNimiFirstRunLocalBaseline,
  selectNimiAppFactoryAIProfileForFirstRun,
  type NimiAppAIProfileFactoryRow,
  type NimiAppInventoryEntry,
  type NimiAppLocalRecordRow,
  type NimiAppScopeRef,
  type NimiAppStatus,
  type NimiAppTransport,
} from './index.js';

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
    readonly list?: readonly NimiAppInventoryEntry[] | null;
    readonly status?: NimiAppStatus | null;
  } = {}) {}

  async list(): Promise<readonly NimiAppInventoryEntry[]> {
    return this.behavior.list === undefined ? [inventoryEntry()] : this.behavior.list as readonly NimiAppInventoryEntry[];
  }

  async get(appId: string): Promise<NimiAppInventoryEntry> {
    return inventoryEntry(localRecord({ appId }));
  }

  async status(appId: string): Promise<NimiAppStatus> {
    return this.behavior.status === undefined
      ? { appId, launchReadiness: 'ready' }
      : this.behavior.status as NimiAppStatus;
  }
}

const scopeRef: NimiAppScopeRef = { kind: 'app', ownerId: 'tester.app', surfaceId: 'settings' };

describe('vNext app surface', () => {
  it('contains no third-party access workflow exports', () => {
    assert.deepEqual(
      Object.keys(appSurface).filter((key) => key.toLowerCase().includes('permission')),
      [],
    );
    assert.deepEqual(createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' }), scopeRef);
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

  it('keeps account and package metadata out of local-development inventory', async () => {
    const [entry] = await createNimiAppClient(new StubAppTransport()).list();
    for (const field of ['catalog', 'account', 'packageReadiness', 'activeJobs', 'releaseDescriptorRef']) {
      assert.equal(field in (entry ?? {}), false);
    }
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
});
