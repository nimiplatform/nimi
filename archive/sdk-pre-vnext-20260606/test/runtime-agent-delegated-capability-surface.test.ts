import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DelegatedApprovalDecision,
  DelegatedApprovalMode,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedReplayOutcome,
  DelegatedTransportKind,
  buildRuntimeAgentDelegatedProviderProfileFromDraft,
  createHostRuntimeAgentDelegatedCapabilitySurface,
} from '../src/runtime/index.js';

function createRuntime() {
  const calls = {
    registerApp: 0,
    authorizeExternalPrincipal: 0,
    snapshot: [] as Array<Record<string, unknown>>,
    upsert: [] as Array<Record<string, unknown>>,
    state: [] as Array<Record<string, unknown>>,
    approval: [] as Array<Record<string, unknown>>,
    replay: [] as Array<Record<string, unknown>>,
  };
  const runtime = {
    appId: 'sdk-test',
    auth: {
      registerApp: async () => {
        calls.registerApp += 1;
        return { accepted: true };
      },
    },
    appAuth: {
      authorizeExternalPrincipal: async () => {
        calls.authorizeExternalPrincipal += 1;
        return { tokenId: `token-${calls.authorizeExternalPrincipal}`, secret: 'secret' };
      },
    },
    agent: {
      getDelegatedControlSurfaceSnapshot: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.snapshot.push({ ...request, __options: options });
        return {
          snapshot: {
            agentId: request.agentId as string,
            conversationAnchorId: request.conversationAnchorId as string,
            approvalMode: DelegatedApprovalMode.REQUIRE_USER,
            providerProfiles: [],
            approvalRequests: [],
            diagnostics: [],
          },
        };
      },
      upsertDelegatedProviderProfile: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.upsert.push({ ...request, __options: options });
        return { providerProfile: request.providerProfile };
      },
      setDelegatedProviderState: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.state.push({ ...request, __options: options });
        return {
          providerProfile: {
            providerProfileId: request.providerProfileId as string,
            displayName: request.providerProfileId as string,
            providerKind: DelegatedProviderKind.MCP_TOOL_PROVIDER,
            transportKind: DelegatedTransportKind.STDIO_COMMAND,
            state: request.state as DelegatedProviderState,
            allowedTools: [],
            credentialRef: '',
            transportRef: '',
            trustTier: DelegatedProviderTrustTier.USER_ADDED_REVIEWED,
            lifecycleReasonCode: request.lifecycleReasonCode as string,
            command: '',
            args: [],
          },
        };
      },
      submitDelegatedApprovalDecision: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.approval.push({ ...request, __options: options });
        return {
          approvalRequest: {
            approvalRequestId: request.approvalRequestId as string,
            agentId: request.agentId as string,
            conversationAnchorId: '',
            turnId: '',
            providerProfileId: '',
            capabilityId: '',
            toolName: '',
            firewallVerdict: '',
            reasonCode: '',
            state: 0,
          },
        };
      },
      getDelegatedReplayTrace: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.replay.push({ ...request, __options: options });
        return {
          trace: {
            replayId: 'replay-1',
            agentId: request.agentId as string,
            conversationAnchorId: request.conversationAnchorId as string,
            turnId: request.turnId as string,
            providerProfileId: 'profile-1',
            capabilityId: 'capability-1',
            toolName: 'tool',
            outcome: DelegatedReplayOutcome.RECONSTRUCTED,
            reasonCode: '',
            stages: [],
            projectionDisposition: 'projected',
            actionDisposition: 'allowed',
            redacted: false,
          },
        };
      },
    },
  };
  return { calls, runtime };
}

test('Runtime agent delegated provider draft builder fixes admitted MCP stdio profile fields', () => {
  assert.deepEqual(buildRuntimeAgentDelegatedProviderProfileFromDraft({
    agentId: 'local-agent:user-1:agent-1',
    providerProfileId: 'profile-1',
    displayName: '',
    transportRef: 'stdio://tool',
    credentialRef: 'credential-1',
    command: 'tool-server',
    args: '--mode strict',
    toolName: 'search',
    inputSchemaDigest: 'sha256:test',
  }), {
    providerProfileId: 'profile-1',
    displayName: 'profile-1',
    providerKind: DelegatedProviderKind.MCP_TOOL_PROVIDER,
    transportKind: DelegatedTransportKind.STDIO_COMMAND,
    state: DelegatedProviderState.READY,
    allowedTools: [{ toolName: 'search', inputSchemaDigest: 'sha256:test' }],
    credentialRef: 'credential-1',
    transportRef: 'stdio://tool',
    trustTier: DelegatedProviderTrustTier.USER_ADDED_REVIEWED,
    lifecycleReasonCode: '',
    command: 'tool-server',
    args: ['--mode', 'strict'],
  });
});

test('host Runtime agent delegated capability surface composes protected read and write calls', async () => {
  const { calls, runtime } = createRuntime();
  const surface = createHostRuntimeAgentDelegatedCapabilitySurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    disabledProviderReasonCode: 'disabled_by_test',
  });

  assert.equal((await surface.loadSnapshot({
    agentId: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
  }))?.conversationAnchorId, 'anchor-1');
  assert.equal((await surface.upsertProviderProfile({
    agentId: 'local-agent:user-1:agent-1',
    providerProfileId: 'profile-1',
    displayName: 'Profile',
    transportRef: 'stdio://tool',
    credentialRef: '',
    command: 'tool-server',
    args: '',
    toolName: 'search',
    inputSchemaDigest: '',
  }))?.providerProfileId, 'profile-1');
  assert.equal((await surface.setProviderEnabled(
    'local-agent:user-1:agent-1',
    'profile-1',
    false,
  ))?.lifecycleReasonCode, 'disabled_by_test');
  assert.equal((await surface.submitApprovalDecision(
    'local-agent:user-1:agent-1',
    'approval-1',
    'approve',
    'looks valid',
  )).approvalRequest?.approvalRequestId, 'approval-1');
  assert.equal((await surface.loadReplayTrace(
    'local-agent:user-1:agent-1',
    'decision-1',
    'anchor-1',
    'turn-1',
  ))?.replayId, 'replay-1');

  assert.equal(calls.registerApp, 1);
  assert.equal(calls.authorizeExternalPrincipal, 2);
  assert.equal(calls.approval[0]?.decision, DelegatedApprovalDecision.APPROVE);
  assert.deepEqual(calls.snapshot[0]?.context, {
    appId: 'sdk-test',
    subjectUserId: 'user-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
  });
  assert.ok(calls.snapshot[0]?.__options);
  assert.ok(calls.upsert[0]?.__options);
});
