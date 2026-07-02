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
      ownerUserId: null,
      runtimeSourceRef: null,
      sourceRef: null,
    },
    inventory: {
      ...status('zhiyu-runtime-account-required'),
      ownerUserId: null,
      count: 0,
      localAgents: [],
    },
    localAgent: {
      ...status('zhiyu-runtime-source-required'),
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
    },
    conversation: {
      ...status('zhiyu-local-agent-required'),
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      conversationAnchorId: null,
    },
    memory: {
      ...status('zhiyu-local-agent-required'),
      state: 'blocked',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      observedAt: null,
      recordCount: 0,
      bankCount: 0,
      bankReviewStatuses: [],
      unsupportedLifecycleFields: ['review', 'redaction', 'forgetIntent'],
      records: [],
    },
    route: {
      ...status('zhiyu-ai-config-route-selection-required'),
      capability: 'text.generate',
      selectedTargetRefKind: null,
      resolvedBindingRef: null,
      executionBinding: null,
    },
    turn: {
      ...status('zhiyu-conversation-anchor-required'),
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
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
    productRegions: ['presence', 'conversation', 'memory', 'capability', 'proposal', 'delegation', 'identity', 'companion', 'diary', 'avatar', 'diagnostics'],
    ...overrides,
  };
}

function identitySafety(overrides = {}) {
  return {
    schemaVersion: 1,
    observedAt: '2026-07-02T00:00:00.000Z',
    state: 'ready',
    identity: {
      state: 'ready',
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
      conversationAnchorId: 'conversation:1',
      reasonCode: 'runtime-agent-local-identity-ready',
      source: 'runtime-agent-local-identity',
    },
    identityConflict: {
      state: 'not_projected',
      reasonCode: 'runtime-agent-identity-conflict-event-not-projected',
      source: 'not_projected',
      sourceEventId: null,
      message: null,
    },
    memoryAdmission: {
      state: 'not_projected',
      reasonCode: 'runtime-agent-memory-admission-rejection-not-projected',
      source: 'not_projected',
      sourceEventId: null,
      message: null,
      identityConflictRelated: false,
    },
    outputFirewall: {
      state: 'not_projected',
      reasonCode: 'runtime-agent-output-firewall-verdict-not-projected',
      source: 'not_projected',
      diagnosticId: null,
      firewallInputId: null,
      firewallVerdict: null,
      runtimeDecision: null,
    },
    promptInjection: {
      state: 'not_projected',
      reasonCode: 'runtime-agent-firewall-threat-indicators-not-projected',
      source: 'not_projected',
      firewallInputId: null,
    },
    unsupportedProjectionFields: [
      'identityConflictEvent',
      'firewallThreatIndicators',
      'firewallNormalizedOutputDiff',
    ],
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
  assert.equal(state.notAdmittedCount, 4);
  assert.equal(state.items.length, 7);
  assert.deepEqual(state.unsupportedProjectionFields, [
    'identityConflictEvent',
    'firewallThreatIndicators',
    'firewallNormalizedOutputDiff',
  ]);
  assert.equal(state.items.find((item) => item.key === 'platform')?.state, 'ready');
  assert.equal(state.items.find((item) => item.key === 'local-agent')?.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'identity-conflict')?.state, 'not-admitted');
  assert.equal(state.items.find((item) => item.key === 'prompt-injection')?.state, 'not-admitted');
});

