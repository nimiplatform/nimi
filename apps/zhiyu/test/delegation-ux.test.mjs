import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

async function loadModule() {
  const outputPath = path.join(await buildDelegationUx(), 'delegation-ux.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildDelegationUx() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-delegation-ux-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent/delegation-ux.ts')],
    outfile: path.join(buildDir, 'delegation-ux.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  }).catch((error) => {
    throw new Error(`failed to build Zhiyu delegation UX wrapper: ${error.message}`);
  });
  return buildDir;
}

function conversationReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'conversation-anchor-open',
    actionHint: 'send_runtime_agent_turn',
    source: 'runtime',
    message: 'Runtime-owned conversation anchor is open.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'runtime-local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
  };
}

function conversationUnavailable() {
  return {
    ...conversationReady(),
    ready: false,
    reasonCode: 'zhiyu-local-agent-required',
    actionHint: 'select_runtime_owned_partner',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: null,
  };
}

function pendingApproval(overrides = {}) {
  return {
    approvalRequestId: 'approval-1',
    agentId: 'runtime-local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    turnId: 'turn-1',
    providerProfileId: 'runtime-provider:opaque',
    capabilityId: 'calendar.read',
    toolName: 'calendar_lookup',
    firewallVerdict: 'approval_required',
    reasonCode: 'requires_human_approval',
    state: 1,
    delegationRequestId: 'deleg-request-1',
    effectClass: 1,
    sensitivityClass: 1,
    summaryRef: 'runtime-summary:approval-1',
    policySnapshotId: 'policy-snapshot:approval-1',
    ...overrides,
  };
}

function diagnostic(overrides = {}) {
  return {
    diagnosticId: 'deleg-decision-1',
    agentId: 'runtime-local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    turnId: 'turn-1',
    providerProfileId: 'runtime-provider:opaque',
    capabilityId: 'calendar.read',
    toolName: 'calendar_lookup',
    gatewayEvidenceId: 'gateway-evidence-1',
    firewallInputId: 'firewall-input-1',
    firewallVerdict: 'accepted_observation',
    runtimeDecision: 'context_candidate',
    reasonCode: '',
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    agentId: 'runtime-local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    approvalMode: 1,
    providerProfiles: [{ providerProfileId: 'runtime-provider:opaque', state: 3 }],
    approvalRequests: [],
    diagnostics: [],
    observedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

test('fails closed before delegated control read when conversation anchor is unavailable', async () => {
  const { probeZhiyuRuntimeDelegationUx } = await loadModule();
  let called = false;
  const status = await probeZhiyuRuntimeDelegationUx(conversationUnavailable(), {
    loadSnapshot: async () => {
      called = true;
      throw new Error('not expected');
    },
  });

  assert.equal(called, false);
  assert.equal(status.ready, false);
  assert.equal(status.state, 'blocked');
  assert.equal(status.reasonCode, 'zhiyu-conversation-anchor-required');
  assert.equal(status.candidateIntent.state, 'not_projected');
  assert.equal(status.outputFirewall.state, 'not_projected');
  assert.equal(status.audit.state, 'not_projected');
});

test('projects Runtime pending approval as candidate intent and preview without executing locally', async () => {
  const { probeZhiyuRuntimeDelegationUx } = await loadModule();
  const status = await probeZhiyuRuntimeDelegationUx(conversationReady(), {
    observedAt: '2026-07-02T00:00:01.000Z',
    loadSnapshot: async (input) => {
      assert.equal(input.localAgentRef, 'runtime-local-agent:opaque');
      assert.equal(input.conversationAnchorId, 'conversation-anchor:opaque');
      return snapshot({
        approvalRequests: [pendingApproval()],
      });
    },
  });

  assert.equal(status.ready, true);
  assert.equal(status.state, 'pending-approval');
  assert.equal(status.reasonCode, 'runtime-delegation-approval-pending');
  assert.equal(status.providerCount, 1);
  assert.equal(status.pendingApprovalCount, 1);
  assert.equal(status.candidateIntent.state, 'pending');
  assert.equal(status.candidateIntent.approvalRequestId, 'approval-1');
  assert.equal(status.candidateIntent.delegationRequestId, 'deleg-request-1');
  assert.equal(status.candidateIntent.summaryRef, 'runtime-summary:approval-1');
  assert.equal(status.preview.state, 'ready');
  assert.equal(status.preview.effectClass, 'read_only');
  assert.equal(status.preview.sensitivityClass, 'none');
  assert.equal(status.outputFirewall.state, 'approval-required');
  assert.equal(status.outputFirewall.firewallVerdict, 'approval_required');
  assert.equal(status.audit.state, 'approval-linked');
  assert.equal(status.audit.policySnapshotId, 'policy-snapshot:approval-1');
});

test('separates required delegation scopes from granted and admitted scope evidence', async () => {
  const { probeZhiyuRuntimeDelegationUx } = await loadModule();
  const status = await probeZhiyuRuntimeDelegationUx(conversationReady(), {
    loadSnapshot: async () => snapshot({
      grantedScopes: ['runtime.agent.delegation.read'],
      admittedScopes: ['runtime.agent.delegation.read'],
    }),
  });

  assert.deepEqual(status.requiredScopes, [
    'runtime.agent.delegation.read',
    'runtime.agent.delegation.write',
  ]);
  assert.deepEqual(status.grantedScopes, ['runtime.agent.delegation.read']);
  assert.deepEqual(status.admittedScopes, ['runtime.agent.delegation.read']);
  assert.deepEqual(status.scopeEvidence, {
    requiredScopes: [
      'runtime.agent.delegation.read',
      'runtime.agent.delegation.write',
    ],
    grantedScopes: ['runtime.agent.delegation.read'],
    admittedScopes: ['runtime.agent.delegation.read'],
    evidenceState: 'partial',
    reasonCode: 'runtime-delegation-scope-grant-partial',
  });
  assert.notDeepEqual(status.requiredScopes, status.grantedScopes);
});

test('fails closed before Runtime delegation RPC while the local-app capability is not admitted', async () => {
  const { probeZhiyuRuntimeDelegationUx } = await loadModule();
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      throw new Error('Runtime delegation RPC must not be invoked');
    },
  };
  try {
    const status = await probeZhiyuRuntimeDelegationUx(conversationReady());

    assert.equal(status.ready, false);
    assert.equal(status.state, 'blocked');
    assert.equal(status.reasonCode, 'zhiyu-delegation-capability-not-admitted');
    assert.equal(status.actionHint, 'admit_zhiyu_delegation_capability');
    assert.deepEqual(calls, []);
  } finally {
    delete globalThis.__NIMI_ELECTRON_TEST__;
  }
});

