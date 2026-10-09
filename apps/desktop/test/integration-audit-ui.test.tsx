import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { integrationOperationPresentation } from '../src/shell/renderer/features/integrations/integration-operation-presentation.js';

// Owner UI fixtures prove form/state behavior only, not a platform login.
async function homePanel(integration:unknown, check:(document:Document,dom:JSDOM,unmount:()=>Promise<void>)=>Promise<void>) {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
  const values={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Element:dom.window.Element,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,DocumentFragment:dom.window.DocumentFragment,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,getComputedStyle:dom.window.getComputedStyle,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),React,IS_REACT_ACT_ENVIRONMENT:true};
  const previous=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const {createRoot}=await import('react-dom/client');
  const {initI18n,changeLocale}=await import('../src/shell/renderer/i18n/index.js');
  const {DesktopRendererBindingProvider}=await import('../src/shell/renderer/renderer/binding-context.js');
  const {IntegrationsPanel}=await import('../src/shell/renderer/features/integrations/integrations-panel.js');
  await initI18n();await changeLocale('en');
  const root=createRoot(dom.window.document.getElementById('root')!);
  const bindings={sdk:{appProduct:()=>({integration})}} as unknown as DesktopCanonicalRendererBindings;
  let mounted=true;
  const unmount=async()=>{if(mounted){await act(async()=>root.unmount());mounted=false;}};
  try{await act(async()=>root.render(<DesktopRendererBindingProvider bindings={bindings}><IntegrationsPanel onBack={()=>{}}/></DesktopRendererBindingProvider>));await check(dom.window.document,dom,unmount);}
  finally{await unmount();dom.window.close();for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
}
const empty=async()=>({targets:[],permissions:[],consumers:[],calls:[]});
const select=async(dom:JSDOM,element:HTMLSelectElement,value:string)=>act(async()=>{element.value=value;element.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
const clickNamed=async(document:Document,name:string)=>act(async()=>{const button=Array.from(document.querySelectorAll('button')).find(button=>button.textContent===name);assert.ok(button,name);button.click();});
function deferred<T>() { let resolve!:(value:T)=>void;const promise=new Promise<T>(accept=>{resolve=accept;});return {promise,resolve}; }

test('Home clears an entered credential across adapter and Feishu setup-mode switches before submission',async()=>{
  const secrets:string[]=[];
  const integration={getManagement:empty,startConnectionSetup:async()=>({setupId:'audit',status:'awaiting-input',expiresAt:new Date(Date.now()+60000).toISOString()}),submitConnectionSetup:async(input:{secret:string})=>{secrets.push(input.secret);return {setupId:'audit',status:'failed',expiresAt:new Date(Date.now()+60000).toISOString()};}};
  await homePanel(integration,async(document,dom)=>{
    const form=document.querySelector('form')!;const service=form.querySelector('select')!;
    await select(dom,service,'qq-official');
    form.querySelector<HTMLInputElement>('input[type=password]')!.value='synthetic-old-service-canary';
    await select(dom,service,'mcp');
    assert.equal(form.querySelector<HTMLInputElement>('input[type=password]')!.value,'');
    await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    assert.deepEqual(secrets,['']);
    await select(dom,service,'feishu');
    form.querySelector<HTMLInputElement>('input[type=password]')!.value='synthetic-old-mode-canary';
    const mode=form.querySelectorAll('select')[1]!;
    await select(dom,mode,'create');await select(dom,mode,'manual');
    assert.equal(form.querySelector<HTMLInputElement>('input[type=password]')!.value,'');
    await select(dom,service,'onebot-v11');
    const token=form.querySelector<HTMLInputElement>('input[type=password]')!;
    assert.equal(token.required,true);assert.match(token.parentElement!.textContent||'',/required/iu);
    await select(dom,service,'mcp');assert.equal(form.querySelector<HTMLInputElement>('input[type=password]')!.required,false);
  });
});

for(const kind of ['qq-official','onebot-v11'])test(`Home offers explicit same-target credential refresh for ${kind}`,async()=>{
  const target={targetRef:'icon_existing',kind,integrationId:kind,displayName:'Existing bot',available:true,accountLabel:'original',operations:[],permittedOperations:[]};
  const started:Record<string,unknown>[]=[];
  await homePanel({getManagement:async()=>({targets:[target],permissions:[],consumers:[],calls:[]}),startConnectionSetup:async(input:Record<string,unknown>)=>{started.push(input);return {setupId:'audit',targetRef:'icon_existing',status:'failed',expiresAt:new Date(Date.now()+60000).toISOString()};}},async(document,dom)=>{
    assert.match(document.body.textContent||'',/Select an existing connection/u);
    const targetSelect=document.querySelectorAll('select')[1]!;
    await select(dom,targetSelect,target.targetRef);
    const refresh=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Refresh credentials')!;
    assert.ok(refresh,'refresh action must exist without deleting the target');await act(async()=>refresh.click());
    const form=document.querySelector('form')!;
    assert.equal(form.querySelector<HTMLSelectElement>('select')!.value,kind);
    assert.equal(form.querySelector<HTMLInputElement>('input[type=password]')!.value,'');
    assert.match(form.parentElement!.textContent||'',/original.*retains this connection and its app permissions/iu);
    await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    assert.equal(started.length,1);assert.equal(started[0]!.targetRef,target.targetRef);assert.equal(started[0]!.adapter,kind);
  });
});

test('Home display copy follows only Runtime-declared native IDs and preserves unknown source text',()=>{
  const op={name:'feishu.updates.read',description:'original descriptor',effect:'read'} as Parameters<typeof integrationOperationPresentation>[1];
  const localized=integrationOperationPresentation('feishu',op,key=>`localized:${key}`);
  assert.equal(localized.name,'localized:Integrations.operationNames.receive');assert.equal(localized.summary,'localized:Integrations.operationSummaries.receive');
  assert.deepEqual(integrationOperationPresentation('app',op,key=>key),{name:op.name,summary:op.description});
  const unknown={...op,name:'feishu.new.operation'};
  assert.deepEqual(integrationOperationPresentation('feishu',unknown,key=>key),{name:unknown.name,summary:unknown.description});
});

for (const adapter of ['mcp', 'onebot-v11']) test(`Home configuration refusal gives the selected ${adapter} correction`, async () => {
  const integration = {
    getManagement: empty,
    startConnectionSetup: async () => {
      throw Object.assign(new Error('local-app-operation-unavailable'), {
        details: { reasonMetadata: { integration_reason: 'INTEGRATION_CONFIGURATION_INVALID' } },
      });
    },
  };
  await homePanel(integration, async (document, dom) => {
    const form = document.querySelector('form')!;
    await select(dom, form.querySelector('select')!, adapter);
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    const alert = document.querySelector('[data-testid=integrations-panel] > [role=status]')!;
    assert.ok(alert);
    if (adapter === 'onebot-v11') {
      assert.match(alert.textContent || '', /numeric self ID.*IP-based listener address.*valid port/u);
    } else {
      assert.match(alert.textContent || '', /selected service.*required fields/u);
      assert.doesNotMatch(alert.textContent || '', /OneBot|self ID|listener/u);
    }
    assert.doesNotMatch(alert.textContent || '', /integration service is unavailable/iu);
  });
});

for (const [adapter, code, hint] of [
  ['qq-official', 'INTEGRATION_QQ_AUTH_REJECTED', /QQ application verification did not complete.*platform status/u],
  ['qq-official', 'INTEGRATION_QQ_RESPONSE_INVALID', /QQ returned a response Nimi could not verify/u],
  ['feishu', 'INTEGRATION_FEISHU_PROVIDER_REJECTED', /Feishu rejected this request/u],
  ['onebot-v11', 'INTEGRATION_ONEBOT_IDENTITY_INVALID', /actual bot account.*numeric self_id/u],
  ['weixin', 'INTEGRATION_CONFIGURATION_CHANGED', /connection changed during verification.*current settings/u],
] as const) test(`Home renders ${code} from the polled terminal setup body`, async () => {
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const setup = { setupId: 'terminal-error', adapter, targetRef: 'original-connection', expiresAt };
  const actions: string[] = [];
  const integration = {
    getManagement: empty,
    startConnectionSetup: async () => { actions.push('start'); return { ...setup, status: 'awaiting-input' }; },
    submitConnectionSetup: async () => { actions.push('submit'); return { ...setup, status: 'verifying' }; },
    getConnectionSetup: async () => { actions.push('get'); return { ...setup, status: 'failed', errorCode: code }; },
    cancelConnectionSetup: async () => ({ ...setup, status: 'canceled' }),
  };
  await homePanel(integration, async (document, dom) => {
    const form = document.querySelector('form')!;
    await select(dom, form.querySelector('select')!, adapter);
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    assert.deepEqual(actions, adapter === 'weixin' ? ['start', 'get'] : ['start', 'submit', 'get']);
    assert.match(form.textContent || '', /Setup failed/u);
    assert.match(form.textContent || '', hint);
    assert.doesNotMatch(form.textContent || '', /integration service is unavailable/iu);
    assert.doesNotMatch(form.textContent || '', /PRIVATE_PROVIDER_SENTINEL/u);
    if (adapter !== 'weixin') assert.equal(form.querySelector<HTMLInputElement>('input[type=password]')!.value, '');
    if (code === 'INTEGRATION_QQ_AUTH_REJECTED') assert.doesNotMatch(form.textContent || '', /did not accept|incorrect|invalid secret/iu);
  });
});

for (const status of ['completed','already-bound']) for (const switchBeforeStart of [false,true]) test(`Home keeps B's confirmed permission intent when A refresh returns ${status}, B selected ${switchBeforeStart?'before':'after'} Start`, async () => {
  const operations=['qq-official.messages.send','qq-official.messages.reply'].map(name=>({name,description:name,effect:'write',inputSchemaJson:'{}',outputSchemaJson:'{}'}));
  const targets=['A','B'].map(targetRef=>({targetRef,kind:'qq-official',integrationId:'qq-official',displayName:`Bot ${targetRef}`,accountLabel:targetRef,available:true,operations,permittedOperations:[]}));
  const consumer={consumerRef:'consumer',appId:'lab',displayName:'Lab test',sourceKind:'development'};
  const management={targets,consumers:[consumer],permissions:targets.map(target=>({targetRef:target.targetRef,consumerRef:consumer.consumerRef,operations:operations.map(op=>op.name)})),calls:[]};
  const setup={setupId:'A-refresh',adapter:'qq-official',targetRef:'A',expiresAt:new Date(Date.now()+60000).toISOString()};
  const terminal=deferred<Record<string,unknown>>();const requests:Record<string,unknown>[]=[];
  await homePanel({getManagement:async()=>management,startConnectionSetup:async()=>({...setup,status:'awaiting-input'}),submitConnectionSetup:async()=>({...setup,status:'verifying'}),getConnectionSetup:async()=>terminal.promise,cancelConnectionSetup:async()=>({...setup,status:'canceled'}),setPermission:async(input:Record<string,unknown>)=>{requests.push(input);}},async(document,dom)=>{
    const targetSelect=document.querySelectorAll('select')[1]!;
    await select(dom,targetSelect,'A');await clickNamed(document,'Refresh credentials');
    if(switchBeforeStart)await select(dom,targetSelect,'B');
    await act(async()=>{document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    if(!switchBeforeStart)await select(dom,targetSelect,'B');
    const checkbox=(text:string)=>Array.from(document.querySelectorAll('label')).find(label=>label.textContent?.includes(text))!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await act(async()=>checkbox('Lab test').click());
    await act(async()=>checkbox('Reply to a received message').click());
    await clickNamed(document,'Save permissions for selected apps');
    assert.match(document.querySelector('[role=dialog]')!.textContent||'',/Bot B/u);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));terminal.resolve({...setup,status});});
    assert.equal(targetSelect.value,'B','background setup must not take the B editor');
    assert.match(document.querySelector('[role=dialog]')!.textContent||'',/Bot B/u);
    await clickNamed(document,'Withdraw and save');
    assert.deepEqual(requests,[{consumerRef:'consumer',targetRef:'B',operations:['qq-official.messages.send']}]);
  });
});

