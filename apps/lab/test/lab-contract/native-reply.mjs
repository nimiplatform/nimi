import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupBehaviorModules, importBehaviorModule } from './helpers.mjs';
test.after(cleanupBehaviorModules);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}};
const source={eventId:'source',messageId:'actual-source',conversation:{kind:'c2c',id:'specified'},senderId:'specified',replyRef:'opaque-current-source',segments:[{kind:'text',text:'原始消息😀',origin:'platform-transcription'}],platformTime:'2026-10-06T10:00:00Z',receivedAt:'2026-10-06T10:00:01Z'};
const result=(text='候选回复')=>({ok:true,capabilityId:'chat.stream',capabilityLabel:'Chat Stream',message:'Actual fixture inference completed.',output:{kind:'text',text,finishReason:'stop',streamed:true},trace:{traceId:'trace-fixture'}});
const messageFact=(status='completed')=>({callId:'ic_reply',targetRef:'target-original',operation:'qq-official.messages.reply',status,resultJson:status==='completed'?'{"confirmation":"message-created","messageId":"native-original"}':'',errorCode:'',consumerDisplayName:'Lab',targetDisplayName:'QQ',accountLabel:'bot',createdAt:'2026-10-06T10:00:00Z',updatedAt:'2026-10-06T10:00:01Z'});
const config={target:{capabilityId:'chat.stream',capabilityContract:'text.generate',section:'chat',status:'configured',source:'local',intentLabel:'Local',detail:'Configured fixture',params:{},paramsSummary:[],profileOrigin:null},promptControls:{contextAttached:true,attachmentCount:0}};
async function fixture(overrides={}){
 const {createNativeReplyController}=await importBehaviorModule('lab/integrations/native-reply-controller.js');
 const {integrationHistoryRecord}=await importBehaviorModule('lab/integrations/integration-history-model.js');
 const calls={ai:[],messages:[],aiRecords:[],messageRecords:[],cancels:[],states:[]};let id=0;
 const controller=createNativeReplyController({targetRef:'target-original',adapter:'qq-official',event:source,currentScope:()=>true,authStatus:async()=>({sessionBound:true}),prepareAI:async()=>({runId:`ai-${++id}`,createdAt:'2026-10-06T10:00:00Z',runConfig:config}),generate:async request=>{calls.ai.push(request);return result()},recordAI:async record=>{calls.aiRecords.push(record)},integration:{invoke:async request=>{calls.messages.push(request);return messageFact()},getCall:()=>assert.fail('terminal fixture was polled'),cancelCall:async request=>{calls.cancels.push(request);return messageFact('unconfirmed')}},recordIntegration:async(inputJson,call)=>{calls.messageRecords.push(integrationHistoryRecord({kind:'qq-official',displayName:'QQ'},inputJson,call))},onState:state=>calls.states.push(state),...overrides});
 return{controller,calls};
}

test('AI draft requires distinct review/send and consumes one exact-source dispatch synchronously',async()=>{
 const{controller,calls}=await fixture();await controller.generate();
 assert.equal(calls.ai.length,1);assert.equal(calls.ai[0].capabilityId,'chat.stream');assert.match(calls.ai[0].prompt,/原始消息😀/u);
 assert.equal(calls.messages.length,0);assert.equal(controller.getState().phase,'draft');
 controller.editDraft('人工检查后的正文');const send=controller.send();assert.equal(controller.send(),null);await send;
 assert.equal(calls.messages.length,1);assert.equal(calls.messages[0].targetRef,'target-original');
 assert.deepEqual(JSON.parse(calls.messages[0].inputJson),{replyRef:'opaque-current-source',body:{kind:'text',text:'人工检查后的正文'}});
 assert.equal(controller.getState().phase,'sent');assert.equal(controller.send(),null);
 assert.equal(calls.aiRecords[0].capabilityId,'chat.stream');assert.equal(calls.messageRecords[0].kind,'integration');assert.equal(Object.hasOwn(calls.messageRecords[0],'capabilityId'),false);
 assert.equal(calls.messageRecords[0].inputJson,'');assert.equal(calls.messageRecords[0].resultJson,'');
});

test('an issued AI reply holds same-scope history through disposal and late actual cancellation facts',async()=>{
 const {integrationHistoryWork}=await importBehaviorModule('lab/integrations/integration-history-work.js');const scope={};const work=integrationHistoryWork(scope);
 const invoked=deferred(),canceled=deferred();const observations=[];
 const {controller}=await fixture({holdIntegrationFact:id=>work.hold(id),integration:{invoke:()=>invoked.promise,getCall:()=>assert.fail('terminal fixture queried'),cancelCall:()=>canceled.promise},recordIntegration:async(_input,call)=>observations.push(call.status)});
 await controller.generate();const sending=controller.send();invoked.resolve(messageFact('accepted'));for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(integrationHistoryWork(scope).busy('ic_reply'),true);const disposed=controller.dispose();assert.equal(work.busy('ic_reply'),true);
 canceled.resolve(messageFact('unconfirmed'));await sending;await disposed;assert.deepEqual(observations,['accepted','unconfirmed']);assert.equal(work.busy('ic_reply'),false);
});

