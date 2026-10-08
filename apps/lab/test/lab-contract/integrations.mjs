import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { cleanupBehaviorModules, importBehaviorModule } from './helpers.mjs';
test.after(cleanupBehaviorModules);
const model=()=>importBehaviorModule('lab/integrations/integration-history-model.js');
const runner=()=>importBehaviorModule('lab/integrations/integration-run.js');

test('QQ and Weixin transcripts render platform-neutral origin in both languages and reopened history',async()=>{
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const {I18nextProvider}=await import('react-i18next');const {createInstance}=await import('i18next');
 const {NativeMessageContent,NativeMessageReferences}=await importBehaviorModule('lab/integrations/native-message-content.js');
 const {integrationHistoryRecord,parseLabIntegrationHistory,exportLabIntegrationHistory}=await model();
 for(const adapter of ['qq-official','weixin'])for(const locale of ['en','zh']){
  const strings=JSON.parse(readFileSync(new URL(`../../src/shell/i18n/locales/${locale}/integrations.json`,import.meta.url),'utf8'));
  const i18n=createInstance();await i18n.init({lng:locale,resources:{[locale]:{translation:strings}}});
  const event={eventId:'actual-source',conversation:{kind:adapter==='weixin'?'private':'c2c',id:'specified'},messageId:'native',senderId:'specified',replyRef:'opaque',platformTime:'',receivedAt:'2026-10-06T10:00:00Z',segments:[{kind:'text',text:'平台原文😀',origin:'platform-transcription'}],references:[{messageId:'old-native',title:'',text:'引用原文',origin:'platform-transcription',mediaKind:'',fileName:'',contentStatus:'text-provided'}]};
  const body=JSON.stringify({cursor:'own',coverageGap:'',events:[event]});
  const record=integrationHistoryRecord({kind:adapter,displayName:adapter},'{}',{...call('completed',body),operation:`${adapter}.updates.read`},true);
  const reopened=parseLabIntegrationHistory(JSON.parse(exportLabIntegrationHistory([record])).records)[0];
  assert.equal(reopened.resultJson,body);
  const rendered=renderToStaticMarkup(createElement(I18nextProvider,{i18n},createElement('article',null,createElement(NativeMessageContent,{event,mediaDisabled:true,fetchMedia:()=>assert.fail()}),createElement(NativeMessageReferences,{event}))));
  assert.equal((rendered.match(new RegExp(locale==='zh'?'平台转录':'Platform transcription','gu'))||[]).length,2);
  assert.match(rendered,/平台原文😀/u);assert.match(rendered,/引用原文/u);
  assert.equal(/微信|WeChat/iu.test(rendered),false);
 }
});

test('received text and mentions render inline in order, with honest parent and root facts',async()=>{
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {I18nextProvider}=await import('react-i18next');
 const {createInstance}=await import('i18next');
 const i18n=createInstance();
 const strings=JSON.parse(readFileSync(new URL('../../src/shell/i18n/locales/en/integrations.json',import.meta.url),'utf8'));
 await i18n.init({lng:'en',resources:{en:{translation:strings}}});
 const {NativeMessageContent,NativeMessageReferences}=await importBehaviorModule('lab/integrations/native-message-content.js');
 const event={eventId:'event',segments:[{kind:'text',text:'Hello '},{kind:'mention',id:'ou_second',displayName:'Second'},{kind:'text',text:', then '},{kind:'mention',id:'ou_first',displayName:'First'},{kind:'text',text:'!'}],references:[{messageId:'actual-parent',relation:'parent',title:'',text:'',mediaKind:'',fileName:'',contentStatus:'not-provided'},{messageId:'actual-root',relation:'root',title:'',text:'',mediaKind:'',fileName:'',contentStatus:'not-provided'}]};
 const render=child=>renderToStaticMarkup(createElement(I18nextProvider,{i18n},child));
 const body=render(createElement(NativeMessageContent,{event,mediaDisabled:true,fetchMedia:()=>assert.fail()}));
 assert.equal(body.replace(/<[^>]*>/gu,''),'Hello @Second, then @First!');
 assert.equal((body.match(/<div/gu)||[]).length,1,'text/mention pieces must not create extra block breaks');
 const references=render(createElement(NativeMessageReferences,{event}));
 assert.match(references,/Replied-to message/u); assert.match(references,/Root message/u);
 assert.match(references,/actual-parent/u); assert.match(references,/actual-root/u);
 assert.equal((references.match(/The platform did not supply the original content/gu)||[]).length,2);
 assert.equal(references.includes('<a'),false,'a relationship ID does not invent a historic message link');
});