test('identity floor admits continuity readiness without claiming firewall or memory-rejection truth', async () => {
  const { projectZhiyuIdentityFloorState } = await loadModule();
  const state = projectZhiyuIdentityFloorState(evidence({
    localAgent: {
      ...status('local-agent-discovered', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
    },
    conversation: {
      ...status('conversation-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
      conversationAnchorId: 'conversation:1',
    },
  }));

  assert.equal(state.state, 'not-admitted');
  assert.equal(state.summaryReasonCode, 'zhiyu-identity-floor-user-visible-projection-not-admitted');
  assert.equal(state.readyCount, 3);
  assert.equal(state.blockedCount, 0);
  assert.equal(state.notAdmittedCount, 4);
  assert.equal(state.items.find((item) => item.key === 'conversation-anchor')?.reasonCode, 'conversation-ready');
  assert.equal(
    state.items.find((item) => item.key === 'memory-admission')?.reasonCode,
    'runtime-agent-memory-admission-rejection-not-projected',
  );
  assert.equal(
    state.items.find((item) => item.key === 'output-firewall')?.reasonCode,
    'runtime-agent-output-firewall-verdict-not-projected',
  );
});

test('identity floor renders Runtime memory rejection and identity conflict relation from SDK projection', async () => {
  const { projectZhiyuIdentityFloorState } = await loadModule();
  const state = projectZhiyuIdentityFloorState(evidence({
    localAgent: {
      ...status('local-agent-discovered', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
    },
    conversation: {
      ...status('conversation-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
      conversationAnchorId: 'conversation:1',
    },
    identitySafety: identitySafety({
      state: 'warning',
      identityConflict: {
        state: 'detected',
        reasonCode: 'PROTOCOL_DOMAIN_FIELD_CONFLICT',
        source: 'runtime-agent-memory-admission',
        sourceEventId: 'turn-1',
        message: 'memory candidate conflicts with local identity boundary',
      },
      memoryAdmission: {
        state: 'rejected',
        reasonCode: 'PROTOCOL_DOMAIN_FIELD_CONFLICT',
        source: 'runtime-agent-memory-admission',
        sourceEventId: 'turn-1',
        message: 'memory candidate conflicts with local identity boundary',
        identityConflictRelated: true,
      },
    }),
  }));

  assert.equal(state.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'identity-conflict')?.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'identity-conflict')?.source, 'runtime-agent-memory-admission');
  assert.equal(state.items.find((item) => item.key === 'memory-admission')?.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'memory-admission')?.reasonCode, 'PROTOCOL_DOMAIN_FIELD_CONFLICT');
});

test('identity floor renders Runtime delegated firewall block and prompt suppression from SDK projection', async () => {
  const { projectZhiyuIdentityFloorState } = await loadModule();
  const state = projectZhiyuIdentityFloorState(evidence({
    localAgent: {
      ...status('local-agent-discovered', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
    },
    conversation: {
      ...status('conversation-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
      conversationAnchorId: 'conversation:1',
    },
    identitySafety: identitySafety({
      state: 'blocked',
      outputFirewall: {
        state: 'blocked',
        reasonCode: 'DELEG_FIREWALL_QUARANTINED',
        source: 'runtime-delegation-firewall',
        diagnosticId: 'diag-1',
        firewallInputId: 'firewall-input-1',
        firewallVerdict: 'POLICY_BLOCKED',
        runtimeDecision: 'blocked',
      },
      promptInjection: {
        state: 'suppressed',
        reasonCode: 'DELEG_FIREWALL_QUARANTINED',
        source: 'runtime-delegation-firewall',
        firewallInputId: 'firewall-input-1',
      },
    }),
  }));

  assert.equal(state.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'output-firewall')?.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'output-firewall')?.source, 'runtime-delegation-firewall');
  assert.equal(state.items.find((item) => item.key === 'prompt-injection')?.state, 'blocked');
  assert.equal(state.items.find((item) => item.key === 'prompt-injection')?.reasonCode, 'DELEG_FIREWALL_QUARANTINED');
});

test('identity floor source does not bypass Runtime or create app-local identity truth', () => {
  const source = readFileSync(path.join(root, 'src/shell/app/identity-floor-state.ts'), 'utf8');
  assert.doesNotMatch(source, /local-agent\.identity|NIMI_STANDARD_SHELL_COMMANDS/);
  assert.doesNotMatch(source, /runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(source, /apiKey|providerId|SourceMaterializationPacket|nimi-guide-archivist/);
  assert.doesNotMatch(source, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.doesNotMatch(source, /conflictDetected|promptInjectionDetected|systemPrompt|rawProviderOutput/);
});
