import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Real React composition, isolated public port fixtures. This is not model,
// platform or Desktop-supervised Lab acceptance.
const root=path.resolve(import.meta.dirname,'..');
const{JSDOM}=createRequire(path.resolve(root,'../../kit/package.json'))('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
for(const key of ['window','document','HTMLElement','Element','Node','Event'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const{createElement,act,useState}=await import('react');const{createRoot}=await import('react-dom/client');
const {TooltipProvider}=await import('@nimiplatform/kit/ui');
mkdirSync(path.join(root,'.tmp'),{recursive:true});const dir=mkdtempSync(path.join(root,'.tmp','native-reply-'));
await build({stdin:{contents:"export { NativeMessagePanel } from './src/lab/integrations/native-message-panel.tsx'; export { LabIntegrationsPanel } from './src/lab/integrations/integrations-panel.tsx'; export { LabWorkbench } from './src/lab/lab-workbench.tsx'; export { useAIStudioWorkspaceController } from './src/ai-studio-core/workspace.tsx'; export { createStudioRunHistoryRecord } from './src/ai-studio-core/history.ts'; export { LabRendererProvider } from './src/renderer/context.tsx'; export { observeLabLocalAppSessionLoss } from './src/shell/auth/session-loss.ts'; export { i18n } from './src/shell/i18n/index.ts';",resolveDir:root,loader:'ts'},outfile:path.join(dir,'view.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const{NativeMessagePanel,LabIntegrationsPanel,LabWorkbench,useAIStudioWorkspaceController,createStudioRunHistoryRecord,LabRendererProvider,observeLabLocalAppSessionLoss,i18n}=await import(pathToFileURL(path.join(dir,'view.mjs')).href);
await i18n.changeLanguage('en');
test.after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true})});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}};
const event=id=>({eventId:id,messageId:`native-${id}`,senderId:'specified',conversation:{kind:'c2c',id:'specified'},replyRef:`source-${id}`,segments:[{kind:'text',text:`original ${id}`,origin:'platform-transcription'}],platformTime:'',receivedAt:'2026-10-06T10:00:00Z'});
const result=text=>({ok:true,capabilityId:'chat.stream',capabilityLabel:'Chat Stream',message:`Received: ${JSON.stringify(text)}.`,output:{kind:'text',text,finishReason:'stop',streamed:true},trace:{traceId:'actual-fixture-trace'}});
const fact=status=>({callId:'ic_actual',targetRef:'target',operation:'qq-official.messages.reply',status,resultJson:'',errorCode:'',consumerDisplayName:'Lab',targetDisplayName:'QQ',accountLabel:'bot',createdAt:'2026-10-06T10:00:00Z',updatedAt:'2026-10-06T10:00:01Z'});
const target={targetRef:'target',kind:'qq-official',displayName:'QQ',available:true,operations:[],permittedOperations:['qq-official.messages.reply']};
function fixture({generate=async()=>result('reviewed fixture draft'),invoke=async()=>fact('unconfirmed')}={}){
 const calls={ai:[],aiRecords:[],messages:[],facts:[],cancels:[]};let id=0;
 const host={sdk:{aiConfig:{get:async()=>({config:{owner:{owner:{oneofKind:'app',app:{appId:'nimi.lab'}}},capabilities:[{capabilityContract:'text.generate',requiredFeatures:[],route:{oneofKind:'local',local:{}}}]}})},runCapability:request=>{calls.ai.push(request);return generate(request)},localAppClient:{auth:{status:async()=>({sessionBound:true})},storage:{assets:{list:async()=>({assets:[],nextCursor:''})}},integration:{invoke:request=>{calls.messages.push(request);return invoke(request)},getCall:()=>assert.fail('terminal fixture polled'),cancelCall:async request=>{calls.cancels.push(request);return fact('unconfirmed')}}}},app:{projection:{aiConfigSummary:async()=>({runtime:{status:'connected',mode:'local-app',detail:'Fixture carrier'}})},commands:{nextRunIdentity:async()=>({runId:`ai-${++id}`,createdAt:'2026-10-06T10:00:00Z'}),appendRunHistory:async record=>{calls.aiRecords.push(record);return{}}}}};
 function Probe(){const[busy,setBusy]=useState(false);const[save,setSave]=useState(false);return createElement(NativeMessagePanel,{target,busy,events:[event('A'),event('B')],saveReceived:save,setSaveReceived:setSave,setAssetBusy:setBusy,saveEvent:()=>assert.fail('body save not selected'),invoke:()=>assert.fail('ordinary send is not AI send'),recordAI:async record=>{await host.app.commands.appendRunHistory(record)},recordReplyCall:async(_input,call)=>calls.facts.push(call),report:error=>{throw error}})}
 return{host,calls,Probe};
}
const pane=()=>document.querySelector('[data-testid="native-reply-panel"]');
const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent===text);
const click=async text=>{const b=button(text);assert.ok(b,text);assert.equal(b.disabled,false,`${text} should be available`);await act(async()=>b.click())};
const select=async index=>{const options=[...document.querySelectorAll('button')].filter(item=>item.textContent===i18n.t('Integrations.useReplyContext'));assert.ok(options[index],'source selection control');assert.equal(options[index].disabled,false);await act(async()=>options[index].click())};

