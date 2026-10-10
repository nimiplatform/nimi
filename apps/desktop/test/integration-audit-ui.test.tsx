import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { integrationOperationPresentation } from '../src/shell/renderer/features/integrations/integration-operation-presentation.js';

// Owner UI fixtures prove form/state behavior only, not a platform login.
async function homePanel(integration:unknown, check:(document:Document,dom:JSDOM,unmount:()=>Promise<void>)=>Promise<void>) {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
  // Kit SelectField (Radix) calls pointer-capture and scroll APIs jsdom lacks.
  dom.window.Element.prototype.scrollIntoView=()=>{};
  dom.window.HTMLElement.prototype.hasPointerCapture=()=>false;
  dom.window.HTMLElement.prototype.setPointerCapture=()=>{};
  dom.window.HTMLElement.prototype.releasePointerCapture=()=>{};
  const values={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,HTMLFormElement:dom.window.HTMLFormElement,HTMLInputElement:dom.window.HTMLInputElement,Element:dom.window.Element,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,DocumentFragment:dom.window.DocumentFragment,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,getComputedStyle:dom.window.getComputedStyle,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),React,IS_REACT_ACT_ENVIRONMENT:true};
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
  const unmount=async()=>{if(mounted){await act(async()=>{root.unmount(); await new Promise(resolve=>setTimeout(resolve,0));});mounted=false;}};
  try{await act(async()=>root.render(<DesktopRendererBindingProvider bindings={bindings}><IntegrationsPanel onBack={()=>{}}/></DesktopRendererBindingProvider>));if (!dom.window.document.querySelector('[data-testid="integration-target"]')) await act(async()=>{ dom.window.document.querySelector<HTMLButtonElement>('[data-testid="integration-add-connection"]')!.click(); }); await check(dom.window.document,dom,unmount);}
  finally{await unmount();dom.window.close();for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
}
const empty=async()=>({targets:[],permissions:[],consumers:[],calls:[]});
// Kit SelectField is a Radix combobox, not a native select: open the trigger,
// then click the option rendered in the portal.
const pickOption=async(document:Document,testid:string,optionText:string)=>{
  await act(async()=>{document.querySelector<HTMLElement>(`[data-testid=${testid}]`)!.click();});
  const option=[...document.querySelectorAll<HTMLElement>('[role=option]')].find((el)=>el.textContent===optionText);
  assert.ok(option,optionText);
  await act(async()=>{option.click();});
};
const clickNamed=async(document:Document,name:string)=>act(async()=>{const button=Array.from(document.querySelectorAll('button')).find(button=>button.textContent===name);assert.ok(button,name);button.click();});
async function openServiceConnection(document: Document, kind: string) {
  const close = document.querySelector<HTMLButtonElement>('[data-testid=integration-connection-drawer] button[aria-label=Close]');
  if (close) await act(async () => close.click());
  await act(async () => document.querySelector<HTMLButtonElement>(`[data-testid=integration-service-${kind}]`)!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid=integration-add-connection]')!.click());
  return document.querySelector('form')!;
}
function deferred<T>() { let resolve!:(value:T)=>void;const promise=new Promise<T>(accept=>{resolve=accept;});return {promise,resolve}; }

