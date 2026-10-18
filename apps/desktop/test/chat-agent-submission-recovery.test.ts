import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { reconcileAgentSubmission } from '@nimiplatform/kit/features/chat/headless';

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


test('recovery highlights one continuation and keeps read-only inspection separate', async () => {
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost', pretendToBeVisual:true});
  const globals = {window:dom.window, document:dom.window.document, navigator:dom.window.navigator, HTMLElement:dom.window.HTMLElement, Element:dom.window.Element, Node:dom.window.Node, MutationObserver:dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT:true};
  const previous = Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AgentSubmissionRecovery } = await import('../src/shell/renderer/features/chat/chat-agent-submission-recovery.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  await initI18n(); await changeLocale('en');
  const node=dom.window.document.createElement('div') as HTMLDivElement;dom.window.document.body.append(node);const root=createRoot(node);
  const sent:unknown[]=[];const acknowledged:string[]=[];let snapshots=0;let resolved=0;
  const submission={requestId:'same-send',conversationAnchorId:'anchor',text:'Question kept here',artifactIds:[]};
  const conversation={snapshot:async()=>{snapshots++;return {turns:[]};},send:async(value:unknown)=>{sent.push(value);return {turnId:'accepted'};}};
  try {
    await React.act(async()=>root.render(React.createElement(AgentSubmissionRecovery,{submission,agentHandle:'handle',conversation:()=>conversation as never,acknowledge:async id=>{acknowledged.push(id);},onResolved:()=>{resolved++;},onRestore:()=>{throw new Error('must not turn recovery into a new message');}})));
    assert.equal(sent.length,0);assert.equal(snapshots,0);
    const button=(label:string)=>Array.from(node.querySelectorAll('button')).find(el=>el.textContent===label)!;
    const primary=button('Continue last send');assert.ok(primary);assert.equal(primary.closest('details'),null);
    const alternatives=node.querySelector('details')!;assert.equal(alternatives.open,false);
    assert.doesNotMatch(node.textContent||'',/request ID|submission copy/);
    alternatives.open=true;
    await React.act(async()=>{button('View conversation only').click();await new Promise(r=>setImmediate(r));});
    assert.equal(snapshots,1);assert.equal(sent.length,0);
    await React.act(async()=>{primary.click();await new Promise(r=>setImmediate(r));});
    assert.equal(sent.length,1);assert.equal((sent[0] as {requestId:string}).requestId,submission.requestId);
    assert.equal(snapshots,1);assert.deepEqual(acknowledged,[submission.requestId]);assert.equal(resolved,1);
  } finally {
    await React.act(async()=>root.unmount());dom.window.close();
    for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