test('actual Lab message UI selects source, shows review, and sends only on a separate click',async()=>{
 const{host,calls,Probe}=fixture();const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:host},createElement(Probe))));
  assert.equal(button('Generate draft').disabled,true);await select(0);assert.match(pane().textContent,/original A/u);
  await click('Generate draft');assert.equal(calls.ai.length,1);assert.equal(calls.messages.length,0);assert.equal(pane().querySelector('textarea').value,'reviewed fixture draft');
  assert.equal(calls.aiRecords[0].capabilityId,'chat.stream');assert.equal(calls.aiRecords[0].prompt,'');assert.equal(calls.aiRecords[0].result.body,'');
  assert.equal(calls.aiRecords[0].result.summary,'');assert.equal(JSON.stringify(calls.aiRecords).includes('reviewed fixture draft'),false);assert.equal(JSON.stringify(calls.aiRecords).includes('original A'),false);
  await click('Send reviewed reply once');assert.equal(calls.messages.length,1);assert.deepEqual(JSON.parse(calls.messages[0].inputJson),{replyRef:'source-A',body:{kind:'text',text:'reviewed fixture draft'}});
  assert.deepEqual(calls.facts.map(call=>call.status),['unconfirmed']);assert.equal(pane().querySelector('textarea'),null);assert.match(pane().textContent,/unconfirmed|Unconfirmed/u);
 }finally{await act(async()=>renderer.unmount())}
});

test('quoted attachment saves its own mediaRef via the ordinary public operation only after an explicit click',async()=>{
 const {host}=fixture();const invocations=[];let invokePort;
 const quoted={...event('quote'),references:[{messageId:'',title:'',text:'',mediaKind:'file',fileName:'中文引用.txt',contentStatus:'media-provided',media:[
  {kind:'file',mediaRef:'quoted-only',fileName:'中文引用.txt',mediaType:'text/plain',sizeBytes:390084},
  {kind:'file',mediaRef:'',fileName:'missing.txt',mediaType:'text/plain',sizeBytes:1,unavailableReason:'source-not-provided'},
 ]}]};
 const permitted={...target,permittedOperations:['qq-official.media.fetch']};
 function Probe(){const[busy,setBusy]=useState(false);const[save,setSave]=useState(false);invokePort=async(...args)=>{invocations.push(args)};return createElement(NativeMessagePanel,{target:permitted,busy,events:[quoted],saveReceived:save,setSaveReceived:setSave,setAssetBusy:setBusy,saveEvent:()=>assert.fail('batch not saved implicitly'),invoke:invokePort,recordAI:()=>assert.fail('no AI'),recordReplyCall:()=>assert.fail('no send'),report:error=>{throw error}})}
 const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:host},createElement(Probe))));
  assert.equal(button('Save quoted attachment').disabled,true);
  assert.match(document.querySelector('blockquote').textContent,/中文引用.txt/u);
  assert.match(document.querySelector('blockquote').textContent,/no download source/u);
  const pathInput=[...document.querySelectorAll('input')].find(input=>input.placeholder==='received/image.png');
  assert.ok(pathInput);
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(pathInput,'received/中文引用.txt');pathInput.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(invocations.length,0,'typing a destination must not download');
  await click('Save quoted attachment');
  assert.deepEqual(invocations,[['qq-official.media.fetch',JSON.stringify({mediaRef:'quoted-only',relativePath:'received/中文引用.txt'})]]);
  assert.equal(document.querySelectorAll('blockquote button').length,1,'unavailable metadata has no save action');
 }finally{await act(async()=>renderer.unmount())}
});