test('AI facts use existing history codec and exclude source/draft bodies unless explicitly saved',async()=>{
 const{parseStudioRunHistory}=await importBehaviorModule('ai-studio-core/history-policy.js');
 for(const saveBodies of [false,true]){
  const draft='PRIVATE_DRAFT_SENTINEL😀';const{controller,calls}=await fixture({generate:async()=>({...result(draft),message:`Received: "原始消息😀". ${draft}`})});await controller.generate(saveBodies);
  const record=calls.aiRecords[0];assert.equal(record.status,'ready');assert.equal(record.result.traceId,'trace-fixture');assert.equal(record.result.charCount,draft.length);assert.equal(record.result.finishReason,'stop');assert.equal(record.result.streamed,true);
  assert.equal(record.prompt.includes('原始消息'),saveBodies);assert.equal(record.result.body,saveBodies?draft:'');assert.equal(record.result.summary,saveBodies?draft:'');
  const reopened=parseStudioRunHistory(JSON.parse(JSON.stringify({'chat.stream':[record]})));assert.deepEqual(reopened['chat.stream'][0],JSON.parse(JSON.stringify(record)));
  const exported=JSON.stringify(reopened);assert.equal(exported.includes('原始消息'),saveBodies);assert.equal(exported.includes('PRIVATE_DRAFT_SENTINEL'),saveBodies);
 }
});

test('default stopped and failed AI facts omit content-bearing messages throughout the serialized record',async()=>{
 const{parseStudioRunHistory}=await importBehaviorModule('ai-studio-core/history-policy.js');
 const{getStudioRunResultSummary}=await importBehaviorModule('ai-studio-core/history.js');
 for(const [reason,status] of [['operation-aborted','canceled'],['runtime-canceled','canceled'],['runtime-call-failed','failed'],['runtime-timeout','timed-out']]){
  for(const saveBodies of [false,true]){
   const diagnostics={reasonCode:'AI_PROVIDER_UNAVAILABLE',actionHint:'retry_runtime_request',traceId:'actual-error-trace',retryable:true,source:'runtime'};
   const failure={ok:false,capabilityId:'chat.stream',reason,message:'Provider echoed 原始消息😀 and PRIVATE_FAILURE_PREVIEW_SENTINEL',actionHint:'Check the configured connection.',diagnostics};
   const{controller,calls}=await fixture({generate:async()=>failure});await controller.generate(saveBodies);
   const record=calls.aiRecords[0];const serialized=JSON.stringify(record);
   assert.equal(record.id,'ai-1');assert.equal(record.createdAt,'2026-10-06T10:00:00Z');assert.equal(record.capabilityId,'chat.stream');assert.equal(record.status,status);assert.equal(record.result.reason,reason);
   assert.deepEqual(record.result.diagnostics,diagnostics);assert.equal(record.runConfig.traceId,'actual-error-trace');assert.equal(record.result.actionHint,failure.actionHint);
   assert.equal(serialized.includes('原始消息😀'),saveBodies);assert.equal(serialized.includes('PRIVATE_FAILURE_PREVIEW_SENTINEL'),saveBodies);
   const reopened=parseStudioRunHistory(JSON.parse(JSON.stringify({'chat.stream':[record]})))['chat.stream'][0];
   assert.deepEqual(reopened,JSON.parse(serialized));assert.equal(getStudioRunResultSummary(reopened).includes('PRIVATE_FAILURE_PREVIEW_SENTINEL'),saveBodies);
   assert.equal(controller.getState().phase,'failed');assert.equal(controller.send(),null);assert.equal(calls.messages.length,0);
  }
 }
});

test('stop during AI configuration admission prevents the later inference and send',async()=>{
 const held=deferred(),entered=deferred();let ai=0;
 const{controller}=await fixture({prepareAI:()=>{entered.resolve();return held.promise},generate:async()=>{ai++;return result()}});
 const run=controller.generate();await entered.promise;controller.stop();held.resolve({runId:'old',createdAt:'2026-10-06T10:00:00Z',runConfig:config});await run;
 assert.equal(ai,0);assert.equal(controller.getState().draft,'');assert.equal(controller.send(),null);
});

