import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  clearPlatformClient,
  createPlatformClient,
  unstable_attachPlatformWorldEvolutionSelectorReadProvider,
} from '@nimiplatform/sdk';
import { worldEvolution as modWorldEvolution } from '@nimiplatform/sdk/mod';

import {
  clearInternalModSdkHost,
  setInternalModSdkHost,
} from '../src/runtime/mod/index.js';
import { buildRuntimeHostCapabilities } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.js';
import {
  handleWorldStateCommitDataCapability,
} from '../src/shell/renderer/infra/bootstrap/world-capabilities.js';
import { createDesktopWorldEvolutionSelectorReadAdapter } from '../src/runtime/world-evolution/selector-read-adapter.js';
import {
  clearDesktopWorldEvolutionCommitRequestsForTest,
  getDesktopWorldEvolutionCommitRequestRecordsForTest,
} from '../src/runtime/world-evolution/commit-requests.js';
import { clearDesktopWorldEvolutionExecutionEventsForTest } from '../src/runtime/world-evolution/execution-events.js';
import { clearDesktopWorldEvolutionReplaysForTest } from '../src/runtime/world-evolution/replays.js';

function buildCommitQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    worldId: 'world-commit-1',
    payload: {
      commit: {
        worldId: 'world-commit-1',
        appId: 'nimi.desktop',
        sessionId: 'session-commit-1',
        effectClass: 'STATE_AND_HISTORY',
        scope: 'WORLD',
        schemaId: 'world.commit.schema',
        schemaVersion: '1',
        actorRefs: [{ actorId: 'user-1', actorType: 'USER', role: 'creator' }],
        reason: 'publish world',
        evidenceRefs: [{ kind: 'commitDraft', refId: 'draft-1' }],
      },
      writes: [{
        scope: 'WORLD',
        scopeKey: 'world-commit-1',
        payload: {
          title: 'Updated World',
        },
      }],
      reason: 'commit state',
    },
    ...overrides,
  };
}

function createDesktopHost() {
  return buildRuntimeHostCapabilities({
    checkLocalLlmHealth: async () => ({ healthy: true, status: 'healthy', detail: 'ok' }) as never,
    executeLocalKernelTurn: async () => ({ outputText: '' }) as never,
    withOpenApiContextLock: async (_context, task) => task(),
    getRuntimeHookRuntime: () => ({
      setModLocalProfileSnapshotResolver: () => undefined,
      authorizeRuntimeCapability: () => undefined,
      getModLocalProfileSnapshot: async () => ({}) as never,
    }) as never,
  });
}

afterEach(() => {
  clearPlatformClient();
  clearInternalModSdkHost();
  clearDesktopWorldEvolutionCommitRequestsForTest();
  clearDesktopWorldEvolutionExecutionEventsForTest();
  clearDesktopWorldEvolutionReplaysForTest();
});