test('explicit received history preserves Feishu parent/root associations and mention order',async()=>{
 const {integrationHistoryRecord,parseLabIntegrationHistory,exportLabIntegrationHistory}=await model();
 const resultJson=JSON.stringify({cursor:'reader',coverageGap:'',events:[{segments:[{kind:'mention',id:'second',displayName:'二'},{kind:'text',text:' 然后 '},{kind:'mention',id:'first',displayName:'一'}],references:[{messageId:'real-parent',relation:'parent',title:'',text:'',mediaKind:'',fileName:'',contentStatus:'not-provided'},{messageId:'real-root',relation:'root',title:'',text:'',mediaKind:'',fileName:'',contentStatus:'not-provided'}]}]});
 const saved=integrationHistoryRecord({kind:'feishu',displayName:'Bot'},'{}',{...call('completed',resultJson),operation:'feishu.updates.read'},true);
 const reopened=parseLabIntegrationHistory(JSON.parse(exportLabIntegrationHistory([saved])).records)[0];
 assert.deepEqual(JSON.parse(reopened.resultJson),JSON.parse(resultJson));
});

test('native read composition keeps explicit filters, a private reader cursor and bounded wait',async()=>{
 const {nativeReadInput,nativeReadPage,nativeConversations,nativeReceipt,nativeEventKey}=await importBehaviorModule('lab/integrations/native-message-model.js');
 assert.deepEqual(JSON.parse(nativeReadInput('user:specified\nchat:chosen','opaque-reader-position')),{conversations:['user:specified','chat:chosen'],cursor:'opaque-reader-position',waitMs:25000});
 for(const input of ['', ' \n, '])assert.deepEqual(JSON.parse(nativeReadInput(input)),{conversations:[],cursor:'',waitMs:25000});
 for(const input of ['user:1\nuser:1', 'missing-kind',Array.from({length:65},(_,i)=>`user:${i}`).join('\n')])assert.throws(()=>nativeReadInput(input));
 const result={cursor:'next-position',events:[],coverageGap:'reconnect'};
 assert.deepEqual(nativeReadPage(JSON.stringify(result)),result);
 assert.deepEqual(nativeConversations('feishu'),['user','chat']);
 const first={eventId:'actual-first-envelope',messageId:'same-message'};
 const duplicate={...first,eventId:'actual-redelivery-envelope'};
 const different={...first,messageId:'different-message'};
 assert.equal(nativeEventKey('feishu',first),nativeEventKey('feishu',duplicate));
 assert.notEqual(nativeEventKey('feishu',first),nativeEventKey('feishu',different));
 for(const adapter of ['weixin','qq-official','onebot-v11'])assert.equal(nativeEventKey(adapter,first),first.eventId);
 assert.throws(()=>nativeReadPage('{"events":[]}'));
 assert.deepEqual(nativeReceipt('weixin.messages.send','{"confirmation":"provider-accepted","messageId":""}'),{confirmation:'provider-accepted',messageId:''});
 assert.equal(nativeReceipt('weixin.messages.send','{"confirmation":"delivered","messageId":"invented"}'),undefined);
});