test('mounted workbench shows Integration completion and cancellation in its existing AI history',async()=>{
 const held=deferred();let generated=0;const {host,calls}=fixture({generate:async()=>++generated===1?result('private first draft'):held.promise});
 const old=createStudioRunHistoryRecord({result:result(''),prompt:'',runId:'existing-run',createdAt:'2026-10-05T10:00:00Z'});
 let history={'chat.stream':[old]};let preferences={schemaVersion:1,draftPersistence:false,verboseConsole:false,historyPanel:{collapsed:true,scope:'capability',hideFailures:false},lastCapabilityId:'chat.stream'};
 Object.assign(host.app.projection,{runHistory:async()=>structuredClone(history),imageHistory:async()=>[],preferences:()=>preferences,promptDraft:()=>({prompt:null}),ecosystemReference:()=>null,personaReference:()=>null,runtimePlatform:async()=>({status:'ready',localAppSession:{}}),integrationHistory:async()=>[]});
 Object.assign(host.app.commands,{appendRunHistory:async record=>{calls.aiRecords.push(record);history[record.capabilityId]=[structuredClone(record),...(history[record.capabilityId]||[])];return structuredClone(history)},savePreferences:async value=>{preferences=value},savePromptDraft:async()=>{},rendererLog:async()=>{},runtimeLog:async()=>{},appendIntegrationHistory:async()=>[]});
 host.app.events={subscribe:()=>()=>{}};host.scope={globalName:key=>key};host.clock={now:()=>Date.parse('2026-10-06T10:01:00Z')};
 host.sdk.storage={assets:{stat:()=>assert.fail('text history has no managed assets')}};
 host.sdk.localAppClient.storage.readJson=async()=>{throw{code:'not-found'}};
 host.sdk.localAppClient.integration.listConnections=async()=>[{...target,operations:[{name:'qq-official.updates.read',inputSchemaJson:'{}'}],permittedOperations:['qq-official.updates.read','qq-official.messages.reply']}];
 host.sdk.localAppClient.integration.invoke=async request=>{assert.match(request.operation,/updates\.read/u);return{...fact('completed'),operation:request.operation,resultJson:JSON.stringify({cursor:'fixture',events:[event('A')],coverageGap:''})}};
 const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(TooltipProvider,null,createElement(LabRendererProvider,{bindings:host},createElement(LabWorkbench,{title:'Nimi Lab'})))));
  await click('Integrations');
  const choice=[...document.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='target'));
  await act(async()=>{choice.value='target';choice.dispatchEvent(new Event('change',{bubbles:true}))});
  // One explicit read fixture supplies the source; it never invokes a message write.
  const advanced=[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent===i18n.t('Integrations.advancedOperations'));
  assert.ok(advanced);await act(async()=>advanced.open=true);
  const operation=advanced.querySelector('select');await act(async()=>{operation.value='qq-official.updates.read';operation.dispatchEvent(new Event('change',{bubbles:true}))});
  await click(i18n.t('Integrations.invoke'));await select(0);await click('Generate draft');
  await click('Stop and discard draft');await click('Generate draft');await click('Stop and discard draft');
  await act(async()=>held.resolve({ok:false,capabilityId:'chat.stream',capabilityLabel:'Chat Stream',reason:'runtime-canceled',message:'Canceled while processing original A PRIVATE_FAILURE_PREVIEW_SENTINEL'}));
  assert.deepEqual(history['chat.stream'].map(r=>r.status),['canceled','ready','ready']);assert.equal(history['chat.stream'][2].id,'existing-run');assert.equal(calls.messages.length,0);
  assert.equal(JSON.stringify(history).includes('private first draft'),false);assert.equal(JSON.stringify(history).includes('original A'),false);assert.equal(JSON.stringify(history).includes('PRIVATE_FAILURE_PREVIEW_SENTINEL'),false);
  const chat=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===i18n.t('Capabilities.chatStream.label'));
  assert.ok(chat);await act(async()=>chat.click());
  const toggle=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===i18n.t('StudioShell.showHistory'));
  assert.ok(toggle);await act(async()=>toggle.click());
  const rows=[...document.querySelectorAll('.studio-recent__row')];
  assert.equal(rows.length,3,'the already-mounted workbench must project both new facts and the retained record');
  for(const row of rows){
   assert.equal(row.outerHTML.includes('private first draft'),false);assert.equal(row.outerHTML.includes('PRIVATE_FAILURE_PREVIEW_SENTINEL'),false);
   await act(async()=>row.click());
   assert.equal(document.body.textContent.includes('private first draft'),false);assert.equal(document.body.textContent.includes('PRIVATE_FAILURE_PREVIEW_SENTINEL'),false);
  }
 }finally{await act(async()=>renderer.unmount())}
});

