import assert from 'node:assert/strict';
import test from 'node:test';
import { GetLocalAppConversationSnapshotResponse, CancelLocalAppConversationFollowUpResponse, LocalAppConversationState, LocalAppConversationEvent, LocalAppConversationTurnStatus } from '../../core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import { LocalAppAgentLifeProjection, LocalAppAgentLifePhase } from '../../core-generated/runtime-protobuf/runtime/v1/agent_life.js';
import { createNimiLocalAppConversationRuntimeClient, type NimiLocalAppConversationRuntime } from './local-app-runtime-platform-direct-conversation.js';
import { projectRuntimeLife, projectLife } from './local-app-runtime-platform-life.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';

test('binary Conversation exposes one free-contact policy and cancellation only',async()=>{
 const state=LocalAppConversationState.fromBinary(LocalAppConversationState.toBinary(LocalAppConversationState.create({freeContactEnabled:true,maxFollowUpTurns:8,pendingFollowUp:{taskId:'follow-1',revision:'1',sourceTurnId:'turn-1',scheduledFor:{seconds:'1792205941',nanos:123}}})));
 const wire=GetLocalAppConversationSnapshotResponse.create({snapshot:{conversationAnchorId:'anchor',throughSequence:'1',state}});
 let received:unknown;
 const client=createNimiLocalAppConversationRuntimeClient({getLocalAppConversationSnapshot:async()=>wire,cancelLocalAppConversationFollowUp:async input=>{received=input;return CancelLocalAppConversationFollowUpResponse.create({state:{...state,pendingFollowUp:undefined}});}} as NimiLocalAppConversationRuntime);
 const scope={agentHandle:`agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle,conversationAnchorId:'anchor'};
 const snapshot=await client.snapshot(scope);assert.deepEqual(snapshot.state.pendingFollowUp?.scheduledFor,{seconds:'1792205941',nanos:123});
 assert.equal('setFollowUpPolicy' in client,false);assert.equal('updateFollowUp' in client,false);
 const input={...scope,taskId:'follow-1',expectedRevision:'1'};assert.equal((await client.cancelFollowUp(input)).pendingFollowUp,null);assert.deepEqual(received,input);
});

test('binary life frames preserve typed time and activity identity',()=>{
 const wire=LocalAppAgentLifeProjection.fromBinary(LocalAppAgentLifeProjection.toBinary(LocalAppAgentLifeProjection.create({revision:'2',current:{frameId:'frame',activityRef:'activity',title:'Painting',phase:LocalAppAgentLifePhase.ACTIVE,startsAt:{seconds:'1792205941',nanos:123},endsAt:{seconds:'1792209541',nanos:456},progress:30}})));
 const life=projectRuntimeLife(wire);assert.deepEqual(life.current?.startsAt,{seconds:'1792205941',nanos:123});assert.equal(life.current?.activityRef,'activity');assert.throws(()=>projectLife({...life,privateReason:'hidden'}));
});
