import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { HomeExecutionNotificationControls } from '../src/shell/renderer/features/home/execution-notices.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function setup(initial: { version: number; systemEnabled: boolean; pausedUntil?: number }, initialNativeApply?: () => Promise<unknown>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const nativeEnabled: boolean[] = [];
  const nativeLanguages: string[] = [];
  const nativeApplications: Array<{ enabled: boolean; generation: string }> = [];
  let nativeContext = { generation: 'account-a-generation-1', state: 'ready', homeVisible: true };
  let contextReads = 0;
  let contextFailure: Error | undefined;
  let beforeNativeApply = initialNativeApply;
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event,
    React, IS_REACT_ACT_ENVIRONMENT: true,
    __NIMI_ELECTRON_TEST__: { invoke: async (command: string, payload: { payload?: { enabled?: boolean; language?: string; generation?: string } }) => {
      if (command === 'system_entry_context_get') {
        contextReads += 1;
        if (contextFailure) throw contextFailure;
        return { ...nativeContext };
      }
      if (command === 'desktop_execution_notices_preferences') {
        nativeApplications.push({ enabled: payload.payload?.enabled === true, generation: payload.payload?.generation ?? '' });
        const applied = beforeNativeApply ? await beforeNativeApply() : { applied: true };
        if (payload.payload?.enabled === true && (nativeContext.state !== 'ready' || payload.payload.generation !== nativeContext.generation)) {
          throw new Error('notification preference generation is stale');
        }
        if (applied && typeof applied === 'object' && 'applied' in applied && applied.applied === true) {
          nativeEnabled.push(payload.payload?.enabled === true);
          nativeLanguages.push(payload.payload?.language ?? '');
        }
        return applied;
      }
      return {};
    }, listen: () => () => {} },
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { ExecutionNotificationPreferenceSync, ExecutionNotificationSetting, useHomeExecutionNotificationControls } = await import('../src/shell/renderer/features/home/execution-notices.js');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().setAuthSession({ id: 'account-a' });
  const documents = new Map<string, unknown>([['account-a', initial], ['account-b', { version: 1, systemEnabled: true }]]);
  const writes: Array<{ account: string; value: unknown }> = [];
  let beforeRead: (() => Promise<void>) | undefined;
  let beforeWrite: (() => Promise<void>) | undefined;
  const client = (account: string) => ({ storage: {
    readJson: async () => { await beforeRead?.(); return { value: structuredClone(documents.get(account)) }; },
    writeJson: async (_path: string, value: unknown) => {
      writes.push({ account, value: structuredClone(value) });
      await beforeWrite?.(); documents.set(account, structuredClone(value));
    },
  } });
  let activeClient = client('account-a');
  const bindings = { sdk: { appProduct: () => activeClient } } as unknown as DesktopCanonicalRendererBindings;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const controls: HomeExecutionNotificationControls[] = [];
  function Consumer({ index }: { index: number }) { controls[index] = useHomeExecutionNotificationControls(); return null; }
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(<QueryClientProvider client={queryClient}><AppStoreProvider store={store}>
    <DesktopRendererBindingProvider bindings={bindings}><DesktopI18nResourceProvider resource={productionDesktopI18n}>
      <Consumer index={0} /><Consumer index={1} /><ExecutionNotificationPreferenceSync /><ExecutionNotificationSetting />
    </DesktopI18nResourceProvider></DesktopRendererBindingProvider>
  </AppStoreProvider></QueryClientProvider>));
  const settle = (ms = 40) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  await settle();
  return {
    dom, controls, writes, documents, nativeEnabled, nativeLanguages, nativeApplications, settle,
    contextReads: () => contextReads,
    setNativeContext: (generation: string, state = 'ready') => { nativeContext = { ...nativeContext, generation, state }; },
    failContextRead: (error: Error | undefined) => { contextFailure = error; },
    nativeApply: (fn: (() => Promise<unknown>) | undefined) => { beforeNativeApply = fn; },
    async retry() { await act(async () => {
      const retry = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Retry');
      assert.ok(retry, 'a failed native preference must expose its retry action');
      retry.click();
    }); await settle(); },
    async changeLanguage(language: 'en' | 'zh') { await act(async () => { await changeLocale(language); }); await settle(); },
    holdRead: (fn: (() => Promise<void>) | undefined) => { beforeRead = fn; },
    holdWrite: (fn: (() => Promise<void>) | undefined) => { beforeWrite = fn; },
    async switchAccount(account: string) { await act(async () => {
      activeClient = client(account);
      store.getState().setAuthSession({ id: account });
    }); },
    async close() {
      await act(async () => { root.unmount(); queryClient.clear(); await new Promise(resolve => setTimeout(resolve, 40)); });
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

test('Settings toggle and system-entry pause share one serial owner mutation and preserve both fields', async () => {
  const fixture = await setup({ version: 1, systemEnabled: true });
  const gate = deferred<void>();
  let first = true;
  fixture.holdWrite(async () => { if (first) { first = false; await gate.promise; } });
  try {
    let pause!: Promise<void>;
    await act(async () => {
      pause = fixture.controls[0]!.pause();
      fixture.dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await fixture.settle();
    assert.equal(fixture.writes.length, 1, 'the second hook must wait for the same mutation scope');
    gate.resolve();
    await act(async () => { await pause; });
    await fixture.settle();
    const stored = fixture.documents.get('account-a') as { systemEnabled: boolean; pausedUntil: number };
    assert.equal(stored.systemEnabled, false);
    assert.ok(stored.pausedUntil > Date.now());
    assert.match(fixture.dom.window.document.body.textContent ?? '', /paused until/);
    await act(async () => { await fixture.controls[1]!.resume(); });
    await fixture.settle();
    assert.deepEqual(fixture.documents.get('account-a'), { version: 1, systemEnabled: false });
    assert.equal(fixture.nativeEnabled.at(-1), false, 'ending pause must not enable permanently disabled notifications');
  } finally { gate.resolve(); await fixture.close(); }
});

test('an old account read and queued pause cannot write into the replacement account', async () => {
  const fixture = await setup({ version: 1, systemEnabled: true });
  const gate = deferred<void>();
  let held = true;
  fixture.holdRead(async () => { if (held) { held = false; await gate.promise; } });
  try {
    let first!: Promise<unknown>, second!: Promise<unknown>;
    await act(async () => {
      first = fixture.controls[0]!.pause().catch(error => error);
      second = fixture.controls[1]!.resume().catch(error => error);
    });
    await fixture.settle();
    await fixture.switchAccount('account-b');
    gate.resolve();
    const failures = await act(async () => Promise.all([first, second]));
    await fixture.settle();
    assert.ok(failures.every(value => value instanceof Error));
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(fixture.documents.get('account-b'), { version: 1, systemEnabled: true });
  } finally { gate.resolve(); await fixture.close(); }
});

test('pause expiry restores only the permanent setting without rewriting its document', async () => {
  for (const systemEnabled of [true, false]) {
    const fixture = await setup({ version: 1, systemEnabled, pausedUntil: Date.now() + 1000 });
    try {
      assert.ok(fixture.controls[0]!.pausedUntil > 0);
      assert.equal(fixture.nativeEnabled.at(-1), false);
      await fixture.settle(1100);
      assert.equal(fixture.controls[0]!.pausedUntil, 0);
      assert.equal(fixture.nativeEnabled.at(-1), systemEnabled);
      assert.equal(fixture.writes.length, 0, 'expiry derives display state; it does not migrate or rewrite preferences');
    } finally { await fixture.close(); }
  }
});

test('pause waits for a native acknowledgement and a rejected application is retriable from saved preferences', async () => {
  const fixture = await setup({ version: 1, systemEnabled: true });
  const gate = deferred<unknown>();
  fixture.nativeApply(() => gate.promise);
  try {
    let settled = false;
    let pause!: Promise<unknown>;
    await act(async () => {
      pause = fixture.controls[0]!.pause().then(() => { settled = true; }, error => { settled = true; return error; });
    });
    await fixture.settle();
    assert.equal(fixture.writes.length, 1);
    assert.equal(settled, false, 'saving a pause is not proof that native notifications paused');
    assert.equal(fixture.controls[1]!.pausedUntil, 0);
    assert.doesNotMatch(fixture.dom.window.document.body.textContent ?? '', /paused until/);
    gate.resolve({ applied: false });
    const failure = await act(async () => pause);
    await fixture.settle();
    assert.ok(failure instanceof Error);
    assert.equal(fixture.controls[0]!.pausedUntil, 0);
    assert.equal(fixture.controls[1]!.enabled, false, 'all consumers must treat a failed native application as unconfirmed');
    assert.equal(fixture.nativeEnabled.at(-1), true, 'the rejected native apply did not change the native setting');
    fixture.nativeApply(undefined);
    await fixture.retry();
    assert.ok(fixture.controls[0]!.pausedUntil > Date.now());
    assert.equal(fixture.nativeEnabled.at(-1), false);
    assert.equal(fixture.writes.length, 1, 'retry reapplies the saved preference without adding a second write');
  } finally { gate.resolve({ applied: true }); await fixture.close(); }
});

test('initial sync, language and account changes use the acknowledged owner path', async () => {
  const fixture = await setup({ version: 1, systemEnabled: true }, async () => { throw new Error('native temporarily unavailable'); });
  try {
    assert.equal(fixture.controls[0]!.enabled, false);
    assert.equal(fixture.nativeEnabled.length, 0);
    fixture.nativeApply(undefined);
    await fixture.retry();
    assert.equal(fixture.controls[0]!.enabled, true);
    assert.equal(fixture.nativeLanguages.at(-1), 'en');
    await fixture.changeLanguage('zh');
    assert.equal(fixture.nativeLanguages.at(-1), 'zh');
    fixture.documents.set('account-b', { version: 1, systemEnabled: false });
    await fixture.switchAccount('account-b');
    await fixture.settle();
    assert.equal(fixture.controls[0]!.enabled, false);
    assert.equal(fixture.nativeEnabled.at(-1), false);
    assert.equal(fixture.writes.length, 0);
  } finally { await fixture.close(); }
});

test('an expired pause stays unconfirmed when the native resume fails until retry acknowledges it', async () => {
  const fixture = await setup({ version: 1, systemEnabled: true, pausedUntil: Date.now() + 1000 });
  try {
    assert.ok(fixture.controls[0]!.pausedUntil > 0);
    fixture.nativeApply(async () => ({ applied: false }));
    await fixture.settle(1100);
    await fixture.settle();
    assert.equal(fixture.controls[0]!.enabled, false);
    assert.equal(fixture.controls[0]!.pausedUntil, 0);
    assert.equal(fixture.nativeEnabled.at(-1), false);
    fixture.nativeApply(undefined);
    await fixture.retry();
    assert.equal(fixture.controls[0]!.enabled, true);
    assert.equal(fixture.nativeEnabled.at(-1), true);
    assert.equal(fixture.writes.length, 0);
  } finally { await fixture.close(); }
});

test('an in-flight preference keeps its original generation and cannot re-enable after scope loss', async () => {
  const fixture = await setup({ version: 1, systemEnabled: true, pausedUntil: Date.now() + 60_000 });
  const gate = deferred<void>();
  let reading = true;
  fixture.holdRead(async () => { if (reading) { reading = false; await gate.promise; } });
  try {
    const reads = fixture.contextReads();
    let resume!: Promise<unknown>;
    await act(async () => { resume = fixture.controls[0]!.resume().catch(error => error); });
    await fixture.settle();
    assert.equal(fixture.contextReads(), reads + 1, 'generation is captured before the blocked storage read');
    fixture.setNativeContext('locked-generation-2', 'locked');
    gate.resolve();
    const failure = await act(async () => resume);
    await fixture.settle();
    assert.ok(failure instanceof Error);
    assert.deepEqual(fixture.nativeApplications.at(-1), { enabled: true, generation: 'account-a-generation-1' });
    assert.equal(fixture.contextReads(), reads + 1, 'the old document is never replayed with a newly read generation');
    assert.equal(fixture.nativeEnabled.at(-1), false);
    assert.equal(fixture.controls[0]!.enabled, false);
    assert.equal(fixture.controls[0]!.pausedUntil, 0);
    fixture.setNativeContext('ready-generation-3');
    await fixture.retry();
    assert.deepEqual(fixture.nativeApplications.at(-1), { enabled: true, generation: 'ready-generation-3' });
    assert.equal(fixture.controls[0]!.enabled, true);
  } finally { gate.resolve(); await fixture.close(); }
});

test('an unavailable native context cannot authorize enable and exposes retry', async () => {
  const fixture = await setup({ version: 1, systemEnabled: true, pausedUntil: Date.now() + 60_000 });
  try {
    fixture.failContextRead(new Error('current native admission unavailable'));
    const applications = fixture.nativeApplications.length;
    let failure!: unknown;
    await act(async () => { failure = await fixture.controls[0]!.resume().catch(error => error); });
    await fixture.settle();
    assert.ok(failure instanceof Error);
    assert.equal(fixture.nativeApplications.length, applications, 'an unavailable generation must not be sent with enabled:true');
    assert.equal(fixture.controls[0]!.enabled, false);
    fixture.failContextRead(undefined);
    await fixture.retry();
    assert.equal(fixture.controls[0]!.enabled, true);
    assert.equal(fixture.nativeEnabled.at(-1), true);
  } finally { await fixture.close(); }
});
