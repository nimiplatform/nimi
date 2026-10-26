import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef, useState } from 'react';
import { JSDOM } from 'jsdom';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function setup() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { AppStoreProvider, useHomeDestination } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { useSettingsSaveGuard } = await import('../src/shell/renderer/features/settings/use-settings-save-guard.js');
  await initI18n(); await changeLocale('en');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  await store.navigation.push({ id: 'settings', settingsSection: 'privacy' });
  const requests: { value: string; resolve(ok: boolean): void }[] = [];
  const applied: string[] = [];
  let edit!: (value: string) => void;
  let save!: () => Promise<unknown>;
  let cancelledTimers = 0;
  let setPending!: (value: boolean) => void;
  function Draft() {
    const [value, setValue] = useState('original');
    const [baseline, setBaseline] = useState('original');
    const [uploading, setUploading] = useState(false); setPending = setUploading;
    const revision = useRef(0);
    edit = next => { revision.current++; setValue(next); };
    const guarded = useSettingsSaveGuard({ pending: uploading, dirty: value !== baseline, revision: revision.current, currentRevision: () => revision.current,
      cancelScheduled: () => { cancelledTimers++; },
      commit: async isCurrent => {
        const ok = await new Promise<boolean>(resolve => requests.push({ value, resolve }));
        if (ok && isCurrent()) { applied.push(value); setBaseline(value); }
        return ok;
      },
    });
    save = guarded.save;
    return <><output data-testid="draft">{value}</output>{guarded.dialog}</>;
  }
  function Page() { return useHomeDestination().id === 'settings' ? <Draft /> : <p>Home</p>; }
  await act(async () => { root.render(<AppStoreProvider store={store}><DesktopMotionProvider><Page /></DesktopMotionProvider></AppStoreProvider>); });
  return { store, requests, applied, edit: (value: string) => edit(value), save: () => save(), dom,
    cancelledTimers: () => cancelledTimers, setPending: (value: boolean) => setPending(value),
    close: async () => { await act(async () => root.unmount()); store.navigation.dispose(); dom.window.close();
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
    },
  };
}

test('leaving waits for an in-flight save and then saves edits made during that request', async () => {
  const f = await setup();
  try {
    await act(async () => { f.edit('first'); });
    let first!: Promise<unknown>;
    await act(async () => { first = f.save(); });
    await act(async () => { f.edit('latest'); });
    let leave!: ReturnType<typeof f.store.navigation.push>;
    await act(async () => { leave = f.store.navigation.push({ id: 'home' }); await tick(); });
    assert.equal(f.requests.length, 1);
    assert.equal(f.store.navigation.getSnapshot().current.destination.id, 'settings');
    await act(async () => { f.requests[0]!.resolve(true); await first; await tick(); });
    await act(async () => { await tick(); });
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1]!.value, 'latest');
    await act(async () => { f.requests[1]!.resolve(true); await leave; });
    assert.deepEqual(f.applied, ['first', 'latest']);
    assert.equal(f.store.navigation.getSnapshot().current.destination.id, 'home');
    assert.ok(f.cancelledTimers() > 0);
  } finally { await f.close(); }
});

test('failed save retains the page; only explicit discard permits the failed draft to leave', async () => {
  const f = await setup();
  try {
    await act(async () => { f.edit('unsaved'); });
    let leave!: ReturnType<typeof f.store.navigation.push>;
    await act(async () => { leave = f.store.navigation.push({ id: 'home' }); await tick(); });
    await act(async () => { f.requests[0]!.resolve(false); await tick(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    const button = (name: string) => [...f.dom.window.document.querySelectorAll('button')].find(e => e.textContent === name)!;
    assert.ok(button('Stay on this page'), f.dom.window.document.body.innerHTML);
    await act(async () => { button('Stay on this page').click(); await leave; });
    assert.equal(f.store.navigation.getSnapshot().current.destination.id, 'settings');
    assert.equal(f.dom.window.document.querySelector('[data-testid="draft"]')?.textContent, 'unsaved');
    await act(async () => { leave = f.store.navigation.push({ id: 'home' }); await tick(); });
    await act(async () => { f.requests[1]!.resolve(false); await tick(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    await act(async () => { button('Discard and leave').click(); await leave; });
    assert.equal(f.store.navigation.getSnapshot().current.destination.id, 'home');
    assert.deepEqual(f.applied, []);
  } finally { await f.close(); }
});

test('scope reset invalidates the pending navigation and its late save application', async () => {
  const f = await setup();
  try {
    await act(async () => { f.edit('old account'); });
    let leave!: ReturnType<typeof f.store.navigation.push>;
    await act(async () => { leave = f.store.navigation.push({ id: 'settings', settingsSection: 'logs' }); await tick(); });
    await act(async () => { f.store.navigation.reset({ id: 'home' }); });
    await act(async () => { f.requests[0]!.resolve(true); await leave; });
    assert.equal((await leave).status, 'invalidated');
    assert.deepEqual(f.applied, []);
    assert.equal(f.store.navigation.getSnapshot().current.destination.id, 'home');
  } finally { await f.close(); }
});


test('a pending upload begun while a save is awaited keeps the Settings page mounted', async () => {
  const f = await setup();
  try {
    await act(async () => { f.edit('new profile'); });
    let leave!: ReturnType<typeof f.store.navigation.push>;
    await act(async () => { leave = f.store.navigation.push({ id: 'home' }); await tick(); });
    await act(async () => { f.setPending(true); });
    await act(async () => { f.requests[0]!.resolve(true); await leave; });
    assert.equal((await leave).status, 'busy');
    assert.equal(f.store.navigation.getSnapshot().current.destination.id, 'settings');
  } finally { await f.close(); }
});
