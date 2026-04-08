import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  clearPlatformClient,
  createPlatformClient,
  unstable_attachPlatformWorldEvolutionSelectorReadProvider,
} from '@nimiplatform/sdk';
import { worldEvolution as modWorldEvolution } from '@nimiplatform/sdk/mod';
import { ReasonCode } from '@nimiplatform/sdk/types';

import {
  clearInternalModSdkHost,
  setInternalModSdkHost,
} from '../src/runtime/mod/index.js';
import { createDesktopWorldEvolutionSelectorReadAdapter } from '../src/runtime/world-evolution/selector-read-adapter.js';
import { clearDesktopWorldEvolutionCommitRequestsForTest } from '../src/runtime/world-evolution/commit-requests.js';
import { clearDesktopWorldEvolutionExecutionEventsForTest } from '../src/runtime/world-evolution/execution-events.js';
import { clearDesktopWorldEvolutionReplaysForTest } from '../src/runtime/world-evolution/replays.js';
import { buildRuntimeHostCapabilities } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.js';

afterEach(() => {
  clearPlatformClient();
  clearInternalModSdkHost();
  clearDesktopWorldEvolutionCommitRequestsForTest();
  clearDesktopWorldEvolutionExecutionEventsForTest();
  clearDesktopWorldEvolutionReplaysForTest();
});

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

test('desktop app path attaches an execution-event provider and returns empty matches instead of boundary denial', async () => {
  const client = await createPlatformClient({
    appId: 'nimi.desktop.wee.app-wiring',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  await assert.rejects(
    () => client.worldEvolution.executionEvents.read({ eventId: 'evt-desktop-pre-attach' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_PERMISSION_DENIED);
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'BOUNDARY_DENIED');
      return true;
    },
  );

  unstable_attachPlatformWorldEvolutionSelectorReadProvider(
    client,
    createDesktopWorldEvolutionSelectorReadAdapter(),
  );

  const result = await client.worldEvolution.executionEvents.read({ eventId: 'evt-desktop-post-attach' });
  assert.equal(result.matchMode, 'exact');
  assert.deepEqual(result.matches, []);
});

test('desktop host worldEvolution facet keeps checkpoint family on missing-evidence fail-close', async () => {
  const client = await createPlatformClient({
    appId: 'nimi.desktop.wee.parity',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  const adapter = createDesktopWorldEvolutionSelectorReadAdapter();
  unstable_attachPlatformWorldEvolutionSelectorReadProvider(client, adapter);
  setInternalModSdkHost(createDesktopHost());

  const [appResult, modResult] = await Promise.allSettled([
    client.worldEvolution.checkpoints.read({ traceId: 'trace-desktop-parity' }),
    modWorldEvolution.checkpoints.read({ traceId: 'trace-desktop-parity' }),
  ]);

  assert.equal(appResult.status, 'rejected');
  assert.equal(modResult.status, 'rejected');

  const appError = appResult.status === 'rejected' ? appResult.reason as {
    reasonCode?: string;
    details?: { rejectionCategory?: string; methodId?: string };
  } : null;
  const modError = modResult.status === 'rejected' ? modResult.reason as {
    reasonCode?: string;
    details?: { rejectionCategory?: string; methodId?: string };
  } : null;

  assert.equal(appError?.reasonCode, ReasonCode.ACTION_NOT_FOUND);
  assert.equal(modError?.reasonCode, ReasonCode.ACTION_NOT_FOUND);
  assert.equal(appError?.details?.rejectionCategory, 'MISSING_REQUIRED_EVIDENCE');
  assert.equal(modError?.details?.rejectionCategory, 'MISSING_REQUIRED_EVIDENCE');
  assert.equal(appError?.details?.methodId, 'worldEvolution.checkpoints.read');
  assert.equal(modError?.details?.methodId, 'worldEvolution.checkpoints.read');
});