test('stateCommit creates a candidate record only after parse succeeds and updates the same record on commit success', async () => {
  let commitCalls = 0;
  let recordIdAtCommit = '';

  const result = await handleWorldStateCommitDataCapability(
    buildCommitQuery(),
    {
      commitWorldState: async () => {
        commitCalls += 1;
        const recordsDuringCommit = getDesktopWorldEvolutionCommitRequestRecordsForTest();
        assert.equal(recordsDuringCommit.length, 1);
        assert.equal(recordsDuringCommit[0]?.outcomeStatus, 'pending');
        recordIdAtCommit = recordsDuringCommit[0]?.commitRequestRecordId || '';
        return { ok: true };
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(commitCalls, 1);

  const recordsAfterCommit = getDesktopWorldEvolutionCommitRequestRecordsForTest();
  assert.equal(recordsAfterCommit.length, 1);
  assert.equal(recordsAfterCommit[0]?.commitRequestRecordId, recordIdAtCommit);
  assert.equal(recordsAfterCommit[0]?.outcomeStatus, 'committed');
  assert.ok(recordsAfterCommit[0]?.settledAt);
});

test('stateCommit updates the same candidate record on commit failure and leaves optional refs empty when no admitted source exists', async () => {
  await assert.rejects(
    () => handleWorldStateCommitDataCapability(
      buildCommitQuery(),
      {
        commitWorldState: async () => {
          const recordsDuringCommit = getDesktopWorldEvolutionCommitRequestRecordsForTest();
          assert.equal(recordsDuringCommit.length, 1);
          assert.equal(recordsDuringCommit[0]?.view.traceId, undefined);
          assert.equal(recordsDuringCommit[0]?.view.sourceEventIds, undefined);
          throw new Error('commit failed');
        },
      },
    ),
    /commit failed/,
  );

  const recordsAfterFailure = getDesktopWorldEvolutionCommitRequestRecordsForTest();
  assert.equal(recordsAfterFailure.length, 1);
  assert.equal(recordsAfterFailure[0]?.outcomeStatus, 'failed');
  assert.equal(recordsAfterFailure[0]?.outcomeReason, 'commit failed');
  assert.equal(recordsAfterFailure[0]?.view.traceId, undefined);
  assert.equal(recordsAfterFailure[0]?.view.sourceEventIds, undefined);
  assert.equal(recordsAfterFailure[0]?.view.correlation, undefined);
});

test('stateCommit skips candidate recording when frozen required evidenceRefs are absent even though parse succeeds', async () => {
  let commitCalls = 0;

  await handleWorldStateCommitDataCapability(
    buildCommitQuery({
      payload: {
        commit: {
          worldId: 'world-commit-1',
          appId: 'nimi.desktop',
          sessionId: 'session-commit-1',
          effectClass: 'STATE_AND_HISTORY',
          scope: 'WORLD',
          schemaId: 'world.commit.schema',
          schemaVersion: '1',
          actorRefs: [{ actorId: 'user-1', actorType: 'USER', role: 'creator' }],
          reason: 'publish world',
        },
        writes: [{
          scope: 'WORLD',
          scopeKey: 'world-commit-1',
          payload: {
            title: 'Updated World',
          },
        }],
        reason: 'commit state',
      },
    }),
    {
      commitWorldState: async () => {
        commitCalls += 1;
        assert.deepEqual(getDesktopWorldEvolutionCommitRequestRecordsForTest(), []);
        return { ok: true };
      },
    },
  );

  assert.equal(commitCalls, 1);
  assert.deepEqual(getDesktopWorldEvolutionCommitRequestRecordsForTest(), []);
});

test('desktop app and mod commitRequests.read return the same real matches while other families keep current behavior', async () => {
  const client = await createPlatformClient({
    appId: 'nimi.desktop',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  unstable_attachPlatformWorldEvolutionSelectorReadProvider(
    client,
    createDesktopWorldEvolutionSelectorReadAdapter(),
  );
  setInternalModSdkHost(createDesktopHost());

  await handleWorldStateCommitDataCapability(
    buildCommitQuery(),
    {
      commitWorldState: async () => ({ ok: true }),
    },
  );

  const [appResult, modResult] = await Promise.all([
    client.worldEvolution.commitRequests.read({
      worldId: 'world-commit-1',
      appId: 'nimi.desktop',
      sessionId: 'session-commit-1',
      schemaId: 'world.commit.schema',
      schemaVersion: '1',
    }),
    modWorldEvolution.commitRequests.read({
      worldId: 'world-commit-1',
      appId: 'nimi.desktop',
      sessionId: 'session-commit-1',
      schemaId: 'world.commit.schema',
      schemaVersion: '1',
    }),
  ]);

  assert.equal(appResult.matchMode, 'filter');
  assert.equal(modResult.matchMode, 'filter');
  assert.equal(appResult.matches.length, 1);
  assert.equal(modResult.matches.length, 1);
  assert.deepEqual(appResult.matches, modResult.matches);
  assert.equal(appResult.matches[0]?.reason, 'publish world');
  assert.equal(appResult.matches[0]?.traceId, undefined);
  assert.equal(appResult.matches[0]?.sourceEventIds, undefined);

  await assert.rejects(
    () => client.worldEvolution.checkpoints.read({ traceId: 'trace-commit-remaining-family' }),
    /world evolution checkpoint evidence/,
  );
});