test('a pending Integration history append cannot publish into a replaced workbench repository',async()=>{
 const held=deferred();let controller;let appends=0;
 const record=createStudioRunHistoryRecord({result:result(''),prompt:'',runId:'scope-a',createdAt:'2026-10-06T10:00:00Z'});
 const projection=runHistory=>({runHistory,mediaHistory:[]});
 const repositoryA={load:async()=>projection({}),appendRecord:()=>{appends++;return held.promise},loadPanelPreferences:()=>({collapsed:true,scope:'capability',hideFailures:false})};
 const repositoryB={...repositoryA,load:async()=>projection({'chat.stream':[{...record,id:'scope-b'}]})};
 function Probe({repository}){controller=useAIStudioWorkspaceController({historyRepository:repository,registrations:[],onSelectCapability:()=>{},translate:key=>key});return null}
 const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(Probe,{repository:repositoryA})));
  const appendA=controller.appendHistoryRecord;let pending;
  await act(async()=>{pending=appendA(record)});
  await act(async()=>renderer.render(createElement(Probe,{repository:repositoryB})));
  await act(async()=>{held.resolve(projection({'chat.stream':[record]}));await pending});
  assert.equal(controller.history['chat.stream'][0].id,'scope-b');
  await act(async()=>appendA(record));assert.equal(appends,1,'stale scope cannot start another history write');
 }finally{await act(async()=>renderer.unmount())}
});

test('actual Lab first receive needs no peer ID, preserves optional filters, and shows the account once',async()=>{
 const {host,calls}=fixture();const held=deferred();const reads=[];
 const source={...target,targetRef:'first-read',kind:'weixin',displayName:'WeChat iLink · bot@im.bot',accountLabel:'bot@im.bot',operations:[{name:'weixin.updates.read'}],permittedOperations:['weixin.updates.read']};
 host.sdk.localAppClient.integration.listConnections=async()=>[source,{...source,targetRef:'remark',displayName:'My remark'}];
 host.app.projection.integrationHistory=async()=>[];host.app.commands.appendIntegrationHistory=async()=>[];
 host.sdk.localAppClient.integration.invoke=async request=>{reads.push(request);return{...fact('accepted'),targetRef:source.targetRef,operation:'weixin.updates.read'}};
 host.sdk.localAppClient.integration.getCall=()=>held.promise;
 host.sdk.localAppClient.integration.cancelCall=async request=>{calls.cancels.push(request);return{...fact('canceled'),operation:'weixin.updates.read'}};
 const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:host},createElement(LabIntegrationsPanel,{recordAI:async record=>{await host.app.commands.appendRunHistory(record)}}))));
  const choice=[...document.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='first-read'));
  assert.ok(choice);assert.equal(choice.querySelector('[value="first-read"]').textContent,'WeChat iLink · bot@im.bot');assert.equal(choice.querySelector('[value="remark"]').textContent,'My remark · bot@im.bot');
  await act(async()=>{choice.value='first-read';choice.dispatchEvent(new Event('change',{bubbles:true}))});
  const optional=[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent===i18n.t('Integrations.conversationFilters'));
  assert.ok(optional);assert.equal(optional.open,false);assert.equal(optional.querySelector('textarea').value,'');
  assert.equal(reads.length,0,'opening the page must not receive');
  await click(i18n.t('Integrations.startReceive'));
  assert.equal(reads.length,1);assert.equal(reads[0].operation,'weixin.updates.read');assert.deepEqual(JSON.parse(reads[0].inputJson),{conversations:[],cursor:'',waitMs:25000});
  assert.equal(calls.messages.length,0,'receiving cannot send');
  await click(i18n.t('Integrations.stop'));
  await act(async()=>held.resolve({...fact('canceled'),operation:'weixin.updates.read'}));
  assert.equal(calls.cancels.length,1);assert.equal(reads.length,1,'stopping cannot restart receiving');
 }finally{await act(async()=>renderer.unmount())}
});

