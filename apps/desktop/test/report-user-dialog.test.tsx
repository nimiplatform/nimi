import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('report dialog sends only a selected message reference and preserves the real submission receipt', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLFormElement: dom.window.HTMLFormElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle, ResizeObserver: Observer,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { ReportUserDialog } = await import('../src/shell/renderer/features/relationship/report-user-dialog.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  store.setState({ auth: { status: 'authenticated', sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'one', user: { id: 'account-a' } } });
  const submissions: unknown[] = [];
  const clipboard: string[] = [];
  const bindings = { sdk: { realm: () => ({ generated: { reportControllerCreateReport: async (request: unknown) => {
    submissions.push(request);
    return { id: 'real-receipt', reporterId: 'account-a', reason: 'OTHER', targetUserId: 'account-b', status: 'PENDING', createdAt: '2026-10-30T10:00:00Z' };
  } } }) }, app: { commands: { writeClipboardText: async (value: string) => { clipboard.push(value); } } } } as never;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (text: string) => [...dom.window.document.querySelectorAll('button')].find(element => element.textContent === text)!;
  try {
    await act(async () => root.render(<AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={bindings}><DesktopMotionProvider>
      <ReportUserDialog target={{ id: 'account-b', displayName: 'B' }} message={{ chatId: 'chat-1', messageId: 'message-1', previewText: 'Client preview is not evidence authority' }} onClose={() => {}} />
    </DesktopMotionProvider></DesktopRendererBindingProvider></AppStoreProvider>));
    assert.match(dom.window.document.body.textContent!, /Client preview/);
    await act(async () => {
      const area = dom.window.document.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'My explanation');
      area.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await act(async () => { dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.deepEqual(submissions, [{ path: {}, body: { targetType: 'USER', targetId: 'account-b', reason: 'OTHER', description: 'My explanation', messageEvidence: { chatId: 'chat-1', messageId: 'message-1' } } }]);
    assert.match(dom.window.document.body.textContent!, /real-receipt/);
    assert.match(dom.window.document.body.textContent!, /not a moderation decision/);
    assert.equal(button('Submit report'), undefined);
    await act(async () => button('Copy report ID').click());
    assert.deepEqual(clipboard, ['real-receipt']);
  } finally {
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 40)); }); store.navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
