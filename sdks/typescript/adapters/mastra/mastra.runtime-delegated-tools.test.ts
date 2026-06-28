import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import {
  type NimiRuntimeAgentDelegatedCapabilitySurface,
} from '@nimiplatform/sdk/runtime';

import {
  createNimiMastraModel,
  createNimiMastraRuntimeDelegatedToolBinding,
  createNimiMastraRuntimeDelegatedTool,
  NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_APPROVAL_REQUIRED_CODE,
  NimiMastraRuntimeDelegatedToolApprovalRequiredError,
  resumeNimiMastraRuntimeDelegatedTool,
} from './index';
import { createMastraTestAgent, createNimiFixtureModel } from './mastra.fixtures';

const runtimeIdentity = {
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'runtime-source-1',
  localAgentRef: 'local-agent:agent-1',
} as const;

function createRuntimeSurface(
  overrides: Partial<NimiRuntimeAgentDelegatedCapabilitySurface>,
): NimiRuntimeAgentDelegatedCapabilitySurface {
  return {
    async loadSnapshot() {
      throw new Error('unexpected loadSnapshot');
    },
    async loadReplayTrace() {
      throw new Error('unexpected loadReplayTrace');
    },
    async upsertProviderProfile() {
      throw new Error('unexpected upsertProviderProfile');
    },
    async setProviderEnabled() {
      throw new Error('unexpected setProviderEnabled');
    },
    async submitApprovalDecision() {
      throw new Error('unexpected submitApprovalDecision');
    },
    async executeCapability() {
      throw new Error('unexpected executeCapability');
    },
    async resumeApprovedCapability() {
      throw new Error('unexpected resumeApprovedCapability');
    },
    ...overrides,
  };
}

test('Mastra Runtime delegated tool executes through Nimi Runtime and propagates model output', async () => {
  const runtimeCalls: unknown[] = [];
  const runtime = createRuntimeSurface({
    async executeCapability(input) {
      runtimeCalls.push(input);
      return {
        diagnostic: {
          firewallVerdict: 'ACCEPTED_OBSERVATION',
        },
        output: { forecast: `runtime:${input.arguments?.city}` },
      };
    },
  });
  const fixture = createNimiFixtureModel({
    results: [
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [{ id: 'call-weather-1', name: 'weather', arguments: { city: 'Paris' } }],
      },
      {
        text: 'Runtime says Paris is sunny.',
        finishReason: 'stop',
      },
    ],
  });
  const weather = createNimiMastraRuntimeDelegatedTool({
    id: 'weather',
    description: 'Lookup weather through Runtime delegated capability',
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({ forecast: z.string() }),
    binding: {
      runtime,
      ...runtimeIdentity,
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      streamId: 'stream-1',
      requestId: 'tool-call-1',
      providerProfileId: 'provider-1',
      capabilityId: 'weather.lookup',
      descriptorHash: 'sha256:weather',
      protocolRevision: '2026-06-09',
      outputKind: 'observation',
    },
  });
  const agent = createMastraTestAgent({
    name: 'runtime-delegated-tool',
    instructions: 'Use the weather tool.',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: { weather },
  });

  const result = await agent.generate('weather in Paris', { maxSteps: 3 });

  assert.equal(result.text, 'Runtime says Paris is sunny.');
  assert.equal(runtimeCalls.length, 1);
  assert.deepEqual(runtimeCalls[0], {
    ...runtimeIdentity,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    requestId: 'tool-call-1',
    providerProfileId: 'provider-1',
    capabilityId: 'weather.lookup',
    toolName: 'weather',
    arguments: { city: 'Paris' },
    descriptorHash: 'sha256:weather',
    protocolRevision: '2026-06-09',
    outputKind: 'observation',
    requiresApproval: undefined,
  });
  assert.equal(fixture.calls.length, 2);
});

test('Mastra Runtime delegated tool binding helper centralizes Nimi turn lineage', async () => {
  const runtimeCalls: unknown[] = [];
  const runtime = createRuntimeSurface({
    async executeCapability(input) {
      runtimeCalls.push(input);
      return {
        diagnostic: {
          firewallVerdict: 'ACCEPTED_OBSERVATION',
        },
        output: { ok: true },
      };
    },
  });
  const tool = createNimiMastraRuntimeDelegatedTool({
    id: 'search',
    description: 'Search through Runtime',
    inputSchema: z.object({ q: z.string() }),
    binding: createNimiMastraRuntimeDelegatedToolBinding({
      runtime,
      ...runtimeIdentity,
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      streamId: 'stream-1',
      requestId: 'run-tool-call-1',
      providerProfileId: 'search-provider',
      capabilityId: 'search.query',
      descriptorHash: 'sha256:search',
      protocolRevision: '2026-06-09',
      outputKind: 'observation',
    }),
  });

  const result = await tool.execute?.({ q: 'nimi' }, {} as never);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(runtimeCalls, [{
    ...runtimeIdentity,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    requestId: 'run-tool-call-1',
    providerProfileId: 'search-provider',
    capabilityId: 'search.query',
    toolName: 'search',
    arguments: { q: 'nimi' },
    descriptorHash: 'sha256:search',
    protocolRevision: '2026-06-09',
    outputKind: 'observation',
    requiresApproval: undefined,
  }]);
});

