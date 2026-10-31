import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('mounted human composer separates peer/account drafts and retires old send completions', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { OfflineCoordinator } = await import('@nimiplatform/kit/core/offline-coordinator');
  const { createDesktopProductionOfflinePort } = await import('../src/shell/renderer/infra/offline/production-offline-port.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { RealmHumanChatDataProvider } = await import('../src/shell/renderer/features/chat/data/realm-human-chat-data-context.js');
  const { RealmSocialDataProvider } = await import('../src/shell/renderer/features/social/data/realm-social-data-context.js');
  const { HumanCanonicalComposer } = await import('../src/shell/renderer/features/chat/chat-human-canonical-composer-profile.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const project = (id: string) => store.getState().applyRuntimeAccountProjection({ status: 'authenticated', user: { id, realmEnvironmentId: 'realm' }, sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'revision' });
  project('alice');
  const offline = createDesktopProductionOfflinePort(new OfflineCoordinator(), { enableEphemeralStore: true, readScope: () => {
    const auth = store.getState().auth;
    return auth.status === 'authenticated' || auth.status === 'refresh-pending' ? { accountId: String(auth.user!.id), realmEnvironmentId: 'realm', generation: store.navigation.getSnapshot().generation } : null;
  } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const sendIds: string[] = [];
  let finish: (() => void) | undefined;
  let hold = true;
  const human = { sendChatMessage: async (chatId: string, text: string, options: { clientMessageId: string }) => {
    sendIds.push(options.clientMessageId);
    if (hold) await new Promise<void>(resolve => { finish = resolve; });
    return { id: 'message', chatId, senderId: 'alice', clientMessageId: options.clientMessageId, text, type: 'TEXT', payload: { content: text }, createdAt: new Date().toISOString() };
  } } as never;
  const bindings = { sdk: { offline }, clock: { schedule: () => () => undefined } } as never;
  const root = createRoot(dom.window.document.getElementById('root')!);
  let permissionRetries = 0;
  const render = async (peer: string, permission: 'allowed' | 'denied' | 'loading' | 'error' = 'allowed') => act(async () => root.render(<React.StrictMode><QueryClientProvider client={client}>
    <AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={bindings}>
      <RealmSocialDataProvider resource={{} as never}><RealmHumanChatDataProvider resource={human}>
        <HumanCanonicalComposer selectedChatId={`chat-${peer}`} contactAdmission={{ state: permission, blockedByMe: false, refresh: () => { permissionRetries += 1; } }} leadingAvatar={{ name: peer, targetId: peer }} />
      </RealmHumanChatDataProvider></RealmSocialDataProvider>
    </DesktopRendererBindingProvider></AppStoreProvider>
  </QueryClientProvider></React.StrictMode>));
  const field = () => dom.window.document.querySelector('textarea')!;
  const edit = async (text: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), text);
    field().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  try {
    await offline.saveHumanDraft({ peerAccountId: 'lost-file-peer', text: 'Keep my text', attachmentNames: ['one.png', 'two.png'] });
    await render('lost-file-peer');
    const missing = (name: string) => dom.window.document.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name}"]`);
    assert.ok(missing('one.png'));
    await act(async () => missing('one.png')!.click());
    assert.equal(field().value, 'Keep my text');
    await render('carol');
    await render('lost-file-peer');
    assert.equal(missing('one.png'), null);
    assert.ok(missing('two.png'));
    assert.deepEqual((await offline.loadHumanDraft('lost-file-peer'))?.attachmentNames, ['two.png']);
    await render('bob'); await edit('for Bob');
    await render('bob', 'loading');
    assert.equal((dom.window.document.querySelector('[data-chat-composer-send]') as HTMLButtonElement).disabled, true);
    assert.equal(field().value, 'for Bob');
    await render('bob', 'error');
    assert.match(dom.window.document.body.textContent || '', /Contact permissions could not be checked/);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click());
    assert.equal(permissionRetries, 1);
    await render('bob', 'denied');
    assert.equal((dom.window.document.querySelector('[data-chat-composer-send]') as HTMLButtonElement).disabled, true);
    assert.equal(sendIds.length, 0, 'denial does not dispatch a new send');
    await render('bob');
    await act(async () => store.setState({ auth: { ...store.getState().auth, status: 'refresh-pending' } }));
    assert.equal(field().value, 'for Bob', 'a normal refresh keeps the mounted composer');
    await act(async () => project('alice'));
    await render('carol'); assert.equal(field().value, ''); await edit('for Carol');
    await render('bob'); assert.equal(field().value, 'for Bob');
    await act(async () => (dom.window.document.querySelector('[data-chat-composer-send]') as HTMLButtonElement).click());
    assert.equal(sendIds.length, 1);
    await render('carol'); assert.equal(field().value, 'for Carol');
    await act(async () => { hold = false; finish!(); });
    assert.equal(field().value, 'for Carol', 'late Bob response cannot clear Carol input');
    await render('bob', 'denied');
    const retry = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Retry unconfirmed items');
    assert.ok(retry, 'retired send stays unconfirmed until an explicit same-ID retry');
    await act(async () => retry.click());
    assert.deepEqual(sendIds, [sendIds[0], sendIds[0]]);
    assert.equal(field().value, '');
    assert.equal((dom.window.document.querySelector('[data-chat-composer-send]') as HTMLButtonElement).disabled, true, 'confirmed retry does not grant permission for a new message');
    await render('bob');
    await edit('Alice private draft');
    await act(async () => project('dave'));
    assert.equal(field().value, '', 'account switch must not expose prior text');
    await act(async () => project('alice'));
    assert.equal(field().value, 'Alice private draft');
  } finally {
    await act(async () => root.unmount()); offline.dispose(); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
