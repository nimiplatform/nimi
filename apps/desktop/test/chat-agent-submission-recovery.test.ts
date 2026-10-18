import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileAgentSubmission } from '../src/shell/renderer/features/chat/chat-agent-submission-recovery.js';

test('explicit recovery uses one same-ID Send without requiring a snapshot',async()=>{
 const calls: unknown[]=[];
 const submission={requestId:'original-id',conversationAnchorId:'anchor',text:'question',artifactIds:['image'],retryOfTurnId:'failed-turn'};
 const conversation={snapshot:async()=>{throw new Error('snapshot must not gate recovery');},send:async(value:unknown)=>{calls.push(value);return {turnId:'original-turn'};}};
 assert.equal(await reconcileAgentSubmission({conversation:conversation as never,agentHandle:'handle' as never,submission,sendIfMissing:true,isCurrent:()=>true}),true);
 assert.deepEqual(calls,[{agentHandle:'handle',conversationAnchorId:'anchor',requestId:'original-id',retryOfTurnId:'failed-turn'}]);
});

test('read-only check never sends when a bounded snapshot does not contain the request',async()=>{
 const conversation={snapshot:async()=>({turns:[]}),send:async()=>{throw new Error('must not send');}};
 assert.equal(await reconcileAgentSubmission({conversation:conversation as never,agentHandle:'handle' as never,submission:{requestId:'id',conversationAnchorId:'anchor',text:'question',artifactIds:[]},sendIfMissing:false,isCurrent:()=>true}),false);
});
