import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GetLocalAppConversationSnapshotResponse,
  UpdateLocalAppConversationFollowUpPolicyResponse,
  LocalAppConversationState,
  LocalAppConversationEvent,
  ListLocalAppAgentPendingHooksResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import {
  createNimiLocalAppConversationRuntimeClient,
  type NimiLocalAppConversationRuntime,
} from './local-app-runtime-platform-direct-conversation.js';
import { createNimiLocalAppAgentConfigureRuntimeShell } from './local-app-runtime-platform-configure.js';
import { createPendingHooksClient } from './local-app-runtime-platform-proactive.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';

test('formal Conversation projects binary-decoded pending tasks without weakening plain-object validation', async () => {
  const state = LocalAppConversationState.fromBinary(LocalAppConversationState.toBinary(LocalAppConversationState.create({
    followUpEnabled: true, followUpPolicyRevision: '9', maxFollowUpTurns: 8,
    pendingFollowUp: { taskId: 'follow-up-1', revision: '1', sourceTurnId: 'turn-1', scheduledFor: { seconds: '1792205941', nanos: 204758000 } },
  })));
  assert.notEqual(Object.getPrototypeOf(state.pendingFollowUp), Object.prototype);
  const snapshot = GetLocalAppConversationSnapshotResponse.fromBinary(GetLocalAppConversationSnapshotResponse.toBinary(GetLocalAppConversationSnapshotResponse.create({
    snapshot: { conversationAnchorId: 'anchor-1', throughSequence: '1', state },
  })));
  const policy = UpdateLocalAppConversationFollowUpPolicyResponse.fromBinary(UpdateLocalAppConversationFollowUpPolicyResponse.toBinary({ state }));
  const client = createNimiLocalAppConversationRuntimeClient({
    getLocalAppConversationSnapshot: async () => snapshot,
    updateLocalAppConversationFollowUpPolicy: async () => policy,
    subscribeLocalAppConversationEvents: () => (async function* () {
      yield LocalAppConversationEvent.fromBinary(LocalAppConversationEvent.toBinary({
        conversationAnchorId: 'anchor-1', sequence: '2', event: { oneofKind: 'stateChanged', stateChanged: state },
      }));
    })(),
  } as NimiLocalAppConversationRuntime);
  const scope = { agentHandle: `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle, conversationAnchorId: 'anchor-1' };
  const projected = (await client.snapshot(scope)).state;
  assert.deepEqual(projected.pendingFollowUp?.scheduledFor, { seconds: '1792205941', nanos: 204758000 });
  assert.equal(Object.getPrototypeOf(projected.pendingFollowUp), Object.prototype);
  assert.deepEqual(await client.setFollowUpPolicy({ ...scope, expectedRevision: '8', enabled: true }), projected);
  const subscription = await client.subscribe(scope);
  const event = (await subscription[Symbol.asyncIterator]().next()).value;
  assert.equal(event?.type, 'state-changed');
  assert.deepEqual(event?.state, projected);
  await subscription.cancel();
});


test('formal Agent activity timestamps are projected from binary messages', async () => {
  const wire = ListLocalAppAgentPendingHooksResponse.fromBinary(ListLocalAppAgentPendingHooksResponse.toBinary(ListLocalAppAgentPendingHooksResponse.create({
    hooks: [{ taskId: 'hook-1', revision: '1', scheduledFor: { seconds: '1792205941', nanos: 123 }, status: 2, systemCadence: false, canModify: true }],
  })));
  const runtime = { listLocalAppAgentPendingHooks: async () => wire } as Parameters<typeof createNimiLocalAppAgentConfigureRuntimeShell>[0];
  const client = createPendingHooksClient(createNimiLocalAppAgentConfigureRuntimeShell(runtime).pendingHooks);
  const projected = await client.list({ agentHandle: `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle });
  assert.deepEqual(projected.hooks[0]?.scheduledFor, { seconds: '1792205941', nanos: 123 });
});