test('UI stop and changing selected source keep an old inference from replacing the new draft',async()=>{
 const held=deferred();let requests=0;const{host,calls,Probe}=fixture({generate:()=>++requests===1?held.promise:Promise.resolve(result('new B draft'))});const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:host},createElement(Probe))));await select(0);await click('Generate draft');
  assert.equal(button(i18n.t('Integrations.useReplyContext')).disabled,true,'ordinary workflow is locked during inference');
  await click('Stop and discard draft');await select(1);await click('Generate draft');assert.equal(pane().querySelector('textarea').value,'new B draft');
  await act(async()=>held.resolve(result('old A draft')));assert.equal(pane().querySelector('textarea').value,'new B draft');assert.equal(calls.messages.length,0);
 }finally{await act(async()=>renderer.unmount())}
});

test('leaving the actual UI cancels a late accepted send and retains its true fact without any new dispatch',async()=>{
 const held=deferred();const{host,calls,Probe}=fixture({invoke:()=>held.promise});const renderer=createRoot(document.getElementById('root'));
 await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:host},createElement(Probe))));await select(0);await click('Generate draft');await click('Send reviewed reply once');assert.equal(calls.messages.length,1);
 await act(async()=>renderer.unmount());await act(async()=>held.resolve(fact('accepted')));
 assert.equal(calls.messages.length,1);assert.equal(calls.cancels.length,1);assert.deepEqual(calls.facts.map(call=>call.status),['accepted','unconfirmed']);assert.equal(document.getElementById('root').textContent,'');
});

test('the actual session-loss observation invalidates a pending draft and cannot silently resume it',async()=>{
 const held=deferred();const{host,calls,Probe}=fixture({generate:()=>held.promise});const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:host},createElement(Probe))));await select(0);await click('Generate draft');
  const surface=observeLabLocalAppSessionLoss({operation:async()=>{throw Object.assign(new Error('Account changed'),{reasonCode:'account-changed'})}});
  await act(async()=>{await assert.rejects(surface.operation(),/Account changed/u)});
  await act(async()=>held.resolve(result('late after lost scope')));
  assert.equal(pane().querySelector('textarea'),null);assert.equal(button('Generate draft').disabled,true);assert.equal(calls.aiRecords.length,0);assert.equal(calls.messages.length,0);assert.match(document.getElementById('root').textContent,/session ended/u);
 }finally{await act(async()=>renderer.unmount())}
});

test('replacing the actual renderer scope clears selected source and suppresses the prior draft and history writes',async()=>{
 const held=deferred();const original=fixture({generate:()=>held.promise});const fresh=fixture();const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:original.host},createElement(original.Probe))));await select(0);await click('Generate draft');
  // Keep the same App component instance: the provider changes its real host,
  // rather than relying on a fresh component to accidentally clear memory.
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:fresh.host},createElement(original.Probe))));
  assert.equal(button('Generate draft').disabled,true);assert.equal(pane().textContent.includes('original A'),false);
  await act(async()=>held.resolve(result('old scope draft')));
  assert.equal(pane().querySelector('textarea'),null);assert.equal(original.calls.aiRecords.length,0);assert.equal(fresh.calls.aiRecords.length,0);assert.equal(original.calls.messages.length,0);assert.equal(fresh.calls.messages.length,0);
 }finally{await act(async()=>renderer.unmount())}
});

test('a connection/history refresh answered after session loss cannot restore the previous scope in the actual Integrations page',async()=>{
 const held=deferred();const{host}=fixture();let reads=0;
 host.sdk.localAppClient.integration.listConnections=()=>++reads===1?held.promise:Promise.reject(new Error('Current refresh failed'));
 host.app.projection.integrationHistory=async()=>[];
 const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:host},createElement(LabIntegrationsPanel,{recordAI:async record=>{await host.app.commands.appendRunHistory(record)}}))));
  const surface=observeLabLocalAppSessionLoss({operation:async()=>{throw Object.assign(new Error('Account changed'),{reasonCode:'account-changed'})}});
  await act(async()=>{await assert.rejects(surface.operation(),/Account changed/u)});
  await click(i18n.t('Integrations.refresh'));
  assert.match(document.getElementById('root').textContent,/Current refresh failed/u);
  await act(async()=>held.resolve([{...target,displayName:'Previous account bot'}]));
  assert.equal(document.getElementById('root').textContent.includes('Previous account bot'),false);
  assert.equal(document.querySelector('[data-testid="native-message-panel"]'),null);
  assert.equal(document.getElementById('root').textContent.includes(i18n.t('Integrations.sessionEnded')),true);
  assert.match(document.getElementById('root').textContent,/Current refresh failed/u);
  assert.equal(document.getElementById('root').textContent.includes(i18n.t('Integrations.errors.LAB_INTEGRATION_REPLY_SCOPE_ENDED')),false);
 }finally{await act(async()=>renderer.unmount())}
});