test('Home cancels a pending Start result that arrives after the form unmounts',async()=>{
  const started=deferred<Record<string,unknown>>();const canceled:string[]=[];let submits=0;
  const integration={getManagement:empty,startConnectionSetup:async()=>started.promise,submitConnectionSetup:async()=>{submits++;},cancelConnectionSetup:async(input:{setupId:string})=>{canceled.push(input.setupId);}};
  await homePanel(integration,async(document,dom,unmount)=>{
    await act(async()=>{document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    await unmount();
    await act(async()=>{started.resolve({setupId:'late-owned-setup',adapter:'mcp',status:'awaiting-input',expiresAt:new Date(Date.now()+60000).toISOString()});});
    assert.deepEqual(canceled,['late-owned-setup']);assert.equal(submits,0);
  });
});

test('Home corrects invalid Weixin codes locally and preserves a typed Runtime input refusal',async()=>{
  const setup={setupId:'verification',adapter:'weixin',status:'awaiting-input',expiresAt:new Date(Date.now()+60000).toISOString()};
  const submitted:unknown[]=[];
  await homePanel({getManagement:empty,startConnectionSetup:async()=>setup,getConnectionSetup:async()=>setup,cancelConnectionSetup:async()=>({...setup,status:'canceled'}),submitConnectionSetup:async(input:unknown)=>{submitted.push(input);throw Object.assign(new Error('local-app-operation-unavailable'),{details:{reasonMetadata:{integration_reason:'INTEGRATION_INPUT_INVALID'}}});}},async(document,dom)=>{
    await select(dom,document.querySelector('form select')!,'weixin');
    await act(async()=>{document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    const code=document.querySelector<HTMLInputElement>('input[autocomplete=one-time-code]')!;
    for(const input of ['', 'letters',' 123','1'.repeat(33)]){
      code.value=input;await clickNamed(document,'Submit code');
      assert.equal(code.value,input);assert.equal(submitted.length,0);assert.equal(document.activeElement,code);
      assert.match(document.body.textContent||'',/nonempty numeric verification code/u);
    }
    code.value='12345';await clickNamed(document,'Submit code');
    assert.equal(submitted.length,1);assert.equal(code.value,'');
    assert.match(document.body.textContent||'',/nonempty numeric verification code/u);
    assert.doesNotMatch(document.body.textContent||'',/integration service is unavailable/iu);
  });
});