test('public reference media parsing preserves ownership and rejects unsafe or excessive material',async()=>{
 const {nativeReadPage}=await importBehaviorModule('lab/integrations/native-message-model.js');
 const media={kind:'file',mediaRef:'quoted-only',fileName:'中文附件.txt',mediaType:'text/plain',sizeBytes:390084};
 const reference={messageId:'',title:'',text:'',mediaKind:'file',fileName:media.fileName,contentStatus:'media-provided',media:[media]};
 const page={cursor:'position',coverageGap:'',events:[{eventId:'current',conversation:{kind:'group',id:'chosen'},messageId:'current-native',senderId:'author',replyRef:'reply-only',platformTime:'',receivedAt:'2026-10-07T10:00:00Z',segments:[{kind:'text',text:'@bot'}],references:[reference]}]};
 assert.deepEqual(nativeReadPage(JSON.stringify(page)),page);
 for(const mutation of [
   value=>{value.events[0].references[0].media[0].url='https://private.invalid'},
   value=>{value.events[0].references[0].media[0].sizeBytes=32*1024*1024+1},
   value=>{value.events[0].references[0].media[0].mediaRef=''},
   value=>{value.events[0].references[0].media[0].unavailableReason='source-rejected'},
   value=>{value.events[0].references[0].media=Array.from({length:64},()=>({...media}));value.events[0].segments.push({...media})},
   value=>{value.events[0].references[0].media=Array.from({length:65},()=>({...media}))},
   value=>{value.events[0].segments[0].text='字'.repeat(24000)},
 ]){const bad=structuredClone(page);mutation(bad);assert.throws(()=>nativeReadPage(JSON.stringify(bad)))}
 const unavailable=structuredClone(page);Object.assign(unavailable.events[0].references[0].media[0],{mediaRef:'',unavailableReason:'source-not-provided'});
 assert.deepEqual(nativeReadPage(JSON.stringify(unavailable)),unavailable);
 const {integrationHistoryRecord,parseLabIntegrationHistory,exportLabIntegrationHistory}=await model();
 const actualCall={...call('completed',JSON.stringify(page)),operation:'qq-official.updates.read'};
 const saved=integrationHistoryRecord({kind:'qq-official',displayName:'QQ'},'{}',actualCall,true);
 const reopened=parseLabIntegrationHistory(JSON.parse(exportLabIntegrationHistory([saved])).records)[0];
 assert.deepEqual(nativeReadPage(reopened.resultJson),page);
 assert.equal(integrationHistoryRecord({kind:'qq-official',displayName:'QQ'},'{}',actualCall).resultJson,'');
 assert.deepEqual(saved.assetPaths,[],'an event ref is not an owned asset until explicit media.fetch');
});
const call=(status='accepted',resultJson='')=>({callId:'ic_actual',targetRef:'icon_actual',operation:'feishu.media.fetch',status,resultJson,errorCode:'',consumerDisplayName:'Lab',targetDisplayName:'Bot',accountLabel:'bot',createdAt:'2026-10-05T10:00:00.000Z',updatedAt:'2026-10-05T10:00:00.000Z'});
const target={kind:'feishu',displayName:'Bot'};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('Integration history and export retain real call correlation without AI capability IDs',async()=>{
 const {integrationHistoryRecord,parseLabIntegrationHistory,exportLabIntegrationHistory}=await model();
 const record=integrationHistoryRecord(target,'{"mediaRef":"opaque"}',call('completed','{"asset":{"relativePath":"integrations/photo.png"}}'),true);
 assert.equal(record.kind,'integration');assert.equal(record.callId,'ic_actual');assert.equal(Object.hasOwn(record,'capabilityId'),false);
 assert.deepEqual(record.assetPaths,['integrations/photo.png']);assert.deepEqual(parseLabIntegrationHistory([record]),[record]);
 assert.deepEqual(JSON.parse(exportLabIntegrationHistory([record])).records,[record]);
 assert.throws(()=>parseLabIntegrationHistory([{...record,capabilityId:'image.generate'}]));
 assert.throws(()=>parseLabIntegrationHistory([{...record,assetPaths:['../other/photo.png']}]));
 assert.throws(()=>parseLabIntegrationHistory([{...record,status:'ready'}]));
 const forged=integrationHistoryRecord({kind:'mcp',displayName:'Untrusted tool'},'{}',call('completed','{"asset":{"relativePath":"existing-user-file.png"}}'));
 assert.deepEqual(forged.assetPaths,[]);
});

test('manual observation captures a newly committed media asset and preserves an already obtained result',async()=>{
 const {integrationHistoryRecord,observeIntegrationHistory}=await model();
 const accepted=integrationHistoryRecord(target,'{}',call());
 const result='{"asset":{"relativePath":"integrations/photo.png"}}';
 const completed=observeIntegrationHistory(accepted,call('completed',result));
 assert.deepEqual(completed.assetPaths,['integrations/photo.png']);
 assert.equal(completed.resultJson,'');
 const explicit=observeIntegrationHistory(completed,call('completed',result),true);
 assert.equal(observeIntegrationHistory(explicit,call('completed')).resultJson,result);
 assert.throws(()=>observeIntegrationHistory(accepted,{...call(),callId:'ic_other'}));
});

