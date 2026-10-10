import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';


async function clickButton(document: Document, text: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === text);
  assert.ok(button, text);
  await act(async () => button.click());
}
async function openConnection(document: Document, kind?: string) {
  if (kind) await act(async () => document.querySelector<HTMLButtonElement>(`[data-testid=integration-service-${kind}]`)!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid=integration-add-connection]')!.click());
}

for (const locale of ['en', 'zh'] as const) {
test(`Home presents a safe, actionable native identity conflict in ${locale}`, async t => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { IntegrationsPanel } = await import('../src/shell/renderer/features/integrations/integrations-panel.js');
  await initI18n(); await changeLocale(locale);
  const epoch = Date.parse('2026-10-08T06:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  const setup = { setupId: 'native-conflict-fixture', adapter: 'weixin', status: 'awaiting-confirmation', expiresAt: new Date(epoch + 60000).toISOString(), verificationUrl: 'https://liteapp.weixin.qq.com/fixture', qrCodeUrl: '', accountLabel: '', targetRef: '', errorCode: '' };
  const integration = {
    getManagement: async () => ({ targets: [], consumers: [], permissions: [], calls: [] }),
    startConnectionSetup: async () => setup,
    getConnectionSetup: async () => ({ ...setup, status: 'failed', verificationUrl: '', errorCode: 'INTEGRATION_IDENTITY_ALREADY_CONNECTED' }),
    submitConnectionSetup: () => assert.fail('conflict must not submit credentials automatically'),
  };
  const bindings = { sdk: { appProduct: () => ({ integration }) } } as unknown as DesktopCanonicalRendererBindings;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<DesktopRendererBindingProvider bindings={bindings}><IntegrationsPanel onBack={() => {}} /></DesktopRendererBindingProvider>); });
    await openConnection(dom.window.document, 'weixin');
    const form = dom.window.document.querySelector('form')!;
    assert.equal(form.querySelector('select'), null);
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { t.mock.timers.tick(1000); });
    const panel = dom.window.document.querySelector('[data-testid="integration-setup"]')!;
    assert.match(panel.textContent || '', locale === 'en' ? /already connected.*existing connection.*remove.*Nimi account/iu : /已有连接.*不能重复添加.*已有连接.*Nimi 账号.*移除/u);
    assert.equal(panel.textContent?.includes('INTEGRATION_'), false);
    assert.equal(panel.querySelector('a'), null);
    assert.equal(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false);
  } finally {
    await act(async () => { root.unmount(); }); t.mock.timers.reset(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
}

// UI engineering fixture only: failed owner reads never stand in for successful
// platform setup or Desktop-supervised product acceptance.
test('Home recovers setup controls and clears QR and OTP after persistent RPC failure', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { IntegrationsPanel } = await import('../src/shell/renderer/features/integrations/integrations-panel.js');
  await initI18n(); await changeLocale('en');
  const epoch = Date.parse('2026-10-05T10:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  let queries = 0, canceled = 0; const startedInputs: unknown[] = [];
  const setup = { setupId: 'actual-fixture', adapter: 'weixin', status: 'awaiting-input', verificationUrl: 'https://liteapp.weixin.qq.com/fixture', expiresAt: new Date(epoch + 4000).toISOString(), accountLabel: '', targetRef: '', errorCode: '' };
  const integration = { getManagement: async () => ({ targets: [], consumers: [], permissions: [], calls: [] }), startConnectionSetup: async (input: unknown) => { startedInputs.push(input); return setup; }, submitConnectionSetup: () => assert.fail('Weixin must wait for explicit verification code'), getConnectionSetup: async () => { queries++; throw new Error('Runtime unavailable'); }, cancelConnectionSetup: async () => { canceled++; throw new Error('Runtime unavailable'); } };
  const bindings = { sdk: { appProduct: () => ({ integration }) } } as unknown as DesktopCanonicalRendererBindings;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<DesktopRendererBindingProvider bindings={bindings}><IntegrationsPanel onBack={() => {}} /></DesktopRendererBindingProvider>); });
    await openConnection(dom.window.document, 'weixin');
    assert.equal(dom.window.document.querySelector('input[maxlength="256"]'), null, 'Weixin QR has no name prerequisite');
    if (!dom.window.document.querySelector('form')) await openConnection(dom.window.document);
    const form = dom.window.document.querySelector('form')!;
    assert.equal((form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, false);
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.deepEqual(startedInputs, [{targetRef:'',adapter:'weixin',accountLabel:'',config:{weixin:{}}}]);
    const panel = dom.window.document.querySelector('[data-testid="integration-connection-drawer"]')!;
    assert.equal(form.querySelector('button[type="submit"]'), null);
    assert.ok(panel.querySelector('a[href="https://liteapp.weixin.qq.com/fixture"]'));
    const otp = panel.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    assert.ok(otp); otp.value = '123456';
    for (let index = 0; index < 3; index++) await act(async () => { t.mock.timers.tick(1000); });
    assert.equal(queries, 3);
    await act(async () => { t.mock.timers.tick(1000); });
    assert.equal(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, false);
    assert.equal(otp.value, ''); assert.equal(panel.querySelector('input[autocomplete="one-time-code"]'), null);
    assert.equal(panel.querySelector('a[href="https://liteapp.weixin.qq.com/fixture"]'), null);
    assert.match(panel.textContent || '', /final status could not be confirmed/u);
    assert.equal(canceled, 0, 'local observation expiry must not claim or issue remote cancellation');
    await act(async () => { t.mock.timers.tick(60000); }); assert.equal(queries, 3);
  } finally {
    await act(async () => { root.unmount(); }); t.mock.timers.reset(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

for (const terminalStatus of ['completed', 'already-bound'] as const) {
test(`Home shows one account and a truthful ${terminalStatus} terminal result`, async t => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  dom.window.Element.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { IntegrationsPanel } = await import('../src/shell/renderer/features/integrations/integrations-panel.js');
  await initI18n(); await changeLocale('en');
  const epoch = Date.parse('2026-10-06T10:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  const setup = { setupId: 'name-fixture', adapter: 'weixin', status: 'awaiting-confirmation', verificationUrl: 'https://liteapp.weixin.qq.com/fixture', qrCodeUrl: '', expiresAt: new Date(epoch + 60000).toISOString(), accountLabel: '', targetRef: '', errorCode: '' };
  const target = { targetRef: 'automatic', integrationId: 'weixin', kind: 'weixin', displayName: 'WeChat iLink · bot@im.bot', accountLabel: 'bot@im.bot', available: true, operations: [], permittedOperations: [], skill: '' };
  const integration = {
    getManagement: async () => ({ targets: [target, { ...target, targetRef: 'remark', displayName: 'My remark' }], consumers: [], permissions: [], calls: [{ callId:'ic_response_fixture',targetRef:target.targetRef,operation:'weixin.updates.read',status:'failed',resultJson:'',errorCode:'INTEGRATION_WEIXIN_RESPONSE_INVALID',consumerDisplayName:'Lab',targetDisplayName:target.displayName,accountLabel:target.accountLabel,createdAt:new Date(epoch).toISOString(),updatedAt:new Date(epoch).toISOString() }] }),
    startConnectionSetup: async (input: { targetRef: string }) => { assert.equal(input.targetRef, terminalStatus === 'already-bound' ? target.targetRef : ''); return { ...setup, targetRef: input.targetRef }; },
    getConnectionSetup: async () => ({ ...setup, status: terminalStatus, targetRef: target.targetRef, accountLabel: target.accountLabel, verificationUrl: '' }),
    cancelConnectionSetup: () => assert.fail('completed setup must not cancel'),
  };
  const bindings = { sdk: { appProduct: () => ({ integration }) } } as unknown as DesktopCanonicalRendererBindings;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<DesktopRendererBindingProvider bindings={bindings}><IntegrationsPanel onBack={() => {}} /></DesktopRendererBindingProvider>); });
    await act(async () => dom.window.document.querySelector<HTMLElement>('[data-testid=integration-target]')!.click());
    const options = [...dom.window.document.querySelectorAll<HTMLElement>('[role=option]')];
    assert.ok(options.some(option => option.textContent === 'My remark · bot@im.bot'));
    const selectedOption = options.find(option => option.textContent === target.displayName);
    assert.ok(selectedOption);
    await act(async () => selectedOption.click());
    await clickButton(dom.window.document, 'Usage records');
    await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('button[aria-controls="detail-ic_response_fixture"]')!.click(); });
    assert.match(dom.window.document.querySelector('tbody')?.textContent || '', /WeChat returned a response Nimi could not verify/u);
    if (terminalStatus === 'already-bound') {
      await clickButton(dom.window.document, 'Connection information');
      await clickButton(dom.window.document, 'Update authentication');
    } else {
      await openConnection(dom.window.document);
    }
    const form = dom.window.document.querySelector('form')!;
    assert.equal(form.querySelector('select'), null);
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.match(dom.window.document.querySelector('[data-testid="integration-setup"]')?.textContent || '', /Setup session expires/u);
    await act(async () => { t.mock.timers.tick(1000); });
    const panel = dom.window.document.querySelector('[data-testid="integration-setup"]')!;
    assert.match(panel.textContent || '', terminalStatus === 'already-bound' ? /Already bound.*no update needed/iu : /ready|connected/iu);
    if (terminalStatus === 'already-bound') {
      assert.match(dom.window.document.body.textContent || '', /No credentials were updated; existing permissions are unchanged/u);
      assert.equal(dom.window.document.body.textContent?.includes('Connected. Select operations'), false);
    }
    assert.equal(panel.textContent?.includes('expires'), false);
    assert.equal(panel.querySelector('a'), null);
    assert.equal(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false);
  } finally {
    await act(async () => { root.unmount(); }); t.mock.timers.reset(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
}

test('a late initial submit cannot replace a new setup after expiry or restore its QR', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { IntegrationsPanel } = await import('../src/shell/renderer/features/integrations/integrations-panel.js');
  await initI18n(); await changeLocale('en');
  const epoch = Date.parse('2026-10-05T10:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  const oldSetup = { setupId: 'old', adapter: 'mcp', status: 'awaiting-input', verificationUrl: '', expiresAt: new Date(epoch + 4000).toISOString(), accountLabel: 'Old setup', targetRef: '', errorCode: '' };
  let resolveOld!: (value: typeof oldSetup) => void;
  let starts = 0, submits = 0;
  const newSetup = { ...oldSetup, setupId: 'new', adapter: 'weixin', status: 'awaiting-confirmation', accountLabel: 'New setup', verificationUrl: 'https://liteapp.weixin.qq.com/new', expiresAt: new Date(epoch + 64000).toISOString() };
  const integration = {
    getManagement: async () => ({ targets: [], consumers: [], permissions: [], calls: [] }),
    startConnectionSetup: async () => { starts++; return starts === 1 ? oldSetup : newSetup; },
    submitConnectionSetup: () => { submits++; return new Promise<typeof oldSetup>(resolve => { resolveOld = resolve; }); },
    getConnectionSetup: async () => { throw new Error('Runtime unavailable'); },
    cancelConnectionSetup: async () => ({ ...newSetup, status: 'canceled' }),
  };
  const bindings = { sdk: { appProduct: () => ({ integration }) } } as unknown as DesktopCanonicalRendererBindings;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<DesktopRendererBindingProvider bindings={bindings}><IntegrationsPanel onBack={() => {}} /></DesktopRendererBindingProvider>); });
    if (!dom.window.document.querySelector('form')) await openConnection(dom.window.document);
    let form = dom.window.document.querySelector('form')!;
    const name = form.querySelector('input[maxlength="256"]') as HTMLInputElement;
    const address = form.querySelector('input[type="url"]') as HTMLInputElement;
    await act(async () => {
      for (const [input, value] of [[name, 'Test account'], [address, 'https://example.com/mcp']] as const) {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      }
    });
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(submits, 1);
    await act(async () => { t.mock.timers.tick(4000); });
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[data-testid=integration-connection-drawer] button[aria-label=Close]')!.click());
    await openConnection(dom.window.document, 'weixin');
    form = dom.window.document.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    const panel = dom.window.document.querySelector('[data-testid="integration-setup"]')!;
    assert.match(panel.textContent || '', /New setup/u);
    assert.ok(panel.querySelector('a[href="https://liteapp.weixin.qq.com/new"]'));
    await act(async () => { resolveOld({ ...oldSetup, status: 'verifying', verificationUrl: 'https://liteapp.weixin.qq.com/expired' }); });
    assert.match(panel.textContent || '', /New setup/u);
    assert.equal(panel.textContent?.includes('Old setup'), false);
    assert.ok(panel.querySelector('a[href="https://liteapp.weixin.qq.com/new"]'));
    assert.equal(panel.querySelector('a[href="https://liteapp.weixin.qq.com/expired"]'), null);
    assert.equal(starts, 2); assert.equal(submits, 1);
    assert.equal(form.querySelector('button[type=submit]'), null, 'a live setup does not offer another start');
  } finally {
    await act(async () => { root.unmount(); }); t.mock.timers.reset(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

for (const outcome of ['confirm', 'cancel', 'expiry', 'unmount', 'late-confirm'] as const) {
test(`Home new bot requires explicit confirmation and clears old grant draft: ${outcome}`, async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url:'http://localhost',pretendToBeVisual:true});
  const values = {window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,HTMLFormElement:dom.window.HTMLFormElement,HTMLInputElement:dom.window.HTMLInputElement,Element:dom.window.Element,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,DocumentFragment:dom.window.DocumentFragment,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,getComputedStyle:dom.window.getComputedStyle,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),React,IS_REACT_ACT_ENVIRONMENT:true};
  const previous = new Map(Object.keys(values).map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(values)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const {createRoot} = await import('react-dom/client');
  const {initI18n,changeLocale} = await import('../src/shell/renderer/i18n/index.js');
  const {DesktopRendererBindingProvider} = await import('../src/shell/renderer/renderer/binding-context.js');
  const {IntegrationsPanel} = await import('../src/shell/renderer/features/integrations/integrations-panel.js');
  await initI18n();await changeLocale('en');
  const epoch=Date.parse('2026-10-07T10:00:00Z');
  t.mock.timers.enable({apis:['Date','setTimeout'],now:epoch});
  const operation={name:'weixin.messages.reply',description:'Reply to a selected message',inputSchemaJson:'{}',outputSchemaJson:'{}',effect:'write',supportsCancel:true,retryPolicy:'none'};
  const old={targetRef:'icon_original',integrationId:'weixin',kind:'weixin',displayName:'Original remark',accountLabel:'original@im.bot',available:true,operations:[operation],permittedOperations:[],skill:''};
  const created={...old,targetRef:'icon_new',displayName:'WeChat iLink · candidate@im.bot',accountLabel:'candidate@im.bot'};
  const pending={setupId:'iset_candidate',adapter:'weixin',status:'awaiting-new-target',verificationUrl:'',qrCodeUrl:'',expiresAt:new Date(epoch+4000).toISOString(),accountLabel:created.accountLabel,targetRef:old.targetRef,errorCode:''};
  const complete={...pending,status:'completed',targetRef:created.targetRef};
  let targets=[old],canceled=0;const submitted:unknown[]=[];
  let release:((value:typeof complete)=>void)|undefined;
  const integration={
    getManagement:async()=>({targets,consumers:[{consumerRef:'icons_lab',appId:'nimi.lab',displayName:'Nimi Lab',sourceKind:'development'}],permissions:[{consumerRef:'icons_lab',targetRef:old.targetRef,operations:[operation.name],consumer:null}],calls:[]}),
    startConnectionSetup:async(input:unknown)=>{assert.deepEqual(input,{targetRef:old.targetRef,adapter:'weixin',accountLabel:'',config:{weixin:{}}});return pending;},
    getConnectionSetup:async()=>{if(outcome==='expiry'||outcome==='late-confirm')throw new Error('unavailable');return pending;},
    submitConnectionSetup:async(input:unknown)=>{submitted.push(input);if(outcome==='late-confirm')return new Promise<typeof complete>(resolve=>{release=resolve;});targets=[old,created];return complete;},
    cancelConnectionSetup:async(input:unknown)=>{assert.deepEqual(input,{setupId:pending.setupId});canceled++;return {...pending,status:'canceled',accountLabel:''};},
    setPermission:()=>assert.fail('new connection must not grant automatically'),
  };
  const bindings={sdk:{appProduct:()=>({integration})}} as unknown as DesktopCanonicalRendererBindings;
  const root=createRoot(dom.window.document.getElementById('root')!);let unmounted=false;
  const button=(name:string)=>Array.from(dom.window.document.querySelectorAll('button')).find(item=>item.textContent===name)!;
  try {
    await act(async()=>{root.render(<DesktopRendererBindingProvider bindings={bindings}><IntegrationsPanel onBack={()=>{}}/></DesktopRendererBindingProvider>);});
    const targetSelect=dom.window.document.querySelector<HTMLElement>('[data-testid=integration-target]')!;
    assert.equal(targetSelect.textContent, `${old.displayName} · ${old.accountLabel}`);
    await clickButton(dom.window.document, 'Edit permissions');
    assert.equal(dom.window.document.querySelectorAll('input:checked').length,1,'existing operation draft selected for the fixed App');
    await act(async()=>{dom.window.document.querySelector<HTMLButtonElement>('[data-testid=integration-permission-drawer] button[aria-label=Close]')!.click();});
    await clickButton(dom.window.document, 'Connection information');
    await act(async()=>{button('Update authentication').click();});
    const form=dom.window.document.querySelector('form')!;
    assert.equal(form.querySelector('input[maxlength="256"]'),null,'no manual name prerequisite');
    await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    const setup=dom.window.document.querySelector('[data-testid="integration-setup"]')!;
    assert.match(setup.textContent||'',/candidate@im.bot/u);
    assert.match(setup.textContent||'',/original connection/u);
    assert.equal(setup.querySelector('a'),null);assert.equal(submitted.length,0);
    const confirm=button('Confirm new connection');assert.ok(confirm);assert.equal(confirm.type,'button');
    if(outcome==='confirm') {
      await act(async()=>{confirm.click();});
      assert.deepEqual(submitted,[{setupId:pending.setupId,secret:'',verificationCode:'',action:'create-new-target'}]);
      assert.equal(targetSelect.textContent,created.displayName);
      // The exiting drawer can retain its last DOM during the shared overlay animation.
      // Assert the new editor's draft below after opening it through the current target.
      assert.match(dom.window.document.body.textContent||'',/New connection created/u);
      await act(async()=>{dom.window.document.querySelector<HTMLButtonElement>('[data-testid=integration-connection-drawer] button[aria-label=Close]')!.click();});
      await clickButton(dom.window.document, 'App permissions');
      await clickButton(dom.window.document, 'Authorize apps');
      assert.equal(button('Confirm authorization').disabled,true);
      assert.equal(dom.window.document.querySelectorAll('[data-testid=integration-permission-drawer][aria-hidden=false] input:checked').length,0);
    } else if(outcome==='cancel') {
      await act(async()=>{button('Cancel connection').click();});
      await act(async()=>{t.mock.timers.tick(1000);});
      assert.equal(canceled,1);assert.equal(submitted.length,0);assert.equal(button('Confirm new connection'),undefined);
    } else if(outcome==='unmount') {
      await act(async()=>{root.unmount();});unmounted=true;assert.equal(canceled,1);assert.equal(submitted.length,0);
    } else {
      if(outcome==='late-confirm') {await act(async()=>{confirm.click();});assert.ok(release);}
      for(let i=0;i<4;i++)await act(async()=>{t.mock.timers.tick(1000);});
      assert.equal(button('Confirm new connection'),undefined);
      if(release)await act(async()=>{release!(complete);});
      assert.equal(targetSelect.textContent,`${old.displayName} · ${old.accountLabel}`,'late completion cannot select a new target');
      assert.equal(submitted.length,outcome==='expiry'?0:1);
    }
  } finally {
    if(!unmounted)await act(async()=>{root.unmount();});
    t.mock.timers.reset();dom.window.close();
    for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
}
