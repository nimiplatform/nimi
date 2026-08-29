import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/app/diagnostic-state.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

const diagnosticOrder = [
  'runtime',
  'auth',
  'source',
  'inventory',
  'localAgent',
  'conversation',
  'turn',
  'composer',
];

test('projects no-runtime evidence into an ordered fail-closed diagnostic state', async () => {
  const { projectZhiyuDiagnosticState } = await loadModule();

  const diagnostics = projectZhiyuDiagnosticState(evidence());

  assert.equal(diagnostics.mode, 'blocked');
  assert.equal(diagnostics.readyCount, 0);
  assert.equal(diagnostics.pendingCount, 1);
  assert.equal(diagnostics.errorCount, 2);
  assert.equal(diagnostics.blockedCount, 5);
  assert.equal(diagnostics.items.length, 8);
  assert.deepEqual(diagnostics.items.map((item) => item.key), diagnosticOrder);
  assert.equal(diagnostics.primaryBlocker?.key, 'runtime');
  assert.equal(diagnostics.primaryBlocker?.reasonCode, 'electron-runtime-endpoint-unavailable');
  assert.equal(diagnostics.primaryBlocker?.actionHint, 'start_external_runtime_daemon');
  assert.equal(diagnostics.primaryBlocker?.source, 'electron');
  assert.equal(diagnostics.primaryBlocker?.traceId, 'zhiyu.diagnostics.runtime.electron-runtime-endpoint-unavailable');
  assert.equal(diagnostics.items.every((item) => item.traceId.startsWith('zhiyu.diagnostics.')), true);
});

test('projects all ready evidence without a primary blocker', async () => {
  const { projectZhiyuDiagnosticState } = await loadModule();

  const diagnostics = projectZhiyuDiagnosticState(evidence({
    runtime: status('runtime-ready', true, 'runtime', 'none'),
    auth: {
      ...status('runtime-account-ready', true, 'runtime', 'none'),
      state: 'authenticated',
      accountReasonCode: 'OK',
      accountId: 'account-1',
      displayName: 'User',
      productionInert: false,
    },
    source: {
      ...status('source-ready', true, 'runtime', 'none'),
      sourceRef: {
        kind: 'worldCharacter',
        worldId: 'world-1',
        id: 'source-1',
        sourceHash: 'a'.repeat(64),
      },
    },
    inventory: {
      ...status('runtime-local-agent-inventory-ready', true, 'runtime', 'none'),
      count: 1,
      localAgents: [],
    },
    localAgent: {
      ...status('local-agent-discovered', true, 'runtime', 'none'),
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
    },
    conversation: {
      ...status('conversation-ready', true, 'runtime', 'none'),
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
      conversationAnchorId: 'conversation:1',
    },
    turn: {
      ...status('runtime-turn-ready', true, 'runtime', 'none'),
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
      conversationAnchorId: 'conversation:1',
      requestId: null,
      messageId: null,
    },
    composer: {
      submitState: 'idle',
      draftLength: 0,
      reasonCode: 'not-probed',
      actionHint: 'enter_runtime_agent_turn_text',
      source: 'renderer',
      message: 'Runtime Agent composer has not been used.',
    },
  }));

  assert.equal(diagnostics.mode, 'ready');
  assert.equal(diagnostics.primaryBlocker, null);
  assert.equal(diagnostics.readyCount, 7);
  assert.equal(diagnostics.pendingCount, 1);
  assert.equal(diagnostics.blockedCount, 0);
  assert.equal(diagnostics.errorCount, 0);
});

function evidence(overrides = {}) {
  return {
    appId: 'nimi.zhiyu',
    phase: 'electron-bootstrap',
    screen: 'home',
    runtime: status('electron-runtime-endpoint-unavailable', false, 'electron', 'start_external_runtime_daemon'),
    auth: {
      ...status('electron-runtime-endpoint-unavailable'),
      state: 'unavailable',
      accountReasonCode: 'UNKNOWN',
      accountId: null,
      displayName: null,
      productionInert: false,
    },
    source: {
      ...status('zhiyu-admitted-source-projection-required'),
      sourceRef: null,
    },
    inventory: {
      ...status('zhiyu-runtime-account-required'),
      count: 0,
      localAgents: [],
    },
    localAgent: {
      ...status('zhiyu-runtime-source-required'),
      agentHandle: null,
    },
    conversation: {
      ...status('zhiyu-local-agent-required'),
      agentHandle: null,
      conversationAnchorId: null,
    },
    turn: {
      ...status('zhiyu-conversation-anchor-required'),
      agentHandle: null,
      conversationAnchorId: null,
      requestId: null,
      messageId: null,
    },
    composer: {
      submitState: 'blocked',
      draftLength: 0,
      reasonCode: 'not-probed',
      actionHint: 'enter_runtime_agent_turn_text',
      source: 'renderer',
      message: 'Runtime Agent composer has not been used.',
    },
    productRegions: ['presence', 'conversation', 'memory', 'proposal', 'delegation', 'identity', 'companion', 'avatar', 'diagnostics'],
    ...overrides,
  };
}

function status(reasonCode, ready = false, source = 'renderer', actionHint = `action:${reasonCode}`) {
  return {
    transport: 'electron-ipc',
    ready,
    reasonCode,
    actionHint,
    source,
    message: `message:${reasonCode}`,
  };
}
