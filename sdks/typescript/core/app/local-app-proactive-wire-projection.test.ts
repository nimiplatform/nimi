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
import { createPendingHooksClient, projectPendingHook } from './local-app-runtime-platform-proactive.js';
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
    hooks: [{ taskId: 'hook-1', revision: '1', scheduledFor: { seconds: '1792205941', nanos: 123 }, status: 2, systemCadence: false, canModify: true, publicPurpose: 'Revisit the observation' }],
  })));
  const runtime = { listLocalAppAgentPendingHooks: async () => wire } as Parameters<typeof createNimiLocalAppAgentConfigureRuntimeShell>[0];
  const client = createPendingHooksClient(createNimiLocalAppAgentConfigureRuntimeShell(runtime).pendingHooks);
  const projected = await client.list({ agentHandle: `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle });
  assert.equal(projected.hooks[0]?.publicPurpose, 'Revisit the observation');
  assert.deepEqual(projected.hooks[0]?.scheduledFor, { seconds: '1792205941', nanos: 123 });
});


test('optional purpose cannot break activity controls or admit private fields', () => {
 const activity = {taskId:'hook-1',revision:'1',scheduledFor:null,status:'pending',systemCadence:false,canModify:true};
 assert.equal(projectPendingHook(activity).publicPurpose, undefined);
 for (const publicPurpose of [null, false, {}, '', ' ', '观'.repeat(161)]) {
  const projected = projectPendingHook({...activity, publicPurpose});
  assert.equal(projected.publicPurpose, undefined);
  assert.equal(projected.canModify, true);
 }
 assert.equal(projectPendingHook({...activity, publicPurpose:'观'.repeat(160)}).publicPurpose, '观'.repeat(160));
 assert.throws(() => projectPendingHook({...activity, publicPurpose:'public',reason:'private'}));
 assert.throws(() => projectPendingHook({...activity,publicPurpose:'allowed',systemCadence:true}));
});

import { LocalAppAgentLifeProjection, LocalAppAgentLifePhase } from '../../core-generated/runtime-protobuf/runtime/v1/agent_life.js';
import { projectRuntimeLife, projectLife } from './local-app-runtime-platform-life.js';

test('binary life frames preserve typed time and activity identity',()=>{
 const wire=LocalAppAgentLifeProjection.fromBinary(LocalAppAgentLifeProjection.toBinary(LocalAppAgentLifeProjection.create({revision:'2',current:{frameId:'frame',activityRef:'activity',title:'Painting',phase:LocalAppAgentLifePhase.ACTIVE,startsAt:{seconds:'1792205941',nanos:123},endsAt:{seconds:'1792209541',nanos:456},progress:30}})));
 const life=projectRuntimeLife(wire);assert.deepEqual(life.current?.startsAt,{seconds:'1792205941',nanos:123});assert.equal(life.current?.activityRef,'activity');assert.throws(()=>projectLife({...life,privateReason:'hidden'}));
});
