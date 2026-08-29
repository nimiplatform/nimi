import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/app/identity-floor-state.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
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

function evidence(overrides = {}) {
  return {
    appId: 'nimi.zhiyu',
    phase: 'electron-bootstrap',
    screen: 'home',
    runtime: status('electron-runtime-endpoint-unavailable'),
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
    memory: {
      ...status('zhiyu-local-agent-required'),
      state: 'blocked',
      observedAt: null,
      recordCount: 0,
      bankCount: 0,
      bankReviewStatuses: [],
      unsupportedLifecycleFields: ['review', 'redaction', 'forgetIntent'],
      records: [],
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
    productRegions: ['presence', 'conversation', 'memory', 'capability', 'proposal', 'delegation', 'identity', 'companion', 'avatar', 'diagnostics'],
    ...overrides,
  };
}

test('identity floor blocks on missing Runtime-owned LocalAgent and exposes no synthetic conflict result', async () => {
  const { projectZhiyuIdentityFloorState } = await loadModule();
  const state = projectZhiyuIdentityFloorState(evidence());

  assert.equal(state.state, 'blocked');
  assert.equal(state.summaryReasonCode, 'zhiyu-runtime-source-required');
  assert.equal(state.readyCount, 1);
  assert.equal(state.blockedCount, 2);
  assert.equal(state.notAdmittedCount, 2);
  assert.equal(state.items.length, 5);
  assert.deepEqual(state.unsupportedProjectionFields, [
    'firewallThreatIndicators',
    'firewallNormalizedOutputDiff',
  ]);
  assert.equal(state.items.find((item) => item.key === 'platform')?.state, 'ready');
  assert.equal(state.items.find((item) => item.key === 'local-agent')?.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'prompt-injection')?.state, 'not-admitted');
});

test('identity floor admits continuity readiness without claiming firewall or memory-rejection truth', async () => {
  const { projectZhiyuIdentityFloorState } = await loadModule();
  const state = projectZhiyuIdentityFloorState(evidence({
    localAgent: {
      ...status('local-agent-discovered', true, 'runtime'),
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
    },
    conversation: {
      ...status('conversation-ready', true, 'runtime'),
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
      conversationAnchorId: 'conversation:1',
    },
  }));

  assert.equal(state.state, 'not-admitted');
  assert.equal(state.summaryReasonCode, 'zhiyu-identity-floor-user-visible-projection-not-admitted');
  assert.equal(state.readyCount, 3);
  assert.equal(state.blockedCount, 0);
  assert.equal(state.notAdmittedCount, 2);
  assert.equal(state.items.find((item) => item.key === 'conversation-anchor')?.reasonCode, 'conversation-ready');
  assert.equal(
    state.items.find((item) => item.key === 'output-firewall')?.reasonCode,
    'runtime-delegation-firewall-not-projected',
  );
});

test('identity floor renders delegated firewall block without fabricating prompt indicators', async () => {
  const { projectZhiyuIdentityFloorState } = await loadModule();
  const state = projectZhiyuIdentityFloorState(evidence({
    localAgent: {
      ...status('local-agent-discovered', true, 'runtime'),
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
    },
    conversation: {
      ...status('conversation-ready', true, 'runtime'),
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
      conversationAnchorId: 'conversation:1',
    },
    delegation: {
      source: 'runtime-delegation-firewall',
      outputFirewall: {
        state: 'blocked',
        reasonCode: 'DELEG_FIREWALL_QUARANTINED',
      },
    },
  }));

  assert.equal(state.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'output-firewall')?.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'output-firewall')?.source, 'runtime-delegation-firewall');
  assert.equal(state.items.find((item) => item.key === 'prompt-injection')?.state, 'not-admitted');
  assert.equal(
    state.items.find((item) => item.key === 'prompt-injection')?.reasonCode,
    'runtime-agent-firewall-threat-indicators-not-projected',
  );
});
