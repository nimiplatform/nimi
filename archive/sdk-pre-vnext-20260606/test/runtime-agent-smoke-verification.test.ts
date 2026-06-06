import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeAgentSmokeVerificationSurface,
} from '../src/runtime/index.js';

function createRuntime() {
  const calls = {
    registerApp: 0,
    authorizeExternalPrincipal: 0,
    getSnapshot: [] as Array<Record<string, unknown>>,
  };
  return {
    calls,
    runtime: {
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
          return { tokenId: 'token-id', secret: 'token-secret' };
        },
      },
      agent: {
        anchors: {
          getSnapshot: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
            calls.getSnapshot.push({ ...request, __options: options });
            return {
              anchor: {
                agentId: request.localAgentRef,
                conversationAnchorId: request.conversationAnchorId,
                status: 'ready',
                lastTurnId: 'turn-1',
                lastMessageId: 'message-1',
              },
              activeTurnId: '',
              activeStreamId: 'stream-1',
            };
          },
        },
      },
      health: async () => ({
        status: 'ok',
        reason: '',
        queueDepth: 0,
        activeWorkflows: 0,
        activeInferenceJobs: 0,
        sampledAt: '2026-01-01T00:00:00.000Z',
      }),
    },
  };
}

test('Runtime agent smoke verification surface verifies anchors through SDK protected scope handling', async () => {
  const { calls, runtime } = createRuntime();
  const surface = createRuntimeAgentSmokeVerificationSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'owner-1',
    withTimeout: async (_label, task) => task,
  });

  await surface.verifyConversationAnchor({
    agentId: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
  });

  assert.equal(calls.registerApp, 1);
  assert.equal(calls.authorizeExternalPrincipal, 1);
  assert.deepEqual(calls.getSnapshot[0]?.ownerUserId, 'owner-1');
  assert.deepEqual(calls.getSnapshot[0]?.realmAgentId, 'agent-1');
  assert.ok(calls.getSnapshot[0]?.__options);
});

test('Runtime agent smoke verification surface projects product-path evidence without app-owned scope construction', async () => {
  const { runtime } = createRuntime();
  const surface = createRuntimeAgentSmokeVerificationSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'owner-1',
    withTimeout: async (_label, task) => task,
  });

  const evidence = await surface.readProductPathEvidence({
    agentId: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
  });

  assert.equal(evidence.runtime_authenticated, true);
  assert.deepEqual(evidence.runtime_auth_scopes, ['runtime.agent.read']);
  assert.equal(evidence.agent_id, 'local-agent:owner-1:agent-1');
  assert.equal(evidence.conversation_anchor_id, 'anchor-1');
  assert.equal(evidence.subject_user_id, 'owner-1');
  assert.equal(evidence.has_runtime_turn, true);
});

test('Runtime agent smoke verification fails closed for invalid local agent refs', async () => {
  const { runtime } = createRuntime();
  const surface = createRuntimeAgentSmokeVerificationSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'owner-1',
    withTimeout: async (_label, task) => task,
  });

  await assert.rejects(
    () => surface.verifyConversationAnchor({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
    }),
    /localAgentRef formatted as local-agent/,
  );
});