test('stopped, disposed and changed-scope late inference cannot publish a draft or gain send authorization',async()=>{
 for(const mode of ['stop','dispose','scope']){
  const held=deferred(),entered=deferred();let scope=true;let signal;const records=[];
  const{controller,calls}=await fixture({currentScope:()=>scope,generate:request=>{signal=request.signal;entered.resolve();return held.promise},recordAI:async record=>records.push(record)});
  const run=controller.generate();await entered.promise;
  let drained;if(mode==='stop')controller.stop();else if(mode==='dispose')drained=controller.dispose();else{scope=false;controller.invalidateScope()}
  assert.equal(signal.aborted,true);held.resolve(result('迟到正文'));await run;await drained;
  assert.equal(controller.getState().draft,'');assert.equal(controller.send(),null);assert.equal(calls.messages.length,0);
  assert.equal(records.length,mode==='scope'?0:1,'actual inference facts may survive leaving only in the original scope');
  assert.equal(calls.states.some(state=>state.phase==='draft'),false);
 }
});

test('an older generation completing last cannot replace a newly reviewed draft',async()=>{
 const held=deferred(),entered=deferred();let attempts=0;
 const{controller}=await fixture({generate:()=>{attempts++;if(attempts===1){entered.resolve();return held.promise}return Promise.resolve(result('新草稿'))}});
 const old=controller.generate();await entered.promise;controller.stop();await controller.generate();assert.equal(controller.getState().draft,'新草稿');
 held.resolve(result('旧草稿'));await old;assert.equal(controller.getState().draft,'新草稿');
});

test('stop while recording an inference fact prevents a later draft publication',async()=>{
 const held=deferred(),entered=deferred();
 const{controller,calls}=await fixture({recordAI:()=>{entered.resolve();return held.promise}});
 const run=controller.generate();await entered.promise;controller.stop();held.resolve();await run;
 assert.equal(controller.getState().phase,'stopped');assert.equal(controller.getState().draft,'');assert.equal(calls.messages.length,0);
});

test('stop or scope loss during send admission cannot issue a new message',async()=>{
 for(const mode of ['stop','scope']){
  const held=deferred(),entered=deferred();let checks=0;
  const{controller,calls}=await fixture({authStatus:async()=>{checks++;if(checks===4){entered.resolve();return held.promise}return{sessionBound:true}}});
  await controller.generate();const send=controller.send();await entered.promise;
  if(mode==='stop')controller.stop();else controller.invalidateScope();held.resolve({sessionBound:true});await send;
  assert.equal(calls.messages.length,0);assert.equal(controller.send(),null);
 }
});

test('a message accepted after leaving is canceled once and its real unknown fact is retained separately',async()=>{
 const held=deferred(),entered=deferred();let dispatches=0,cancels=0;const recorded=[];
 const{controller}=await fixture({integration:{invoke:()=>{dispatches++;entered.resolve();return held.promise},getCall:()=>assert.fail('late stopped call polled'),cancelCall:async()=>{cancels++;return messageFact('unconfirmed')}},recordIntegration:async(_input,call)=>recorded.push(call)});
 await controller.generate();const send=controller.send();await entered.promise;const drained=controller.dispose();held.resolve(messageFact('accepted'));await send;await drained;
 assert.equal(dispatches,1);assert.equal(cancels,1);assert.deepEqual(recorded.map(call=>call.status),['accepted','unconfirmed']);assert.equal(controller.send(),null);
});

test('unknown sending stays unknown and never automatically reuses a draft or retries',async()=>{
 let dispatches=0;const{controller}=await fixture({integration:{invoke:async()=>{dispatches++;return messageFact('unconfirmed')},getCall:()=>assert.fail(),cancelCall:()=>assert.fail()}});
 await controller.generate();await controller.send();assert.equal(controller.getState().integrationCall.status,'unconfirmed');assert.equal(controller.getState().draft,'');assert.equal(controller.send(),null);assert.equal(dispatches,1);
});

test('missing configuration and incomplete or oversized inference do not masquerade as sendable replies',async()=>{
 for(const fault of ['config','length','incomplete','unbound']){
  const{controller,calls}=await fixture({...(fault==='config'?{prepareAI:async()=>{throw new Error('AIConfig is absent')}}:{}),...(fault==='length'?{generate:async()=>result('x'.repeat(32769))}:{}),...(fault==='incomplete'?{generate:async()=>({...result(),output:{...result().output,finishReason:'length'}})}:{}),...(fault==='unbound'?{authStatus:async()=>({sessionBound:false,reasonCode:'account-changed'})}:{})});
  await controller.generate();assert.equal(controller.getState().phase,'failed');assert.equal(controller.getState().draft,'');assert.equal(controller.send(),null);assert.equal(calls.messages.length,0);
 }
});