test('Mastra Runtime delegated tool fails closed on Runtime approval-required response', async () => {
  const runtime = createRuntimeSurface({
    async executeCapability() {
      return {
        diagnostic: {
          diagnosticId: 'approval-1',
          agentId: 'agent-1',
          conversationAnchorId: 'anchor-1',
          turnId: 'turn-1',
          providerProfileId: 'provider-1',
          capabilityId: 'delete.user',
          toolName: 'deleteUser',
          gatewayEvidenceId: '',
          firewallInputId: '',
          firewallVerdict: 'APPROVAL_REQUIRED',
          runtimeDecision: 'approval_required',
          reasonCode: 'DELEG_APPROVAL_REQUIRED',
        },
        approvalRequest: {
          approvalRequestId: 'approval-1',
          agentId: 'agent-1',
          conversationAnchorId: 'anchor-1',
          turnId: 'turn-1',
          providerProfileId: 'provider-1',
          capabilityId: 'delete.user',
          toolName: 'deleteUser',
          firewallVerdict: 'APPROVAL_REQUIRED',
          reasonCode: 'DELEG_APPROVAL_REQUIRED',
          state: 'pending',
          delegationRequestId: 'delegation-1',
          effectClass: 'external_side_effect',
          sensitivityClass: 'unknown_sensitive',
          summaryRef: 'summary-1',
          policySnapshotId: 'policy-1',
        },
      };
    },
  });
  const deleteUser = createNimiMastraRuntimeDelegatedTool({
    id: 'deleteUser',
    description: 'Delete user through Runtime delegated capability',
    inputSchema: z.object({ userId: z.string() }),
    binding: {
      runtime,
      ...runtimeIdentity,
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      capabilityId: 'delete.user',
      descriptorHash: 'sha256:deleteUser',
      requiresApproval: true,
    },
  });

  await assert.rejects(
    async () => await deleteUser.execute?.({ userId: 'u-1' }, {} as never),
    (error: unknown) => {
      assert.ok(error instanceof NimiMastraRuntimeDelegatedToolApprovalRequiredError);
      assert.equal(error.code, NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_APPROVAL_REQUIRED_CODE);
      assert.equal(error.approvalRequestId, 'approval-1');
      return true;
    },
  );
});

test('Mastra Runtime delegated tool fails closed when firewall verdict evidence is missing', async () => {
  const runtime = createRuntimeSurface({
    async executeCapability() {
      return { output: { ok: true } };
    },
  });
  const tool = createNimiMastraRuntimeDelegatedTool({
    id: 'search',
    description: 'Search through Runtime',
    inputSchema: z.object({ q: z.string() }),
    binding: {
      runtime,
      ...runtimeIdentity,
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      capabilityId: 'search.query',
      descriptorHash: 'sha256:search',
    },
  });

  const execute = tool.execute;
  if (!execute) {
    throw new Error('delegated tool execute function is required');
  }
  await assert.rejects(
    () => execute({ q: 'nimi' }, {} as never),
    (error: unknown) => (
      (error as { readonly reasonCode?: string }).reasonCode
      === 'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_FIREWALL_VERDICT_REQUIRED'
    ),
  );
});

test('Mastra Runtime delegated tool resume uses Runtime-owned approval resume', async () => {
  const resumeCalls: unknown[] = [];
  const runtime = createRuntimeSurface({
    async resumeApprovedCapability(input) {
      resumeCalls.push(input);
      return {
        diagnostic: {
          firewallVerdict: 'ACCEPTED_OBSERVATION',
        },
        output: { deleted: true, userId: 'u-1' },
      };
    },
  });

  const result = await resumeNimiMastraRuntimeDelegatedTool({
    runtime,
    ...runtimeIdentity,
    approvalRequestId: 'approval-1',
  });

  assert.deepEqual(result, { deleted: true, userId: 'u-1' });
  assert.deepEqual(resumeCalls, [{ ...runtimeIdentity, approvalRequestId: 'approval-1' }]);
});
