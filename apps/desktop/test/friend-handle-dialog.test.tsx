import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createStore } from 'zustand/vanilla';

test('the mounted inline friend lookup submits without a profile read, survives refresh, supports request messages and rejects stale completions', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
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
  const { FriendHandleLookupView } = await import('../src/shell/renderer/features/relationship/friend-handle-lookup-view.js');
  await initI18n(); await changeLocale('en');
  const store = createStore(() => ({ auth: { status: 'authenticated', user: { id: 'account-a', handle: 'eric_nimi' } as { id: string; handle?: string } | null }, runtimeDefaults: { realm: { realmBaseUrl: 'https://realm.example' } } }));
  const calls: unknown[] = [];
  const copied: string[] = [];
  let sentRequestsOpened = 0;
  let complete!: (value: { outcome: string }) => void;
  let reject!: (error: Error) => void;
  const realm = { social: {
    getUserByHandle: () => { throw new Error('Private profiles must never be read by this entry'); },
    addFriendByHandle: async (input: unknown) => { calls.push(input); return new Promise((resolve, fail) => { complete = resolve; reject = fail; }); },
  } };
  const bindings = {
    sdk: { socialData: { callApi: async (call: (value: unknown) => unknown) => call(realm) } },
    app: { commands: { writeClipboardText: async (value: string) => { copied.push(value); } } },
  } as never;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const text = () => dom.window.document.body.textContent ?? '';
  const button = () => dom.window.document.querySelector('button[type="submit"]') as HTMLButtonElement;
  const buttonByText = (label: string) => [...dom.window.document.querySelectorAll('button')].find(el => el.textContent?.trim() === label);
  const edit = async (value: string) => act(async () => {
    const input = dom.window.document.querySelector('input')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const editMessage = async (value: string) => act(async () => {
    const textarea = dom.window.document.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const submit = async () => act(async () => {
    dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <AppStoreProvider store={store as never}>
          <DesktopRendererBindingProvider bindings={bindings}>
            <DesktopMotionProvider>
              <FriendHandleLookupView
                myHandle="eric_nimi"
                onOpenSentRequests={() => { sentRequestsOpened += 1; }}
              />
            </DesktopMotionProvider>
          </DesktopRendererBindingProvider>
        </AppStoreProvider>
      </QueryClientProvider>,
    ));
    assert.match(button().textContent ?? '', /Send friend request/);
    assert.equal(dom.window.document.querySelector('input')?.placeholder, 'e.g. @alex');
    assert.match(text(), /@eric_nimi/);
    await act(async () => { buttonByText('Copy')?.click(); });
    assert.deepEqual(copied, ['@eric_nimi']);
    assert.ok(buttonByText('Copied'));

    await act(async () => { await changeLocale('zh'); });
    assert.equal(dom.window.document.querySelector('input')?.placeholder, '例如：@alex');
    await act(async () => { await changeLocale('en'); });

    await edit(' @bob ');
    await submit();
    assert.equal(button().disabled, true);
    await act(async () => {
      store.setState({ auth: { status: 'refresh-pending', user: { id: 'account-a', handle: 'eric_nimi' } } });
      store.setState({ auth: { status: 'authenticated', user: { id: 'account-a', handle: 'eric_nimi' } } });
      complete({ outcome: 'requested' });
    });
    assert.deepEqual(calls, [{ path: { handle: 'bob' }, body: {} }]);
    assert.match(text(), /Friend request sent/);
    assert.equal(button().disabled, true, 'a confirmed request is not resubmitted by the same button');
    await act(async () => { buttonByText('View sent requests')?.click(); });
    assert.equal(sentRequestsOpened, 1);

    await act(async () => { buttonByText('Add another')?.click(); });
    assert.equal(dom.window.document.querySelector('input')?.value, '');
    await edit('@carol');
    await editMessage('Hi from Nimi');
    await submit();
    await act(async () => reject(new Error('friend request denied')));
    assert.deepEqual(calls[1], { path: { handle: 'carol' }, body: { requestMessage: 'Hi from Nimi' } });
    assert.match(text(), /could not be confirmed/);
    assert.equal(button().disabled, false);

    await edit('@dave');
    await editMessage('');
    await submit();
    await act(async () => {
      store.setState({ auth: { status: 'anonymous', user: null } });
      store.setState({ auth: { status: 'authenticated', user: { id: 'account-b' } } });
      store.setState({ auth: { status: 'authenticated', user: { id: 'account-a', handle: 'eric_nimi' } } });
      complete({ outcome: 'requested' });
    });
    assert.doesNotMatch(text(), /Friend request sent/);
    assert.equal(button().disabled, false, 'cancelled old-owner action must not keep the form pending');
  } finally {
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
    client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