test('submits Runtime-owned deny decision without resuming delegated execution', async () => {
  const { submitZhiyuRuntimeDelegationApproval } = await loadModule();
  const calls = [];
  const status = await submitZhiyuRuntimeDelegationApproval({
    conversation: conversationReady(),
    approvalRequestId: 'approval-1',
    decision: 'reject',
  }, {
    submitApprovalDecision: async (input) => {
      calls.push({ method: 'submit', input });
      return {
        approvalRequest: pendingApproval({ state: 3, reasonCode: 'user_rejected' }),
      };
    },
    loadSnapshot: async () => snapshot({
      approvalRequests: [pendingApproval({ state: 3, reasonCode: 'user_rejected' })],
    }),
  });

  assert.deepEqual(calls.map((call) => call.method), ['submit']);
  assert.equal(calls[0].input.decision, 'reject');
  assert.equal(status.state, 'denied');
  assert.equal(status.reasonCode, 'runtime-delegation-approval-denied');
  assert.equal(status.lastDecision.state, 'denied');
  assert.equal(status.lastDecision.approvalRequestId, 'approval-1');
  assert.equal(status.candidateIntent.state, 'rejected');
  assert.equal(status.retryState, 'retry_available');
});

test('approves through Runtime without exposing a delegated execution resume path', async () => {
  const { submitZhiyuRuntimeDelegationApproval } = await loadModule();
  const calls = [];
  const status = await submitZhiyuRuntimeDelegationApproval({
    conversation: conversationReady(),
    approvalRequestId: 'approval-1',
    decision: 'approve',
  }, {
    submitApprovalDecision: async (input) => {
      calls.push({ method: 'submit', input });
      return {
        approvalRequest: pendingApproval({ state: 2, reasonCode: 'approved_once' }),
      };
    },
    loadSnapshot: async () => snapshot({
      diagnostics: [diagnostic()],
    }),
    loadReplayTrace: async (input) => {
      calls.push({ method: 'replay', input });
      return {
        replayId: 'replay-1',
        outcome: 1,
        stages: [{ kind: 3, stageId: 'firewall-input-1', state: 'accepted_observation' }],
        projectionDisposition: 'not_projected',
        actionDisposition: 'not_admitted',
        redacted: true,
      };
    },
  });

  assert.deepEqual(calls.map((call) => call.method), ['submit', 'replay']);
  assert.equal(status.state, 'diagnostic');
  assert.equal(status.lastDecision.state, 'approved');
  assert.equal(status.outputFirewall.state, 'accepted');
  assert.equal(status.outputFirewall.gatewayEvidenceId, 'gateway-evidence-1');
  assert.equal(status.audit.state, 'replay-linked');
  assert.equal(status.audit.replayOutcome, 'reconstructed');
});

test('renders firewall-blocked diagnostic and Runtime replay lineage as user-visible audit', async () => {
  const { probeZhiyuRuntimeDelegationUx } = await loadModule();
  const status = await probeZhiyuRuntimeDelegationUx(conversationReady(), {
    loadSnapshot: async () => snapshot({
      diagnostics: [diagnostic({
        firewallVerdict: 'policy_blocked',
        runtimeDecision: 'blocked',
        reasonCode: 'DELEG_FIREWALL_POLICY_BLOCKED',
      })],
    }),
    loadReplayTrace: async (input) => {
      assert.equal(input.decisionId, 'deleg-decision-1');
      return {
        replayId: 'runtime-replay:deleg-decision-1',
        outcome: 2,
        stages: [
          { kind: 1, stageId: 'deleg-request-1', state: 'requested', reasonCode: '' },
          { kind: 3, stageId: 'firewall-input-1', state: 'policy_blocked', reasonCode: 'DELEG_FIREWALL_POLICY_BLOCKED' },
        ],
        projectionDisposition: 'blocked_by_policy',
        actionDisposition: 'blocked_by_policy',
        redacted: true,
      };
    },
  });

  assert.equal(status.state, 'firewall-blocked');
  assert.equal(status.reasonCode, 'DELEG_FIREWALL_POLICY_BLOCKED');
  assert.equal(status.outputFirewall.state, 'blocked');
  assert.equal(status.outputFirewall.firewallInputId, 'firewall-input-1');
  assert.equal(status.audit.state, 'replay-linked');
  assert.equal(status.audit.decisionId, 'deleg-decision-1');
  assert.equal(status.audit.replayId, 'runtime-replay:deleg-decision-1');
  assert.equal(status.audit.replayOutcome, 'partial_redacted');
  assert.equal(status.audit.actionDisposition, 'blocked_by_policy');
  assert.equal(status.audit.stageCount, 2);
});