for (const exit of ['cancel', 'close'] as const) test(`Home ${exit} keeps a failed cancellation retryable and closes only after confirmation`, async () => {
  const setup = { setupId: 'cancel-flow', adapter: 'weixin', status: 'awaiting-confirmation', verificationUrl: 'https://liteapp.weixin.qq.com/fixture', expiresAt: new Date(Date.now() + 60000).toISOString() };
  const reply = deferred<typeof setup>();
  const requests: unknown[] = [];
  await homePanel({
    getManagement: empty,
    startConnectionSetup: async () => setup,
    getConnectionSetup: async () => setup,
    cancelConnectionSetup: async (input: unknown) => {
      requests.push(input);
      if (requests.length === 1) throw new Error('Temporary cancellation failure');
      return reply.promise;
    },
  }, async (document, dom) => {
    const form = await openServiceConnection(document, 'weixin');
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(form.querySelector('button[type=submit]'), null);
    const drawer = () => document.querySelector('[data-testid=integration-connection-drawer][aria-hidden=false]');
    const exitButton = () => exit === 'close'
      ? drawer()!.querySelector<HTMLButtonElement>('button[aria-label=Close]')!
      : [...drawer()!.querySelectorAll('button')].find(button => button.textContent === 'Cancel connection')!;
    await act(async () => exitButton().click());
    assert.ok(drawer());
    assert.match(drawer()!.textContent || '', /Cancellation did not complete. Please try again/u);
    assert.doesNotMatch(document.body.textContent || '', /This connection attempt was canceled/u);
    await act(async () => exitButton().click());
    assert.ok(drawer());
    const canceling = [...drawer()!.querySelectorAll('button')].find(button => button.textContent === 'Canceling…')!;
    assert.equal(canceling.disabled, true);
    assert.equal(drawer()!.querySelector<HTMLButtonElement>('button[aria-label=Close]')!.disabled, true);
    await act(async () => canceling.click());
    assert.equal(requests.length, 2);
    await act(async () => reply.resolve({ ...setup, status: 'canceled', verificationUrl: '' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
    assert.equal(Boolean(drawer()), false);
    assert.match(document.body.textContent || '', /This connection attempt was canceled/u);
    assert.deepEqual(requests, [{ setupId: setup.setupId }, { setupId: setup.setupId }]);
  });
});

test('Home does not report cancellation when Runtime returns a completed connection', async () => {
  const setup = { setupId: 'completed-before-cancel', adapter: 'weixin', status: 'awaiting-confirmation', expiresAt: new Date(Date.now() + 60000).toISOString() };
  await homePanel({
    getManagement: empty,
    startConnectionSetup: async () => setup,
    getConnectionSetup: async () => setup,
    cancelConnectionSetup: async () => ({ ...setup, status: 'completed', targetRef: 'new-connection' }),
  }, async (document, dom) => {
    const form = await openServiceConnection(document, 'weixin');
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await clickNamed(document, 'Cancel connection');
    assert.ok(document.querySelector('[data-testid=integration-connection-drawer][aria-hidden=false]'));
    assert.match(document.body.textContent || '', /connection status changed and was not canceled/u);
    assert.doesNotMatch(document.body.textContent || '', /This connection attempt was canceled/u);
  });
});

test('service navigation preserves every connection, instance grant, and unavailable-source permission without writes', async () => {
  const operation = { name: 'feishu.messages.reply', description: 'Original reply description', effect: 'write', inputSchemaJson: '{}', outputSchemaJson: '{}' };
  const targets = [
    { targetRef: 'feishu-a', kind: 'feishu', displayName: 'Feishu A', accountLabel: 'verified-a' },
    { targetRef: 'feishu-b', kind: 'feishu', displayName: 'Feishu B', accountLabel: 'verified-b' },
    { targetRef: 'provider', kind: 'app', displayName: 'App results', accountLabel: '' },
  ].map(target => ({ ...target, integrationId: target.kind, available: target.kind !== 'app', operations: [operation], permittedOperations: [], skill: 'Source documentation' }));
  const consumers = ['instance-11111111', 'instance-22222222'].map(consumerRef => ({ consumerRef, appId: 'lab', displayName: 'Lab', sourceKind: 'development' }));
  const permissions = [
    { targetRef: 'feishu-a', consumerRef: consumers[0]!.consumerRef, operations: [operation.name] },
    { targetRef: 'feishu-a', consumerRef: consumers[1]!.consumerRef, operations: [operation.name] },
    { targetRef: 'feishu-b', consumerRef: consumers[0]!.consumerRef, operations: [operation.name] },
    { targetRef: 'removed-source', consumerRef: 'retired-instance', operations: ['old.read'], consumer: { appId: 'retired', displayName: 'Retired app', sourceKind: 'installed' } },
  ];
  const writes: unknown[] = [];
  await homePanel({ getManagement: async () => ({ targets, consumers, permissions, calls: [] }), setPermission: async (input: unknown) => { writes.push(input); } }, async (document, dom) => {
    assert.equal(document.querySelectorAll('[data-testid=integration-permissions] tbody tr').length, 2);
    const permissionList = document.querySelector('[data-testid=integration-permissions]')!;
    assert.doesNotMatch(permissionList.textContent || '', /Full operation description|One choice permits/u);
    const instanceDetails = [...permissionList.querySelectorAll('details')];
    assert.equal(instanceDetails.length, 2);
    assert.deepEqual(instanceDetails.map(detail => detail.querySelector('code')?.textContent), consumers.map(app => app.consumerRef));
    assert.ok(instanceDetails.every(detail => !detail.open), 'instance identifiers remain available without cluttering the list');
    assert.match(permissionList.textContent || '', /Reply to a received message/u);
    const connection = document.querySelector<HTMLElement>('[data-testid=integration-target]')!;
    await act(async () => connection.click());
    assert.equal(document.querySelectorAll('[role=option]').length, 3);
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find((option) => option.textContent === 'Feishu B · verified-b')!.click());
    assert.equal(document.querySelectorAll('[data-testid=integration-permissions] tbody tr').length, 1);
    await clickNamed(document, 'All permissions');
    assert.equal(document.querySelectorAll('tbody tr').length, 4);
    assert.match(document.body.textContent || '', /Retired app/u);
    assert.match(document.body.textContent || '', /old.read/u);
    assert.deepEqual(writes, [], 'navigation must not rewrite saved grants');
    const retired = [...document.querySelectorAll('tbody tr')].find(row => row.textContent?.includes('Retired app'))!;
    assert.equal([...retired.querySelectorAll('button')].some(button => button.textContent === 'Edit permissions'), false);
    await act(async () => [...retired.querySelectorAll('button')].find(button => button.textContent === 'Revoke')!.click());
    assert.deepEqual(writes, [], 'revoke must wait for confirmation');
    assert.match(document.body.textContent || '', /Revoke Retired app's authorization\?/u);
    assert.match(document.body.textContent || '', /will no longer be able to use the corresponding connection/u);
    assert.match(document.querySelector('[role=alertdialog]')?.textContent || document.querySelector('[role=dialog]')?.textContent || '', /retired-instance/u);
    await clickNamed(document, 'Revoke authorization');
    assert.deepEqual(writes, [{ consumerRef: 'retired-instance', targetRef: 'removed-source', operations: [] }]);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid=integration-service-app]')!.click());
    await clickNamed(document, 'Connection information');
    assert.match(document.body.textContent || '', /Source documentation/u);
    assert.equal([...document.querySelectorAll('button')].some(button => button.textContent === 'Remove connection'), false, 'app providers are not user-owned saved connections');
  });
});

test('call pagination and filters preserve all retained facts including removed targets and historical names', async () => {
  const target = { targetRef: 'current', kind: 'feishu', integrationId: 'feishu', displayName: 'Renamed connection', accountLabel: 'new account label', available: true, operations: [], permittedOperations: [] };
  const calls = Array.from({ length: 47 }, (_, index) => ({
    callId: `call-${index}`, targetRef: index % 2 ? 'removed' : 'current', operation: index === 46 ? 'app.original.operation' : 'feishu.updates.read',
    consumerDisplayName: index % 2 ? 'Former app name' : 'Lab', targetDisplayName: 'Name at call time', accountLabel: 'Original account',
    status: index === 46 ? 'unconfirmed' : index % 2 ? 'failed' : 'completed', errorCode: index === 46 ? 'SOURCE_CODE_PRESERVED' : '',
    createdAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-09T10:01:00Z', resultJson: '',
  }));
  await homePanel({ getManagement: async () => ({ targets: [target], consumers: [], permissions: [], calls }) }, async (document, dom) => {
    await clickNamed(document, 'All usage records');
    assert.equal(document.querySelectorAll('tbody tr').length, 20);
    assert.match(document.querySelector('tbody')!.textContent || '', /Former app name/u);
    assert.match(document.querySelector('tbody')!.textContent || '', /Name at call time/u);
    await clickNamed(document, 'Next'); assert.equal(document.querySelectorAll('tbody tr').length, 20);
    await clickNamed(document, 'Next'); assert.equal(document.querySelectorAll('tbody tr').length, 7);
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-controls="detail-call-46"]')!.click());
    const detail = document.getElementById('detail-call-46')!.textContent || '';
    for (const text of ['call-46', 'app.original.operation', 'SOURCE_CODE_PRESERVED', 'Original account', 'Name at call time', 'Last updated']) assert.ok(detail.includes(text), text);
    assert.match(detail, /Check the original outcome/u);
    await pickOption(document, 'integration-calls-filter-app', 'Former app name');
    assert.match(document.body.textContent || '', /Page 1 \/ 2/u, 'filter change resets pagination');
    await pickOption(document, 'integration-calls-filter-result', 'Completed');
    assert.match(document.body.textContent || '', /No calls match/u);
    await clickNamed(document, 'Clear filters');
    assert.equal(document.querySelectorAll('tbody tr').length, 20);
  });
});

test('adding authorization excludes existing grants, requires operations, and editing fixes the app', async () => {
  const operation = { name: 'feishu.updates.read', description: 'Read updates', effect: 'read', inputSchemaJson: '{}', outputSchemaJson: '{}' };
  const target = { targetRef: 'connection', kind: 'feishu', integrationId: 'feishu', displayName: 'Team connection', accountLabel: '', available: true, operations: [operation], permittedOperations: [] };
  const consumers = ['Existing app', 'New instance', 'Other connection app'].map((displayName, i) => ({ consumerRef: `instance-${i}`, appId: 'lab', displayName, sourceKind: 'development' }));
  const permissions = [
    { targetRef: target.targetRef, consumerRef: 'instance-0', operations: [operation.name] },
    { targetRef: target.targetRef, consumerRef: 'instance-1', operations: [] },
    { targetRef: 'other', consumerRef: 'instance-2', operations: [operation.name] },
  ];
  const writes: unknown[] = [];
  await homePanel({
    getManagement: async () => ({ targets: [target], consumers, permissions, calls: [] }),
    setPermission: async (input: typeof permissions[number]) => {
      writes.push(input);
      const existing = permissions.find(p => p.targetRef === input.targetRef && p.consumerRef === input.consumerRef);
      if (existing) existing.operations = input.operations;
      else permissions.push(input);
    },
  }, async (document) => {
    await clickNamed(document, 'Authorize apps');
    const drawer = () => document.querySelector('[data-testid=integration-permission-drawer][aria-hidden=false]')!;
    const save = () => [...drawer().querySelectorAll('button')].find(b => b.textContent === 'Confirm authorization')!;
    assert.match(drawer().textContent || '', /^Authorize apps/u);
    assert.doesNotMatch(drawer().textContent || '', /Existing app|Edit permissions/u);
    const appChecks = [...drawer().querySelectorAll<HTMLInputElement>('fieldset:first-of-type input')];
    assert.equal(appChecks.length, 2, 'filter by consumer instance and current connection; empty grants remain eligible');
    assert.equal(drawer().querySelectorAll('input:checked').length, 0);
    await act(async () => { appChecks.forEach(input => input.click()); });
    assert.equal(save().disabled, true, 'an empty permission set is not a new authorization');
    await act(async () => drawer().querySelector<HTMLInputElement>('[data-testid=integration-operations] input')!.click());
    assert.equal(save().disabled, false);
    await clickNamed(document, 'Confirm authorization');
    assert.deepEqual(writes, ['instance-1', 'instance-2'].map(consumerRef => ({ consumerRef, targetRef: target.targetRef, operations: [operation.name] })));
    await clickNamed(document, 'Authorize apps');
    assert.match(drawer().textContent || '', /All currently eligible apps are already authorized/u);
    assert.equal(drawer().querySelector('input'), null);
    assert.equal(save(), undefined);
    await act(async () => drawer().querySelector<HTMLButtonElement>('button[aria-label=Close]')!.click());
    const existingRow = [...document.querySelectorAll('tbody tr')].find(row => row.textContent?.includes('Existing app'))!;
    await act(async () => [...existingRow.querySelectorAll('button')].find(button => button.textContent === 'Edit permissions')!.click());
    assert.match(drawer().textContent || '', /^Edit permissions/u);
    assert.match(drawer().textContent || '', /Existing app/u);
    assert.doesNotMatch(drawer().textContent || '', /New instance|Other connection app/u);
    assert.equal(drawer().querySelectorAll('fieldset:first-of-type input').length, 0, 'editing cannot switch app');
    assert.equal(drawer().querySelector<HTMLInputElement>('[data-testid=integration-operations] input')!.checked, true);
    assert.equal(writes.length, 2, 'opening and canceling do not change permissions');
  });
});

test('editing a grant preserves missing catalog operations until explicitly withdrawn', async () => {
  const target = { targetRef: 'current', kind: 'mcp', integrationId: 'mcp', displayName: 'Tools', accountLabel: '', available: true, operations: [], permittedOperations: [] };
  const consumer = { consumerRef: 'lab-instance', appId: 'lab', displayName: 'Lab', sourceKind: 'development' };
  const permission = { targetRef: target.targetRef, consumerRef: consumer.consumerRef, operations: ['missing.tool'] };
  const writes: unknown[] = [];
  await homePanel({ getManagement: async () => ({ targets: [target], consumers: [consumer], permissions: [permission], calls: [] }), setPermission: async (input: unknown) => { writes.push(input); } }, async (document) => {
    await clickNamed(document, 'Edit permissions');
    const operation = [...document.querySelectorAll('label')].find(label => label.textContent === 'missing.tool')!.querySelector<HTMLInputElement>('input')!;
    assert.equal(operation.checked, true);
    await act(async () => operation.click());
    assert.equal(operation.isConnected, true, 'unchecking must not remove the option and prevent undo');
    await act(async () => operation.click());
    await clickNamed(document, 'Save permissions');
    assert.deepEqual(writes, [{ consumerRef: consumer.consumerRef, targetRef: target.targetRef, operations: ['missing.tool'] }]);
  });
});

test('Home clears an entered credential across adapter and Feishu setup-mode switches before submission',async()=>{
  const secrets:string[]=[];
  const integration={getManagement:empty,startConnectionSetup:async()=>({setupId:'audit',status:'awaiting-input',expiresAt:new Date(Date.now()+60000).toISOString()}),submitConnectionSetup:async(input:{secret:string})=>{secrets.push(input.secret);return {setupId:'audit',status:'failed',expiresAt:new Date(Date.now()+60000).toISOString()};}};
  await homePanel(integration,async(document,dom)=>{
    let form=await openServiceConnection(document,'qq-official');
    form.querySelector<HTMLInputElement>('input[type=password]')!.value='synthetic-old-service-canary';
    form=await openServiceConnection(document,'mcp');
    assert.equal(form.querySelector<HTMLInputElement>('input[type=password]')!.value,'');
    await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    assert.deepEqual(secrets,['']);
    form=await openServiceConnection(document,'feishu');
    form.querySelector<HTMLInputElement>('input[type=password]')!.value='synthetic-old-mode-canary';
    await pickOption(document,'integration-feishu-mode','Create an app with an official QR code');
    await pickOption(document,'integration-feishu-mode','Use an existing app');
    assert.equal(form.querySelector<HTMLInputElement>('input[type=password]')!.value,'');
    form=await openServiceConnection(document,'onebot-v11');
    const token=form.querySelector<HTMLInputElement>('input[type=password]')!;
    assert.equal(token.required,true);assert.match(token.parentElement!.textContent||'',/required/iu);
    form=await openServiceConnection(document,'mcp');assert.equal(form.querySelector<HTMLInputElement>('input[type=password]')!.required,false);
  });
});

for(const kind of ['qq-official','onebot-v11'])for(const available of [true,false])test(`Home offers explicit same-target credential refresh for ${kind}, available=${available}`,async()=>{
  const target={targetRef:'icon_existing',kind,integrationId:kind,displayName:'Existing bot',available,accountLabel:'original',operations:[],permittedOperations:[]};
  const started:Record<string,unknown>[]=[];
  await homePanel({getManagement:async()=>({targets:[target],permissions:[],consumers:[],calls:[]}),startConnectionSetup:async(input:Record<string,unknown>)=>{started.push(input);return {setupId:'audit',targetRef:'icon_existing',status:'failed',expiresAt:new Date(Date.now()+60000).toISOString()};}},async(document,dom)=>{
    assert.match(document.body.textContent||'',/Current connection/u);
    await pickOption(document,'integration-target','Existing bot · original');
    await clickNamed(document,'Connection information');
    if(!available){
      await clickNamed(document,'Check status again');
      assert.deepEqual(started,[],'checking status must not start credential replacement');
      assert.equal(Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Update authentication'),false);
    }
    const refresh=Array.from(document.querySelectorAll('button')).find(button=>button.textContent===(available?'Update authentication':'Reconnect'))!;
    assert.ok(refresh,'refresh action must exist without deleting the target');await act(async()=>refresh.click());
    const form=document.querySelector('form')!;
    assert.equal(form.querySelector('select'),null);
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
    const form = await openServiceConnection(document, adapter);
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    const alert = document.querySelector('[data-testid=integration-connection-drawer] [role=status]')!;
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
    const form = await openServiceConnection(document, adapter);
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

for (const status of ['completed', 'already-bound']) test(`Closing A's setup fences its late ${status} reply from B's permission editor`, async () => {
  const operations = ['qq-official.messages.send', 'qq-official.messages.reply'].map(name => ({ name, description: name, effect: 'write', inputSchemaJson: '{}', outputSchemaJson: '{}' }));
  const targets = ['A', 'B'].map(targetRef => ({ targetRef, kind: 'qq-official', integrationId: 'qq-official', displayName: `Bot ${targetRef}`, accountLabel: targetRef, available: true, operations, permittedOperations: [] }));
  const consumer = { consumerRef: 'consumer', appId: 'lab', displayName: 'Lab test', sourceKind: 'development' };
  const management = { targets, consumers: [consumer], permissions: targets.map(target => ({ targetRef: target.targetRef, consumerRef: consumer.consumerRef, operations: operations.map(op => op.name) })), calls: [] };
  const setup = { setupId: 'A-refresh', adapter: 'qq-official', targetRef: 'A', expiresAt: new Date(Date.now() + 60000).toISOString() };
  const terminal = deferred<Record<string, unknown>>(); const requests: Record<string, unknown>[] = []; const canceled: unknown[] = [];
  await homePanel({ getManagement: async () => management, startConnectionSetup: async () => ({ ...setup, status: 'awaiting-input' }), submitConnectionSetup: async () => ({ ...setup, status: 'verifying' }), getConnectionSetup: async () => terminal.promise, cancelConnectionSetup: async (input: unknown) => { canceled.push(input); return { ...setup, status: 'canceled' }; }, setPermission: async (input: Record<string, unknown>) => { requests.push(input); } }, async (document, dom) => {
    await clickNamed(document, 'Connection information');
    await clickNamed(document, 'Update authentication');
    await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid=integration-connection-drawer] button[aria-label=Close]')!.click(); });
    assert.deepEqual(canceled, [{ setupId: setup.setupId }]);
    const targetSelect = document.querySelector<HTMLElement>('[data-testid=integration-target]')!;
    await pickOption(document, 'integration-target', 'Bot B');
    await clickNamed(document, 'App permissions');
    await clickNamed(document, 'Edit permissions');
    const reply = Array.from(document.querySelectorAll('[data-testid=integration-operations] label')).find(label => label.textContent?.includes('Reply to a received message'))!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await act(async () => reply.click());
    await clickNamed(document, 'Save permissions');
    assert.match(document.querySelector('[role=alertdialog]')?.textContent || document.body.textContent || '', /Bot B/u);
    await act(async () => { terminal.resolve({ ...setup, status }); });
    assert.match(targetSelect.textContent || '', /Bot B/u);
    await clickNamed(document, 'Withdraw and save');
    assert.deepEqual(requests, [{ consumerRef: 'consumer', targetRef: 'B', operations: ['qq-official.messages.send'] }]);
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
    await openServiceConnection(document,'weixin');
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