test('the actual Integration refresh clears only its old recovery feedback and keeps saved or new business failures',async()=>{
 const{host,calls}=fixture();const held=deferred();let mode='old';let reads=0;let observations=0;
 const savedFailure={id:'saved-failure',callId:'old-failed-call',targetRef:'current-target',targetDisplayName:'Saved failure kept',operation:'qq-official.messages.reply',status:'failed',errorCode:'INTEGRATION_PERMISSION_DENIED',createdAt:'2026-10-07T05:00:00Z',inputJson:'{}',resultJson:'',assetPaths:[]};
 host.sdk.localAppClient.integration.listConnections=async()=>{
  reads++;
  if(mode==='loss')throw Object.assign(new Error('Account changed'),{reasonCode:'account-changed'});
  if(mode==='failed')throw new Error('Refresh unavailable');
  if(mode==='held')return held.promise;
  return[{...target,targetRef:mode==='old'?'old-target':'current-target',displayName:mode==='old'?'Old account bot':'Current account bot'}];
 };
 host.sdk.localAppClient.integration.getCall=async()=>{observations++;throw new Error('INTEGRATION_MEDIA_UNAVAILABLE')};
 host.sdk.localAppClient.integration=observeLabLocalAppSessionLoss(host.sdk.localAppClient.integration);
 host.app.projection.integrationHistory=async()=>mode==='old'?[{...savedFailure,id:'old-scope-history',targetDisplayName:'Old scope history'}]:[savedFailure];
 const renderer=createRoot(document.getElementById('root'));const text=()=>document.getElementById('root').textContent;
 try{
  await act(async()=>renderer.render(createElement(LabRendererProvider,{bindings:host},createElement(LabIntegrationsPanel,{recordAI:()=>assert.fail('refresh must not generate AI')}))));
  assert.match(text(),/Old account bot|Old scope history/u);
  mode='loss';await click(i18n.t('Integrations.refresh'));
  assert.equal(text().includes('Old account bot'),false);assert.equal(text().includes('Old scope history'),false);
  assert.equal(text().includes(i18n.t('Integrations.sessionEnded')),true);
  assert.equal(text().includes(i18n.t('Integrations.errors.LAB_INTEGRATION_REPLY_SCOPE_ENDED')),false);
  mode='failed';await click(i18n.t('Integrations.refresh'));assert.match(text(),/Refresh unavailable/u);
  mode='current';await click(i18n.t('Integrations.refresh'));
  assert.match(text(),/Current account bot/u);assert.match(text(),/Saved failure kept/u);
  assert.equal(text().includes(i18n.t('Integrations.sessionEnded')),false);assert.equal(text().includes('Refresh unavailable'),false);

  mode='failed';await click(i18n.t('Integrations.refresh'));assert.match(text(),/Refresh unavailable/u);
  mode='held';await click(i18n.t('Integrations.refresh'));
  await click(i18n.t('Integrations.observe'));
  const businessError=i18n.t('Integrations.errors.INTEGRATION_MEDIA_UNAVAILABLE',{defaultValue:'INTEGRATION_MEDIA_UNAVAILABLE'});
  assert.equal(text().includes(businessError),true);
  await act(async()=>held.resolve([{...target,targetRef:'current-target',displayName:'Current account bot'}]));
  assert.equal(text().includes('Refresh unavailable'),false);assert.equal(text().includes(businessError),true);
  assert.match(text(),/Saved failure kept/u);assert.equal(observations,1);
  assert.equal(reads,6);assert.equal(calls.ai.length,0);assert.equal(calls.messages.length,0);assert.equal(calls.facts.length,0);
 }finally{await act(async()=>renderer.unmount())}
});
