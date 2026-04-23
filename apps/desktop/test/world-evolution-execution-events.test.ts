import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  clearPlatformClient,
  createPlatformClient,
  unstable_attachPlatformWorldEvolutionSelectorReadProvider,
} from '@nimiplatform/sdk';
import { worldEvolution as modWorldEvolution } from '@nimiplatform/sdk/mod';

import { createDesktopWorldEvolutionSelectorReadAdapter } from '../src/runtime/world-evolution/selector-read-adapter.js';
import { clearDesktopWorldEvolutionCommitRequestsForTest } from '../src/runtime/world-evolution/commit-requests.js';
import {
  clearDesktopWorldEvolutionExecutionEventsForTest,
  queryDesktopWorldEvolutionExecutionEvents,
  recordDesktopWorldEvolutionLocalTurnExecutionEvent,
} from '../src/runtime/world-evolution/execution-events.js';
import { clearDesktopWorldEvolutionReplaysForTest } from '../src/runtime/world-evolution/replays.js';
import { runLocalTurnFlow } from '../src/runtime/execution-kernel/kernel/flows/local-turn-flow.js';
import {
  clearInternalModSdkHost,
  setInternalModSdkHost,
} from '../src/runtime/mod/index.js';
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

test('runLocalTurnFlow records a desktop-private execution event only when frozen required fields exist', async () => {
  await runLocalTurnFlow({
    input: {
      requestId: 'req-local-turn',
      sessionId: 'session-local-turn',
      turnIndex: 3,
      mode: 'SCENE_TURN',
      userInputText: 'hello',
      provider: 'llama',
      worldId: 'world-local-turn',
      agentId: 'agent-local-turn',
    },
    invokeTurnHooks: async ({ context }) => ({ context }),
    executeLocalKernelTurn: async () => ({
      requestId: 'req-local-turn',
      sessionId: 'session-local-turn',
      turnIndex: 3,
      traceId: 'trace-local-turn',
      assistantMessage: {
        text: 'response',
        style: 'mixed',
      },
      sceneCards: [{ type: 'text', content: 'response' }],
      stateDelta: {
        narrativeDelta: ['delta'],
        memoryWrites: ['memory-1'],
      },
      ruleDecisions: [],
      promptTraceId: 'prompt-local-turn',
      auditEventIds: ['audit-local-turn'],
      nextActions: [{ id: 'next', label: '继续', kind: 'free_input' }],
      localOnly: true,
      localPromptTrace: {
        id: 'prompt-local-turn',
        sourceSegments: [],
        tokenRequested: 1,
        tokenActual: 1,
        droppedSegments: [],
        conflictResolutions: [],
        decision: 'ALLOW',
        decisionReason: 'ok',
      },
      localAuditEvents: [],
    }),
    appendAudit: async () => undefined,
    reportCrash: () => 0,
    shouldDisable: () => false,
  });

  const matches = queryDesktopWorldEvolutionExecutionEvents({
    worldId: 'world-local-turn',
    traceId: 'trace-local-turn',
    stage: 'TERMINAL',
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.eventKind, 'LOCAL_TURN_EXECUTED');
  assert.equal(matches[0]?.appId, 'nimi.desktop');
  assert.equal(matches[0]?.detail?.kind, 'desktop-local-turn');

  clearDesktopWorldEvolutionExecutionEventsForTest();

  await runLocalTurnFlow({
    input: {
      requestId: 'req-local-turn-no-world',
      sessionId: 'session-local-turn-no-world',
      turnIndex: 4,
      mode: 'SCENE_TURN',
      userInputText: 'hello',
      provider: 'llama',
    },
    invokeTurnHooks: async ({ context }) => ({ context }),
    executeLocalKernelTurn: async () => ({
      requestId: 'req-local-turn-no-world',
      sessionId: 'session-local-turn-no-world',
      turnIndex: 4,
      traceId: 'trace-local-turn-no-world',
      assistantMessage: {
        text: 'response',
        style: 'mixed',
      },
      stateDelta: {
        narrativeDelta: ['delta'],
        memoryWrites: ['memory-1'],
      },
      ruleDecisions: [],
      promptTraceId: 'prompt-local-turn-no-world',
      auditEventIds: ['audit-local-turn-no-world'],
      nextActions: [{ id: 'next', label: '继续', kind: 'free_input' }],
      localOnly: true,
      localPromptTrace: {
        id: 'prompt-local-turn-no-world',
        sourceSegments: [],
        tokenRequested: 1,
        tokenActual: 1,
        droppedSegments: [],
        conflictResolutions: [],
        decision: 'ALLOW',
        decisionReason: 'ok',
      },
      localAuditEvents: [],
    }),
    appendAudit: async () => undefined,
    reportCrash: () => 0,
    shouldDisable: () => false,
  });

  const noWorldMatches = queryDesktopWorldEvolutionExecutionEvents({
    traceId: 'trace-local-turn-no-world',
  });
  assert.deepEqual(noWorldMatches, []);
});

test('desktop app and mod executionEvents.read return the same real matches', async () => {
  const client = await createPlatformClient({
    appId: 'nimi.desktop.wee.execution-events',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  unstable_attachPlatformWorldEvolutionSelectorReadProvider(
    client,
    createDesktopWorldEvolutionSelectorReadAdapter(),
  );
  setInternalModSdkHost(createDesktopHost());

  const recorded = recordDesktopWorldEvolutionLocalTurnExecutionEvent({
    requestId: 'req-recorded',
    sessionId: 'session-recorded',
    turnIndex: 7,
    worldId: 'world-recorded',
    agentId: 'agent-recorded',
    provider: 'llama',
    mode: 'SCENE_TURN',
    traceId: 'trace-recorded',
    eventKind: 'LOCAL_TURN_EXECUTED',
    stage: 'TERMINAL',
    effectClass: 'NONE',
    reason: 'local turn executed',
    evidenceRefs: [{ kind: 'promptTrace', refId: 'prompt-recorded' }],
    detail: {
      kind: 'desktop-local-turn',
      source: 'test',
    },
  });

  assert.ok(recorded);

  const [appExact, modExact, appFilter, modFilter] = await Promise.all([
    client.worldEvolution.executionEvents.read({ eventId: recorded?.eventId || '' }),
    modWorldEvolution.executionEvents.read({ eventId: recorded?.eventId || '' }),
    client.worldEvolution.executionEvents.read({
      worldId: 'world-recorded',
      traceId: 'trace-recorded',
      stage: 'TERMINAL',
    }),
    modWorldEvolution.executionEvents.read({
      worldId: 'world-recorded',
      traceId: 'trace-recorded',
      stage: 'TERMINAL',
    }),
  ]);

  assert.equal(appExact.matchMode, 'exact');
  assert.equal(modExact.matchMode, 'exact');
  assert.equal(appExact.matches.length, 1);
  assert.equal(modExact.matches.length, 1);
  assert.equal(appExact.matches[0]?.eventId, recorded?.eventId);
  assert.equal(modExact.matches[0]?.eventId, recorded?.eventId);

  assert.equal(appFilter.matchMode, 'filter');
  assert.equal(modFilter.matchMode, 'filter');
  assert.equal(appFilter.matches.length, 1);
  assert.equal(modFilter.matches.length, 1);
  assert.equal(appFilter.matches[0]?.traceId, 'trace-recorded');
  assert.equal(modFilter.matches[0]?.traceId, 'trace-recorded');
  assert.equal(appFilter.matches[0]?.detail?.kind, 'desktop-local-turn');
  assert.equal(modFilter.matches[0]?.detail?.kind, 'desktop-local-turn');
});