test('default call history, reopen and export exclude private bodies until explicitly saved',async()=>{
 const {integrationHistoryRecord,observeIntegrationHistory,parseLabIntegrationHistory,exportLabIntegrationHistory}=await model();
 const input='{"text":"private-request"}',result='{"text":"private-result"}';
 const record=integrationHistoryRecord(target,input,call('completed',result));
 assert.equal(record.inputJson,'');assert.equal(record.resultJson,'');
 const reopened=parseLabIntegrationHistory(JSON.parse(exportLabIntegrationHistory([record])).records)[0];
 assert.equal(reopened.inputJson,'');assert.equal(reopened.resultJson,'');
 assert.equal(observeIntegrationHistory(reopened,call('completed',result)).resultJson,'');
 const saved=integrationHistoryRecord(target,input,call('completed',result),true);
 const exported=JSON.parse(exportLabIntegrationHistory([saved])).records[0];
 assert.equal(exported.inputJson,input);assert.equal(exported.resultJson,result);
});

test('an actually published media asset remains owned when terminal recording is unconfirmed',async()=>{
 const {integrationHistoryRecord,parseLabIntegrationHistory,exportLabIntegrationHistory}=await model();
 const record=integrationHistoryRecord(target,'{"private":"input"}',call('unconfirmed','{"asset":{"relativePath":"integrations/published.png"}}'));
 assert.equal(record.status,'unconfirmed');assert.deepEqual(record.assetPaths,['integrations/published.png']);
 assert.equal(record.inputJson,'');assert.equal(record.resultJson,'');
 assert.deepEqual(parseLabIntegrationHistory(JSON.parse(exportLabIntegrationHistory([record])).records)[0].assetPaths,record.assetPaths);
});

test('saved history reopens locally after live query expiry without inventing unsaved bodies',async()=>{
 const {integrationHistoryRecord,parseLabIntegrationHistory,exportLabIntegrationHistory,savedIntegrationHistoryRecord}=await model();
 const original=integrationHistoryRecord(target,'{"private":"request"}',call('completed','{"private":"saved-result"}'),true);
 const reopened=parseLabIntegrationHistory(JSON.parse(exportLabIntegrationHistory([original])).records);
 const liveQuery=async()=>{throw new Error('Runtime result expired or scope changed');};
 await assert.rejects(liveQuery,/expired/);
 const saved=savedIntegrationHistoryRecord(reopened,original.id);
 assert.equal(saved.inputJson,original.inputJson);assert.equal(saved.resultJson,original.resultJson);
 assert.equal(saved.status,'completed');assert.equal(savedIntegrationHistoryRecord(reopened,'missing'),undefined);
 const factsOnly=integrationHistoryRecord(target,'{"private":"not-saved"}',call('completed','{"private":"not-saved"}'));
 const local=savedIntegrationHistoryRecord(parseLabIntegrationHistory([factsOnly]),factsOnly.id);
 assert.equal(local.inputJson,'');assert.equal(local.resultJson,'');
});

test('explicit received history preserves platform transcript origin and supplied old quote facts',async()=>{
 const {integrationHistoryRecord,parseLabIntegrationHistory,exportLabIntegrationHistory}=await model();
 const body=JSON.stringify({cursor:'own-position',coverageGap:'',events:[{eventId:'event',messageId:'current',conversation:{kind:'private',id:'specified'},senderId:'specified',replyRef:'current-only',platformTime:'',receivedAt:'2026-10-05T10:00:00Z',segments:[{kind:'text',text:'平台原文😀',origin:'platform-transcription'}],references:[{messageId:'18446744073709551615',title:'摘要',text:'旧原文',mediaKind:'',fileName:'',contentStatus:'text-provided'}]}]});
 const read={...call('completed',body),operation:'weixin.updates.read'};
 const facts=integrationHistoryRecord({kind:'weixin',displayName:'WeChat'},'{}',read);
 assert.equal(facts.resultJson,'');
 const saved=integrationHistoryRecord({kind:'weixin',displayName:'WeChat'},'{}',read,true);
 const reopened=parseLabIntegrationHistory(JSON.parse(exportLabIntegrationHistory([saved])).records)[0];
 assert.deepEqual(JSON.parse(reopened.resultJson),JSON.parse(body));
});

