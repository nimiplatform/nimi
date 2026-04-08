import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  clearPlatformClient,
  createPlatformClient,
  unstable_attachPlatformWorldEvolutionSelectorReadProvider,
} from '@nimiplatform/sdk';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import { ScenarioJobStatus } from '@nimiplatform/sdk/runtime';
import { worldEvolution as modWorldEvolution } from '@nimiplatform/sdk/mod';

import {
  clearInternalModSdkHost,
  setInternalModSdkHost,
} from '../src/runtime/mod/index.js';
import { buildRuntimeHostCapabilities } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.js';
import { runDesktopBridgeReplay } from '../src/runtime/llm-adapter/execution/replay.js';
import { createDesktopWorldEvolutionSelectorReadAdapter } from '../src/runtime/world-evolution/selector-read-adapter.js';
import {
  clearDesktopWorldEvolutionCommitRequestsForTest,
} from '../src/runtime/world-evolution/commit-requests.js';
import {
  clearDesktopWorldEvolutionExecutionEventsForTest,
} from '../src/runtime/world-evolution/execution-events.js';
import {
  clearDesktopWorldEvolutionReplaysForTest,
  getDesktopWorldEvolutionReplayRecordsForTest,
} from '../src/runtime/world-evolution/replays.js';

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

test('runDesktopBridgeReplay creates a replay record before runtime dispatch and updates the same record on sync success', async () => {
  let executeScenarioCalls = 0;
  let pendingReplayRefId = '';

  const runtime = {
    appId: 'nimi.desktop.ai.gold',
    ai: {
      executeScenario: async () => {
        executeScenarioCalls += 1;
        const recordsDuringDispatch = getDesktopWorldEvolutionReplayRecordsForTest();
        assert.equal(recordsDuringDispatch.length, 1);
        assert.equal(recordsDuringDispatch[0]?.outcomeStatus, 'pending');
        pendingReplayRefId = recordsDuringDispatch[0]?.replayRefId || '';
        return {
          output: {
            oneofKind: 'textGenerate',
            textGenerate: {
              text: 'hello replay',
            },
          },
          finishReason: 1,
          modelResolved: 'qwen3',
        };
      },
    },
  } as unknown as Runtime;

  const result = await runDesktopBridgeReplay({
    runtime,
    fixture: {
      fixture_id: 'replay.text.generate',
      capability: 'text.generate',
      provider: 'llama',
      model_id: 'qwen3',
      request: {
        prompt: 'hello',
      },
      request_digest: 'digest-replay-text',
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(executeScenarioCalls, 1);

  const recordsAfter = getDesktopWorldEvolutionReplayRecordsForTest();
  assert.equal(recordsAfter.length, 1);
  assert.equal(recordsAfter[0]?.replayRefId, pendingReplayRefId);
  assert.equal(recordsAfter[0]?.outcomeStatus, 'passed');
  assert.ok(recordsAfter[0]?.settledAt);
  assert.equal(recordsAfter[0]?.view.replayMode, 'RECORDED');
  assert.equal(recordsAfter[0]?.view.traceId, undefined);
  assert.equal(recordsAfter[0]?.view.eventId, undefined);
  assert.equal(recordsAfter[0]?.view.tick, undefined);
  assert.equal(recordsAfter[0]?.view.replayResult, undefined);
});

test('runDesktopBridgeReplay updates the same replay record on terminal failure without synthetic anchors', async () => {
  const runtime = {
    appId: 'nimi.desktop.ai.gold',
    ai: {
      submitScenarioJob: async () => {
        const recordsDuringDispatch = getDesktopWorldEvolutionReplayRecordsForTest();
        assert.equal(recordsDuringDispatch.length, 1);
        assert.equal(recordsDuringDispatch[0]?.outcomeStatus, 'pending');
        throw new Error('replay submit failed');
      },
      getScenarioJob: async () => ({
        job: {
          status: ScenarioJobStatus.COMPLETED,
        },
      }),
      getScenarioArtifacts: async () => ({
        artifacts: [],
      }),
    },
  } as unknown as Runtime;

  const result = await runDesktopBridgeReplay({
    runtime,
    fixture: {
      fixture_id: 'replay.voice.design',
      capability: 'voice.design',
      provider: 'dashscope',
      model_id: 'qwen3-tts-vd',
      target_model_id: 'qwen3-tts-vd-2026-01-26',
      request: {
        instruction_text: 'warm narrator',
      },
      request_digest: 'digest-replay-voice-design',
    },
  });

  assert.equal(result.status, 'failed');

  const recordsAfter = getDesktopWorldEvolutionReplayRecordsForTest();
  assert.equal(recordsAfter.length, 1);
  assert.equal(recordsAfter[0]?.outcomeStatus, 'failed');
  assert.equal(recordsAfter[0]?.outcomeReason, 'replay submit failed');
  assert.equal(recordsAfter[0]?.view.traceId, undefined);
  assert.equal(recordsAfter[0]?.view.worldId, undefined);
  assert.equal(recordsAfter[0]?.view.sessionId, undefined);
  assert.equal(recordsAfter[0]?.view.eventId, undefined);
  assert.equal(recordsAfter[0]?.view.tick, undefined);
});

test('desktop app and mod replays.read return the same real matches', async () => {
  const runtime = {
    appId: 'nimi.desktop.ai.gold',
    ai: {
      executeScenario: async () => ({
        output: {
          oneofKind: 'textGenerate',
          textGenerate: {
            text: 'hello replay',
          },
        },
        finishReason: 1,
        modelResolved: 'qwen3',
      }),
    },
  } as unknown as Runtime;

  const replayResult = await runDesktopBridgeReplay({
    runtime,
    fixture: {
      fixture_id: 'replay.text.generate.exact',
      capability: 'text.generate',
      provider: 'llama',
      model_id: 'qwen3',
      request: {
        prompt: 'hello',
      },
      request_digest: 'digest-replay-exact',
    },
  });
  assert.equal(replayResult.status, 'passed');

  const records = getDesktopWorldEvolutionReplayRecordsForTest();
  assert.equal(records.length, 1);
  const replayRef = records[0]?.view.replayRef;
  assert.ok(replayRef);

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

  const [appExact, modExact] = await Promise.all([
    client.worldEvolution.replays.read({ replayRef: replayRef || { kind: 'replay', refId: '' } }),
    modWorldEvolution.replays.read({ replayRef: replayRef || { kind: 'replay', refId: '' } }),
  ]);

  assert.equal(appExact.matchMode, 'exact');
  assert.equal(modExact.matchMode, 'exact');
  assert.equal(appExact.matches.length, 1);
  assert.equal(modExact.matches.length, 1);
  assert.deepEqual(appExact.matches, modExact.matches);
  assert.equal(appExact.matches[0]?.replayMode, 'RECORDED');
  assert.equal(appExact.matches[0]?.traceId, undefined);
  assert.equal(appExact.matches[0]?.eventId, undefined);
});

test('desktop app and mod replays.read keep recorded replay mode filter on the valid replay path', async () => {
  const runtime = {
    appId: 'nimi.desktop.ai.gold',
    ai: {
      executeScenario: async () => ({
        output: {
          oneofKind: 'textGenerate',
          textGenerate: {
            text: 'hello replay filter',
          },
        },
        finishReason: 1,
        modelResolved: 'qwen3',
      }),
    },
  } as unknown as Runtime;

  const replayResult = await runDesktopBridgeReplay({
    runtime,
    fixture: {
      fixture_id: 'replay.text.generate.filter',
      capability: 'text.generate',
      provider: 'llama',
      model_id: 'qwen3',
      request: {
        prompt: 'hello filter',
      },
      request_digest: 'digest-replay-filter',
    },
  });
  assert.equal(replayResult.status, 'passed');

  const records = getDesktopWorldEvolutionReplayRecordsForTest();
  assert.equal(records.length, 1);
  const replayRef = records[0]?.view.replayRef;
  assert.ok(replayRef);

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

  const selector = {
    replayRef: replayRef || { kind: 'replay', refId: '' },
    replayMode: 'RECORDED' as const,
  };
  const [appFiltered, modFiltered] = await Promise.all([
    client.worldEvolution.replays.read(selector),
    modWorldEvolution.replays.read(selector),
  ]);

  assert.equal(appFiltered.matchMode, 'filter');
  assert.equal(modFiltered.matchMode, 'filter');
  assert.equal(appFiltered.matches.length, 1);
  assert.equal(modFiltered.matches.length, 1);
  assert.deepEqual(appFiltered.matches, modFiltered.matches);
  assert.equal(appFiltered.matches[0]?.replayMode, 'RECORDED');
});
