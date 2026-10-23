import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createStore } from 'zustand/vanilla';

test('the mounted friend dialog submits without a profile read, survives refresh and rejects stale completions', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { FriendHandleLookupDialog } = await import('../src/shell/renderer/features/relationship/friend-handle-lookup-dialog.js');
  await initI18n(); await changeLocale('en');
  const store = createStore(() => ({ auth: { status: 'authenticated', user: { id: 'account-a' } as { id: string } | null }, runtimeDefaults: { realm: { realmBaseUrl: 'https://realm.example' } } }));
  const calls: unknown[] = [];
  let complete!: (value: { outcome: string }) => void;
  let reject!: (error: Error) => void;
  const realm = { social: {
    getUserByHandle: () => { throw new Error('Private profiles must never be read by this entry'); },
    addFriendByHandle: async (input: unknown) => { calls.push(input); return new Promise((resolve, fail) => { complete = resolve; reject = fail; }); },
  } };
  const bindings = { sdk: { socialData: { callApi: async (call: (value: unknown) => unknown) => call(realm) } } } as never;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const text = () => dom.window.document.body.textContent ?? '';
  const button = () => dom.window.document.querySelector('button[type="submit"]') as HTMLButtonElement;
  const edit = async (value: string) => act(async () => {
    const input = dom.window.document.querySelector('input')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const submit = async () => act(async () => {
    dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AppStoreProvider store={store as never}><DesktopRendererBindingProvider bindings={bindings}><DesktopMotionProvider><FriendHandleLookupDialog onClose={() => {}} /></DesktopMotionProvider></DesktopRendererBindingProvider></AppStoreProvider></QueryClientProvider>));
    assert.match(button().textContent ?? '', /Send friend request/);
    await edit(' @bob '); await submit();
    assert.equal(button().disabled, true);
    await act(async () => { store.setState({ auth: { status: 'refresh-pending', user: { id: 'account-a' } } }); store.setState({ auth: { status: 'authenticated', user: { id: 'account-a' } } }); complete({ outcome: 'requested' }); });
    assert.deepEqual(calls, [{ path: { handle: 'bob' }, body: {} }]);
    assert.match(text(), /Friend request sent/);
    assert.equal(button().disabled, true, 'a confirmed request is not resubmitted by the same button');
    await edit('@carol'); await submit();
    await act(async () => reject(new Error('friend request denied')));
    assert.match(text(), /could not be confirmed/);
    assert.equal(button().disabled, false);
    await edit('@dave'); await submit();
    await act(async () => {
      store.setState({ auth: { status: 'anonymous', user: null } });
      store.setState({ auth: { status: 'authenticated', user: { id: 'account-b' } } });
      store.setState({ auth: { status: 'authenticated', user: { id: 'account-a' } } });
      complete({ outcome: 'requested' });
    });
    assert.doesNotMatch(text(), /Friend request sent/);
    assert.equal(button().disabled, false, 'cancelled old-owner action must not keep the form pending');
  } finally {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