test('a stop before acceptance cancels the returned call without publishing or sending again',async()=>{
 const {runLabIntegrationCall}=await runner();const accepted=deferred();const signal=new AbortController();let sends=0,cancels=0,published=0;
 const run=runLabIntegrationCall({client:{invoke:()=>{sends++;return accepted.promise;},getCall:()=>assert.fail('stopped wait polled'),cancelCall:async({callId})=>{assert.equal(callId,'ic_actual');cancels++;return call('unconfirmed');}},targetRef:'icon_actual',operation:'feishu.media.fetch',inputJson:'{}',signal:signal.signal,accepted:async()=>{published++;},completed:async()=>{published++;}});
 signal.abort();accepted.resolve(call());await run;assert.equal(sends,1);assert.equal(cancels,1);assert.equal(published,0);
});

test('a known call is canceled immediately during held history I/O, with ordered facts and one dispatch',async()=>{
 const {runLabIntegrationCall}=await runner();
 for(const stopBeforeCallId of [true,false]){
  const invocation=deferred(),history=deferred(),observing=deferred();const signal=new AbortController();
  const facts=[];let sends=0,cancels=0,published=0;
  const run=runLabIntegrationCall({client:{invoke:()=>{sends++;return invocation.promise},getCall:()=>assert.fail('stopped call polled'),cancelCall:async({callId})=>{assert.equal(callId,'ic_actual');cancels++;return call('unconfirmed')}},targetRef:'icon_actual',operation:'feishu.media.fetch',inputJson:'{}',signal:signal.signal,
   observed:async value=>{facts.push(value.status);if(value.status==='accepted'){observing.resolve();await history.promise}},
   accepted:async()=>{published++},completed:async()=>{published++}});
  try{
   if(stopBeforeCallId)signal.abort();invocation.resolve(call('accepted','{"private":"late body"}'));await observing.promise;
   if(!stopBeforeCallId)signal.abort();
   assert.equal(cancels,1,'cancellation must not wait for history storage');signal.abort();
   assert.equal(sends,1);assert.equal(published,0);assert.deepEqual(facts,['accepted']);
  }finally{history.resolve();await run}
  assert.equal(cancels,1);assert.equal(sends,1);assert.equal(published,0);assert.deepEqual(facts,['accepted','unconfirmed']);
 }
});

test('a late private result after stop cannot update history or start another business action',async()=>{
 const {runLabIntegrationCall}=await runner();const signal=new AbortController();const pending=deferred(),entered=deferred();const published=[];let sends=0,cancels=0;
 const run=runLabIntegrationCall({client:{invoke:async()=>{sends++;return call();},getCall:()=>{entered.resolve();return pending.promise;},cancelCall:async()=>{cancels++;return call('unconfirmed');}},targetRef:'icon_actual',operation:'feishu.media.fetch',inputJson:'{}',signal:signal.signal,accepted:async value=>{published.push(value.status);},completed:async value=>{published.push(value.resultJson);}});
 await entered.promise;signal.abort();pending.resolve(call('completed','{"private":"late body"}'));await run;assert.deepEqual(published,['accepted']);assert.equal(cancels,1);assert.equal(sends,1);
});

test('a completed fact keeps its result and an unconfirmed fact is never automatically resent',async()=>{
 const {runLabIntegrationCall}=await runner();for(const status of ['completed','unconfirmed']){let sends=0;const saved=[];await runLabIntegrationCall({client:{invoke:async()=>{sends++;return call(status,status==='completed'?'{}':'');},getCall:()=>assert.fail('terminal call polled'),cancelCall:()=>assert.fail('terminal call canceled')},targetRef:'icon_actual',operation:'feishu.media.fetch',inputJson:'{}',signal:new AbortController().signal,accepted:async value=>{saved.push(value.status);},completed:async value=>{saved.push(value.status);}});assert.equal(sends,1);assert.deepEqual(saved,[status,status]);}
});
